import { describe, expect, test } from "bun:test";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { listSources, seedSources } from "../../db/queries/sources.js";
import { HERMES_BACKENDS } from "../../collectors/hermes/config.js";

describe("local inference source compatibility", () => {
  test("refreshes the legacy source name without replacing historical identity", async () => {
    const db = await open({ filename: ":memory:", driver: sqlite3.Database });
    try {
      await db.exec(`
        CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT, kind TEXT, default_unit TEXT);
        CREATE TABLE source_instances (
          id TEXT PRIMARY KEY, source_id TEXT, machine TEXT, endpoint TEXT,
          collector_kind TEXT, status TEXT, last_seen_at TEXT, last_error TEXT, meta TEXT
        );
        INSERT INTO sources VALUES ('hermes', 'Hermes', 'inference', 'compute');
        INSERT INTO source_instances (id, source_id, machine, collector_kind, status)
        VALUES ('hermes@existing-host', 'hermes', 'existing-host', 'http-poll', 'ok');
      `);
      await seedSources(db);
      await seedSources(db);
      const sources = await listSources(db);
      const local = sources.find((source) => source.id === "hermes");
      expect(local?.name).toBe("Local Inference");
      expect(local?.kind).toBe("inference");
      expect(
        local?.instances.some(
          (instance) => instance.id === "hermes@existing-host",
        ),
      ).toBe(true);
      expect(
        sources.filter((source) => source.name === "Local Inference"),
      ).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  test("the active backend does not correlate retired gateway activity", () => {
    expect(HERMES_BACKENDS.map((backend) => backend.label)).toEqual([
      "halogen",
    ]);
    expect(HERMES_BACKENDS.some((backend) => backend.sharedByGateways)).toBe(
      false,
    );
  });
});
