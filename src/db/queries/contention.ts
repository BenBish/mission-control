import type { Database as SqliteDatabase } from "sqlite";

/**
 * Contention incidents: a background-classified request that held a slot
 * during a saturation episode that also overlapped a non-background
 * request on the same instance — i.e. "background work made a real turn
 * wait." Correlated in JS rather than one big SQL join: volumes here are
 * small (Hermes-instance-scoped telemetry over a few days, not millions
 * of rows) and the overlap logic is much easier to get right and test as
 * plain interval math than as SQLite datetime-arithmetic joins.
 *
 * Because workload classification itself is a best-effort heuristic (see
 * src/collectors/hermes/workload-correlation.ts), this will surface few
 * or zero incidents unless that correlation actually found something —
 * that's expected, not a bug. Never fabricate an incident to make this
 * look more populated than the underlying classification supports.
 */

interface InferenceWindowRow {
  id: string;
  instance_id: string;
  timestamp: string;
  duration_ms: number | null;
  ttft_ms: number | null;
  client_label: string | null;
  model: string | null;
  status: string;
}

interface SaturationEventRow {
  id: string;
  instance_id: string;
  timestamp: string;
  ended_at: string | null;
  summary: string;
}

export interface ContentionIncident {
  id: string;
  instanceId: string;
  backgroundRequestId: string;
  backgroundClientLabel: string | null;
  backgroundModel: string | null;
  backgroundStartedAt: string;
  backgroundDurationMs: number | null;
  saturationEventId: string;
  saturationSummary: string;
  saturationStartedAt: string;
  saturationEndedAt: string;
  foregroundRequestId: string;
  foregroundStartedAt: string;
  foregroundTtftMs: number | null;
}

function windowEnd(startIso: string, durationMs: number | null): number {
  return new Date(startIso).getTime() + (durationMs ?? 0);
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export async function listContentionIncidents(
  db: SqliteDatabase,
  opts: { since?: string; limit?: number } = {},
): Promise<ContentionIncident[]> {
  const since =
    opts.since ?? new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const limit = opts.limit ?? 50;

  const [backgroundRows, saturationRows, otherRows] = await Promise.all([
    db.all<InferenceWindowRow[]>(
      `SELECT id, instance_id, timestamp, duration_ms, ttft_ms, client_label, model, status
       FROM inference_requests
       WHERE workload = 'background' AND timestamp >= ?
       ORDER BY timestamp DESC`,
      since,
    ),
    db.all<SaturationEventRow[]>(
      `SELECT id, instance_id, timestamp, ended_at, summary
       FROM runtime_events
       WHERE kind = 'slots_saturated' AND ended_at IS NOT NULL AND timestamp >= ?`,
      since,
    ),
    db.all<InferenceWindowRow[]>(
      `SELECT id, instance_id, timestamp, duration_ms, ttft_ms, client_label, model, status
       FROM inference_requests
       WHERE workload != 'background' AND timestamp >= ?`,
      since,
    ),
  ]);

  const incidents: ContentionIncident[] = [];

  for (const bg of backgroundRows) {
    const bgStart = new Date(bg.timestamp).getTime();
    const bgEnd = windowEnd(bg.timestamp, bg.duration_ms);

    const overlappingSaturation = saturationRows.filter((sat) => {
      if (sat.instance_id !== bg.instance_id || !sat.ended_at) return false;
      const satStart = new Date(sat.timestamp).getTime();
      const satEnd = new Date(sat.ended_at).getTime();
      return overlaps(bgStart, bgEnd, satStart, satEnd);
    });
    if (overlappingSaturation.length === 0) continue;

    for (const sat of overlappingSaturation) {
      const satStart = new Date(sat.timestamp).getTime();
      const satEnd = new Date(sat.ended_at!).getTime();

      const overlappingForeground = otherRows.filter((fg) => {
        if (fg.instance_id !== bg.instance_id) return false;
        const fgStart = new Date(fg.timestamp).getTime();
        const fgEnd = windowEnd(fg.timestamp, fg.duration_ms);
        return (
          overlaps(fgStart, fgEnd, satStart, satEnd) &&
          overlaps(fgStart, fgEnd, bgStart, bgEnd)
        );
      });

      for (const fg of overlappingForeground) {
        incidents.push({
          id: `${bg.id}:${sat.id}:${fg.id}`,
          instanceId: bg.instance_id,
          backgroundRequestId: bg.id,
          backgroundClientLabel: bg.client_label,
          backgroundModel: bg.model,
          backgroundStartedAt: bg.timestamp,
          backgroundDurationMs: bg.duration_ms,
          saturationEventId: sat.id,
          saturationSummary: sat.summary,
          saturationStartedAt: sat.timestamp,
          saturationEndedAt: sat.ended_at!,
          foregroundRequestId: fg.id,
          foregroundStartedAt: fg.timestamp,
          foregroundTtftMs: fg.ttft_ms,
        });
      }
    }
  }

  incidents.sort((a, b) =>
    a.backgroundStartedAt < b.backgroundStartedAt ? 1 : -1,
  );
  return incidents.slice(0, limit);
}
