# Provider capacity research (BSH-94)

**Spike outcome for [BSH-94](https://linear.app/bshp/issue/BSH-94).**  
**Parent feature:** [BSH-93](https://linear.app/bshp/issue/BSH-93) — split plan usage vs usage credits wallet vs API org spend.  
**Context:** [BSH-92](https://linear.app/bshp/issue/BSH-92) shipped a single “Credits remaining” surface that blurs these concepts.  
**Research date:** 2026-08-05.

---

## Product model (do not collapse)

| # | Surface | Operator question | Typical unit | Mission Control today (post-BSH-92) |
|---|---------|-------------------|--------------|-------------------------------------|
| **1** | **Plan usage remaining** | How much of my *subscription / window* quota is left? | % used/remaining, resets_at | Codex + Claude Code + Grok `quota_snapshot` → % windows (OpenAI + Anthropic + xAI via session bridge) |
| **2** | **Usage credits wallet** | How much *prepaid / promo $ balance* can I burn after plan limits? | USD (+ grant expiry) | `prepaid_balance` snapshots; Anthropic/xAI unavailable; OpenAI `credit_grants` fails with secret keys |
| **3** | **API org spend** | What did the *org API billing* cost historically / this month? | USD spend (daily/MTD) | **Shipped well** — `provider_usage_daily`, spend insights, budgets |

These map to different Anthropic product UIs (claude.ai **Plan usage limits** vs **Usage credits**) and must stay separate in Mission Control.

---

## Anthropic / Claude

### Identity of the three surfaces

| Surface | Where the user sees it | What it is |
|---------|------------------------|------------|
| Plan usage | claude.ai / Claude Code settings — “Plan usage limits” (Pro, weekly, session) | **Subscription** capacity: rolling session window + weekly caps, optional promos (“limits temporarily boosted”) |
| Usage credits | claude.ai — “Usage credits” (balance, promo lines, monthly spend limit, auto-reload) | **Wallet** for overage after plan limits when usage credits are enabled |
| API org spend | Claude Console Usage/Cost; Admin Usage & Cost API | **Org API billing history** (tokens/cost by day/model), not Pro weekly % and not wallet balance |

Admin usage/cost **does not** equal plan usage remaining or usage-credit wallet.

### Candidate endpoints

| Endpoint / surface | Key type | Surface fit | Status | Notes |
|--------------------|----------|-------------|--------|-------|
| `GET /v1/organizations/usage_report/messages` | Admin (`sk-ant-admin…`) | **#3 spend** (tokens) | **Available** | Already in `anthropicConnector.fetchUsage` |
| `GET /v1/organizations/cost_report` | Admin | **#3 spend** (USD) | **Available** | Already merged into daily spend rows |
| `GET /v1/organizations/rate_limits` | Admin | Neither #1 nor #2 | **Available (wrong product)** | Returns **configured** org RPM/TPM **ceilings**, not remaining plan %, not wallet $ |
| `GET /v1/organizations/usage_report/claude_code` | Admin | Productivity / estimated cost, not plan % | **Available (limited fit)** | Daily per-user sessions, LOC, tool accepts, **estimated_cost** by model. `customer_type`: `api` \| `subscription`. **No** “10% weekly used / resets in 4h” fields |
| Claude Enterprise Analytics API | Analytics key | Enterprise claude.ai usage/cost | **Needs product decision** | Different key path for Enterprise parents; not the Console Admin key |
| claude.ai plan usage UI | User session (browser) | **#1 plan usage** | **Unavailable** via Admin API | No documented public Admin/API for Pro/Max weekly/session remaining. Multiple Claude Code feature requests for `claude usage` / local quota export remain open |
| claude.ai usage credits UI | User session (browser) | **#2 wallet** | **Unavailable** via Admin API | No documented remaining-balance endpoint (confirmed in BSH-92 + platform docs). Console “credit balance too low” is billing-side; not exposed on Usage & Cost API |
| Claude Code status bar / OTEL | Local session | **#1** (session-time only) | **Limited** | Visible in-session only; not org-wide durable snapshots without new collector plumbing. OTEL is real-time custom metrics, not Admin plan % |
| Scraping claude.ai HTML | User cookies | #1 / #2 | **Needs product decision** | Explicitly out of scope as default long-term approach (BSH-94). Accept only if product signs risk |

### Mapping confirmation

- **Admin Usage + Cost = API org spend (#3) only.** Keep powering Direct API Spend / `provider_usage_daily`. Never label those rows as “plan remaining” or “wallet balance.”
- **Rate Limits API** is for **API rate ceiling configuration**, not Pro plan usage bars.
- **Claude Code Analytics** is useful for **adoption/productivity and estimated Claude Code cost**, not for the Plan usage limits UI the operator screenshots.
- **Pro plan usage (#1)** is available via the **Claude Code desktop collector** (`GET https://api.anthropic.com/api/oauth/usage` using `~/.claude/.credentials.json`), bridged into Anthropic `plan_usage` credit rows (`source=session_quota`). Admin keys still cannot read these bars.
- **Usage credits wallet (#2)** still has **no stable programmatic Admin source** for individual/Pro accounts on Console Admin keys.

### Recommended empty-state copy (Anthropic)

| Surface | When no data | Copy direction |
|---------|--------------|----------------|
| Plan usage | No collector data yet | “Claude Pro / Claude Code plan limits are not available via Admin API. When the desktop collector is running, plan windows come from the Claude Code OAuth usage endpoint.” |
| Usage credits | Always (until a source exists) | “Usage credit wallet is not exposed on Anthropic Admin Usage & Cost APIs.” |
| API org spend | Not configured | Existing not_configured path for `ANTHROPIC_ADMIN_KEY` |

---

## OpenAI / Codex

| Endpoint / surface | Key type | Surface fit | Status | Notes |
|--------------------|----------|-------------|--------|-------|
| `GET /v1/organization/usage/completions` | Org Admin | **#3 spend** (tokens) | **Available** | In `openaiConnector.fetchUsage` |
| `GET /v1/organization/costs` | Org Admin | **#3 spend** (USD) | **Available** | May fail without cost scope |
| `GET /v1/dashboard/billing/credit_grants` | Undocumented; **browser session key** | Aimed at **#2 wallet** | **Unavailable** with secret/Admin keys | Production evidence (fedora): *“must be made with a session key … You made it with … secret.”* Do not treat secret-key path as viable |
| Codex session `quota_snapshot` (ingest) | Local collector | **#1 plan/window** | **Available** | Already mapped to % remaining + window minutes in BSH-92. Label as **usage window**, not prepaid USD |
| ChatGPT / Codex subscription UI | User session | **#1** | **Unavailable** programmatically in MC | Separate from API org Admin |

**Recommendation:** Keep Codex windows under **plan usage**. Drop or demote secret-key `credit_grants` as a wallet source unless product accepts browser-session OAuth.

---

## OpenRouter

| Endpoint | Key type | Surface fit | Status | Notes |
|----------|----------|-------------|--------|-------|
| Activity / usage (existing connector) | API / management key | **#3 spend** | **Available** | Already synced |
| `GET https://openrouter.ai/api/v1/credits` | Management key | **#2 wallet** | **Available** | Official: `total_credits`, `total_usage` → remaining ≈ total_credits − total_usage (USD credits) |
| `GET https://openrouter.ai/api/v1/key` | API key | Key cap + rate limit | **Available (limited)** | `limit_remaining` is **per-key credit cap**, not always full account wallet |

**OpenRouter has no “Pro plan weekly %”** analogous to Claude Pro — only credit wallet + optional per-key caps.  
**BSH-92 gap:** no `fetchCredits` on OpenRouter connector; spend works, wallet tile missing.

**Phase 1 win:** implement OpenRouter wallet via `/api/v1/credits` (and optionally key `limit_remaining` as a secondary cap line).

---

## xAI (Grok)

| Endpoint | Surface fit | Status | Notes |
|----------|-------------|--------|-------|
| `GET /v1/models` (key check) | Connectivity | **Available** | Existing |
| Historical usage | **#3** | **Limited** | Optional `MC_XAI_USAGE_ENDPOINT` export only |
| Prepaid balance / plan windows | #1 / #2 | **#1 available via Grok CLI collector**; #2 still limited | No public Admin/API-key plan %. SuperGrok weekly (or monthly) remaining comes from `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` using `~/.grok/auth.json` (BSH-143). `prepaidBalance` / on-demand stay wallet and are not treated as plan %. `XAI_API_KEY` still cannot read these bars. Session `updates.jsonl` usage events are tokens only — no Codex-style `rate_limits`. OpenCode SQLite has no quota tables. |

Keep explicit limited empty states for wallet; do not invent dollars.

---

## Master matrix (BSH-94 acceptance table)

Statuses: **available** | **limited** | **unavailable** | **needs product decision**

| Provider | #1 Plan usage | #2 Wallet / credits | #3 API org spend | Keys |
|----------|---------------|---------------------|------------------|------|
| Anthropic | **available via session collector** (OAuth usage endpoint / Claude Code credentials); Admin still unavailable | **unavailable** (Admin) | **available** | `ANTHROPIC_ADMIN_KEY` (spend); collector for plan windows |
| Anthropic Enterprise Analytics | **needs product decision** | **needs product decision** | **available** (Analytics path) | Analytics API key |
| OpenAI | **limited** — Codex windows only via session logs | **unavailable** via secret keys (`credit_grants` session-only) | **available** | `OPENAI_ADMIN_KEY`; do not rely on secret for wallet |
| OpenRouter | N/A (no Pro-style plan UI) | **available** (`GET /api/v1/credits`) | **available** | `OPENROUTER_API_KEY` (management preferred for credits) |
| xAI | **available via Grok CLI collector** (billing `creditUsagePercent` + period window); API key still unavailable. Canonical **5h** is usually `unavailable` — SuperGrok billing typically exposes weekly (or monthly as an extra), not a 5-hour bar. | **unavailable** (API key) | **limited** (export endpoint) | `XAI_API_KEY`, optional `MC_XAI_USAGE_ENDPOINT`; collector uses `~/.grok/auth.json` for plan windows |

---

## Mission Control data model recommendations (for BSH-93)

Prefer **three first-class concepts** in API/UI (names illustrative):

1. **`plan_usage` / capacity windows**  
   - Fields: `provider`, `product` (e.g. `codex:primary`, `claude-code`), `used_percent` or `remaining_percent`, `window_minutes`, `resets_at`, `source` (`session_quota` \| `provider_api` \| `unavailable`)  
   - Canonical slots (BSH-171): every Claude / OpenAI / xAI subscription presents **5-hour** (300m) and **weekly** (10080m). Shared contract: `src/lib/plan-windows.ts`. Claude, Codex, and Grok collectors emit into that contract; normalize fills a missing slot as `unavailable` rather than inventing %. Extras (Claude Opus weekly, Grok month / product bars) are labeled separately and never occupy 5h/weekly.  
   - UI section: **Plan usage** (Dashboard KPI + Consumption list both slots, not only the tightest window)  
   - Seed from: existing `quota_snapshots` + future real plan APIs if any  

2. **`usage_credits` / wallet**  
   - Fields: `provider`, `remaining_usd`, `total_granted_usd?`, grants[] with `amount` + `expires_at`, `monthly_spend_limit?`, `spent_in_period?`, `source`  
   - UI section: **Usage credits**  
   - Seed from: OpenRouter `/credits` first; Anthropic/OpenAI stay explicit unavailable until a real source exists  

3. **`api_org_spend` (existing)**  
   - Keep `provider_usage_daily` + spend-insights + budgets  
   - UI: existing **Direct API Spend** — never merge wallet remaining into these SUMs  

Avoid a single card titled only “Credits remaining” that mixes % windows and USD wallets.

### Empty-state principles

- Name **which** surface failed (plan vs wallet vs spend).  
- Never show `$0.00` remaining when the true state is “API does not expose balance.”  
- Prefer `—` + status badge `unavailable` / `limited` with one-line reason (as BSH-92 does for Anthropic/xAI).

---

## Phase recommendations for BSH-93

### Phase 1 (implement next — high value, low fiction)

1. **UI split** on Consumption Direct API (and optionally Settings): three labeled blocks — Plan usage | Usage credits | API org spend.  
2. **Move Codex/session quotas** into **Plan usage** copy (not “prepaid balance”).  
3. **OpenRouter wallet:** `fetchCredits` → `GET /api/v1/credits` → durable wallet snapshot.  
4. **Anthropic / OpenAI wallet:** keep honest unavailable states; remove or clearly demote secret-key `credit_grants` attempts.  
5. **API org spend:** unchanged behavior; tighten copy that it is **not** plan runway or wallet.  
6. Tests for OpenRouter credits normalize + sync; UI empty states per surface.

### Phase 2 (when/if sources appear)

1. Anthropic plan usage: only if Anthropic ships a documented plan-quota API, Claude Code local export, or product accepts a constrained session-collector path.  
2. Anthropic usage credits wallet: only with a documented balance/grants API.  
3. OpenAI prepaid wallet: only with official Admin billing balance or approved session OAuth — not undocumented secret-key dashboard routes.  
4. Enterprise Analytics key path if the deployment is Claude Enterprise-first.

### Explicit non-goals for Phase 1

- Scraping claude.ai plan/usage-credits HTML.  
- Inferring plan % from Admin cost_report (wrong metric).  
- Using Rate Limits API RPM ceilings as “plan remaining.”  
- Double-counting wallet remaining into Direct API Spend or session `costUsd`.

---

## Evidence from production (fedora, 2026-08-05)

After BSH-92 deploy + sync:

- Anthropic: usage/cost **ok**; credit snapshot `prepaid_balance` **unavailable** (by design).  
- OpenAI: `credit_grants` **auth failed** (session key required); Codex windows **ok** (100% / 98% left).  
- OpenRouter: spend **ok**; no credit tile.  
- xAI: **limited** on usage and wallet.

---

## BSH-184 source audit (2026-08-15)

Consumption now gives plan usage and wallets a dedicated
`?view=plan-wallet` route. Direct API Spend contains only API organization
spend, and legacy `?view=direct-api#capacity` links migrate to the new view.

| Provider / surface | Secure source | Authentication | Freshness/reset semantics | Result |
|---|---|---|---|---|
| Codex 5-hour window | Local rollout JSONL `token_count.rate_limits.primary/secondary` | Existing local Codex session; credentials are not copied | Event timestamp plus provider `resets_at`; accepted only when `window_minutes` classifies as 300 | Supported when present; primary/secondary names never determine the slot. |
| Grok 5-hour window | Grok CLI billing `currentPeriod` | Existing local OIDC token, never ingested or logged | Polled every five minutes; period end is the reset; type/duration must classify as 300 minutes | Observed SuperGrok data is weekly, so 5-hour remains explicitly unavailable. |
| Anthropic usage-credit wallet | Documented Admin Usage & Cost APIs | Organization Admin key | APIs report historical usage/cost, not authoritative prepaid balance | No reliable automated source; the approximately $93 UI balance must not be scraped or fabricated. |

The safest Anthropic fallback is an explicit unavailable tile directing the
operator to the provider billing UI. Automation should wait for a documented
balance endpoint or safe local client export that needs no browser credentials.

## References

- [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)  
- [Rate Limits API](https://platform.claude.com/docs/en/manage-claude/rate-limits-api)  
- [Claude Code Analytics API](https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api)  
- [OpenRouter remaining credits](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits)  
- [OpenRouter key limits](https://openrouter.ai/docs/api_reference/limits)  
- Claude Code feature requests for subscription usage export (e.g. anthropics/claude-code#44328 and related)  
- Mission Control: `src/services/provider-connectors/`, `docs/DEPLOYMENT.md` provider section, BSH-92 PR #109  

---

## Spike checklist (BSH-94 AC)

- [x] Reference doc at `docs/provider-capacity-research.md`  
- [x] Endpoint/key matrix with available / limited / unavailable / needs product decision  
- [x] Phase 1 vs later recommendations for BSH-93  
- [x] Link from BSH-93 (Linear comment on merge of this PR)
