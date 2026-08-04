import { describe, expect, test } from "bun:test";
import type { Source } from "../../lib/queries.js";
import {
  getEmptyWorkloadPageState,
  getWorkloadAvailability,
  shouldShowWorkloadInNav,
  workloadSourceIds,
} from "../../lib/workload-availability.js";

function source(
  id: string,
  instances: { status: string }[],
  kind = "agentic",
): Source {
  return {
    id,
    name: id,
    kind,
    defaultUnit: "quota",
    instances: instances.map((i, idx) => ({
      id: `${id}@m${idx}`,
      machine: `m${idx}`,
      endpoint: null,
      collectorKind: "http-poll",
      status: i.status,
      lastSeenAt: null,
      lastError: null,
      meta: null,
    })),
  };
}

describe("workloadSourceIds", () => {
  test("generations map to comfyui", () => {
    expect([...workloadSourceIds("generations")]).toEqual(["comfyui"]);
  });

  test("jobs map to hermes and agent collectors", () => {
    expect(workloadSourceIds("jobs")).toContain("hermes");
    expect(workloadSourceIds("jobs")).toContain("claude-code");
    expect(workloadSourceIds("jobs")).not.toContain("comfyui");
  });
});

describe("getWorkloadAvailability — generations", () => {
  test("not_configured when comfyui is missing from registry", () => {
    const result = getWorkloadAvailability("generations", [
      source("hermes", [{ status: "ok" }], "inference"),
    ]);
    expect(result.configured).toBe(false);
    expect(result.available).toBe(false);
    expect(result.pageState).toBe("not_configured");
    expect(result.navEmphasis).toBe("hidden");
    expect(shouldShowWorkloadInNav(result)).toBe(false);
  });

  test("disabled when comfyui instances are all off", () => {
    const result = getWorkloadAvailability("generations", [
      source("comfyui", [{ status: "off" }], "generation"),
    ]);
    expect(result.configured).toBe(true);
    expect(result.available).toBe(false);
    expect(result.pageState).toBe("disabled");
    expect(result.navEmphasis).toBe("deemphasized");
    expect(result.navBadge).toBe("Off");
    expect(shouldShowWorkloadInNav(result)).toBe(true);
  });

  test("available when comfyui has a non-off instance", () => {
    const result = getWorkloadAvailability("generations", [
      source("comfyui", [{ status: "ok" }], "generation"),
    ]);
    expect(result.available).toBe(true);
    expect(result.pageState).toBe("available");
    expect(result.navEmphasis).toBe("primary");
  });

  test("available when status is unknown (collector may be starting)", () => {
    const result = getWorkloadAvailability("generations", [
      source("comfyui", [{ status: "unknown" }], "generation"),
    ]);
    expect(result.available).toBe(true);
    expect(result.navEmphasis).toBe("primary");
  });
});

describe("getWorkloadAvailability — jobs", () => {
  test("available when any agentic source is not off", () => {
    const result = getWorkloadAvailability("jobs", [
      source("claude-code", [{ status: "unknown" }]),
      source("comfyui", [{ status: "off" }], "generation"),
    ]);
    expect(result.available).toBe(true);
    expect(result.pageState).toBe("available");
    expect(result.navEmphasis).toBe("primary");
  });

  test("disabled when all job-related instances are off", () => {
    const result = getWorkloadAvailability("jobs", [
      source("hermes", [{ status: "off" }], "inference"),
      source("claude-code", [{ status: "off" }]),
      source("codex", [{ status: "off" }]),
      source("grok", [{ status: "off" }]),
      source("opencode", [{ status: "off" }]),
      source("lemonade", [{ status: "off" }], "inference"),
    ]);
    expect(result.available).toBe(false);
    expect(result.pageState).toBe("disabled");
    expect(result.navEmphasis).toBe("deemphasized");
  });

  test("undefined sources (still loading) keep jobs visible in nav", () => {
    const result = getWorkloadAvailability("jobs", undefined);
    expect(result.available).toBe(true);
    expect(result.navEmphasis).toBe("primary");
    expect(shouldShowWorkloadInNav(result)).toBe(true);
  });

  test("empty registry hides jobs from nav", () => {
    const result = getWorkloadAvailability("jobs", []);
    expect(result.configured).toBe(false);
    expect(result.navEmphasis).toBe("hidden");
  });
});

describe("getEmptyWorkloadPageState", () => {
  test("maps availability to empty list states", () => {
    const disabled = getWorkloadAvailability("generations", [
      source("comfyui", [{ status: "off" }], "generation"),
    ]);
    expect(getEmptyWorkloadPageState(disabled)).toBe("disabled");

    const ready = getWorkloadAvailability("generations", [
      source("comfyui", [{ status: "ok" }], "generation"),
    ]);
    expect(getEmptyWorkloadPageState(ready)).toBe("no_data");
  });
});
