/**
 * Health-transition logic — the actual "kill llama-swap -> service_down"
 * verification target the plan calls for can't safely be tested against
 * the real box (it's the user's production Hermes setup, actively serving
 * real agents), so this covers the transition state machine directly
 * instead.
 */

import { describe, test, expect } from "bun:test";
import {
  updateHealthState,
  type LlamaSwapHealthState,
} from "../../../collectors/hermes/llama-swap-poller.js";

describe("updateHealthState", () => {
  test("first observation records state but emits no event, healthy or not", () => {
    const state: LlamaSwapHealthState = {};
    const healthyResult = updateHealthState({ healthy: true }, state);
    expect(healthyResult.event).toBeUndefined();
    expect(healthyResult.state.lastKnownHealthy).toBe(true);

    const downResult = updateHealthState({ healthy: false }, {});
    expect(downResult.event).toBeUndefined();
    expect(downResult.state.lastKnownHealthy).toBe(false);
  });

  test("healthy -> unhealthy transition emits service_down", () => {
    const state: LlamaSwapHealthState = { lastKnownHealthy: true };
    const { state: newState, event } = updateHealthState(
      { healthy: false },
      state,
    );
    expect(event?.kind).toBe("service_down");
    expect(event?.severity).toBe("error");
    expect(newState.lastKnownHealthy).toBe(false);
  });

  test("unhealthy -> healthy transition emits service_up", () => {
    const state: LlamaSwapHealthState = { lastKnownHealthy: false };
    const { state: newState, event } = updateHealthState(
      { healthy: true },
      state,
    );
    expect(event?.kind).toBe("service_up");
    expect(event?.severity).toBe("info");
    expect(newState.lastKnownHealthy).toBe(true);
  });

  test("no state change -> no event, on either steady state", () => {
    const stillUp = updateHealthState(
      { healthy: true },
      { lastKnownHealthy: true },
    );
    expect(stillUp.event).toBeUndefined();

    const stillDown = updateHealthState(
      { healthy: false },
      { lastKnownHealthy: false },
    );
    expect(stillDown.event).toBeUndefined();
  });

  test("repeated flapping emits one event per actual transition, not per tick", () => {
    let state: LlamaSwapHealthState = { lastKnownHealthy: true };
    const events: string[] = [];

    for (const healthy of [true, true, false, false, false, true, false]) {
      const result = updateHealthState({ healthy }, state);
      state = result.state;
      if (result.event) events.push(result.event.kind);
    }

    // true,true -> no events. false -> down. false,false -> no events.
    // true -> up. false -> down.
    expect(events).toEqual(["service_down", "service_up", "service_down"]);
  });
});
