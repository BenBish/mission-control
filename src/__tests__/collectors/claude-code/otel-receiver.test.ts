import { describe, expect, test } from "bun:test";
import {
  OtelReceiver,
  extractApiRequestCosts,
  extractSessionCostDeltas,
  flattenAttributes,
  type OtlpExportLogsServiceRequest,
  type OtlpExportMetricsServiceRequest,
} from "../../../collectors/claude-code/otel-receiver.js";

function kv(key: string, value: unknown) {
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { doubleValue: value as number } };
}

describe("flattenAttributes", () => {
  test("reads string/double/int/bool values, skips empty", () => {
    expect(
      flattenAttributes([
        { key: "a", value: { stringValue: "x" } },
        { key: "b", value: { doubleValue: 1.5 } },
        { key: "c", value: { intValue: "42" } },
        { key: "d", value: { boolValue: true } },
        { key: "e", value: {} },
      ]),
    ).toEqual({ a: "x", b: 1.5, c: 42, d: true });
  });

  test("undefined input returns empty object", () => {
    expect(flattenAttributes(undefined)).toEqual({});
  });
});

describe("extractApiRequestCosts", () => {
  test("extracts cost_usd from a claude_code.api_request event", () => {
    const body: OtlpExportLogsServiceRequest = {
      resourceLogs: [
        {
          resource: { attributes: [kv("session.id", "sess-1")] },
          scopeLogs: [
            {
              logRecords: [
                {
                  eventName: "claude_code.api_request",
                  attributes: [
                    kv("request_id", "req-1"),
                    kv("cost_usd", 0.059912),
                    kv("model", "claude-sonnet-4.5"),
                    kv("input_tokens", 100),
                    kv("output_tokens", 50),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const results = extractApiRequestCosts(body);
    expect(results).toEqual([
      {
        requestId: "req-1",
        costUsd: 0.059912,
        sessionExternalId: "sess-1",
        model: "claude-sonnet-4.5",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: undefined,
        cacheCreationTokens: undefined,
      },
    ]);
  });

  test("falls back to cost_usd_micros when cost_usd is absent", () => {
    const body: OtlpExportLogsServiceRequest = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  eventName: "claude_code.api_request",
                  attributes: [
                    kv("request_id", "req-2"),
                    kv("cost_usd_micros", 59912),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const results = extractApiRequestCosts(body);
    expect(results).toHaveLength(1);
    expect(results[0].requestId).toBe("req-2");
    expect(results[0].costUsd).toBeCloseTo(0.059912, 6);
  });

  test("ignores events that are not claude_code.api_request", () => {
    const body: OtlpExportLogsServiceRequest = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  eventName: "claude_code.tool_decision",
                  attributes: [kv("request_id", "req-3"), kv("cost_usd", 1)],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractApiRequestCosts(body)).toEqual([]);
  });

  test("skips records missing request_id or cost", () => {
    const body: OtlpExportLogsServiceRequest = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  eventName: "claude_code.api_request",
                  attributes: [kv("cost_usd", 1)],
                },
                {
                  eventName: "claude_code.api_request",
                  attributes: [kv("request_id", "req-4")],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractApiRequestCosts(body)).toEqual([]);
  });

  test("malformed/empty input never throws", () => {
    expect(extractApiRequestCosts({})).toEqual([]);
    expect(extractApiRequestCosts({ resourceLogs: [{}] })).toEqual([]);
  });
});

describe("extractSessionCostDeltas", () => {
  test("computes a delta from a cumulative sum data point", () => {
    const cumulative = new Map<string, number>();
    const body: OtlpExportMetricsServiceRequest = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.cost.usage",
                  sum: {
                    dataPoints: [
                      {
                        attributes: [
                          kv("session.id", "sess-1"),
                          kv("model", "claude-sonnet-4.5"),
                        ],
                        asDouble: 0.05,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractSessionCostDeltas(body, cumulative)).toEqual([
      { sessionExternalId: "sess-1", deltaUsd: 0.05 },
    ]);

    // A later export with a higher cumulative total yields only the delta.
    const body2: OtlpExportMetricsServiceRequest = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.cost.usage",
                  sum: {
                    dataPoints: [
                      {
                        attributes: [
                          kv("session.id", "sess-1"),
                          kv("model", "claude-sonnet-4.5"),
                        ],
                        asDouble: 0.08,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const result2 = extractSessionCostDeltas(body2, cumulative);
    expect(result2).toHaveLength(1);
    expect(result2[0].sessionExternalId).toBe("sess-1");
    expect(result2[0].deltaUsd).toBeCloseTo(0.03, 9);
  });

  test("a lower cumulative value (counter reset) is treated as the new delta, not negative", () => {
    const cumulative = new Map<string, number>([
      ["sess-1:claude-sonnet-4.5", 0.5],
    ]);
    const body: OtlpExportMetricsServiceRequest = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.cost.usage",
                  sum: {
                    dataPoints: [
                      {
                        attributes: [
                          kv("session.id", "sess-1"),
                          kv("model", "claude-sonnet-4.5"),
                        ],
                        asDouble: 0.02,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractSessionCostDeltas(body, cumulative)).toEqual([
      { sessionExternalId: "sess-1", deltaUsd: 0.02 },
    ]);
  });

  test("ignores metrics that are not claude_code.cost.usage and points missing session.id", () => {
    const cumulative = new Map<string, number>();
    const body: OtlpExportMetricsServiceRequest = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.token.usage",
                  sum: { dataPoints: [{ asDouble: 5 }] },
                },
                {
                  name: "claude_code.cost.usage",
                  sum: { dataPoints: [{ asDouble: 5 }] },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractSessionCostDeltas(body, cumulative)).toEqual([]);
  });
});

describe("OtelReceiver HTTP", () => {
  async function post(port: number, path: string, body: unknown) {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("ingests a claude_code.api_request log export and makes it retrievable by request id", async () => {
    const receiver = new OtelReceiver({ port: 0 });
    const port = await receiver.start();
    expect(port).toBeGreaterThan(0);

    const res = await post(port!, "/v1/logs", {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  eventName: "claude_code.api_request",
                  attributes: [
                    kv("request_id", "req-http-1"),
                    kv("cost_usd", 0.02),
                  ],
                },
              ],
            },
          ],
        },
      ],
    } satisfies OtlpExportLogsServiceRequest);
    expect(res.status).toBe(200);

    const match = receiver.getRequestCost("req-http-1");
    expect(match?.costUsd).toBe(0.02);

    receiver.consumeRequestCost("req-http-1");
    expect(receiver.getRequestCost("req-http-1")).toBeUndefined();

    await receiver.stop();
  });

  test("ingests a claude_code.cost.usage metrics export as a session delta", async () => {
    const receiver = new OtelReceiver({ port: 0 });
    const port = await receiver.start();

    const res = await post(port!, "/v1/metrics", {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.cost.usage",
                  sum: {
                    dataPoints: [
                      {
                        attributes: [kv("session.id", "sess-http")],
                        asDouble: 0.1,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    } satisfies OtlpExportMetricsServiceRequest);
    expect(res.status).toBe(200);

    expect(receiver.drainSessionCostDeltas()).toEqual([
      { sessionExternalId: "sess-http", deltaUsd: 0.1 },
    ]);
    // Draining clears it — a second drain with no new export is empty.
    expect(receiver.drainSessionCostDeltas()).toEqual([]);

    await receiver.stop();
  });

  test("rejects non-JSON content types instead of crashing", async () => {
    const receiver = new OtelReceiver({ port: 0 });
    const port = await receiver.start();

    const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/x-protobuf" },
      body: Buffer.from([0, 1, 2]),
    });
    expect(res.status).toBe(415);

    await receiver.stop();
  });

  test("unknown paths 404 without disturbing the receiver", async () => {
    const receiver = new OtelReceiver({ port: 0 });
    const port = await receiver.start();

    const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);

    await receiver.stop();
  });

  test("a second receiver on the same fixed port fails to start without throwing", async () => {
    const first = new OtelReceiver({ port: 0 });
    const boundPort = await first.start();
    expect(boundPort).toBeGreaterThan(0);

    const warnings: string[] = [];
    const second = new OtelReceiver({
      port: boundPort!,
      onWarn: (m) => warnings.push(m),
    });
    const result = await second.start();
    expect(result).toBeNull();
    expect(warnings.length).toBe(1);

    await first.stop();
  });
});
