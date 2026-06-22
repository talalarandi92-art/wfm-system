# Design System & UI Magic — durable design intelligence

Everything learned and applied while making this dark-first app feel **alive, premium,
and comfortable in every theme**. The user (WFM Director) cares deeply about polish:
"alive, joyful, professional, NOT cluttered/gloomy." Treat UI quality as a first-class
feature. This doc lets any agent reproduce the look + the method without re-deriving.

## The hard constraint that shapes everything

The app is **dark-first**: ~69 files use hardcoded `text-white` (377×) and white-alpha
inline surfaces (`rgba(255,255,255,0.0x)`), plus dark hexes/gradients for grids, chat,
modals, the sidebar. So any **light** theme can't just flip a token — it must override the
dark-first text + surfaces. All of this lives in `frontend/src/index.css` (the single
source of design truth) scoped under theme classes, so pages are NOT individually rewritten.

## Theme architecture (3 themes, one button)

`frontend/src/store/ui.store.ts` cycles **Dark → Light → Aurora Glass** (header
Moon/Sun/Sparkles button, `cycleTheme`). Persisted to `localStorage 'theme'` (migrates the
old `dark` key). `applyTheme` toggles three html classes:
- **Dark**: `html.dark` — the original, untouched baseline.
- **Light**: `html.theme-light` (no `.dark`) — the comfort layer below.
- **Aurora Glass**: `html.dark + html.theme-glass` — dark-BASED (keeps all dark text/contrast
  correct → zero breakage) + a mint/teal atmosphere overlay.

Rule: keep `dark` true for Glass. New theme work is CSS-only under `.theme-light` /
`.theme-glass` so Dark stays pristine and the others can't bleed into each other.

## Light-mode comfort layer (`.theme-light`) — the big one

Make a dark-first app comfortable on light WITHOUT touching 69 files:
- **Text:** `.text-white`→`#0f172a`; `.text-slate-100/200/300/400/500`→ progressively darker.
  Preserve white on solid colored chips: `.text-white[class*="bg-"]:not([class*="bg-white"])`
  and `.btn-primary/.btn-danger` stay white.
- **Inline light text colors:** `style={{color:'#hex'}}` serializes to `rgb(r, g, b)` —
  override via spaced-form selectors `.theme-light [style*="color: rgb(r, g, b)"]`.
- **Pale accent classes (the recurring offender):** Tailwind `text-{color}-300/-400` wash out
  on light. A robust **class net** deepens them to `-600/-700` (amber/yellow/emerald/green/sky/
  cyan/blue/indigo(+200)/violet/purple/rose/red/pink/teal/orange). Catch opacity modifiers
  (`text-amber-400/80`) with `[class*="text-amber-4"]` substring selectors, and alpha inline
  (`rgba(251,191,36,0.8)`) with `[style*="color: rgba(251, 191, 36"]`.
- **Surfaces:** white-alpha inline bgs + `bg-white/N` + `border-white/N` → faint light
  surfaces + hairline. Dark popovers (`#11162a`) → white.
- **Soft GREY + LIGHT-GREY mix** (user asked, "رمادي و رمادي افتح"): `--bg:#e6e8ef` (page),
  `--surface:#f4f6fa` (cards lift gently — NOT stark white).
- **Intentionally-dark surfaces → convert to LIGHT** (user does NOT want dark blocks in light
  mode): schedule grid `rgba(7,9,15,*)`, chat shell **gradient** `#0a0f1e→#080c18` (+ `#0f1527`,
  `#121929`, `#1a2340`), shift-detail modal `#0d1424` → all light-grey via
  `.theme-light [style*="rgb(r, g, b)"]{background:#f4f6fa!important}` (match the serialized rgb).
- **Sidebar stays a DARK rail** in light mode (intentional) → re-light its text:
  `.theme-light aside .text-white{...}` etc., or the brand/labels vanish into the dark rail.
- **`keep-dark`** utility exists (re-light text on a surface that stays dark) but the user
  prefers full light conversion — convert hardcoded-dark bgs to light, don't keep-dark them.

## Aurora Glass (`.theme-glass`, dark-based)

Mint/teal/cyan/soft-violet **static** radial wash on `body::before` (NOT animated — see below);
deep teal-black base `#061210`; frosted `.card`; teal accents for sidebar-active, primary
buttons, segmented pill, glow-ring, selection, focus, scrollbar. Inspired by the **Enterprise
Lab** sibling repo (`../WFM System - Enterprise Lab`, its `glass-shell`/`glass-panel` mint design).

