/**
 * Profile Service Tests (ORC-46)
 * Tests profile discovery from systemd services and env vars
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// We test internal functions by importing the module
import {
  getProfiles,
  getProfile,
  clearProfileCache,
} from "../../services/profile-service.js";

const SYSTEMD_DIR = path.join(os.homedir(), ".config", "systemd", "user");

describe("Profile Service", () => {
  beforeEach(() => {
    clearProfileCache();
  });

  afterEach(() => {
    clearProfileCache();
  });

  describe("getProfiles", () => {
    test("discovers profiles from systemd services", async () => {
      const profiles = await getProfiles();

      // Should find at least the default and team profiles
      // (since the test host has those service files)
      expect(profiles.length).toBeGreaterThanOrEqual(2);

      const ids = profiles.map((p) => p.id);
      expect(ids).toContain("default");
      expect(ids).toContain("team");
    });

    test("default profile is sorted first", async () => {
      const profiles = await getProfiles();
      if (profiles.length > 0) {
        expect(profiles[0].id).toBe("default");
      }
    });

    test("profiles have required fields", async () => {
      const profiles = await getProfiles();

      for (const profile of profiles) {
        expect(profile.id).toBeTruthy();
        expect(profile.name).toBeTruthy();
        expect(profile.gatewayUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(typeof profile.port).toBe("number");
        expect(["online", "offline"]).toContain(profile.status);
        expect(profile.stateDir).toBeTruthy();
      }
    });

    test("team profile has correct port", async () => {
      const profiles = await getProfiles();
      const team = profiles.find((p) => p.id === "team");
      if (team) {
        expect(team.port).toBe(18890);
        expect(team.gatewayUrl).toBe("http://127.0.0.1:18890");
      }
    });

    test("default profile has correct port", async () => {
      const profiles = await getProfiles();
      const defaultProfile = profiles.find((p) => p.id === "default");
      if (defaultProfile) {
        expect(defaultProfile.port).toBe(18789);
        expect(defaultProfile.gatewayUrl).toBe("http://127.0.0.1:18789");
      }
    });

    test("caches results for 30 seconds", async () => {
      const profiles1 = await getProfiles();
      const profiles2 = await getProfiles();

      // Should be the same reference (cached)
      expect(profiles1).toBe(profiles2);
    });

    test("cache is cleared on clearProfileCache()", async () => {
      const profiles1 = await getProfiles();
      clearProfileCache();
      const profiles2 = await getProfiles();

      // Should be different references (new fetch)
      expect(profiles1).not.toBe(profiles2);
      // But same data
      expect(profiles1.length).toBe(profiles2.length);
    });
  });

  describe("getProfile", () => {
    test("returns a profile by ID", async () => {
      const profile = await getProfile("team");
      if (profile) {
        expect(profile.id).toBe("team");
        expect(profile.name).toBe("Team");
      }
    });

    test("returns null for nonexistent profile", async () => {
      const profile = await getProfile("nonexistent-profile-xyz");
      expect(profile).toBeNull();
    });
  });
});
