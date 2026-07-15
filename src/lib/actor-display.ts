/**
 * Actor display helpers.
 *
 * There is no per-agent identity service anymore (AgentService/SOUL.md are
 * gone) — actors are rendered generically from their ActorType, not a
 * resolved display name or emoji.
 */

import { Bot, GitBranch, Server, User, type LucideIcon } from "lucide-react";
import type { ActorType } from "@/types/activity";

const ACTOR_ICONS: Record<ActorType, LucideIcon> = {
  user: User,
  agent: Bot,
  subagent: GitBranch,
  system: Server,
};

const ACTOR_LABELS: Record<ActorType, string> = {
  user: "User",
  agent: "Agent",
  subagent: "Subagent",
  system: "System",
};

export function actorIcon(type: ActorType): LucideIcon {
  return ACTOR_ICONS[type] ?? Bot;
}

export function actorTypeLabel(type: ActorType): string {
  return ACTOR_LABELS[type] ?? type;
}
