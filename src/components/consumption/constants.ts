import type { AgentUsageDimension, ByokTreatment } from "@/lib/queries";
import type { DatePreset } from "@/lib/date-range";
import type { Unit } from "./types";

export const PROVIDER_FILTER_OPTIONS = [
  "openrouter",
  "anthropic",
  "openai",
  "xai",
] as const;

export const BYOK_OPTIONS: { label: string; value: ByokTreatment }[] = [
  { label: "Flag BYOK overlap", value: "flag_overlap" },
  { label: "Exclude OpenRouter", value: "exclude_openrouter" },
  { label: "Prefer direct providers", value: "prefer_direct" },
];

export const AGENT_DIMENSIONS: { label: string; value: AgentUsageDimension }[] =
  [
    { label: "Model", value: "model" },
    { label: "Project", value: "project" },
    { label: "Actor", value: "actor" },
    { label: "Source", value: "source" },
    { label: "Session", value: "session" },
  ];

export const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "All time", value: "all" },
];

export const UNITS: { label: string; value: Unit }[] = [
  { label: "Tokens", value: "tokens" },
  { label: "Compute time", value: "compute" },
  { label: "USD", value: "usd" },
];
