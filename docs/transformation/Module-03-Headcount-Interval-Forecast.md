# Module 03 — Headcount, Interval & Shift Impact + Forecast & Shrinkage
**Boutiqaat Contact Center Transformation** · Owner: WFM · Status: Design for build · **Phase 1 → 2**

---

## 1. Purpose
The WFM backbone: **Required vs Scheduled vs Actual HC** by interval, with forecast and shrinkage, so every request and attendance event has a measurable coverage impact.

**Key principle:** the **interval (30-min) × function** is the atom. Shift-level and day-level reports are roll-ups of it — one calculation, three grains (removes the overlap between Headcount / Shift / Interval reports).

---

## 2. Required HC (the reference everything depends on)
```
Forecast volume × AHT per interval
→ Voice: Erlang-C (service level + occupancy target)
→ Digital: workload ÷ concurrency (chat/WhatsApp = 4)
→ + Shrinkage uplift (30–35%)
= Required HC per interval per function
```

## 3. Shrinkage model (was missing — now in scope)
- **Planned:** training, meeting, coaching, break.
- **Unplanned:** sick, absence, no-show, system-down.
- Tracked as % of paid hours; feeds the Required-HC uplift and the shift impact report.

---

## 4. Final HC & risk (per interval) → `FACT_Interval`
```
Final HC = Scheduled − approved perm/early − sick − absent − no-show − system-down + approved OT + cross-skill cover
Effective Capacity = Final HC × Concurrency (digital) | Final HC (voice)
Gap  = Effective Capacity − Required HC
Risk = OK | Watch (−10%) | High (−20%) | Critical (< −20%)
```

## 5. Workflow
```
Build Required curve (forecast + shrinkage)
→ Overlay Scheduled HC → overlay Actual + approved requests
→ Compute Gap + Risk per interval → roll up to shift + day
→ Intraday: refresh with live state (Module 04)
→ Gap → suggest OT / cross-skill (Module 01 + 04)
```

## 6. Forecast accuracy (new)
Forecast vs Actual volume & AHT per interval/day → MAPE. Drives trust in every downstream number.

---

## 7. Automation
Auto-build Required curve · auto-compute Final HC + Gap + Risk per interval · auto-suggest OT / cross-skill on gap · auto-roll-up to shift/day.

## 8. AI
HC **risk summary** (NL) · suggested **action plan** for gaps · suggested **schedule adjustment** · forecast assist.

## 9. Reports this module feeds
Headcount Impact (3) · Shift Impact (4) · Interval Impact (8) · Forecast Accuracy — `FACT_Interval` in the workbook.

## 10. Build status
**Ready:** capacity/Erlang engine (partial), permission interval impact (before/after), Sprinklr volumes.
**To build:** shrinkage model, forecast-accuracy report, concurrency-aware effective capacity across all channels.

## 11. Governance
Required-HC owner = WFM · forecast basis documented (P90 per weekday) · shrinkage categories signed off.

## 12. Definition of Done
Required-HC produced per interval (concurrency + shrinkage aware) · Gap + Risk computed and rolled up to shift/day · forecast accuracy tracked · all three impact reports populate.
