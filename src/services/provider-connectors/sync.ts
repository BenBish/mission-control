/**
 * Orchestrates provider connector sync: fetch → upsert → prune → status.
 * Never throws out of syncAllProviders — errors become status=error rows.
 */

import type { Database as SqliteDatabase } from "sqlite";
import {
  deleteProviderCreditSnapshotsByLabel,
  upsertProviderCreditSnapshot,
} from "../../db/queries/provider-credits.js";
import {
  pruneStaleProviderUsageModels,
  upsertProviderSyncStatus,
  upsertProviderUsage,
} from "../../db/queries/provider-usage.js";
import { latestQuotaSnapshots } from "../../db/queries/telemetry.js";
import { anthropicConnector } from "./connectors/anthropic.js";
import { openaiConnector } from "./connectors/openai.js";
import { openrouterConnector } from "./connectors/openrouter.js";
import { xaiConnector } from "./connectors/xai.js";
import { credentialMeta } from "./credentials.js";
import { sanitizeMessage } from "./http.js";
import {
  CANONICAL_PLAN_SLOTS,
  UNAVAILABLE_SLOT_LABEL,
} from "../../lib/plan-windows.js";
import { normalizeSessionQuotaToCredits } from "./normalize/credits.js";
import type {
  FetchImpl,
  FetchWindow,
  ProviderId,
  ProviderConnector,
} from "./types.js";
import { ProviderHttpError } from "./types.js";

const ALL_CONNECTORS: ProviderConnector[] = [
  openrouterConnector,
  anthropicConnector,
  openaiConnector,
  xaiConnector,
];

/**
 * Map provider connector id → collector source_id that emits quota_snapshots
 * for that provider's plan-usage windows. Those snapshots are classified
 * into the shared 5h / weekly contract (`src/lib/plan-windows.ts`).
 */
export const SESSION_QUOTA_SOURCE_BY_PROVIDER: Partial<
  Record<ProviderId, string>
> = {
  openai: "codex",
  anthropic: "claude-code",
  xai: "grok",
};

/** Prevent overlapping scheduled/manual syncs from stacking. */
let syncInFlight: Promise<SyncProviderResult[]> | null = null;

function findConnector(id: ProviderId): ProviderConnector | undefined {
  return ALL_CONNECTORS.find((c) => c.id === id);
}

