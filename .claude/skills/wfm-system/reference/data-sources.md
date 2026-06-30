# Data sources & reconciliation

## The core rule: combine BOTH systems
Attendance, OT, and presence must be reconciled from **Ameyo AND Sprinklr together** — never one
alone. Each system has bleed/gaps (login/logout carries across sessions; one system misses chat or
voice activity). The attendance-recon engine builds a unified per-day model from both. Validated
example: Abdalla's OT corrected 223h → 55h once both systems combined and bleed guards applied.

## Systems
- **Ameyo** (telephony): voice for Inbound/Outbound/OMT/Refund. Reports: AGENT_Session_Details
  (login/logout, **Break Reason / Break Duration**), AGENT_Productivity_Interval_Summary, CALL_History,
  ACD_Abandon, feedback (Yes/No CSAT). Bridge: `/integrations/ameyo` (discovery phase — needs captured
  samples to finalize the parser).
- **Sprinklr** (digital): chat/WhatsApp, social, email. Case-Assignments (Case Count, FRT, AHT, %FCR),
  survey (Yes/No "able to resolve" + response count), occupancy/status times. Bridge: extension caches +
  auto-login, daily stats rollup, email→employee link, synthetic-name blocklist.
- **Odoo** (HR): holidays, leave. **Rule: Odoo gives holidays — do NOT treat as stale leave.** Integration
  fixed + completed (2026-06-13).

## Break source per function (for productivity)
- **Inbound, Refund, Outbound** → Ameyo AGENT_Session_Details (break reason/duration).
- **CH-WA, Social Media, Email** → Sprinklr occupancy/break export.

## Roster build & reliability
- Build per-day per-employee from schedule + both systems. Source reliability notes: login/logout
  **bleed** across days; Sprinklr **occupancy** is the better presence signal for digital; Odoo =
  holidays (not stale leave).
- Period-accurate identity: manager/function/team/gender/email can change month to month — carry them
  **per day**, not once. Match by **Employee ID**; collapse name whitespace (`cleanName`) only for
  name-keyed sources.

## Employee ID map (intern → full-time)
Interns have `6xxxx` IDs; on conversion to full-time they get `1xxxx`. The recon engine **merges**
old↔new via `Employee_ID_Map.xlsx`. Always resolve through the map before aggregating a person.

## Cut-off cycles (permission/leave balances renew per cycle)
- Full-time: **15 → 14** (of next month). Interns: **1 → end of month**. Bahrain: **25 → 24**.
- Each cycle renews the permission balance: **6 hours + 3 permissions**.

## Metric formulas (user-confirmed)
- **RES** = feedback response rate. **PRR** = positive response rate (Yes ÷ responses).
- **CTR** = contacts received ÷ tickets created. **FCR** = closed ÷ total tickets.
- **Productivity% = (WD×9 − ShortBreak) ÷ (WD×9)** = Y/X; `*7` maternity days use ×7. Break = the named
  Short Break only. Sick penalty on the score: 1 sick → −2%, 2+ → −5% (sheet IF gives no penalty for >2).
- **Sick-day penalty applies to the score**, not the raw value.

## Attendance / OT engine highlights
- OT bleed guards: zero out impossible OT (otAfter/otBefore > 6h uncorroborated; degenerate punches);
  OFF-day punch-only OT credit with a cap; absence reclassified to `unconfirmed` when observed rate <0.7.
- Split-shift / Ramadan support (shiftStart2/end2, periods array for conformance); conformance counts
  approved permission; maternity 7h early-out (+120 min) for the named mothers.
- Outputs: dashboard, employee profile, 5h+ OT bonus report (names/day/window/before-after), half-hourly
  headcount by function (scheduled vs present vs shrinkage vs OT count), forgotten-OT report, colored
  OT_Review workbook.

## Forecast / planning data
Order-driven forecast: orders × CPO → HC. OPS files: ACD reports, CALL_History, feedback, orders CSV,
HC Calculation workbook. See the user's "My work" dataset for how they actually operate.
