/**
 * Profile Context Middleware Tests (ORC-46)
 * Validates ?profile= query parameter extraction and validation
 */

import { describe, test, expect, mock } from "bun:test";
import { profileContextMiddleware } from "../../api/middleware/profile-context.js";
import type { Request, Response, NextFunction } from "express";

function createMockRequest(query: Record<string, string> = {}): Request {
  return { query } as unknown as Request;
}

function createMockResponse(): Response & { statusCode: number; body: any } {
  const res = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
  };
  return res as any;
}

describe("profileContextMiddleware", () => {
  test("defaults to 'default' when no ?profile param", () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const next = mock(() => {});

    profileContextMiddleware(req, res, next as NextFunction);

    expect(req.profileId).toBe("default");
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("extracts valid profile ID", () => {
    const req = createMockRequest({ profile: "team" });
    const res = createMockResponse();
    const next = mock(() => {});

    profileContextMiddleware(req, res, next as NextFunction);

    expect(req.profileId).toBe("team");
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("allows 'all' as a special profile value", () => {
    const req = createMockRequest({ profile: "all" });
    const res = createMockResponse();
    const next = mock(() => {});

    profileContextMiddleware(req, res, next as NextFunction);

    expect(req.profileId).toBe("all");
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("allows hyphens and underscores", () => {
    const req = createMockRequest({ profile: "my-team_profile" });
    const res = createMockResponse();
    const next = mock(() => {});

    profileContextMiddleware(req, res, next as NextFunction);

    expect(req.profileId).toBe("my-team_profile");
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("rejects profile with special characters", () => {
    const req = createMockRequest({ profile: "team/../hack" });
    const res = createMockResponse();
    const next = mock(() => {});

    profileContextMiddleware(req, res, next as NextFunction);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Invalid profile ID");
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects profile with spaces", () => {
    const req = createMockRequest({ profile: "my team" });
    const res = createMockResponse();
    const next = mock(() => {});

    profileContextMiddleware(req, res, next as NextFunction);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects profile exceeding 50 characters", () => {
    const longId = "a".repeat(51);
    const req = createMockRequest({ profile: longId });
    const res = createMockResponse();
    const next = mock(() => {});

    profileContextMiddleware(req, res, next as NextFunction);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  test("accepts profile with exactly 50 characters", () => {
    const id = "a".repeat(50);
    const req = createMockRequest({ profile: id });
    const res = createMockResponse();
    const next = mock(() => {});

    profileContextMiddleware(req, res, next as NextFunction);

    expect(req.profileId).toBe(id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("rejects empty string profile", () => {
    // Empty string should default to 'default' (falsy check)
    const req = createMockRequest({ profile: "" });
    const res = createMockResponse();
    const next = mock(() => {});

    profileContextMiddleware(req, res, next as NextFunction);

    expect(req.profileId).toBe("default");
    expect(next).toHaveBeenCalledTimes(1);
  });
});
