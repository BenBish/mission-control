import { describe, test, expect } from "bun:test";
import { HermesBackendCollector } from "../../../collectors/hermes/backend-collector.js";
import type { CollectorStateStore } from "../../../collectors/core/state-store.js";
import type { Sink } from "../../../types/ingest.js";

const backend = {
  port: 12348,
  unit: "halogen.service",
  label: "halogen",
};

describe("HermesBackendCollector", () => {
  test("reports backend telemetry health independently from the router", async () => {
    const collector = new HermesBackendCollector(
      backend,
      {} as CollectorStateStore,
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 503 });

    try {
      const result = await collector.tick({} as Sink);
      expect(collector.instanceId).toBe("hermes@strix-halo:backend-halogen");
      expect(result.sourceStatus).toBe("error");
      expect(result.detail).toContain("backend telemetry unavailable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
