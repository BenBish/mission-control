import { describe, expect, test } from "bun:test";
import {
  agentUsageDriversExportPath,
  buildAgentUsageDriversExportJson,
  buildProviderUsageExportJson,
  consumptionExportFilename,
  csvEscape,
  parseExportFormat,
  providerUsageExportPath,
  serializeAgentUsageDriversCsv,
  serializeProviderUsageCsv,
  toCsv,
  type AgentUsageDriverExportRow,
  type ProviderUsageExportRow,
} from "../../lib/consumption-export.js";

function usage(
  partial: Partial<ProviderUsageExportRow> = {},
): ProviderUsageExportRow {
  return {
    provider: "openrouter",
    day: "2026-08-01",
    model: "test/model",
    input_tokens: 10,
    output_tokens: 2,
    cost_usd: 0.0123,
    request_count: 1,
    ...partial,
  };
}

function driver(
  partial: Partial<AgentUsageDriverExportRow> = {},
): AgentUsageDriverExportRow {
  return {
    key: "model:claude-code:claude-3.5-sonnet",
    sourceId: "claude-code",
    canonicalModel: "claude-3.5-sonnet",
    rawModels: ["claude-3-5-sonnet-20241022"],
    project: "mission-control",
    sessionId: null,
    sessionTitle: null,
    actorId: null,
    actorType: null,
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 50,
    cacheWriteTokens: 10,
    costUsd: null,
    hasCost: false,
    requestCount: 3,
    sessionCount: 1,
    materiality: "material",
    attribution: "known",
    ...partial,
  };
}

describe("parseExportFormat", () => {
  test("defaults missing values to csv", () => {
    expect(parseExportFormat(undefined)).toBe("csv");
    expect(parseExportFormat(null)).toBe("csv");
    expect(parseExportFormat("")).toBe("csv");
  });

  test("accepts csv and json case-insensitively", () => {
    expect(parseExportFormat("csv")).toBe("csv");
    expect(parseExportFormat("JSON")).toBe("json");
  });

  test("rejects unknown formats", () => {
    expect(parseExportFormat("xml")).toBeUndefined();
    expect(parseExportFormat(1)).toBeUndefined();
  });
});

describe("csvEscape / toCsv", () => {
  test("leaves simple fields unquoted", () => {
    expect(csvEscape("openrouter")).toBe("openrouter");
    expect(csvEscape(42)).toBe("42");
  });

  test("emits empty string for nullish values", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  test("quotes commas, quotes, and newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  test("joins rows with CRLF and a trailing newline", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2\r\n");
  });
});

describe("serializeProviderUsageCsv", () => {
  test("writes headers and daily usage columns", () => {
    const csv = serializeProviderUsageCsv([
      usage({ model: "acme,pro", cost_usd: null }),
    ]);
    expect(csv.startsWith("day,provider,model,input_tokens,")).toBe(true);
    expect(csv).toContain('2026-08-01,openrouter,"acme,pro",10,2,,1');
  });
});

describe("serializeAgentUsageDriversCsv", () => {
  test("flattens driver rows and joins raw model aliases", () => {
    const csv = serializeAgentUsageDriversCsv([
      driver({
        rawModels: ["claude-3-5-sonnet-20241022", "sonnet"],
        project: 'Acme "Labs"',
      }),
    ]);
    expect(csv).toContain(
      "model:claude-code:claude-3.5-sonnet,claude-code,claude-3.5-sonnet",
    );
    expect(csv).toContain("claude-3-5-sonnet-20241022; sonnet");
    expect(csv).toContain('"Acme ""Labs"""');
    expect(csv).toContain(",false,3,1,material,known");
  });
});

describe("JSON export payloads", () => {
  test("provider JSON keeps usage rows and filter metadata", () => {
    const body = buildProviderUsageExportJson([usage()], {
      since: "2026-08-01",
      exportedAt: "2026-08-13T00:00:00.000Z",
    });
    expect(body.dataset).toBe("provider-usage");
    expect(body.source).toBe("provider-api");
    expect(body.filters).toEqual({ since: "2026-08-01", provider: null });
    expect((body.usage as ProviderUsageExportRow[])[0].model).toBe(
      "test/model",
    );
  });

  test("agent driver JSON keeps current filters and driver fields", () => {
    const body = buildAgentUsageDriversExportJson([driver()], {
      since: "2026-08-01T00:00:00.000Z",
      sourceId: "claude-code",
      dimension: "project",
      includeNonMaterial: true,
      exportedAt: "2026-08-13T00:00:00.000Z",
    });
    expect(body.dataset).toBe("agent-usage-drivers");
    expect(body.filters).toEqual({
      since: "2026-08-01T00:00:00.000Z",
      until: null,
      sourceId: "claude-code",
      dimension: "project",
      includeNonMaterial: true,
    });
    expect((body.drivers as AgentUsageDriverExportRow[])[0].sourceId).toBe(
      "claude-code",
    );
  });
});

describe("paths and filenames", () => {
  test("builds filter-aware export paths", () => {
    expect(
      providerUsageExportPath({ format: "csv", since: "2026-08-01" }),
    ).toBe("/api/providers/usage/export?format=csv&since=2026-08-01");
    expect(
      agentUsageDriversExportPath({
        format: "json",
        sourceId: "codex",
        dimension: "model",
        includeNonMaterial: true,
      }),
    ).toBe(
      "/api/consumption/agent-usage/export?format=json&sourceId=codex&dimension=model&includeNonMaterial=1",
    );
  });

  test("filename includes dataset, dimension, and since day", () => {
    expect(consumptionExportFilename("provider-usage", "csv")).toBe(
      "provider-usage.csv",
    );
    expect(
      consumptionExportFilename("agent-usage-drivers", "json", {
        dimension: "model",
        since: "2026-08-01T12:00:00.000Z",
      }),
    ).toBe("agent-usage-drivers-model-since-2026-08-01.json");
  });
});
