# Spend reconciliation (BSH-101)

Mission Control keeps **provider billing** (`provider_usage_daily`) and **agent
session usage** (activities / inference requests) as separate authoritative
datasets. This document defines how the reconciliation layer *links* them for
attribution without summing raw totals or overwriting either source.

Reconciliation is **derived on read** (idempotent): each API call recomputes
matches from current rows. Late-arriving billing re-runs cleanly — no persisted
match table to invalidate.

## Inputs

| Side | Source | Grain |
| --- | --- | --- |
| Provider | `provider_usage_daily` | `(provider, day, model)` cost + tokens |
| Agent | activities (+ inference_requests) | `(day, model)` tokens; optional session-log `cost_usd` |

Models on both sides are normalized with `normalizeModelIdentity` (same rules
as Agent Usage / BSH-99).

## Provider filters

- **`includeProviders`**: if non-empty, only these connector ids participate
  (`openrouter` \| `anthropic` \| `openai` \| `xai`).
- **`excludeProviders`**: always dropped after include filtering.
- Raw provider rows are never deleted; filters only affect the derived view.

## OpenRouter BYOK treatment (`byokTreatment`)

OpenRouter spend can overlap direct Anthropic/OpenAI/xAI connectors when BYOK
routes the same underlying calls through both.

| Value | Behavior |
| --- | --- |
| `flag_overlap` (default) | Keep all included providers. When OpenRouter and a direct provider both report the same `(day, canonicalModel)`, classify as **`duplicate_risk`** rather than a clean match. |
| `exclude_openrouter` | Drop OpenRouter from the provider side before matching. |
| `prefer_direct` | When both OpenRouter and a direct provider share `(day, canonicalModel)`, use only the direct row(s) for matching; OpenRouter cost for that key is classified **`duplicate_risk`**. |

## Matching keys

Primary key: **`(day, canonicalModel)`**.

Secondary signals (evidence, not hard keys at current data grain):

- Token totals (input + output)
- Request counts (provider request_count vs agent request_count)
- Provider id(s) contributing cost
- Agent source id(s)
- Session-log `cost_usd` when present (allocated/estimated provenance — never
  treated as provider actual)

## Confidence levels

| Classification | When |
| --- | --- |
| `exact` | Single provider on the key; agent tokens within **15%** of provider tokens (relative to max of the two, floor 1). |
| `likely` | Single provider on the key; day + canonical model match, but token ratio outside exact band (or either side has zero tokens while the other does not). |
| `ambiguous` | Multiple *non-overlapping* providers report the same key without OpenRouter∩direct BYOK pattern, or token evidence is contradictory across providers. |
| `duplicate_risk` | OpenRouter + direct provider both present for the same key under `flag_overlap` / `prefer_direct` handling. |
| `unmatched_provider` | Provider cost/tokens for a key with no agent usage that day/model. |
| `unmatched_agent` | Agent usage for a key with no included provider billing (usage without cost). |

Unknown / synthetic agent models never form `exact`/`likely` matches; they
remain `unmatched_agent` (or are excluded from coverage denominators as noted
in the API response).

## Summary metrics (never a blind sum)

- **`providerSpendUsd`**: sum of included provider `cost_usd` (actual).
- **`matchedSpendUsd`**: provider cost on keys classified `exact` or `likely`.
- **`unmatchedProviderSpendUsd`**: provider cost with no agent counterpart.
- **`ambiguousSpendUsd`** / **`duplicateRiskSpendUsd`**: provider cost on those classifications.
- **`agentTokensWithoutBilling`**: agent tokens on `unmatched_agent` keys.
- **`coveragePct`**: `matchedSpendUsd / providerSpendUsd × 100` when provider spend &gt; 0; otherwise `null`.
- Agent session-log cost is reported separately as **`agentLogCostUsd`** with
  provenance `session-log` — never added into provider spend.

## Delayed / lag notes

The response includes human-readable `notes` when:

- Provider rows for recent days have `updated_at` more than 36h after day end
  (billing finalization lag).
- Agent usage exists for the last two UTC days with little or no provider data
  (billing may still arrive).
- Any included connector reports error/stale sync status.

## Drill-down evidence

Each match row exposes:

- Classification + confidence label
- Day, canonical model, raw model aliases
- Per-provider cost/tokens/requests
- Agent tokens/requests/sources and optional log cost
- Token ratio and rule hit (`exact_token_band`, `model_day_only`, `byok_overlap`, …)

## What this deliberately does not do

- Sum agent tokens × pricing into provider spend
- Merge OpenRouter and direct connectors into one total without labeling risk
- Overwrite `provider_usage_daily` or activity rows
- Claim project/session allocation for unmatched provider spend
