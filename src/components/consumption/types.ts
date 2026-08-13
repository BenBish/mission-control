import type { DatePreset } from "@/lib/date-range";

export type Unit = "tokens" | "compute" | "usd";
export type ConsumptionView = "agent" | "direct-api" | "attribution";

export type UpdateConsumptionParams = (patch: {
  view?: ConsumptionView;
  range?: DatePreset;
  unit?: Unit;
}) => void;

export type AgentUsageTotals = {
  tokens: number;
  compute: number;
  cost: number;
  hasCost: boolean;
};

export type ProviderTotals = {
  tokens: number;
  cost: number;
  hasCost: boolean;
};
