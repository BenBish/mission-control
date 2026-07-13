/**
 * Lemonade Server topology — UNVERIFIED. Confirmed real (via CLI
 * `--help-all`, /opt/share/lemonade/defaults.json, and the bundled
 * examples' actual working Python client code): host defaults to
 * `localhost`, port defaults to `13305`, and the OpenAI-compatible base
 * path is `/api/v1` (e.g. examples/api_image_generation.py uses
 * `base_url="http://localhost:13305/api/v1"`).
 *
 * NOT verified: I could not get a live Lemonade instance running on the
 * target box to check actual endpoint shapes. Every CLI subcommand
 * (`run`, `pull`, `list`) requires an already-running server, and the
 * real server daemon appears to be a root-managed systemd service
 * (/opt/lib/sysusers.d/lemonade.conf exists, was never set up) —
 * no sudo access to start it. The health/system-stats/stats endpoint
 * paths and shapes below are carried over from an earlier research pass
 * (~/Dev/benbishop-context/docs/research), not independently confirmed
 * the way Hermes and ComfyUI were. Treat everything in poller.ts as a
 * best-effort implementation to be corrected once someone can test
 * against a real running instance.
 */

export const LEMONADE_BASE_URL =
  process.env.MC_LEMONADE_URL ?? "http://localhost:13305";

export const LEMONADE_POLL_INTERVAL_MS = 15_000;
