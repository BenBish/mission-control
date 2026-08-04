import { describe, expect, test } from "bun:test";
import {
  clientLabelDisplay,
  formatClientLabel,
  hasOpenCodeHermesClient,
  isOpenCodeHermesClient,
  UNKNOWN_CLIENT_LABEL,
} from "../../lib/client-label-display.js";

describe("clientLabelDisplay", () => {
  test("maps known Hermes OpenCode backend to a human label", () => {
    const d = clientLabelDisplay("opencode");
    expect(d.id).toBe("opencode");
    expect(d.name).toBe("OpenCode (llama-swap)");
    expect(d.description).toMatch(/backend/i);
    expect(d.description).toMatch(/not OpenCode agent/i);
  });

  test("maps other known Hermes backends without inventing agent sources", () => {
    expect(formatClientLabel("hermes-qwen")).toBe("Hermes Qwen");
    expect(formatClientLabel("gemma-fallback")).toBe("Gemma fallback");
    expect(formatClientLabel("lemonade")).toBe("Lemonade");
  });

  test("passes through unknown labels unchanged as the display name", () => {
    expect(clientLabelDisplay("custom-client")).toEqual({
      id: "custom-client",
      name: "custom-client",
    });
  });

  test("null/empty becomes Unknown client", () => {
    expect(clientLabelDisplay(null).id).toBe(UNKNOWN_CLIENT_LABEL);
    expect(clientLabelDisplay("").name).toBe("Unknown client");
    expect(formatClientLabel(undefined)).toBe("Unknown client");
  });

  test("OpenCode Hermes helpers", () => {
    expect(isOpenCodeHermesClient("opencode")).toBe(true);
    expect(isOpenCodeHermesClient("hermes-qwen")).toBe(false);
    expect(hasOpenCodeHermesClient(["hermes-qwen", "opencode"])).toBe(true);
    expect(hasOpenCodeHermesClient(["lemonade"])).toBe(false);
  });
});