## Premium effects (opt-in utilities, all themes)

In `index.css`: `glow-border-soft` (animated gradient ring via mask trick), `sheen` (hover
light-sweep, RTL-safe via `inset-inline-start`), `lift` (hover translateY+glow), `num-pop`
(mount pop), `stagger-grid`, `text-gradient`. **Schedule shift cells**: `.shift-cell` carries a
per-cell `--cell-accent` var (set inline to the category colour) → hover = lift + **neon glow in
the cell's own colour** + saturate/brightness. **Roster**: zebra rows (`zrow-light`/`zrow-dark`)
+ the expanded detail CONTRASTS its row (`zdet-on-light`/`zdet-on-dark`: light row→grey detail,
grey row→light detail) + indigo top accent. **Requests**: every card colour-coded by request
type — 4px coloured left edge + faint same-colour wash (`typeColor` from `REQUEST_TYPES`).

## NO animated background

The user **opted out** of the moving/animated background. There is NO `LivingBackground`
component and the `body::before` ambient washes are **static** (no `animation`). Do NOT re-add
drifting auroras / floating motes / a moving page background. Per-element hover/entrance effects
(lift, sheen, neon hover, num-pop) are fine — those aren't "background".

## Rules of thumb

- transforms/opacity only (GPU). `@media (prefers-reduced-motion: reduce)` already freezes ALL
  animation globally — don't re-handle. Durations 150–400ms. 1–2 animated focal points per view.
- Scope every theme override under `.theme-light` / `.theme-glass`; never edit Dark directly.
- Inline `style` attribute substring selectors MUST match the **browser-serialized** form
  (spaces): `rgba(255, 255, 255, 0.03)`, `rgb(15, 21, 39)` — the no-space form matches nothing.
- Gradients report `backgroundColor: transparent` — to recolor a gradient surface, override
  `background` with a solid `!important`.

## Verification method (how the magic was checked)

1. **Browser-verify without disturbing the user's dev server (port 5173):** a `preview-5174`
   config in `.claude/launch.json` runs a 2nd Vite on 5174 (proxies to backend :3000). Use the
   Claude_Preview MCP: `preview_start("preview-5174")`, inject `localStorage access_token`
   (mint a fresh JWT with backend `JWT_ACCESS_SECRET`, payload `{sub:'d10000000-…0001',
   tenantId:'a0000000-…0001'}`, 6h), navigate, **DOM-eval is authoritative** (screenshots render
   clipped/zoomed and sometimes hang — a known quirk; trust computed styles).
- **Automated contrast auditor** (the workhorse): in a `preview_eval`, walk `main *`, for each
  leaf text node compute its colour luminance vs its nearest opaque ancestor background, flag
  `|Δlum| < ~42`. Skip tiny elements (avatar initials) and know that **white-on-gradient** chips/
  avatars are false positives (gradients read as transparent bg). This found+killed every faint
  spot across Schedule, Roster, Chat, Requests, Report/Dashboard Builder, Data Quality, Change
  Log, Interval Headcount, Agent 360, My Workspace, Control Dashboards, Live Monitoring, Scorecard.
- Backend runs **compiled `dist/main.js`** (prod mode, NOT watch) — new endpoints need
  `npm run build` + kill the `*dist/main*` node proc + relaunch `node dist/main.js`. Frontend dev
  server is watch/HMR.
- Always finish with `tsc --noEmit` + `vite build` clean.

## Next creative ideas to continue (the "ابداع" bookmark)

The user loves the polish and wants to keep going. Candidate next steps:
- Spread the premium hover/effect polish (lift/sheen/neon, count-up numbers, staggered entrance)
  to the high-traffic pages beyond Agent 360 (WFM Overview/Command Center, Control Dashboards,
  Scorecard Board, RTA Live).
- Richer (but tasteful, still no moving page bg) Aurora-Glass refinements; maybe a subtle
  per-card glass treatment toggle.
- Real animated count-up on headline KPI numbers; micro-interactions on approve/reject, publish.
- A cohesive chart style (the schedule/coverage bars, trends) tuned per theme.
- Keep using the contrast auditor as a pre-commit gate for any new page in light/glass.
