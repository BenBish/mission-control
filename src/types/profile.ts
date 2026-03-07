/**
 * Profile Types
 * Definitions for multi-profile support
 */

export interface Profile {
  /** Unique identifier (e.g. "default", "team") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Gateway URL (e.g. "http://127.0.0.1:18789") */
  gatewayUrl: string;

  /** Gateway port */
  port: number;

  /** Whether the gateway is reachable */
  status: "online" | "offline";

  /** State directory (e.g. ~/.openclaw or ~/.openclaw-team) */
  stateDir: string;

  /** Gateway authentication token */
  gatewayToken?: string;

  /** Systemd unit name, if discovered via systemd */
  systemdUnit?: string;

  /** Number of active agents (frontend display) */
  agentCount?: number;

  /** Last activity timestamp (frontend display) */
  lastActivity?: string;
}

export interface ProfilesResponse {
  success: boolean;
  count: number;
  profiles: Profile[];
}
