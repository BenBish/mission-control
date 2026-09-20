# Mission Control product review — 2026-08-05

## Scope

Reviewed the Mission Control repository and the live application at
`https://fedora.taile952db.ts.net:3001/`, with particular attention to cost and
usage analysis. The live review covered desktop (1440 px) and mobile (390 px),
the dashboard, Consumption, Runtime, Failures, Activities, Sessions, Jobs,
Settings, source scoping, console/network behaviour, and representative API
responses.

The live review was read-only: provider sync, budget saving, ingestion
mutations, and authentication changes were not exercised.

## Executive summary

Mission Control is already a credible personal AI observability console. Its
collection architecture, real-time updates, source health, runtime telemetry,
and separation of differently sourced usage data are strong. The main product
gap is analytical: it reports many facts, but does not yet consistently turn
them into decisions.

Cost and usage should evolve from totals and tables into drivers, efficiency,
attribution, risk, confidence, and recommended action. Before expanding the
analytics, several data-truth issues should be fixed: timezone-safe date ranges,
stale quota expiry, model normalization, attribution coverage, and duplicate
spend risk.

## Working well

- Agent session usage, Direct API Spend, subscription/rate-limit windows, and
  wallet capacity are explicitly separated rather than incorrectly summed.
- The global source filter is persistent, shareable state is encoded in URLs,
  and account-wide views clearly indicate when the filter does not apply.
- Real-time ingestion works: new Codex activity appeared on the dashboard
  within seconds.
- Runtime provides useful operational metrics: occupancy, throughput,
  cancellation, p50/p95 latency, backend volume, loaded models, and saturation
  history.
- Effective source health uses heartbeat age, so stale collectors do not remain
  falsely green.
- Mobile navigation and layout work without page-wide horizontal overflow.
- The backend has sound foundations: idempotent ingestion, indexed SQLite
  tables, retention/rollups, structured routes, and selective SSE invalidation.
- `bun run ci` passed: lint, formatting, TypeScript, and 399 tests completed with
  zero failures.

## Acceptable but not yet excellent

- The dashboard works for awareness, but the activity stream is dominated by
  low-level messages and tool events instead of a concise summary of meaningful
  changes.
- Sessions expose duration, turns, tokens, and success rate, but lack project
  aggregation, outcome labels, search, and obvious cost drill-down.
- Runtime is capable but dense. Wide request tables rely on internal horizontal
  scrolling on mobile, and useful content can take several seconds to appear.
- Jobs and Generations accurately communicate unavailable data, but currently
  provide limited day-to-day value.
- The visual system is coherent, though long tables are often used where ranked
  drivers, distributions, or exception views would communicate faster.

## Confirmed defects and risks

### Direct API “Today” can include the prior provider day

At 13:13 BST on 2026-08-05, selecting **Today** generated:

`/api/providers/usage/breakdown?since=2026-08-04T23:00:00.000Z`

`getSince("today")` constructs browser-local midnight and converts it to UTC.
The provider query then truncates that ISO value to `YYYY-MM-DD`, turning the
range into `2026-08-04`. This is incorrect for positive UTC offsets and also
mixes browser timezone semantics with the configured budget timezone.

Affected code:

- `src/pages/Consumption.tsx` (`getSince`)
- `src/db/queries/provider-usage.ts` (`since.slice(0, 10)`)

### Stale quota snapshots look current

The live Plan usage section showed a Codex secondary quota snapshot from
2026-07-10 as green with “98% left” on 2026-08-05. The query selects the latest
snapshot per provider/label without evaluating its age or reset window.

Affected code:

- `src/db/queries/provider-credits.ts`
- `src/pages/Consumption.tsx`

### Agent usage has significant attribution gaps

The 30-day Agent Usage view showed approximately 44.2M tokens. Approximately
10.35M tokens (about 23%) were assigned to `hermes / unknown`. The table also
contained zero-token, `unknown`, and `<synthetic>` rows and split similar model
identities across aliases.

The agent aggregation currently groups by source/model/day and does not expose
cache tokens, requests, sessions, projects, actors, or attribution confidence.

### Failure analysis is noisy

At review time, 1,316 failure events produced 725 groups. The first page was
dominated by individual Claude tool-result IDs, commonly one open event per
group. Identifier normalization and incident semantics are not yet producing a
high-signal triage queue.

### Sensitive data is visible while application auth is disabled

