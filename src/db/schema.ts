/**
 * SQLite Database Schema
 * Implements the schema from MISSION_CONTROL_DESIGN.md Section 7
 */

export const SCHEMA_SQL = `
-- Enable WAL mode for better concurrency
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

-- Core activities table
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL,
  parent_activity_id TEXT,
  
  timestamp DATETIME NOT NULL,
  completed_at DATETIME,
  duration_ms INTEGER,
  
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT,
  actor_session_label TEXT,
  
  action_type TEXT NOT NULL,
  tool_name TEXT,
  description TEXT NOT NULL,
  details JSON,
  
  status TEXT NOT NULL,
  result JSON,
  
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  model TEXT,
  cost_usd REAL,
  
  tags TEXT,
  references_json JSON,
  metadata JSON,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (parent_activity_id) REFERENCES activities(id)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activities_session ON activities(session_id);
CREATE INDEX IF NOT EXISTS idx_activities_actor ON activities(actor_id);
CREATE INDEX IF NOT EXISTS idx_activities_status ON activities(status);
CREATE INDEX IF NOT EXISTS idx_activities_tool ON activities(tool_name);
CREATE INDEX IF NOT EXISTS idx_activities_session_actor ON activities(session_id, actor_id);
-- NOTE: idx_activities_profile_timestamp is created by migration 001-add-profile-id

-- Sessions table for tracking agent sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',
  start_time DATETIME NOT NULL,
  end_time DATETIME,
  
  total_actions INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0,
  avg_action_duration_ms REAL DEFAULT 0,
  
  actors_json JSON,
  top_tools_json JSON,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time DESC);

-- Cost summaries for efficient reporting
CREATE TABLE IF NOT EXISTS cost_summaries (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL,
  actor_id TEXT,
  summary_date DATE NOT NULL,
  
  action_count INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0,
  total_tokens INTEGER DEFAULT 0,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  UNIQUE (session_id, actor_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_cost_summaries_session ON cost_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_cost_summaries_date ON cost_summaries(summary_date DESC);

-- Activity logs table for stdout/stderr capture
CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  
  stdout TEXT,
  stderr TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (activity_id) REFERENCES activities(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_activity ON activity_logs(activity_id);

-- LLM generations extracted from OpenClaw session JSONL logs
CREATE TABLE IF NOT EXISTS llm_generations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',
  session_log_file TEXT NOT NULL,
  session_log_msg_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  timestamp DATETIME NOT NULL,
  model TEXT NOT NULL,
  provider TEXT,
  stop_reason TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_input REAL DEFAULT 0,
  cost_output REAL DEFAULT 0,
  cost_cache_read REAL DEFAULT 0,
  cost_total REAL DEFAULT 0,
  linked_activity_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_log_file, session_log_msg_id)
);

CREATE INDEX IF NOT EXISTS idx_llm_generations_timestamp ON llm_generations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_llm_generations_agent ON llm_generations(agent_id);
CREATE INDEX IF NOT EXISTS idx_llm_generations_model ON llm_generations(model);
CREATE INDEX IF NOT EXISTS idx_llm_generations_linked ON llm_generations(linked_activity_id);
-- NOTE: idx_llm_generations_profile_ts is created by migration 001-add-profile-id

-- Tracks incremental scan progress per session log file per profile
CREATE TABLE IF NOT EXISTS scan_state (
  file_path TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT 'default',
  last_offset INTEGER DEFAULT 0,
  last_scanned_at DATETIME,
  file_size INTEGER DEFAULT 0,
  PRIMARY KEY (file_path, profile_id)
);
`;

/**
 * Split SQL into individual statements for execution
 */
export function getSQLStatements(): string[] {
  return SCHEMA_SQL.split(";")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}
