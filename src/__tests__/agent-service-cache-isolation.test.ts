/**
 * Unit tests for ORC-102: soulPathCache profile isolation
 *
 * os.homedir() is cached at process start in Bun, so we can't override it
 * mid-process. Instead, we spawn a child `bun test` with HOME set to a
 * temp directory containing our fixture agents.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";

/**
 * Build a temp HOME with two profile directories, each containing one agent.
 */
function buildFixtureHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "orc102-"));

  const agentADir = path.join(home, ".openclaw-alpha", "agents", "bot-a");
  fs.mkdirSync(agentADir, { recursive: true });
  fs.writeFileSync(
    path.join(agentADir, "SOUL.md"),
    "# SOUL.md — Bot A\n\n## Role\nAlpha Bot\n\nModel: model-alpha\n",
  );

  const agentBDir = path.join(home, ".openclaw-beta", "agents", "bot-b");
  fs.mkdirSync(agentBDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentBDir, "SOUL.md"),
    "# SOUL.md — Bot B\n\n## Role\nBeta Bot\n\nModel: model-beta\n",
  );

  return home;
}

describe("soulPathCache profile isolation", () => {
  test("concurrent profiles do not share cached soul paths", () => {
    const home = buildFixtureHome();

    try {
      // The inline script exercises the keyed cache and asserts isolation.
      const script = `
const { AgentService } = require("./src/services/agent-service.js");

async function main() {
  const svc = new AgentService();

  // --- Test 1: concurrent readAgents returns correct agents ---
  const [agentsA, agentsB] = await Promise.all([
    svc.readAgents("alpha"),
    svc.readAgents("beta"),
  ]);

  const idsA = agentsA.map(a => a.id);
  const idsB = agentsB.map(a => a.id);

  if (!idsA.includes("bot-a")) throw new Error("alpha missing bot-a: " + JSON.stringify(idsA));
  if (idsA.includes("bot-b"))  throw new Error("alpha leaks bot-b");
  if (!idsB.includes("bot-b")) throw new Error("beta missing bot-b: " + JSON.stringify(idsB));
  if (idsB.includes("bot-a"))  throw new Error("beta leaks bot-a");

  // --- Test 2: sequential load doesn't overwrite earlier profile ---
  const svc2 = new AgentService();
  await svc2.readAgents("alpha");
  await svc2.readAgents("beta");

  const soulA = await svc2.readAgentSoul("bot-a", "alpha");
  if (!soulA || !soulA.includes("Alpha Bot")) throw new Error("soul leak: alpha got " + soulA);

  const soulBFromAlpha = await svc2.readAgentSoul("bot-b", "alpha");
  if (soulBFromAlpha !== null) throw new Error("alpha should not resolve bot-b");

  // --- Test 3: readAgentFullConfig returns correct workspace ---
  const svc3 = new AgentService();
  await Promise.all([svc3.readAgents("alpha"), svc3.readAgents("beta")]);

  const [cfgA, cfgB] = await Promise.all([
    svc3.readAgentFullConfig("bot-a", "alpha"),
    svc3.readAgentFullConfig("bot-b", "beta"),
  ]);

  if (!cfgA || !cfgA.workspace.includes(".openclaw-alpha"))
    throw new Error("configA workspace wrong: " + JSON.stringify(cfgA));
  if (!cfgB || !cfgB.workspace.includes(".openclaw-beta"))
    throw new Error("configB workspace wrong: " + JSON.stringify(cfgB));

  console.log("ALL_PASSED");
}
main().catch(e => { console.error(e.message); process.exit(1); });
`;

      const result = spawnSync("bun", ["-e", script], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home },
        timeout: 15_000,
      });

      const stdout = result.stdout?.toString() ?? "";
      const stderr = result.stderr?.toString() ?? "";

      if (result.status !== 0) {
        throw new Error(
          `Child exited ${result.status}.\nstdout: ${stdout}\nstderr: ${stderr}`,
        );
      }

      expect(stdout).toContain("ALL_PASSED");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
