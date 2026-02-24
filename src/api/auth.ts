/**
 * Authentication Module
 * Stateless JWT authentication with HttpOnly cookies for Mission Control.
 *
 * Environment variables:
 *   MC_AUTH_ENABLED     – "true" to enable (default: "false")
 *   MC_PASSWORD_HASH    – bcrypt hash of admin password (required when auth enabled)
 *   MC_JWT_SECRET       – HMAC-SHA256 secret for JWT signing (auto-generated if missing)
 *   MC_API_KEY          – API key for plugin ingestion on POST /api/activities
 *   MC_SESSION_TTL      – JWT lifetime in seconds (default: 86400 = 24h)
 *   MC_USERNAME         – admin username (default: "admin")
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { Request, Response, NextFunction, Express } from "express";
import crypto from "crypto";

// ─── Configuration ──────────────────────────────────────────────────────────

export interface AuthConfig {
  enabled: boolean;
  username: string;
  passwordHash: string;
  jwtSecret: Uint8Array;
  apiKey: string | undefined;
  sessionTtl: number; // seconds
  secureCookie: boolean; // Secure flag on cookies (true in production)
}

const COOKIE_NAME = "mc_session";

/**
 * Resolve auth configuration from environment variables.
 * Throws if auth is enabled but required vars are missing.
 */
export function resolveAuthConfig(): AuthConfig {
  const enabled = process.env.MC_AUTH_ENABLED === "true";
  const passwordHash = process.env.MC_PASSWORD_HASH || "";
  const username = process.env.MC_USERNAME || "admin";
  const apiKey = process.env.MC_API_KEY || undefined;
  const sessionTtl = parseInt(process.env.MC_SESSION_TTL || "86400", 10);
  const secureCookie = process.env.NODE_ENV === "production";

  if (enabled && !passwordHash) {
    throw new Error(
      "MC_AUTH_ENABLED is true but MC_PASSWORD_HASH is not set. " +
        "Generate a hash with: bun -e \"console.log(await Bun.password.hash('yourpass'))\"",
    );
  }

  // JWT secret: use env var if provided, otherwise generate a random one
  const rawSecret =
    process.env.MC_JWT_SECRET || crypto.randomBytes(64).toString("hex");
  const jwtSecret = new TextEncoder().encode(rawSecret);

  return {
    enabled,
    username,
    passwordHash,
    jwtSecret,
    apiKey,
    sessionTtl,
    secureCookie,
  };
}

// ─── JWT helpers ────────────────────────────────────────────────────────────

export interface MCJWTPayload extends JWTPayload {
  sub: string; // username
}

