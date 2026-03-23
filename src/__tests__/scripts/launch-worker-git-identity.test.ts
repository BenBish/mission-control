/**
 * Tests that archie_launch_worker.sh injects git identity env vars
 * from AGENTS.md into the generated runner script.
 *
 * Note: The heredoc uses <<RUNNER (not <<'RUNNER'), so shell variables
 * that should be deferred to runtime are escaped as \$ in the source.
 * These tests verify the source file content directly.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const LAUNCH_SCRIPT_PATH = resolve(
  process.env.HOME || "~",
  ".openclaw-archie/scripts/archie_launch_worker.sh",
);

describe("archie_launch_worker.sh — git identity injection", () => {
  const script = readFileSync(LAUNCH_SCRIPT_PATH, "utf-8");

  // Extract the heredoc runner section (between <<RUNNER and RUNNER)
  const runnerMatch = script.match(
    /cat > "\$RUNNER_PATH" <<RUNNER\n([\s\S]*?)\nRUNNER$/m,
  );
  const runner = runnerMatch?.[1] ?? "";

  test("runner parses GIT_AUTHOR_NAME from AGENTS.md", () => {
    expect(runner).toContain("GIT_AUTHOR_NAME=");
    expect(runner).toMatch(/grep.*GIT_AUTHOR_NAME.*AGENTS_MD/);
  });

  test("runner parses GIT_AUTHOR_EMAIL from AGENTS.md", () => {
    expect(runner).toContain("GIT_AUTHOR_EMAIL=");
    expect(runner).toMatch(/grep.*GIT_AUTHOR_EMAIL.*AGENTS_MD/);
  });

  test("runner exports all four git identity env vars", () => {
    expect(runner).toContain("export GIT_AUTHOR_NAME=");
    expect(runner).toContain("export GIT_AUTHOR_EMAIL=");
    expect(runner).toContain("export GIT_COMMITTER_NAME=");
    expect(runner).toContain("export GIT_COMMITTER_EMAIL=");
  });

  test("runner sets local git config user.name", () => {
    expect(runner).toMatch(/git config user\.name/);
  });

  test("runner sets local git config user.email", () => {
    expect(runner).toMatch(/git config user\.email/);
  });

  test("git config is set after cd into workspace", () => {
    const cdIndex = runner.indexOf('cd "');
    const gitConfigNameIndex = runner.indexOf("git config user.name");
    const gitConfigEmailIndex = runner.indexOf("git config user.email");
    expect(cdIndex).toBeGreaterThan(-1);
    expect(gitConfigNameIndex).toBeGreaterThan(cdIndex);
    expect(gitConfigEmailIndex).toBeGreaterThan(cdIndex);
  });
});
