/**
 * Best-effort workload:'background' tagging for inference_requests on the
 * shared hermes-qwen backend (port 12346 — the one all three Hermes
 * gateways route to). There is no shared request ID between llama-server's
 * journal and a Hermes gateway's journal, so this is *not* a precise
 * per-request link — it's coarse, tick-window correlation: if any Hermes
 * gateway journal shows a "Context compression"/"Compression sanitizer"
 * line (from ~/.hermes/hermes-agent/agent/context_compressor.py's own
 * logger — verified real message text on the live box) anywhere within
 * this tick's time window, every inference_request that closed on the
 * shared backend during that same window gets tagged 'background'.
 *
 * That's a real false-positive risk (a foreground turn that happens to
 * complete in the same ~5s window as an unrelated compression job would
 * get mistagged) — acceptable for a heuristic the UI is expected to badge
 * as uncertain, not for anything treated as ground truth. If this turns
 * out noisy in practice, the fix is tightening the window or dropping
 * this correlation entirely and shipping 'unknown' — not silently trusting
 * it further.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { HERMES_GATEWAY_UNITS } from "./config.js";

const execFileAsync = promisify(execFile);

const COMPRESSION_SIGNATURE = /Context compression|Compression sanitizer/;

/**
 * Returns true if any Hermes gateway journal has a compression-related
 * line with a timestamp inside [sinceIso, untilIso]. One journalctl call
 * per gateway unit per invocation — call at most once per tick, not once
 * per request. journalctl's --since/--until don't reliably parse ISO8601
 * with a 'T'/'Z' (verified: no error, but also no results against a known
 * good window on the real box) — `@<unix-seconds>` is journalctl's own
 * unambiguous epoch format and verified working.
 */
export async function anyGatewayCompressionActivity(
  sinceIso: string,
  untilIso: string,
): Promise<boolean> {
  const since = `@${Math.floor(new Date(sinceIso).getTime() / 1000)}`;
  const until = `@${Math.floor(new Date(untilIso).getTime() / 1000)}`;

  for (const unit of HERMES_GATEWAY_UNITS) {
    try {
      const { stdout } = await execFileAsync(
        "journalctl",
        [
          "--user",
          "-u",
          unit,
          "--since",
          since,
          "--until",
          until,
          "-o",
          "cat",
          "--no-pager",
        ],
        { maxBuffer: 8 * 1024 * 1024 },
      );
      if (COMPRESSION_SIGNATURE.test(stdout)) return true;
    } catch {
      // Unit might not exist in non-production environments — treat as
      // "no signal", not an error worth failing the tick over.
      continue;
    }
  }
  return false;
}
