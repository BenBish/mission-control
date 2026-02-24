/**
 * Agent Utils Tests
 * Tests for agent ID translation utilities
 */

import { describe, test, expect } from "bun:test";
import { toActorId } from "../../lib/agent-utils.js";

describe("toActorId", () => {
  test("should translate 'workspace' to 'main'", () => {
    expect(toActorId("workspace")).toBe("main");
  });

  test("should strip 'workspace-' prefix", () => {
    expect(toActorId("workspace-engineer")).toBe("engineer");
  });

  test("should strip 'workspace-' for multi-hyphen names", () => {
    expect(toActorId("workspace-code-reviewer")).toBe("code-reviewer");
  });

  test("should pass through IDs without workspace prefix", () => {
    expect(toActorId("engineer")).toBe("engineer");
  });

  test("should pass through empty string", () => {
    expect(toActorId("")).toBe("");
  });

  test("should handle workspace prefix followed by nothing", () => {
    expect(toActorId("workspace-")).toBe("");
  });
});
