/**
 * Session Log Scanner
 * Reads OpenClaw session JSONL files to extract LLM generation cost data.
 * The JSONL files contain exact per-request cost breakdowns on every assistant message.
 */

import fs from "fs";
import path from "path";
import { glob } from "glob";
import { v7 as uuidv7 } from "uuid";
import { Database } from "../db/database.js";

const DEFAULT_SESSIONS_GLOB = `${process.env.HOME}/.openclaw-team/agents/*/sessions/*.jsonl`;
const DEFAULT_SCAN_INTERVAL_MS = 30_000;

interface JSONLContentItem {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface JSONLAssistantMessage {
  type: "message";
  id: string;
  parentId?: string;
  timestamp: string;
  message: {
    role: string;
    content: JSONLContentItem[];
    api?: string;
    provider?: string;
    model?: string;
    usage?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      totalTokens: number;
      cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        total: number;
      };
    };
    stopReason?: string;
    timestamp?: number;
  };
}

export interface ScanResult {
  filesScanned: number;
  newGenerations: number;
  totalCost: number;
  errors: string[];
}

export class SessionLogScanner {
  private db: Database;
  private sessionsGlob: string;
  private intervalMs: number;
  private profileId: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private lastScanResult: ScanResult | null = null;
  private lastScanTime: Date | null = null;

  constructor(
    db: Database,
    options?: { sessionsGlob?: string; intervalMs?: number; profileId?: string },
  ) {
    this.db = db;
    this.sessionsGlob = options?.sessionsGlob || DEFAULT_SESSIONS_GLOB;
    this.intervalMs =
      options?.intervalMs ||
      parseInt(process.env.SCAN_INTERVAL_MS || "") ||
      DEFAULT_SCAN_INTERVAL_MS;
    this.profileId = options?.profileId ?? "team";
  }

  /**
   * Start the periodic scanner
   */
  start(): void {
    if (this.timer) return;
    console.log(
      `[Scanner] Starting session log scanner (interval: ${this.intervalMs}ms)`,
    );
    console.log(`[Scanner] Glob pattern: ${this.sessionsGlob}`);

    // Run immediately, then on interval
    this.scan();
    this.timer = setInterval(() => this.scan(), this.intervalMs);
  }

  /**
   * Stop the periodic scanner
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[Scanner] Stopped");
    }
  }

  /**
   * Get scanner status
   */
  getStatus(): {
    running: boolean;
    lastScanTime: string | null;
    lastResult: ScanResult | null;
  } {
    return {
      running: this.timer !== null,
      lastScanTime: this.lastScanTime?.toISOString() ?? null,
      lastResult: this.lastScanResult,
    };
  }

  /**
   * Run a single incremental scan
   */
  async scan(): Promise<ScanResult> {
    if (this.scanning) {
      return {
        filesScanned: 0,
        newGenerations: 0,
        totalCost: 0,
        errors: ["Scan already in progress"],
      };
    }

    this.scanning = true;
    const result: ScanResult = {
      filesScanned: 0,
      newGenerations: 0,
      totalCost: 0,
      errors: [],
    };

    try {
      const files = await glob(this.sessionsGlob);
      if (files.length === 0) {
        return result;
      }

      for (const filePath of files) {
        try {
          const fileResult = await this.scanFile(filePath);
          result.filesScanned++;
          result.newGenerations += fileResult.newGenerations;
          result.totalCost += fileResult.totalCost;
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          result.errors.push(`${filePath}: ${errorMessage}`);
        }
      }

      if (result.newGenerations > 0) {
        console.log(
          `[Scanner] Found ${result.newGenerations} new generations ($${result.totalCost.toFixed(4)}) across ${result.filesScanned} files`,
        );
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.errors.push(`Glob error: ${errorMessage}`);
    } finally {
      this.scanning = false;
      this.lastScanResult = result;
      this.lastScanTime = new Date();
    }

    return result;
  }

  /**
   * Full rescan — resets all scan state and re-reads everything
   */
  async fullScan(): Promise<ScanResult> {
    console.log("[Scanner] Starting full rescan...");
    await this.db.resetScanState();
    return this.scan();
  }

  /**
   * Scan a single JSONL file incrementally from last known offset
   */
  private async scanFile(
    filePath: string,
  ): Promise<{ newGenerations: number; totalCost: number }> {
    const stat = fs.statSync(filePath);
    const scanState = await this.db.getScanState(filePath, this.profileId);

    // Skip if file hasn't grown since last scan
    if (scanState && stat.size <= scanState.lastOffset) {
      return { newGenerations: 0, totalCost: 0 };
    }

    const startOffset = scanState?.lastOffset || 0;
    const agentId = this.extractAgentId(filePath);

    // Read only the new portion of the file
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(stat.size - startOffset);
    fs.readSync(fd, buffer, 0, buffer.length, startOffset);
    fs.closeSync(fd);

    const newContent = buffer.toString("utf-8");
    const lines = newContent
      .split("\n")
      .filter((line) => line.trim().length > 0);

    let newGenerations = 0;
    let totalCost = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as JSONLAssistantMessage;

        // Only process assistant messages with usage/cost data
        // Cost data lives inside entry.message (not top-level)
        if (
          entry.type !== "message" ||
          entry.message?.role !== "assistant" ||
          !entry.message?.usage?.cost
        ) {
          continue;
        }

        const msg = entry.message;
        const usage = msg.usage!;
        const cost = usage.cost;

        // Skip entries with zero cost (e.g. auth errors)
        if (cost.total === 0 && usage.totalTokens === 0) {
          continue;
        }

        await this.db.upsertGeneration({
          id: uuidv7(),
          profileId: this.profileId,
          sessionLogFile: filePath,
          sessionLogMsgId: entry.id,
          agentId,
          timestamp: entry.timestamp || new Date().toISOString(),
          model: msg.model || "unknown",
          provider: msg.provider,
          stopReason: msg.stopReason,
          inputTokens: usage.input || 0,
          outputTokens: usage.output || 0,
          cacheReadTokens: usage.cacheRead || 0,
          cacheWriteTokens: usage.cacheWrite || 0,
          totalTokens: usage.totalTokens || 0,
          costInput: cost.input || 0,
          costOutput: cost.output || 0,
          costCacheRead: cost.cacheRead || 0,
          costTotal: cost.total || 0,
        });

        newGenerations++;
        totalCost += cost.total || 0;
      } catch {
        // Skip unparseable lines (partial writes, non-JSON)
      }
    }

    // Update scan state to current file size
    await this.db.updateScanState(filePath, stat.size, stat.size, {
      profileId: this.profileId,
    });

    return { newGenerations, totalCost };
  }

  /**
   * Extract agent ID from file path
   * e.g. ~/.openclaw-team/agents/engineer/sessions/abc.jsonl -> "engineer"
   */
  private extractAgentId(filePath: string): string {
    const parts = filePath.split(path.sep);
    const agentsIdx = parts.indexOf("agents");
    if (agentsIdx >= 0 && agentsIdx + 1 < parts.length) {
      return parts[agentsIdx + 1];
    }
    return "unknown";
  }
}
