# Source file map

All under `My work/April SC & May/` unless noted. Templates under `My work/OPS/Score Card 2026/`.

## Templates
- `4.April 26 SC..xlsx`, `5.May 26 SC..xlsx` — the user's format templates. Sheets:
  `<Month> SC 26` (rubric rows 0–10 + computed rows 12+), `Productivity`, `<Month> 26`,
  `Incentive`, `W1`..`W5` (W5 = Final), channel sheets `Inbound/Outbound/Chat`, `PRR/QA/QUIZ`,
  `SM& Email`. W-sheet columns B→P: ID, User ID, Team Manager, Function, WD%, QA, RES%, PRR%,
  AHT, FCR%, Productivity%, CTR%, Quiz, Response Time, Common Mistakes. VLOOKUP col index 5 = WD%(F).

## Voice (Inbound / Outbound / OMT)
- `Inbound.xlsx`, `Outbound.xlsx` — Ameyo interval rows. Cols: Interval Start(0) … User ID(5) …
  Total Wrapped Calls(10), Avg Handling Time(11, day-fraction). Span Apr **and** May — filter by
  month, bucket by week from Interval Start. AHT from the agent's OWN channel only.

## Chat (CH - WA)
- April W1–W3: `CHAT AND WHATSAPP AMEYO FROM 1 TO 20 APRIL..xlsx` — chat-level (Chat Time date,
  FRT, Total Chat Duration). April W4 + all May: Sprinklr Case-Assignments.

## Sprinklr Case-Assignments (Chat W4+ / Social / Email) — AHT, FRT, FCR, Case Count
- April W4: `Agentwise-CaseAssignmentsVSChannel April WEEK 4 (1).xlsx`
- May W1–W5: `Agentwise-CaseAssignmentsVSChannel mAY WEEK N (1).xlsx` (the `(1)` re-exports
  include "Avg. Handling Time"). May W4 also has `... WEEK 4 (2).xlsx`.
- Header row found by exact cell `=="social network"`. Columns by name: Last Engaged User,
  Case Count, First Response Time, **Avg. Handling Time** (not "(Case)"), First Contact Closure(FCR).
  Aggregate per agent across networks, weighted by case count. FCR "100%" → 1.

## Survey (RES / PRR)
- `SPRINKLR SURVEY <Month> WEEK N.xlsx` — Yes/No "able to resolve" + Survey Response Count per agent.
- Fallback: `Survey Ameyo & ticket status FCR.xlsx` (Ameyo ticket-level: Created On, Channel, Status,
  Agent, TimeToResponse) for April W1–W3 RES/PRR via feedback1 Yes/No.

## QA
- `QA_Apr.xlsx` (April; WK01-C1..C5 + Avg). No May QA file → bar 0.95 unless user provides.

## Quiz
- `April 2026 Weekly Training Quiz - Week 1..4.xlsx`
- `May 2026 Weekly Training Quiz - Week 3, Week 4 (+ New Joiners).xlsx` — May W1–W2 = bar.
- MS-Forms layout: Email, Name, Total points (/100), Function. Match by email-local or name.

## Ignored / redundant
- `Ticket status sprinkler.xlsx` (~200k rows, only FRT — redundant).
- `*.txt` (API definitions for Survey / Case-Assignments).

## Known data caveats to flag
1. April W4 Sprinklr chat/SM only as aggregate (apply to W4/Final).
2. April Sprinklr RES/PRR only via Ameyo (Sprinklr survey provided from May).
3. AHT scale mix: April chat W1–3 = Ameyo minutes; W4 = Sprinklr (May is uniform → no mix).
4. May QA missing; per-week Short Break needed for per-week Productivity.
