/**
 * Incremental offset-cursor JSONL scanning engine.
 *
 * Extracted from src/services/session-log-scanner.ts's offset-tracking
 * approach (left in place, unmodified, as OpenClaw-shaped reference code)
 * and hardened: this version detects file rotation/truncation via
 * inode+size instead of trusting size alone, and never advances the cursor
 * past a partial trailing line (a line still being written).
 */

import fs from "fs";

export interface FileCursor {
  offset: number;
  inode: number;
  size: number;
}

export interface ScanOutcome<T> {
  cursor: FileCursor;
  records: T[];
}

/**
 * Scan a JSONL file incrementally from a prior cursor position.
 *
 * @param parseLine Called once per complete, non-blank line (already
 *   trimmed). Return null to skip a line (e.g. a record type this
 *   collector doesn't care about). Throwing is treated as "skip" too —
 *   partial writes and corruption shouldn't kill the scan.
 */
export function scanJsonlFile<T>(
  filePath: string,
  prevCursor: FileCursor | undefined,
  parseLine: (line: string) => T | null,
): ScanOutcome<T> {
  const stat = fs.statSync(filePath);
  const inode = stat.ino;

  let startOffset = prevCursor?.offset ?? 0;
  const rotated =
    prevCursor !== undefined &&
    (prevCursor.inode !== inode || stat.size < prevCursor.offset);
  if (rotated) {
    startOffset = 0;
  }

  if (stat.size <= startOffset) {
    return {
      cursor: { offset: startOffset, inode, size: stat.size },
      records: [],
    };
  }

  const fd = fs.openSync(filePath, "r");
  const length = stat.size - startOffset;
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, startOffset);
  fs.closeSync(fd);

  const chunk = buffer.toString("utf-8");
  const lastNewline = chunk.lastIndexOf("\n");

  // No complete line yet (file mid-write) — don't advance the cursor.
  if (lastNewline === -1) {
    return {
      cursor: { offset: startOffset, inode, size: stat.size },
      records: [],
    };
  }

  const complete = chunk.slice(0, lastNewline);
  const consumedBytes = Buffer.byteLength(complete, "utf-8") + 1; // + the newline itself

  const records: T[] = [];
  for (const line of complete.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = parseLine(trimmed);
      if (parsed !== null) records.push(parsed);
    } catch {
      // Skip unparseable lines (partial writes, corruption)
    }
  }

  return {
    cursor: { offset: startOffset + consumedBytes, inode, size: stat.size },
    records,
  };
}
