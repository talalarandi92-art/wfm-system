# Sprinklr Reporting — LIVE exploration findings (2026-07-11)

> Entered the live Care reporting dashboard (Director's open link, read-only, changed nothing):
> `space-prod15.sprinklr.com/care/insights/reporting/dashboard/69e87d2c51f3b8793baec56a/tab/2` ("Live Chat").
> This grounds our Report/Dashboard Builder v2 (the Sprinklr-replacement surface). Complements the
> `sprinklr-boutiqaat-intelligence` skill's deeper builder guides (Reports_SelfService_Mastery_Guide.md,
> Reporting_System_FullDiagnosis_Solutions.md).

## THE report data API (captured live)
- **`POST /ui/graphql/reportingQuery?op=queries`** — the canonical endpoint every Care-reporting widget calls for data (GraphQL wrapper; fires per widget on load/refresh). Confirmed 200 on refresh.
- Underlying reporting engine = **SERVICE_ANALYTICS** (per the Director's captured `USER_AVAILABILITY_SLA_REPORT_V2` request body). Auth = the logged-in session (cookies); a headless server pull needs `key` + `X-PARTNER-ID` (still Director-supplied).
- **Single-session enforced**: opening a 2nd session shows "You're already logged in — logout & refresh". So automated pulls must use the extension/session channel, not a parallel login.

## Dashboard anatomy (what Builder v2 must match)
- **Dashboard → tabbed SECTIONS**: Queue Performance · Agent Performance · Productivity · WhatsApp Sale · Live Chat · Email · SM · (+ add section). Each section = its own canvas of widgets.
- **Widgets**: rich-text "Contextual Notes" (documentation blocks) + data tables/charts. Per-widget controls: granularity dropdown (Daily/…), refresh, **filter-count badge** (widget-level filters, e.g. ②), **chart-type toggle** (table↔bar), ⋯ menu, column config (the little columns icon).
- **Dashboard-level controls (top bar)**: relative **date-range** picker ("Last 30 Days: Jun 12 – Jul 11, 2026"), theme toggle, refresh, ⋯, **+ Add Widget**, **Save**.
- **Filters (top-left row)**: Quick Filter · Case Number · Account · **+ Add Filter** (dashboard scope) — plus the per-widget filter badge. Matches screenshot 2 (Select Filter / Type / Value).
- **The golden rule** (skill-confirmed): every metric in ONE widget must come from the SAME report — the platform blocks mixing.

## Survey model — CONFIRMED live (§12 of the scorecard spec)
The Agent Performance section's survey table columns, with real data:
`Date · Agent Email ID · Channel Type (Case) · "Were we able to resolve your issue today?" (Yes/No) · Survey Response Count`.
→ **PRR/Survey attribution = Agent Email + Channel** (exactly screenshot 9). e.g. a.alhamada@boutiqaat.com · WhatsApp Business · Yes · 4. This validates B3/B7 of the scorecard program.

## Contextual-Notes caveats worth encoding (from the live "Key Note" widget)
- "Average First Response Time" and "SLA%" are configurable in the STANDARD METRICS screen (so their band definitions are tenant-config, not universal).
- Interaction action categories (Brand Response / Macro Applied / No Action) **overlap and are NOT a funnel** — never sum them as mutually exclusive.
- Agent-performance records are generated **only when a case is unassigned from a user** (a case assigned 10:00, worked to 11:00, unassigned 11:00 → one record at 11:00). Attribution timing matters for daily rollups.

## What this means for Builder v2 (our Sprinklr replacement)
Our existing `ReportBuilder.tsx` + `DashboardBuilder.tsx` + `roster-reports report-builder` endpoint are the base. To reach parity, add: tabbed sections per dashboard, a metric/dimension LIBRARY picker (screenshot 6), a visual widget builder (source → visualization → columns → add; screenshot 5), relative date controls (Last month/28/30/90/Custom/Dynamic; screenshot 7), a filter builder (Select filter/type/value; screenshot 2), calculated metrics, per-widget granularity + chart-type + column config, drill-down, and data-freshness. Design = original WFM (dazzle/ds kit), NOT a Sprinklr clone.

## Honest limits of this pass
The Add Widget / Add Filter MODAL internals didn't open cleanly through the automation layer (heavy renderer); the metric/dimension library + widget-builder field lists are documented in the skill's guides from a prior clean session. A full macro/flow build + exhaustive Sprinklr exploration is the Director's separate large program — best run in a dedicated session with a free Sprinklr login (or via the extension channel).
