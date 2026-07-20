/**
 * Resolve provider API credentials from environment.
 * Never log return values — keys must not appear in status or logs.
 */

import type { ProviderId } from "./types.js";

export interface ProviderCredentials {
  /** Present when the connector has enough config to attempt a sync. */
  configured: boolean;
  /** Env var names used (for docs / status UI — not values). */
  envVars: string[];
  /** Notes about key type (admin vs inference). */
  notes?: string;
}

export function resolveOpenRouterKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key || null;
}

export function resolveAnthropicAdminKey(): string | null {
  // Admin usage/cost API requires sk-ant-admin01-… (not a standard API key).
  const admin = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (admin) return admin;
  // Fall back only if explicitly labeled for admin use.
  const alt = process.env.ANTHROPIC_API_KEY?.trim();
  if (alt?.startsWith("sk-ant-admin")) return alt;
  return null;
}

export function resolveOpenAIAdminKey(): string | null {
  // Admin usage/cost endpoints require an org Admin key (not a project inference key).
  const admin = process.env.OPENAI_ADMIN_KEY?.trim();
  return admin || null;
}

export function resolveXaiKey(): string | null {
  const key =
    process.env.XAI_API_KEY?.trim() || process.env.XAI_KEY?.trim() || null;
  return key;
}

/** Optional override base URLs (tests / proxies). */
export function providerBaseUrl(
  provider: ProviderId,
  fallback: string,
): string {
  const envMap: Record<ProviderId, string | undefined> = {
    openrouter: process.env.OPENROUTER_BASE_URL,
    anthropic: process.env.ANTHROPIC_BASE_URL,
    openai: process.env.OPENAI_BASE_URL,
    xai: process.env.XAI_BASE_URL,
  };
  return (envMap[provider]?.trim() || fallback).replace(/\/$/, "");
}

export function credentialMeta(provider: ProviderId): ProviderCredentials {
  switch (provider) {
    case "openrouter":
      return {
        configured: !!resolveOpenRouterKey(),
        envVars: ["OPENROUTER_API_KEY"],
        notes:
          "Management key recommended for /activity (provider returns ~last 30 UTC days; filtered to sync window client-side).",
      };
    case "anthropic":
      return {
        configured: !!resolveAnthropicAdminKey(),
        envVars: ["ANTHROPIC_ADMIN_KEY"],
        notes:
          "Admin API key (prefix sk-ant-admin…), not a standard Claude key.",
      };
    case "openai":
      return {
        configured: !!resolveOpenAIAdminKey(),
        envVars: ["OPENAI_ADMIN_KEY"],
        notes:
          "Organization Admin key required for /organization/costs and usage.",
      };
    case "xai":
      return {
        configured: !!resolveXaiKey(),
        envVars: ["XAI_API_KEY"],
        notes:
          "xAI has no public historical usage API; connector verifies the key and accepts optional MC_XAI_USAGE_ENDPOINT JSON export.",
      };
  }
}