`/api/auth/me` returned `authEnabled: false`. Raw conversation text and local
working-directory paths were visible in the UI. Tailnet access reduces the
audience but does not provide application roles, redaction, or per-field
retention controls.

### Consumption chart emits a console warning

Recharts reported a `width(-1) and height(-1)` warning during Consumption
rendering. It did not prevent the tested page from rendering, but should be
removed to prevent chart layout races and keep the console clean.

## Cost and usage observations

At review time the 30-day Direct API view reported approximately:

- 4.54M provider-reported tokens
- $14.46 Direct API Spend
- Anthropic Claude Sonnet: about $9.09 (approximately 63%)
- Anthropic web search: $1.81 (approximately 12.5%)
- OpenRouter GPT-5.5: about $1.53 (approximately 10.6%)

The UI exposes these rows but does not calculate shares, rank material movers,
or explain recommended action. It also retains a known risk that OpenRouter
BYOK and a direct provider connector may represent overlapping spend.

On mobile, the MTD spend, budget, burn-rate, and forecast cards began roughly
2,400 px down the page, after provider status and unavailable capacity sections.
The most actionable information should be first.

## Recommended cost model

Mission Control should preserve explicit cost classes:

| Cost class | Meaning |
| --- | --- |
| Actual provider spend | Authoritative provider billing API data |
| Allocated subscription cost | Optional monthly-plan allocation by session or project |
| Estimated local compute | Energy and hardware-amortization estimate |
| Agent usage | Tokens/compute, linked to spend only when reconciliation succeeds |
| Wallet/quota | Remaining capacity, never spend |

Raw datasets should not be summed. A reconciliation layer should report matched
spend, unmatched spend, agent usage without cost, duplicate risk, and overall
coverage/confidence.

## Recommended Consumption information architecture

1. **Overview** — actual spend, budget variance, forecast with confidence, and
   quota/wallet risk.
2. **Drivers** — provider/model/project shares, period-over-period movers, and
   separate fee categories such as web search.
3. **Efficiency** — cost per request/session/successful session, cost per output,
   cache savings, retry waste, and failed spend.
4. **Attribution** — matched agent-to-provider spend, unmatched rows, and
   coverage percentage.
5. **Capacity and data health** — quota windows, wallets, connector freshness,
   data lag, availability, and duplicate warnings.

Provider diagnostics and unavailable-capacity explanations should be collapsed
or moved below the decision-oriented sections.

## Prioritized improvements

1. Fix timezone-safe provider range semantics and rename “All time” to
   “Available history” where connector history is bounded.
2. Expire or mark stale quota/window snapshots using reset timestamps and
   source-specific freshness rules.
3. Move the spend overview, trend, top drivers, and budget risk to the top of
   Consumption; keep mobile scanning concise.
4. Normalize model aliases, hide non-material zero rows, and expose unattributed
   usage and cost coverage.
5. Add request count, cache tokens, session/project/actor dimensions, and custom
   date ranges.
6. Reconcile provider billing and agent usage with explicit matched/unmatched
   coverage rather than summing them.
7. Add unit economics and optimization signals: cost per successful outcome,
   cache savings, failed/retried spend, cheaper-model opportunities, and
   local-versus-API break-even.
8. Add provider/model/project budgets, alert thresholds, anomaly notifications,
   and scheduled digests.
9. Improve failure fingerprinting and add acknowledge, snooze, ownership, and
   resolution workflows.
10. Add ingestion redaction, configurable retention, and safer authentication
    defaults before broader multi-user use.

## Other feature opportunities

- Project/workspace dashboards using configurable aliases instead of raw paths.
- Cross-layer trace from agent session to provider request to local runtime.
- Saved views and scheduled summaries.
- CSV/JSON export and allocation reports.
- A higher-level dashboard summary of meaningful changes and recommended action.
- Finish and route the current Skills Registry implementation, or remove the
  orphaned code.
- Refresh README and architecture documentation to match the current collectors,
  routes, provider connectors, and deployment model.

## Verification notes

- Passed: dashboard, Agent Usage, Direct API Spend, source selection, responsive
  layout, Runtime, Failures, Activities, Sessions, Jobs, and Settings.
- Console: one Recharts sizing warning; one transient `ERR_NETWORK_CHANGED`
  request occurred during the long browser session and recovered.
- Not tested: provider sync mutation, budget mutation, auth login, or live
  ingestion mutation.
- Repository verification: `bun run ci` passed with 399 tests and zero failures.
