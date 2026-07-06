# WFM Bridge — Odoo Connector

Reads the Odoo **Live Monitoring** screen (agents list + KPI cards) and syncs it
to the WFM Platform in real-time, mirroring the Sprinklr bridge.

## How it captures data
1. **Network interceptor** (`injected.js`) wraps `fetch`/XHR/WebSocket in the page
   world → sees how Odoo loads its live data (it refreshes ~every 10s).
2. **DOM scraper** (`content.js`) reads the "Agents List" table + KPI cards as a
   reliable fallback that works even before the exact API shape is known.
3. **Service worker** (`background.js`) POSTs snapshots to
   `/api/v1/integrations/ameyo/push` (auth = WFM login → rotating refresh token).

## Load it (Discovery step)
1. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked**
   → select this `chrome-extension-ameyo` folder.
2. Open the extension popup → enter the WFM API URL + your WFM email/password →
   **حفظ وتسجيل الدخول**. (Password is used once, then wiped; a refresh token is kept.)
3. Open the **Odoo Live Monitoring** page. The badge turns green with the agent
   count when snapshots start flowing.
4. Open DevTools console on the Odoo tab — every captured network call is logged
   as `[WFM Odoo] captured …`. Click **نسخ العيّنات** in the popup and share the
   copied JSON so the precise parser (queue/KPI field mapping) can be finalized.

## Verify on the backend
- `GET /api/v1/integrations/ameyo/live` returns the latest snapshot
  (`{ capturedAt, kpis, queues, agents, staleSec }`).
- Snapshots are stored in `integration_snapshots` with `source='ameyo'`
  (raw rows pruned after 48h).

## Notes
- `content_scripts` matches all URLs but **only activates** on a page that looks
  like Odoo Live Monitoring (`looksLikeOdoo()`), so it won't touch other sites.
  Once the Odoo URL is known, narrow `matches`/`host_permissions` to that domain.
