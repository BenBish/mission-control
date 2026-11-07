/**
 * Saturation-episode state machine — forcing real saturation on the live
 * box would mean flooding the user's production Hermes backend with
 * concurrent requests, so this is the safe way to verify the plan's
 * "confirm slot band chart shows saturation" logic.
 */

import { describe, test, expect } from "bun:test";
import {
  pollSlots,
  updateSaturation,
  emptySaturationState,
  type SaturationState,
} from "../../../collectors/hermes/llama-server-poller.js";
import type { HermesBackend } from "../../../collectors/hermes/config.js";
import { SATURATION_SAMPLE_THRESHOLD } from "../../../collectors/hermes/config.js";

const BACKEND: HermesBackend = {
  port: 12346,
  unit: "llama-toolbox-qwen-hermes.service",
  label: "hermes-qwen",
};

const HALOGEN_BACKEND: HermesBackend = {
  port: 12348,
  unit: "halogen.service",
  label: "halogen",
};

function saturated(slotsTotal = 2) {
  return { reachable: true, slotsTotal, slotsBusy: slotsTotal };
}
function idle(slotsTotal = 2, slotsBusy = 0) {
  return { reachable: true, slotsTotal, slotsBusy };
}

describe("updateSaturation", () => {
  test("fewer than threshold consecutive saturated samples emits nothing", () => {
    let state = emptySaturationState();
    for (let i = 0; i < SATURATION_SAMPLE_THRESHOLD - 1; i++) {
      const result = updateSaturation(BACKEND, saturated(), state);
      state = result.state;
      expect(result.event).toBeUndefined();
    }
    expect(state.consecutiveSaturated).toBe(SATURATION_SAMPLE_THRESHOLD - 1);
  });

  test("reaching the threshold opens an episode but still emits nothing yet — only the close does", () => {
    let state = emptySaturationState();
    for (let i = 0; i < SATURATION_SAMPLE_THRESHOLD; i++) {
      const result = updateSaturation(BACKEND, saturated(), state);
      state = result.state;
      expect(result.event).toBeUndefined();
    }
    expect(state.openEpisodeStartedAtIso).toBeDefined();
  });

  test("a full episode (open then clear) emits exactly one slots_saturated event with both timestamps set", () => {
    let state = emptySaturationState();
    let lastResult;
    for (let i = 0; i < SATURATION_SAMPLE_THRESHOLD; i++) {
      lastResult = updateSaturation(BACKEND, saturated(2), state);
      state = lastResult.state;
    }
    // Clearing sample
    const clearResult = updateSaturation(BACKEND, idle(2, 0), state);

    expect(clearResult.event).toBeDefined();
    expect(clearResult.event?.kind).toBe("slots_saturated");
    expect(clearResult.event?.timestamp).toBeDefined();
    expect(clearResult.event?.endedAt).toBeDefined();
    expect(
      new Date(clearResult.event!.timestamp).getTime(),
    ).toBeLessThanOrEqual(new Date(clearResult.event!.endedAt!).getTime());
    // State resets after closing.
    expect(clearResult.state).toEqual(emptySaturationState());
  });

  test("never reaching the threshold means clearing emits nothing", () => {
    let state = emptySaturationState();
    // One saturated sample, then idle — never reaches threshold of 3.
    const r1 = updateSaturation(BACKEND, saturated(), state);
    state = r1.state;
    const r2 = updateSaturation(BACKEND, idle(), state);
    expect(r2.event).toBeUndefined();
  });

  test("an unreachable sample doesn't reset in-progress saturation counting or spuriously close an episode", () => {
    let state: SaturationState = emptySaturationState();
    for (let i = 0; i < SATURATION_SAMPLE_THRESHOLD; i++) {
      state = updateSaturation(BACKEND, saturated(), state).state;
    }
    expect(state.openEpisodeStartedAtIso).toBeDefined();

    const unreachableResult = updateSaturation(
      BACKEND,
      { reachable: false },
      state,
    );
    // State unchanged — episode still open, no event.
    expect(unreachableResult.state).toEqual(state);
    expect(unreachableResult.event).toBeUndefined();
  });

  test("zero total slots is never considered saturated (avoids a 0-busy/0-total false positive)", () => {
    const result = updateSaturation(
      BACKEND,
      { reachable: true, slotsTotal: 0, slotsBusy: 0 },
      emptySaturationState(),
    );
    expect(result.state.consecutiveSaturated).toBe(0);
  });
});

describe("pollSlots", () => {
  test("marks Halogen occupancy unsupported when slot status fields are absent", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify([{ id: 0, n_ctx: 131072 }]), {
        status: 200,
      });

    try {
      const result = await pollSlots(HALOGEN_BACKEND);
      expect(result.reachable).toBe(true);
      expect(result.occupancySupported).toBe(false);
      expect(result.slotsTotal).toBeUndefined();
      expect(result.slotsBusy).toBeUndefined();
      expect(result.snapshot?.payload).toEqual({
        port: 12348,
        label: "halogen",
        occupancySupported: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("retains measured occupancy when slot status fields are present", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          { id: 0, is_processing: true },
          { id: 1, is_processing: false },
        ]),
        { status: 200 },
      );

    try {
      const result = await pollSlots(BACKEND);
      expect(result.occupancySupported).toBe(true);
      expect(result.slotsTotal).toBe(2);
      expect(result.slotsBusy).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
