/**
 * Local collector state — file scan cursors plus per-session running
 * aggregates (turn/tool-call/failure counts, token sums, last-known
 * cwd/branch/title). Both need to survive a collector restart:
 *
 *  - Cursors so a restart doesn't re-send already-ACKed events.
 *  - Session aggregates so a restart doesn't under-report a session's
 *    lifetime totals (the collector only re-reads bytes *after* the
 *    cursor, so without persisting the running total, a restart mid-session
 *    would reset it to zero and the next "session" event would understate
 *    everything that happened before the restart).
 *
 * Single file at ~/.local/state/mission-control/cursors.json, keyed by an
 * arbitrary string the caller controls (collectors namespace their own
 * keys, e.g. `claude-code:<filePath>` for cursors, `claude-code:<external
 * Id>` for session aggregates).
 */

import fs from "fs";
import path from "path";
import os from "os";
import type { FileCursor } from "./jsonl-scanner.js";

const STATE_DIR = path.join(os.homedir(), ".local", "state", "mission-control");
const STATE_FILE = path.join(STATE_DIR, "cursors.json");

interface PersistedState {
  fileCursors: Record<string, FileCursor>;
  sessionAggregates: Record<string, unknown>;
}

function loadPersisted(): PersistedState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      fileCursors: parsed.fileCursors ?? {},
      sessionAggregates: parsed.sessionAggregates ?? {},
    };
  } catch {
    return { fileCursors: {}, sessionAggregates: {} };
  }
}

export class CollectorStateStore {
  private state: PersistedState;

  constructor() {
    this.state = loadPersisted();
  }

  getCursor(key: string): FileCursor | undefined {
    return this.state.fileCursors[key];
  }

  setCursor(key: string, cursor: FileCursor): void {
    this.state.fileCursors[key] = cursor;
  }

  getAggregate<T>(key: string): T | undefined {
    return this.state.sessionAggregates[key] as T | undefined;
  }

  setAggregate<T>(key: string, value: T): void {
    this.state.sessionAggregates[key] = value;
  }

  /**
   * Only call this after the batch containing these updates has been ACKed.
   * Writes to a temp file and renames over the target — a crash mid-write
   * leaves the previous cursors.json intact instead of a truncated/corrupt
   * file (rename is atomic on the same filesystem, and the temp file lives
   * in STATE_DIR so it always is).
   */
  persist(): void {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmpFile = path.join(STATE_DIR, `.cursors.json.${process.pid}.tmp`);
    fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), "utf-8");
    fs.renameSync(tmpFile, STATE_FILE);
  }
}
