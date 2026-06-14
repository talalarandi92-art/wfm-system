# Module 04 — Real-Time Adherence (RTA) & Intraday Control
**Boutiqaat Contact Center Transformation** · Owner: RTA / WFM · Status: Design for build · **Phase 2**

---

## 1. Purpose
Live floor control: who is adherent **now**, where the live gaps are, which intervals are at risk, and what intraday action to take — with every RTA action logged.

Built on the **Sprinklr live bridge + station mirror** already running (Agent Status vs Agent State, queue SLA).

---

## 2. Live picture (RTA dashboard)
Logged-in · available · busy · on-break · late logins · early logouts · queue waiting & SLA · live HC gap by interval · at-risk intervals · outages / system-down · alerts.

Planned vs Actual per interval, refreshed continuously.

---

## 3. Live adherence + bands
```
Live state (Sprinklr/Ameyo) → map to scheduled state per interval
→ Live Adherence % (exempt = system-down excluded)
→ Band: Green ≥ 88 | Amber 80–88 | Red < 80 → alert RTA
```

## 4. Intraday workflow
```
Live state → compare to schedule per interval → live gap + risk
→ At-risk interval → RTA alerted
→ Action: OT / cross-skill move / re-time breaks / hold non-urgent requests
→ Action logged in WFM-RTA Control → dashboard updates
```

## 5. Exempt handling (fairness)
Outage / Sprinklr / CRM downtime auto-excluded from live adherence — agents not penalised for system failures.

---

## 6. WFM / RTA Control report (report 11)
Per RTA/WFM per day: requests reviewed / approved / rejected · avg response time · coverage checks done · manual schedule changes · gaps identified · escalations · SLA-risk intervals.

## 7. Automation
Live alert on band/SLA breach · auto-suggest OT / cross-skill on gap · auto-escalate aged pending requests · auto-refresh dashboards.

## 8. AI
RTA **daily NL summary** · **SLA-risk explanation** · **intraday re-forecast / what-if** (project the rest of day from current trend).

## 9. Reports this module feeds
WFM/RTA Control (11) · intraday interval view (feeds Module 03) · live tiles for Exec/WFM dashboards (Module 06).

## 10. Build status
**Ready:** Sprinklr live bridge, station mirror (Queue Summary / Agent Status / Agent State), queue SLA, break tracker.
**To build:** live adherence-vs-schedule calc, band alerting, outage→exempt linkage, intraday re-forecast.

## 11. Governance
Adherence bands signed off · exempt rule enforced · RTA actions immutable in audit.

## 12. Definition of Done
Live adherence per interval (exempt-aware) · band alerts firing · intraday actions logged in RTA Control · gap → action loop closed.
