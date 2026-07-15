/**
 * Slot occupancy polling for one llama-server backend, direct on its own
 * port (bypasses llama-swap entirely — verified /slots works the same
 * whether hit through the router or not, and going direct means this
 * still works even if llama-swap itself is down).
 *
 * Saturation ("all slots busy") is tracked as an episode, not a per-sample
 * event: emitting once per 5s sample while a backend stays pegged would
 * flood runtime_events. SATURATION_SAMPLE_THRESHOLD consecutive busy
 * samples opens an episode; the ingest layer only supports inserting new
 * rows (no update-by-naturalKey path), and the schema's runtime_event
 * `kind` enum has no separate "cleared" value, so a single
 * slots_saturated row — timestamp = episode start, ended_at = episode
 * end — is only emitted once the episode actually closes (the first
 * non-saturated sample after it opened). There's no live "currently
 * saturated" event mid-episode; the live view of occupancy comes from
 * the 5s runtime_snapshot rows this same poller emits, independently of
 * episode tracking.
 */

import type {
  RuntimeEventPayload,
  RuntimeSnapshotPayload,
} from "../../types/ingest.js";
import { SATURATION_SAMPLE_THRESHOLD, type HermesBackend } from "./config.js";

interface SlotEntry {
  id: number;
  is_processing: boolean;
}

export interface SlotPollResult {
  reachable: boolean;
  slotsTotal?: number;
  slotsBusy?: number;
  snapshot?: RuntimeSnapshotPayload;
}

export async function pollSlots(
  backend: HermesBackend,
): Promise<SlotPollResult> {
  try {
    const res = await fetch(`http://127.0.0.1:${backend.port}/slots`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return { reachable: false };
    const slots = (await res.json()) as SlotEntry[];
    const slotsTotal = slots.length;
    const slotsBusy = slots.filter((s) => s.is_processing).length;
    return {
      reachable: true,
      slotsTotal,
      slotsBusy,
      snapshot: {
        timestamp: new Date().toISOString(),
        kind: "slots",
        slotsTotal,
        slotsBusy,
        payload: { port: backend.port, label: backend.label },
      },
    };
  } catch {
    return { reachable: false };
  }
}

/** Saturation episode state, persisted per backend across ticks. */
export interface SaturationState {
  /** Count of consecutive saturated samples seen so far (resets to 0 on
   *  any non-saturated sample). Only reaching the threshold opens an
   *  episode. */
  consecutiveSaturated: number;
  /** Set once the episode officially opens (threshold reached) — this is
   *  the timestamp that becomes the emitted event's `timestamp` once the
   *  episode closes. Slots_total is remembered too since the closing
   *  sample's own total could differ (backend restarted mid-episode). */
  openEpisodeStartedAtIso?: string;
  openEpisodeSlotsTotal?: number;
}

export function emptySaturationState(): SaturationState {
  return { consecutiveSaturated: 0 };
}

/** Given a fresh /slots sample and the prior saturation state, returns the
 *  updated state plus a runtime_event — only produced once, when a
 *  saturation episode that reached the threshold subsequently clears. */
export function updateSaturation(
  backend: HermesBackend,
  result: SlotPollResult,
  state: SaturationState,
): { state: SaturationState; event?: RuntimeEventPayload } {
  if (!result.reachable || result.slotsTotal == null) {
    // Backend unreachable — don't count toward saturation either way,
    // and don't spuriously close an open episode (that's llama-swap's/the
    // health poller's job to report as service_down).
    return { state };
  }

  const isSaturated =
    result.slotsBusy === result.slotsTotal && result.slotsTotal > 0;
  const now = new Date().toISOString();

  if (isSaturated) {
    const consecutiveSaturated = state.consecutiveSaturated + 1;
    const opening =
      consecutiveSaturated === SATURATION_SAMPLE_THRESHOLD &&
      !state.openEpisodeStartedAtIso;
    return {
      state: {
        consecutiveSaturated,
        openEpisodeStartedAtIso: opening ? now : state.openEpisodeStartedAtIso,
        openEpisodeSlotsTotal: opening
          ? result.slotsTotal
          : state.openEpisodeSlotsTotal,
      },
    };
  }

  // Not saturated this sample — if an episode had opened, it just closed.
  if (state.openEpisodeStartedAtIso) {
    const event: RuntimeEventPayload = {
      timestamp: state.openEpisodeStartedAtIso,
      endedAt: now,
      kind: "slots_saturated",
      severity: "warning",
      summary: `All ${state.openEpisodeSlotsTotal ?? "?"} slot(s) busy on ${backend.label} (port ${backend.port})`,
      details: {
        port: backend.port,
        label: backend.label,
        slotsTotal: state.openEpisodeSlotsTotal,
      },
    };
    return { state: emptySaturationState(), event };
  }

  return { state: emptySaturationState() };
}
