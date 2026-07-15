/**
 * ComfyUI topology on the Strix Halo box. Verified live against the real
 * box (2026-07-13): unlike Hermes's llama-server backends (loopback-only),
 * ComfyUI's start script passes `--listen 100.104.4.96` (the tailnet IP)
 * explicitly, not 127.0.0.1 — so it's reachable at the tailnet address
 * even though this poller happens to run colocated with it via LocalSink.
 * No systemd unit exists for it (started/stopped manually via
 * ~/bin/comfyui-start / ~/bin/comfyui-stop) — currently disabled by
 * default, same as Lemonade.
 */

export const COMFYUI_URL =
  process.env.MC_COMFYUI_URL ?? "http://100.104.4.96:8188";

export const COMFYUI_POLL_INTERVAL_MS = 10_000;