export function defaultFetchWindow(days = 30): FetchWindow {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

export interface SyncProviderResult {
  provider: ProviderId;
  status: "not_configured" | "ok" | "limited" | "error" | "skipped";
  rowsUpserted: number;
  rowsPruned?: number;
  creditSnapshots?: number;
  error?: string;
  limitation?: string;
}

/**
 * Persist connector credit snapshots + (for OpenAI) latest Codex session quotas.
 * Failures are recorded as error snapshots when possible; never throw to caller.
 */
async function syncCreditsForProvider(
  db: SqliteDatabase,
  connector: ProviderConnector,
  fetchImpl?: FetchImpl,
): Promise<{ count: number; limitation?: string }> {
  let count = 0;
  let limitation: string | undefined;

  // Session quota / plan-usage windows from collectors (Codex, Claude Code, …).
  // Prefer real session rows over placeholder "unavailable" plan-usage tiles.
  let sessionPlanUsageCount = 0;
  const sessionSource = SESSION_QUOTA_SOURCE_BY_PROVIDER[connector.id];
  if (sessionSource) {
    try {
      const quotas = await latestQuotaSnapshots(db);
      const rows = quotas.filter((q) => q.source_id === sessionSource);
      const snaps = normalizeSessionQuotaToCredits(rows, connector.id);
      for (const snap of snaps) {
        await upsertProviderCreditSnapshot(db, snap);
        count++;
        sessionPlanUsageCount++;
      }
      if (sessionPlanUsageCount > 0) {
        await deleteProviderCreditSnapshotsByLabel(
          db,
          connector.id,
          "plan_usage_unavailable",
        );
      }
      for (const slot of CANONICAL_PLAN_SLOTS) {
        const hasRealSlot = snaps.some(
          (s) => s.source === "session_quota" && s.details?.slot === slot,
        );
        if (hasRealSlot) {
          await deleteProviderCreditSnapshotsByLabel(
            db,
            connector.id,
            UNAVAILABLE_SLOT_LABEL[slot],
          );
        }
      }
    } catch (err) {
      console.warn(
        `[provider-sync] session quota bridge failed for ${connector.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  if (connector.fetchCredits) {
    try {
      const result = await connector.fetchCredits(fetchImpl);
      limitation = result.limitation;
      for (const snap of result.snapshots) {
        // Drop placeholder plan_usage unavailable once real session rows exist.
        if (
          sessionPlanUsageCount > 0 &&
          snap.surface === "plan_usage" &&
          snap.source === "unavailable"
        ) {
          continue;
        }
        await upsertProviderCreditSnapshot(db, snap);
        count++;
      }
    } catch (err) {
      const message =
        err instanceof ProviderHttpError
          ? sanitizeMessage(err.message)
          : sanitizeMessage(err instanceof Error ? err.message : String(err));
      await upsertProviderCreditSnapshot(db, {
        provider: connector.id,
        asOf: new Date().toISOString(),
        remaining: null,
        total: null,
        unit: "usd",
        label: "prepaid_balance",
        source: "unavailable",
        status: "error",
        surface: "wallet",
        details: { error: message, surface: "wallet" },
      });
      count++;
      limitation = message;
    }
  }

  return { count, limitation };
}

export async function syncProvider(
  db: SqliteDatabase,
  connector: ProviderConnector,
  opts: {
    window?: FetchWindow;
    fetchImpl?: FetchImpl;
  } = {},
): Promise<SyncProviderResult> {
  const now = new Date().toISOString();
  const meta = credentialMeta(connector.id);

  if (!connector.isConfigured()) {
    await upsertProviderSyncStatus(db, {
      provider: connector.id,
      status: "not_configured",
      lastSyncAt: now,
      lastError: null,
      meta: { envVars: meta.envVars, notes: meta.notes, limitation: null },
    });
    // Still try session-quota credits for OpenAI even when admin key missing.
    const credits = await syncCreditsForProvider(db, connector, opts.fetchImpl);
    return {
      provider: connector.id,
      status: "not_configured",
      rowsUpserted: 0,
      creditSnapshots: credits.count,
      limitation: credits.limitation,
    };
  }

  await upsertProviderSyncStatus(db, {
    provider: connector.id,
    status: "syncing",
    lastSyncAt: now,
    lastError: null,
    meta: { envVars: meta.envVars, notes: meta.notes, limitation: null },
  });

  try {
    const window = opts.window ?? defaultFetchWindow(30);
    const result = await connector.fetchUsage(window, opts.fetchImpl);
    let rowsUpserted = 0;
    let rowsPruned = 0;
    let maxDay: string | null = null;

    // Group models by day so we can prune stale models per day after upsert.
    // Only days present in this fetch are pruned; historical days outside the
    // provider window are intentionally retained (we do not wipe missing days).
    const modelsByDay = new Map<string, Set<string>>();
    for (const row of result.rows) {
      await upsertProviderUsage(db, {
        provider: row.provider,
        day: row.day,
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: row.costUsd,
        requestCount: row.requestCount,
      });
      rowsUpserted++;
      if (!maxDay || row.day > maxDay) maxDay = row.day;
      let set = modelsByDay.get(row.day);
      if (!set) {
        set = new Set();
        modelsByDay.set(row.day, set);
      }
      set.add(row.model);
    }

    for (const [day, models] of modelsByDay) {
      rowsPruned += await pruneStaleProviderUsageModels(
        db,
        connector.id,
        day,
        Array.from(models),
      );
    }

    const credits = await syncCreditsForProvider(db, connector, opts.fetchImpl);
    const creditLimitation = credits.limitation;
    const combinedLimitation =
      [result.limitation, creditLimitation].filter(Boolean).join(" ") ||
      undefined;

    const status =
      combinedLimitation && rowsUpserted === 0 && !result.rows.length
        ? "limited"
        : result.limitation
          ? "limited"
          : "ok";
    await upsertProviderSyncStatus(db, {
      provider: connector.id,
      status,
      lastSyncAt: now,
      lastSuccessAt: now,
      // Real failures only in lastError; limitations live in meta.
      lastError: null,
      cursorDay: maxDay,
      meta: {
        envVars: meta.envVars,
        notes: meta.notes,
        rowsUpserted,
        rowsPruned,
        creditSnapshots: credits.count,
        limitation: combinedLimitation ?? null,
      },
    });

    return {
      provider: connector.id,
      status,
      rowsUpserted,
      rowsPruned,
      creditSnapshots: credits.count,
      limitation: combinedLimitation,
    };
  } catch (err) {
    const message =
      err instanceof ProviderHttpError
        ? sanitizeMessage(err.message)
        : sanitizeMessage(err instanceof Error ? err.message : String(err));

    await upsertProviderSyncStatus(db, {
      provider: connector.id,
      status: "error",
      lastSyncAt: now,
      lastError: message,
      meta: {
        envVars: meta.envVars,
        notes: meta.notes,
        limitation: null,
      },
    });

    return {
      provider: connector.id,
      status: "error",
      rowsUpserted: 0,
      error: message,
    };
  }
}

export async function syncAllProviders(
  db: SqliteDatabase,
  opts: {
    providers?: ProviderId[];
    window?: FetchWindow;
    fetchImpl?: FetchImpl;
    /** When true (default for public entrypoints), skip if a sync is already running. */
    skipIfInFlight?: boolean;
  } = {},
): Promise<SyncProviderResult[]> {
  const skipIfInFlight = opts.skipIfInFlight !== false;
  const list = opts.providers?.length
    ? opts.providers
        .map((id) => findConnector(id))
        .filter((c): c is ProviderConnector => !!c)
    : ALL_CONNECTORS;

  if (skipIfInFlight && syncInFlight) {
    // Only report skipped for the connectors this call would have run.
    return list.map((c) => ({
      provider: c.id,
      status: "skipped" as const,
      rowsUpserted: 0,
      error: "sync already in progress",
    }));
  }

  const run = (async () => {
    const results: SyncProviderResult[] = [];
    for (const connector of list) {
      results.push(await syncProvider(db, connector, opts));
    }
    return results;
  })();

  if (skipIfInFlight) {
    syncInFlight = run.finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  }

  return run;
}

/** Test-only: reset the in-flight guard between suites. */
export function resetSyncInFlightForTests(): void {
  syncInFlight = null;
}
