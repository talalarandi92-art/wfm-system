# Coding & UX conventions

## i18n (strict)
- Inline ternary: `ar ? 'النص العربي' : 'English text'` — NOT a dictionary/i18n library.
- English mode must be **100% English** (no leftover Arabic labels).
- BUT **inputs must still accept typed Arabic** in English mode — never put `dir="ltr"` or input filters
  that block Arabic characters on text inputs.
- `ar` comes from `useUiStore`. RTL/LTR + light/dark all driven from there.

## Dates — Saturday week alignment (this bites)
- Week = **Saturday → Friday**. Use a local formatter (`fmtLocal`) and `snapToSaturday`.
- **Never use `toISOString()` for local-day logic** — it shifts by timezone and caused a bug where
  employees got **3 OFF days/week**. Always format in local time.
- Calendar scorecard weeks (different concept): W1 1–7, W2 8–14, W3 15–21, W4 22→end.

## Navigation
- The sidebar was consolidated into **6 tabbed hub pages** (`?tab=` + redirects + per-tab permission
  gating). The guard team is hidden behind **the Chief** (only the Chief shows in the sidebar).

## RBAC & audit
- Role-based page + action access. Permissions like `attendance.view_team` gate endpoints
  (`RequirePermissions`). **Audit log is append-only** — no UPDATE/DELETE on `audit_logs`.

## Excel deliverables for the user
- The user prefers his OWN template kept intact (it has the exact per-function scoring formulas) and the
  painful part automated. Provide formulas in cells + embedded raw-data tabs so every number is traceable.
- Round-half-up all percentages. Colored cues (green/yellow/red) for at-a-glance status.

## Working style with this user (read before acting)
- He has deep WFM domain expertise — match that depth; no shallow/CRUD/mock work, no faked completion.
- Continue from the latest approved state; never restart the project.
- Build module-by-module: plan → implement → test → verify → package. Don't break the working app with
  unsafe global edits (the old single-HTML prototype broke on duplicate top-level `let`/`const`).
- Surface gaps honestly (coverage shortfalls, missing data) rather than hiding them.
- Secrets: API keys go in config/env, **never pasted in chat**. Work on a git branch.
