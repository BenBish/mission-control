/**
 * Display names for inference `client_label` values.
 *
 * Hermes backends stamp short machine labels (e.g. `opencode`) onto
 * inference_requests.client_label — see collectors/hermes/config.ts. Those
 * strings are not agentic sources (Activities/Sessions "OpenCode" is a
 * different product surface after BSH-86). This module maps known labels to
 * operator-friendly names without inventing fake agent identity.
 */

export interface ClientLabelDisplay {
  /** Raw client_label / backend id (filter value, API identity). */
  id: string;
  /** Short UI label for badges, filters, tables. */
  name: string;
  /** Optional secondary explanation (tooltips, helper copy). */
  description?: string;
}

/**
 * Known Hermes / lemonade client labels. Keys must match the strings written
 * by collectors (HERMES_BACKENDS[].label, lemonade poller, etc.).
 */
const KNOWN: Record<string, Omit<ClientLabelDisplay, "id">> = {
  opencode: {
    name: "OpenCode (llama-swap)",
    description:
      "Hermes/llama-swap backend traffic for the OpenCode-dedicated slot — not OpenCode agent sessions.",
  },
  "hermes-qwen": {
    name: "Hermes Qwen",
    description: "Shared Hermes gateway backend (Qwen).",
  },
  "gemma-fallback": {
    name: "Gemma fallback",
    description: "Hermes gemma-fallback llama-server backend.",
  },
  lemonade: {
    name: "Lemonade",
    description: "Lemonade inference client.",
  },
};

/** Raw label used when client_label is null/empty. */
export const UNKNOWN_CLIENT_LABEL = "unknown";

export function clientLabelDisplay(
  raw: string | null | undefined,
): ClientLabelDisplay {
  if (raw == null || raw === "") {
    return { id: UNKNOWN_CLIENT_LABEL, name: "Unknown client" };
  }
  const known = KNOWN[raw];
  if (known) {
    return { id: raw, name: known.name, description: known.description };
  }
  return { id: raw, name: raw };
}

/** Short display name only (badges, select items, occupancy rows). */
export function formatClientLabel(raw: string | null | undefined): string {
  return clientLabelDisplay(raw).name;
}

export function isOpenCodeHermesClient(
  raw: string | null | undefined,
): boolean {
  return raw === "opencode";
}

/**
 * True when any of the raw labels is the Hermes OpenCode backend.
 * Used for Runtime helper copy when that traffic is present in filters.
 */
export function hasOpenCodeHermesClient(
  labels: readonly (string | null | undefined)[],
): boolean {
  return labels.some((l) => isOpenCodeHermesClient(l));
}