export async function signToken(
  config: AuthConfig,
  username: string,
): Promise<string> {
  return new SignJWT({ sub: username } as MCJWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${config.sessionTtl}s`)
    .sign(config.jwtSecret);
}

export async function verifyToken(
  config: AuthConfig,
  token: string,
): Promise<MCJWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, {
      algorithms: ["HS256"],
    });
    return payload as MCJWTPayload;
  } catch {
    return null;
  }
}

// ─── Password verification ─────────────────────────────────────────────────

/**
 * Verify a plaintext password against a bcrypt/argon2 hash using Bun.password.
 * Falls back to a simple timing-safe comparison if the hash doesn't look like
 * a standard password hash (for testing).
 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  try {
    // Bun.password.verify handles bcrypt ($2b$) and argon2 hashes
    return await Bun.password.verify(plaintext, hash);
  } catch {
    // Fallback: timing-safe comparison for plain test hashes
    const a = Buffer.from(plaintext);
    const b = Buffer.from(hash);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
}

// ─── Rate limiter ───────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number; // timestamp in ms
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private maxAttempts: number;
  private windowMs: number;

  constructor(maxAttempts = 5, windowMs = 60_000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  /**
   * Check if the IP is rate-limited. Returns true if the request is allowed.
   */
  check(ip: string): boolean {
    const now = Date.now();
    const entry = this.store.get(ip);

    if (!entry || now >= entry.resetAt) {
      this.store.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    entry.count++;
    if (entry.count > this.maxAttempts) {
      return false; // rate-limited
    }
    return true;
  }

  /**
   * Reset rate limit for an IP (e.g. on successful login)
   */
  reset(ip: string): void {
    this.store.delete(ip);
  }

  /**
   * Get remaining attempts for an IP
   */
  remaining(ip: string): number {
    const entry = this.store.get(ip);
    if (!entry || Date.now() >= entry.resetAt) return this.maxAttempts;
    return Math.max(0, this.maxAttempts - entry.count);
  }
}

// ─── Cookie helpers ─────────────────────────────────────────────────────────

function setAuthCookie(res: Response, token: string, config: AuthConfig): void {
  const maxAge = config.sessionTtl * 1000; // ms
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.secureCookie,
    maxAge,
    path: "/",
  });
}

function clearAuthCookie(res: Response, config: AuthConfig): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.secureCookie,
    path: "/",
  });
}

// ─── Extract cookie from header (no cookie-parser dependency) ───────────────

function parseCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : undefined;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Auth middleware — protects all routes except:
 *   - POST /api/auth/login
 *   - POST /api/auth/logout
 *   - GET  /api/health
 *   - POST /api/activities (when API key provided)
 *   - Non-API routes (SPA static files)
 */
export function authMiddleware(config: AuthConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Auth disabled → pass through
    if (!config.enabled) return next();

    const path = req.path;

    // Public routes
    if (path === "/api/auth/login" || path === "/api/auth/logout") {
      return next();
    }
    if (path === "/api/health") return next();

    // Non-API routes (static assets, SPA pages)
    if (!path.startsWith("/api/")) return next();

    // API key auth for plugin ingestion (POST /api/activities only)
    if (path === "/api/activities" && req.method === "POST") {
      const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
      if (config.apiKey && apiKeyHeader === config.apiKey) {
        return next();
      }
      // Fall through to JWT check
    }

    // JWT cookie auth
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    if (!token) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const payload = await verifyToken(config, token);
    if (!payload) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    }

    // Attach user info to request for downstream use
    (req as any).user = { username: payload.sub };
    next();
  };
}

// ─── Auth route handlers ────────────────────────────────────────────────────

export function setupAuthRoutes(
  app: Express,
  config: AuthConfig,
  logActivity?: (
    event: string,
    details: Record<string, unknown>,
  ) => Promise<void>,
) {
  const limiter = new RateLimiter(5, 60_000);

  /**
   * POST /api/auth/login
   * Body: { username: string, password: string }
   */
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";

    // Rate limiting
    if (!limiter.check(ip)) {
      if (logActivity) {
        await logActivity("auth:rate_limited", { ip }).catch(() => {});
      }
      return res.status(429).json({
        success: false,
        error: "Too many login attempts. Try again later.",
      });
    }

    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required",
      });
    }

    // Check username
    if (username !== config.username) {
      if (logActivity) {
        await logActivity("auth:login_failed", {
          username,
          ip,
          reason: "invalid_username",
        }).catch(() => {});
      }
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    // Check password
    const valid = await verifyPassword(password, config.passwordHash);
    if (!valid) {
      if (logActivity) {
        await logActivity("auth:login_failed", {
          username,
          ip,
          reason: "invalid_password",
        }).catch(() => {});
      }
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    // Success — issue JWT
    limiter.reset(ip);
    const token = await signToken(config, username);
    setAuthCookie(res, token, config);

    if (logActivity) {
      await logActivity("auth:login_success", { username, ip }).catch(() => {});
    }

    return res.json({
      success: true,
      user: { username },
    });
  });

  /**
   * POST /api/auth/logout
   */
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    clearAuthCookie(res, config);

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    let username = "unknown";
    if (token) {
      const payload = await verifyToken(config, token);
      if (payload) username = payload.sub || "unknown";
    }

    if (logActivity) {
      await logActivity("auth:logout", { username, ip }).catch(() => {});
    }

    return res.json({ success: true });
  });

  /**
   * GET /api/auth/me
   * Returns the current user if authenticated, 401 otherwise.
   */
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!config.enabled) {
      // Auth disabled — return an anonymous user
      return res.json({
        success: true,
        user: { username: "admin" },
        authEnabled: false,
      });
    }

    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    if (!token) {
      return res
        .status(401)
        .json({ success: false, error: "Not authenticated" });
    }

    const payload = await verifyToken(config, token);
    if (!payload) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    }

    return res.json({
      success: true,
      user: { username: payload.sub },
      authEnabled: true,
    });
  });
}
