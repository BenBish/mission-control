/**
 * Hermes topology on the Strix Halo box — fixed, not user-configurable.
 * Halogen is reached directly on loopback and its systemd journal is read
 * locally, so this poller must run on the same box via LocalSink rather
 * than as a remote HTTP collector.
 */

export interface HermesBackend {
  /** Backend's own port — /slots and request telemetry are read directly,
   *  bypassing llama-swap. */
  port: number;
  /** systemd unit whose journal carries this backend's request telemetry. */
  unit: string;
  /** Human-readable label for client_label/UI — not a precise per-agent
   *  attribution (llama-server has no concept of which Hermes gateway a
   *  request came from), just which shared backend it landed on. */
  label: string;
  /**
   * Default model identity for requests that land on this backend.
   * llama-server journals do not include the model name on per-request
   * lines, and each dedicated backend is pinned to one model via
   * llama-swap/systemd. Stamped onto inference_request.model at emit time
   * so Runtime and consumption can group by model instead of null.
   * Update when the backend's loaded model changes on the box.
   */
  model?: string;
  /** True only for the backend all Hermes gateways route to — the only
   *  one workload-correlation.ts's gateway-journal check applies to (see
   *  its doc comment for why: no per-request link, coarse tick-window
   *  correlation, only meaningful where gateway activity and backend
   *  activity can plausibly be the same traffic). */
  sharedByGateways?: boolean;
}

export const LLAMA_SWAP_URL = "http://127.0.0.1:8080";

export const HERMES_BACKENDS: HermesBackend[] = [
  {
    port: 12348,
    unit: "halogen.service",
    label: "halogen",
    model: "Qwen3.8-Flash-Next-UD-IQ4_XS",
    sharedByGateways: true,
  },
];

/** Hermes gateway units whose journals may carry a "Context compression"/
 *  "Compression sanitizer" line from context_compressor.py — used for
 *  best-effort workload:'background' correlation. Three gateways exist on
 *  the real box (tom, freddy, bernie), not the two an earlier doc assumed. */
export const HERMES_GATEWAY_UNITS = [
  "hermes-gateway-tom.service",
  "hermes-gateway-freddy.service",
  "hermes-gateway-bernie.service",
];

export const POLL_INTERVAL_MS = 5_000;
/** Consecutive saturated /slots samples before emitting slots_saturated. */
export const SATURATION_SAMPLE_THRESHOLD = 3;
