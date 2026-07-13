import type { Collector } from "../core/types.js";
import { CollectorStateStore } from "../core/state-store.js";
import { HERMES_BACKENDS } from "./config.js";
import { LlamaSwapCollector } from "./llama-swap-collector.js";
import { HermesBackendCollector } from "./backend-collector.js";

/**
 * Assembles every Hermes-side Collector: the router (llama-swap) health
 * poller plus one combined slots+log collector per backend port. All run
 * server-side via LocalSink (see src/collectors/core/sinks.ts) since
 * llama-server's individual backend ports and its systemd journal are
 * only reachable on the same box as the server itself.
 */
export function buildHermesCollectors(
  state: CollectorStateStore = new CollectorStateStore(),
): Collector[] {
  return [
    new LlamaSwapCollector(state),
    ...HERMES_BACKENDS.map(
      (backend) => new HermesBackendCollector(backend, state),
    ),
  ];
}
