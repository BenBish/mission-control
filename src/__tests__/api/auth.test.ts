/**
 * Authentication Tests
 * Covers JWT auth, login/logout endpoints, rate limiting, API key auth,
 * middleware bypass, and backward compatibility.
 */

import {
  resolveAuthConfig,
  signToken,
  verifyToken,
  verifyPassword,
  authMiddleware,
  setupAuthRoutes,
  RateLimiter,
  type AuthConfig,
} from "../../server/auth.js";
import express from "express";
import { Database } from "../../db/database.js";
import { setupRoutes } from "../../server/routes/index.js";
import * as fs from "fs";
import * as http from "http";

const TEST_DB_PATH = "./test-data/test-auth.db";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Make a real HTTP request to the test server */
async function request(
  server: http.Server,
  method: string,
  path: string,
  options: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    cookie?: string;
  } = {},
): Promise<{
  status: number;
  body: any;
  headers: http.IncomingHttpHeaders;
  setCookie: string[];
}> {
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}${path}`;

  const fetchHeaders: Record<string, string> = {
    ...options.headers,
  };
  if (options.body) {
    fetchHeaders["Content-Type"] = "application/json";
  }
  if (options.cookie) {
    fetchHeaders["Cookie"] = options.cookie;
  }

  const res = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });

  const body = await res.json().catch(() => null);
  const setCookie = res.headers.getSetCookie?.() || [];

  return {
    status: res.status,
    body,
    headers: Object.fromEntries(res.headers.entries()),
    setCookie,
  };
}

/** Extract cookie value from Set-Cookie headers */
function extractCookie(
  setCookieHeaders: string[],
  name: string,
): string | null {
  for (const header of setCookieHeaders) {
    if (header.startsWith(`${name}=`)) {
      const value = header.split(";")[0].split("=").slice(1).join("=");
      return `${name}=${value}`;
    }
  }
  return null;
}

// ─── Unit Tests ─────────────────────────────────────────────────────────────

describe("Auth Module - Unit Tests", () => {
  describe("resolveAuthConfig", () => {
    const origEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...origEnv };
    });

    test("returns disabled config by default", () => {
      delete process.env.MC_AUTH_ENABLED;
      delete process.env.MC_PASSWORD_HASH;
      const config = resolveAuthConfig();
      expect(config.enabled).toBe(false);
      expect(config.username).toBe("admin");
    });

    test("throws when auth enabled but no password hash", () => {
      process.env.MC_AUTH_ENABLED = "true";
      delete process.env.MC_PASSWORD_HASH;
      expect(() => resolveAuthConfig()).toThrow("MC_PASSWORD_HASH");
    });

    test("returns enabled config with password hash", () => {
      process.env.MC_AUTH_ENABLED = "true";
      process.env.MC_PASSWORD_HASH = "$2b$10$test";
      const config = resolveAuthConfig();
      expect(config.enabled).toBe(true);
      expect(config.passwordHash).toBe("$2b$10$test");
    });

    test("uses custom username from env", () => {
      process.env.MC_USERNAME = "ops";
      const config = resolveAuthConfig();
      expect(config.username).toBe("ops");
    });

    test("parses session TTL from env", () => {
      process.env.MC_SESSION_TTL = "3600";
      const config = resolveAuthConfig();
      expect(config.sessionTtl).toBe(3600);
    });

    test("sets secureCookie based on NODE_ENV", () => {
      process.env.NODE_ENV = "production";
      const config = resolveAuthConfig();
      expect(config.secureCookie).toBe(true);
    });
  });

  describe("JWT sign/verify", () => {
    let config: AuthConfig;

    beforeAll(() => {
      config = {
        enabled: true,
        username: "admin",
        passwordHash: "hash",
        jwtSecret: new TextEncoder().encode("test-secret-key-32-bytes-long!!"),
        apiKey: undefined,
        sessionTtl: 3600,
        secureCookie: false,
      };
    });

    test("signs and verifies a token", async () => {
      const token = await signToken(config, "admin");
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);

      const payload = await verifyToken(config, token);
      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe("admin");
    });

    test("rejects tampered token", async () => {
      const token = await signToken(config, "admin");
      const tampered = token.slice(0, -5) + "XXXXX";
      const payload = await verifyToken(config, tampered);
      expect(payload).toBeNull();
    });

    test("rejects token signed with different secret", async () => {
      const otherConfig = {
        ...config,
        jwtSecret: new TextEncoder().encode("different-secret!!!!!!!!!!!!!!!!"),
      };
      const token = await signToken(config, "admin");
      const payload = await verifyToken(otherConfig, token);
      expect(payload).toBeNull();
    });

    test("rejects expired token", async () => {
      const shortConfig = { ...config, sessionTtl: 0 };
      const token = await signToken(shortConfig, "admin");
      // Wait a moment for expiration
      await new Promise((r) => setTimeout(r, 1100));
      const payload = await verifyToken(shortConfig, token);
      expect(payload).toBeNull();
    });
  });

  describe("verifyPassword", () => {
    test("verifies bcrypt hash", async () => {
      const hash = await Bun.password.hash("testpass123");
      expect(await verifyPassword("testpass123", hash)).toBe(true);
      expect(await verifyPassword("wrongpass", hash)).toBe(false);
    });
  });

  describe("RateLimiter", () => {
    test("allows up to maxAttempts", () => {
      const limiter = new RateLimiter(3, 60_000);
      expect(limiter.check("1.2.3.4")).toBe(true); // 1
      expect(limiter.check("1.2.3.4")).toBe(true); // 2
      expect(limiter.check("1.2.3.4")).toBe(true); // 3
      expect(limiter.check("1.2.3.4")).toBe(false); // 4 — blocked
    });

    test("different IPs are independent", () => {
      const limiter = new RateLimiter(1, 60_000);
      expect(limiter.check("1.1.1.1")).toBe(true);
      expect(limiter.check("1.1.1.1")).toBe(false);
      expect(limiter.check("2.2.2.2")).toBe(true); // different IP
    });

    test("reset clears limit", () => {
      const limiter = new RateLimiter(1, 60_000);
      limiter.check("1.1.1.1");
      expect(limiter.check("1.1.1.1")).toBe(false);
      limiter.reset("1.1.1.1");
      expect(limiter.check("1.1.1.1")).toBe(true);
    });

    test("remaining returns correct count", () => {
      const limiter = new RateLimiter(5, 60_000);
      expect(limiter.remaining("1.1.1.1")).toBe(5);
      limiter.check("1.1.1.1");
      expect(limiter.remaining("1.1.1.1")).toBe(4);
    });
  });
});

// ─── Integration Tests ──────────────────────────────────────────────────────

describe("Auth Module - Integration Tests", () => {
  let db: Database;
  let passwordHash: string;

  beforeAll(async () => {
    if (!fs.existsSync("./test-data")) {
      fs.mkdirSync("./test-data", { recursive: true });
    }
    db = new Database(TEST_DB_PATH);
    await db.initialize();

    // Generate a real password hash
    passwordHash = await Bun.password.hash("admin123");
  });

  afterAll(async () => {
    await db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  /** Create a test server with auth enabled */
  function createAuthServer(overrides: Partial<AuthConfig> = {}): {
    app: express.Express;
    config: AuthConfig;
  } {
    const config: AuthConfig = {
      enabled: true,
      username: "admin",
      passwordHash,
      jwtSecret: new TextEncoder().encode(
        "test-integration-secret-key-32bytes!",
      ),
      apiKey: "test-api-key-123",
      sessionTtl: 3600,
      secureCookie: false,
      ...overrides,
    };

    const app = express();
    app.use(express.json());

    setupAuthRoutes(app, config);
    app.use(authMiddleware(config));
    setupRoutes(app, db);

    return { app, config };
  }

  /** Start a server and return it with a cleanup fn */
  async function startServer(overrides: Partial<AuthConfig> = {}): Promise<{
    server: http.Server;
    config: AuthConfig;
    close: () => Promise<void>;
  }> {
    const { app, config } = createAuthServer(overrides);
    return new Promise((resolve) => {
      const server = app.listen(0, () => {
        resolve({
          server,
          config,
          close: () => new Promise<void>((res) => server.close(() => res())),
        });
      });
    });
  }

  describe("POST /api/auth/login", () => {
    test("returns 200 with valid credentials and sets HttpOnly cookie", async () => {
      const { server, close } = await startServer();
      try {
        const res = await request(server, "POST", "/api/auth/login", {
          body: { username: "admin", password: "admin123" },
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.user.username).toBe("admin");

        // Check Set-Cookie header
        const cookie = res.setCookie.find((c: string) =>
          c.startsWith("mc_session="),
        );
        expect(cookie).toBeTruthy();
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Strict");
      } finally {
        await close();
      }
    });

    test("returns 401 with wrong password", async () => {
      const { server, close } = await startServer();
      try {
        const res = await request(server, "POST", "/api/auth/login", {
          body: { username: "admin", password: "wrongpass" },
        });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.setCookie.length).toBe(0);
      } finally {
        await close();
      }
    });

    test("returns 401 with wrong username", async () => {
      const { server, close } = await startServer();
      try {
        const res = await request(server, "POST", "/api/auth/login", {
          body: { username: "notadmin", password: "admin123" },
        });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      } finally {
        await close();
      }
    });

    test("returns 400 with missing credentials", async () => {
      const { server, close } = await startServer();
      try {
        const res = await request(server, "POST", "/api/auth/login", {
          body: {},
        });

        expect(res.status).toBe(400);
      } finally {
        await close();
      }
    });

    test("rate limits after 5 failed attempts", async () => {
      const { server, close } = await startServer();
      try {
        // Make 5 failed attempts (these are allowed by the limiter)
        for (let i = 0; i < 5; i++) {
          await request(server, "POST", "/api/auth/login", {
            body: { username: "admin", password: "wrong" },
          });
        }

        // 6th attempt should be rate-limited
        const res = await request(server, "POST", "/api/auth/login", {
          body: { username: "admin", password: "wrong" },
        });

        expect(res.status).toBe(429);
        expect(res.body.error).toContain("Too many");
      } finally {
        await close();
      }
    });
  });

  describe("POST /api/auth/logout", () => {
    test("clears the auth cookie", async () => {
      const { server, close } = await startServer();
      try {
        // Login first
        const loginRes = await request(server, "POST", "/api/auth/login", {
          body: { username: "admin", password: "admin123" },
        });
        const cookie = extractCookie(loginRes.setCookie, "mc_session");

        // Logout
        const logoutRes = await request(server, "POST", "/api/auth/logout", {
          cookie: cookie!,
        });

        expect(logoutRes.status).toBe(200);
        expect(logoutRes.body.success).toBe(true);

        // Cookie should be cleared (max-age=0 or expires in past)
        const clearCookie = logoutRes.setCookie.find((c: string) =>
          c.startsWith("mc_session="),
        );
        expect(clearCookie).toBeTruthy();
      } finally {
        await close();
      }
    });
  });

  describe("Protected endpoints", () => {
    test("returns 401 for API calls without auth cookie", async () => {
      const { server, close } = await startServer();
      try {
        const res = await request(server, "GET", "/api/health");
        // /api/health is public
        expect(res.status).toBe(200);

        // /api/activities requires auth
        const res2 = await request(server, "GET", "/api/activities");
        expect(res2.status).toBe(401);
      } finally {
        await close();
      }
    });

    test("allows API calls with valid auth cookie", async () => {
      const { server, close } = await startServer();
      try {
        // Login
        const loginRes = await request(server, "POST", "/api/auth/login", {
          body: { username: "admin", password: "admin123" },
        });
        const cookie = extractCookie(loginRes.setCookie, "mc_session");

        // Access protected endpoint
        const res = await request(server, "GET", "/api/activities", {
          cookie: cookie!,
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      } finally {
        await close();
      }
    });

    test("allows POST /api/ingest/batch with valid API key", async () => {
      const { server, close } = await startServer();
      try {
        const res = await request(server, "POST", "/api/ingest/batch", {
          headers: { "X-API-Key": "test-api-key-123" },
          body: {
            sourceId: "claude-code",
            instanceId: "claude-code@arch-desktop",
            collectorVersion: "test",
            sentAt: new Date().toISOString(),
            events: [],
          },
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      } finally {
        await close();
      }
    });

    test("rejects POST /api/ingest/batch with wrong API key", async () => {
      const { server, close } = await startServer();
      try {
        const res = await request(server, "POST", "/api/ingest/batch", {
          headers: { "X-API-Key": "wrong-key" },
          body: {
            sourceId: "claude-code",
            instanceId: "claude-code@arch-desktop",
            collectorVersion: "test",
            sentAt: new Date().toISOString(),
            events: [],
          },
        });
        expect(res.status).toBe(401);
      } finally {
        await close();
      }
    });
  });

  describe("Backward compatibility (auth disabled)", () => {
    test("all endpoints accessible without auth when disabled", async () => {
      const { server, close } = await startServer({ enabled: false });
      try {
        const res = await request(server, "GET", "/api/activities");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const res2 = await request(server, "GET", "/api/sources");
        expect(res2.status).toBe(200);
      } finally {
        await close();
      }
    });

    test("/api/auth/me returns authEnabled=false when disabled", async () => {
      const { server, close } = await startServer({ enabled: false });
      try {
        const res = await request(server, "GET", "/api/auth/me");
        expect(res.status).toBe(200);
        expect(res.body.authEnabled).toBe(false);
        expect(res.body.user.username).toBe("admin");
      } finally {
        await close();
      }
    });
  });

  describe("GET /api/auth/me", () => {
    test("returns user when authenticated", async () => {
      const { server, close } = await startServer();
      try {
        const loginRes = await request(server, "POST", "/api/auth/login", {
          body: { username: "admin", password: "admin123" },
        });
        const cookie = extractCookie(loginRes.setCookie, "mc_session");

        const res = await request(server, "GET", "/api/auth/me", {
          cookie: cookie!,
        });
        expect(res.status).toBe(200);
        expect(res.body.user.username).toBe("admin");
        expect(res.body.authEnabled).toBe(true);
      } finally {
        await close();
      }
    });

    test("returns 401 when not authenticated", async () => {
      const { server, close } = await startServer();
      try {
        const res = await request(server, "GET", "/api/auth/me");
        expect(res.status).toBe(401);
      } finally {
        await close();
      }
    });
  });
});
