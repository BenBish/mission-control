/**
 * Hermes topology on the Strix Halo box — fixed, not user-configurable in
 * P2. Verified live against the real box (2026-07-13): three llama-server
 * backends behind llama-swap, each its own systemd --user unit inside the
 * `llama-rocm-7.2.4` podman container, each reachable only from
 * 127.0.0.1 on that box (not exposed over Tailscale) — which is exactly
 * why this poller has to run colocated on that box via LocalSink rather
 * than as a remote HTTP collector.
 */

export interface HermesBackend {
  /** llama-server's own port — /slots, /metrics, and per-request journal
   *  telemetry all come from here directly, bypassing llama-swap. */
  port: number;
  /** systemd --user unit whose journal carries this backend's slot/request
   *  log lines (`slot launch_slot_`, `slot release`, `srv send_error`, ...). */
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
    port: 12346,
    unit: "llama-toolbox-qwen-hermes.service",
    label: "hermes-qwen",
    model: "Qwen3.6-27B-UD-Q4_K_XL.gguf",
    sharedByGateways: true,
  },
  {
    port: 12347,
    unit: "llama-toolbox-qwen-opencode.service",
    label: "opencode",
    model: "Qwen3.6-35B-A3B-Opencode-128K",
  },
  {
    port: 12345,
    unit: "llama-toolbox-gemma.service",
    label: "gemma-fallback",
    model: "gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf",
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
