/**
 * Session Log Scanner Tests
 * Verifies log scanning, JSONL parsing, and cost extraction
 */

import { Database } from "../../db/database.js";
import {
  SessionLogScanner,
  ScanResult,
} from "../../services/session-log-scanner.js";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

// Mock glob
jest.mock("glob", () => ({
  glob: jest.fn(),
}));

const TEST_DB_PATH = "./test-data/test-scanner.db";

describe("SessionLogScanner", () => {
  let db: Database;
  let scanner: SessionLogScanner;
  let mockGlob: jest.MockedFunction<typeof glob>;

  beforeAll(async () => {
    // Create test database directory
    if (!fs.existsSync("./test-data")) {
      fs.mkdirSync("./test-data", { recursive: true });
    }

    db = new Database(TEST_DB_PATH);
    await db.initialize();
    mockGlob = glob as jest.MockedFunction<typeof glob>;
  });

  afterAll(async () => {
    await db.close();
    // Cleanup
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  beforeEach(async () => {
    await db.clear();
    jest.clearAllMocks();
  });

  describe("Scanner Initialization", () => {
    test("should create scanner with default options", () => {
      scanner = new SessionLogScanner(db);
      expect(scanner).toBeTruthy();
      expect(scanner.getStatus().running).toBe(false);
    });

    test("should create scanner with custom options", () => {
      scanner = new SessionLogScanner(db, {
        sessionsGlob: "/custom/path/*.jsonl",
        intervalMs: 5000,
      });
      expect(scanner).toBeTruthy();
    });

    test("should start and stop scanner", () => {
      scanner = new SessionLogScanner(db, { intervalMs: 100 });
      expect(scanner.getStatus().running).toBe(false);

      scanner.start();
      expect(scanner.getStatus().running).toBe(true);

      scanner.stop();
      expect(scanner.getStatus().running).toBe(false);
    });
  });

  describe("JSONL File Scanning", () => {
    const createMockLogFile = (content: string): string => {
      const filePath = `./test-data/test-${Date.now()}.jsonl`;
      fs.writeFileSync(filePath, content);
      return filePath;
    };

    test("should scan empty file list", async () => {
      mockGlob.mockResolvedValue([]);
      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });

      const result = await scanner.scan();

      expect(result.filesScanned).toBe(0);
      expect(result.newGenerations).toBe(0);
      expect(result.totalCost).toBe(0);
    });

    test("should parse assistant message with cost data", async () => {
      const jsonlContent = JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-15T10:30:00Z",
        message: {
          role: "assistant",
          content: ["Hello"],
          model: "openrouter/anthropic/claude-haiku-4.5",
          usage: {
            input: 100,
            output: 50,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 150,
            cost: {
              input: 0.00025,
              output: 0.000625,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0.000875,
            },
          },
        },
      });

      const filePath = createMockLogFile(jsonlContent);
      mockGlob.mockResolvedValue([filePath]);

      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });
      const result = await scanner.scan();

      expect(result.filesScanned).toBe(1);
      expect(result.newGenerations).toBe(1);
      expect(result.totalCost).toBeGreaterThan(0);

      // Cleanup
      fs.unlinkSync(filePath);
    });

    test("should skip non-assistant messages", async () => {
      const jsonlContent = JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-15T10:30:00Z",
        message: {
          role: "user",
          content: ["Hello"],
        },
      });

      const filePath = createMockLogFile(jsonlContent);
      mockGlob.mockResolvedValue([filePath]);

      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });
      const result = await scanner.scan();

      expect(result.filesScanned).toBe(1);
      expect(result.newGenerations).toBe(0);

      // Cleanup
      fs.unlinkSync(filePath);
    });

    test("should skip entries without cost data", async () => {
      const jsonlContent = JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-15T10:30:00Z",
        message: {
          role: "assistant",
          content: ["Hello"],
          model: "openrouter/anthropic/claude-haiku-4.5",
        },
      });

      const filePath = createMockLogFile(jsonlContent);
      mockGlob.mockResolvedValue([filePath]);

      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });
      const result = await scanner.scan();

      expect(result.filesScanned).toBe(1);
      expect(result.newGenerations).toBe(0);

      // Cleanup
      fs.unlinkSync(filePath);
    });

    test("should skip entries with zero cost and tokens", async () => {
      const jsonlContent = JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-15T10:30:00Z",
        message: {
          role: "assistant",
          content: ["Hello"],
          model: "openrouter/anthropic/claude-haiku-4.5",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        },
      });

      const filePath = createMockLogFile(jsonlContent);
      mockGlob.mockResolvedValue([filePath]);

      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });
      const result = await scanner.scan();

      expect(result.filesScanned).toBe(1);
      expect(result.newGenerations).toBe(0);

      // Cleanup
      fs.unlinkSync(filePath);
    });

    test("should handle multiple messages in one file", async () => {
      const messages = [
        {
          type: "message",
          id: "msg-001",
          timestamp: "2024-01-15T10:30:00Z",
          message: {
            role: "assistant",
            content: ["Hello"],
            model: "openrouter/anthropic/claude-haiku-4.5",
            usage: {
              input: 100,
              output: 50,
              totalTokens: 150,
              cost: { input: 0.00025, output: 0.000625, total: 0.000875 },
            },
          },
        },
        {
          type: "message",
          id: "msg-002",
          timestamp: "2024-01-15T10:31:00Z",
          message: {
            role: "assistant",
            content: ["World"],
            model: "openrouter/anthropic/claude-haiku-4.5",
            usage: {
              input: 200,
              output: 100,
              totalTokens: 300,
              cost: { input: 0.0005, output: 0.00125, total: 0.00175 },
            },
          },
        },
      ];

      const jsonlContent = messages.map((m) => JSON.stringify(m)).join("\n");
      const filePath = createMockLogFile(jsonlContent);
      mockGlob.mockResolvedValue([filePath]);

      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });
      const result = await scanner.scan();

      expect(result.filesScanned).toBe(1);
      expect(result.newGenerations).toBe(2);
      expect(result.totalCost).toBeCloseTo(0.002625, 5);

      // Cleanup
      fs.unlinkSync(filePath);
    });

    test("should handle malformed JSON lines gracefully", async () => {
      const jsonlContent = `
        {"type": "message", "id": "msg-001", "timestamp": "2024-01-15T10:30:00Z", "message": {"role": "assistant", "content": ["Hello"], "usage": {"totalTokens": 100, "cost": {"total": 0.001}}}}
        this is not valid json
        {"type": "message", "id": "msg-002", "timestamp": "2024-01-15T10:31:00Z", "message": {"role": "assistant", "content": ["World"], "usage": {"totalTokens": 200, "cost": {"total": 0.002}}}}
      `;

      const filePath = createMockLogFile(jsonlContent);
      mockGlob.mockResolvedValue([filePath]);

      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });
      const result = await scanner.scan();

      // Should process valid messages and skip invalid ones
      expect(result.filesScanned).toBe(1);
      expect(result.newGenerations).toBe(2);

      // Cleanup
      fs.unlinkSync(filePath);
    });

    test("should extract agent ID from file path", async () => {
      const jsonlContent = JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-15T10:30:00Z",
        message: {
          role: "assistant",
          content: ["Hello"],
          usage: {
            totalTokens: 100,
            cost: { total: 0.001 },
          },
        },
      });

      // Create the directory structure for testing
      const testDir = "./test-data/agents/engineer/sessions";
      fs.mkdirSync(testDir, { recursive: true });
      const testFilePath = `${testDir}/test-session.jsonl`;
      fs.writeFileSync(testFilePath, jsonlContent);

      mockGlob.mockResolvedValue([testFilePath]);

      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });
      await scanner.scan();

      // Verify the generation was stored with correct agent ID
      const generations = await db.getGenerations({ agentId: "engineer" });
      expect(generations.length).toBe(1);
      expect(generations[0].agent_id).toBe("engineer");

      // Cleanup
      fs.unlinkSync(testFilePath);
      fs.rmSync("./test-data/agents", { recursive: true, force: true });
    });
  });

  describe("Incremental Scanning", () => {
    test("should skip unchanged files on subsequent scans", async () => {
      const jsonlContent = JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-15T10:30:00Z",
        message: {
          role: "assistant",
          content: ["Hello"],
          usage: {
            totalTokens: 100,
            cost: { total: 0.001 },
          },
        },
      });

      const filePath = `./test-data/test-incremental-${Date.now()}.jsonl`;
      fs.writeFileSync(filePath, jsonlContent);
      mockGlob.mockResolvedValue([filePath]);

      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });

      // First scan
      const result1 = await scanner.scan();
      expect(result1.newGenerations).toBe(1);

      // Second scan - should find no new generations
      const result2 = await scanner.scan();
      expect(result2.newGenerations).toBe(0);

      // Cleanup
      fs.unlinkSync(filePath);
    });

    test("should detect new content in existing files", async () => {
      const initialContent = JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-15T10:30:00Z",
        message: {
          role: "assistant",
          content: ["Hello"],
          usage: {
            totalTokens: 100,
            cost: { total: 0.001 },
          },
        },
      });

      const filePath = `./test-data/test-grow-${Date.now()}.jsonl`;
      fs.writeFileSync(filePath, initialContent);
      mockGlob.mockResolvedValue([filePath]);

      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });

      // First scan
      const result1 = await scanner.scan();
      expect(result1.newGenerations).toBe(1);

      // Append new content
      const newContent = JSON.stringify({
        type: "message",
        id: "msg-002",
        timestamp: "2024-01-15T10:31:00Z",
        message: {
          role: "assistant",
          content: ["World"],
          usage: {
            totalTokens: 200,
            cost: { total: 0.002 },
          },
        },
      });
      fs.appendFileSync(filePath, "\n" + newContent);

      // Second scan - should find the new generation
      const result2 = await scanner.scan();
      expect(result2.newGenerations).toBe(1);

      // Cleanup
      fs.unlinkSync(filePath);
    });

    test("should handle full rescan", async () => {
      const jsonlContent = JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-15T10:30:00Z",
        message: {
          role: "assistant",
          content: ["Hello"],
          usage: {
            totalTokens: 100,
            cost: { total: 0.001 },
          },
        },
      });

      const filePath = `./test-data/test-fullscan-${Date.now()}.jsonl`;
      fs.writeFileSync(filePath, jsonlContent);
      mockGlob.mockResolvedValue([filePath]);

      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });

      // Initial scan
      await scanner.scan();

      // Full rescan should re-read everything
      const result = await scanner.fullScan();
      expect(result.filesScanned).toBe(1);
      // Should find the generation again (upsert behavior)
      expect(result.newGenerations).toBe(1);

      // Cleanup
      fs.unlinkSync(filePath);
    });
  });

  describe("Scan Status", () => {
    test("should track scan status", async () => {
      mockGlob.mockResolvedValue([]);
      scanner = new SessionLogScanner(db, { sessionsGlob: "*.jsonl" });

      const statusBefore = scanner.getStatus();
      expect(statusBefore.lastScanTime).toBeNull();
      expect(statusBefore.lastResult).toBeNull();

      await scanner.scan();

      const statusAfter = scanner.getStatus();
      expect(statusAfter.lastScanTime).not.toBeNull();
      expect(statusAfter.lastResult).not.toBeNull();
    });
  });
});
