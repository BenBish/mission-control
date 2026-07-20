/**
 * Orchestrates provider connector sync: fetch → upsert → prune → status.
 * Never throws out of syncAllProviders — errors become status=error rows.
 */

import type { Database as SqliteDatabase } from "sqlite";
import {
  pruneStaleProviderUsageModels,
  upsertProviderSyncStatus,
  upsertProviderUsage,
} from "../../db/queries/provider-usage.js";
import { anthropicConnector } from "./connectors/anthropic.js";
import { openaiConnector } from "./connectors/openai.js";
import { openrouterConnector } from "./connectors/openrouter.js";
import { xaiConnector } from "./connectors/xai.js";
import { credentialMeta } from "./credentials.js";
import { sanitizeMessage } from "./http.js";
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
  error?: string;
  limitation?: string;
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
    return {
      provider: connector.id,
      status: "not_configured",
      rowsUpserted: 0,
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

    const status = result.limitation ? "limited" : "ok";
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
        limitation: result.limitation ?? null,
      },
    });

    return {
      provider: connector.id,
      status,
      rowsUpserted,
      rowsPruned,
      limitation: result.limitation,
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

  if (skipIfInFlight && syncInFlight) {
    return ALL_CONNECTORS.map((c) => ({
      provider: c.id,
      status: "skipped" as const,
      rowsUpserted: 0,
      error: "sync already in progress",
    }));
  }

  const run = (async () => {
    const list = opts.providers?.length
      ? opts.providers
          .map((id) => findConnector(id))
          .filter((c): c is ProviderConnector => !!c)
      : ALL_CONNECTORS;

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
