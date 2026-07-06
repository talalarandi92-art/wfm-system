/* WFM Ameyo Bridge — content script (isolated world).
 * 1) Injects injected.js so we can SEE Ameyo's network (discovery).
 * 2) DOM-scrapes the Live-Monitoring "Agents List" table + KPI cards as a reliable
 *    fallback that works even before we know Ameyo's API shape.
 * 3) Every few seconds posts a snapshot to the WFM backend via background.js.
 *
 * Only activates on a page that looks like Ameyo Live Monitoring, so it can be
 * loaded with a broad match pattern without touching unrelated sites. */
(function () {
  'use strict';
  const TAG = '[WFM Ameyo]';
  const SEND_INTERVAL_MS = 8000;

  // ── activation guard: is this an Ameyo monitoring page? ──
  const looksLikeAmeyo = () => {
    const txt = document.body ? document.body.innerText : '';
    return /Live\s*Monitoring|Agents?\s*List|Auto[-\s]?Call|On\s*ACW|Customers?\s*On\s*Hold/i.test(txt)
      || /ameyo/i.test(location.hostname);
  };

  // ── 1) inject page-world interceptor ──
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injected.js');
    s.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { console.warn(TAG, 'inject failed', e); }

  // ── collect intercepted network (discovery) — keep latest sample per URL ──
  const discovery = new Map();
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || !m.__wfmAmeyo) return;
    const key = (m.url || '').split('?')[0];
    discovery.set(key, { op: `${m.kind} ${key}`, sample: m.data });
    // surface in console so the data shape can be shared back for parser building
    console.log(TAG, 'captured', m.kind, key, m.data);
  });

  // ── 2) DOM scrapers ────────────────────────────────────────────────────────
  const num = (s) => { const m = String(s ?? '').replace(/[^\d.]/g, ''); return m ? Number(m) : null; };

  // KPI cards: pair a number with its nearby label (Break / Ready / Connected / On ACW / Customers On Hold …)
  function scrapeKpis() {
    const kpis = {};
    const labelRe = /^(break|ready|available|connected|on\s*acw|acw|customers?\s*on\s*hold|on\s*hold|queued|total\s*agents?|auto[-\s]?call(\s*on|\s*off)?|talk|handling|hold|inactive)$/i;
    document.querySelectorAll('*').forEach((el) => {
      if (el.children.length) return;                 // leaf nodes only
      const t = (el.textContent || '').trim();
      if (!t || t.length > 28 || !labelRe.test(t)) return;
      // look for a number in a sibling / parent block
      const scope = el.parentElement?.parentElement || el.parentElement;
      const n = scope ? num(scope.textContent) : null;
      if (n != null) kpis[t.toLowerCase().replace(/\s+/g, '_')] = n;
    });
    return kpis;
  }

  // Agents table: header columns seen in the screenshot.
  function scrapeAgents() {
    const tables = Array.from(document.querySelectorAll('table'));
    for (const tbl of tables) {
      const heads = Array.from(tbl.querySelectorAll('thead th, thead td, tr:first-child th'))
        .map((h) => (h.textContent || '').trim().toLowerCase());
      // accept the agents grid whether it labels the column "Agent Name/ID" OR uses a plain
      // Name/User column alongside a status + call/phone/customer/extension column.
      const looksAgentTable = heads.some((h) => /agent\s*name|agent\s*id/.test(h))
        || (heads.some((h) => /^status$|agent\s*status/.test(h)) && heads.some((h) => /call|phone|customer|extension|campaign|queue/.test(h)));
      if (!looksAgentTable) continue;
      const col = (re) => heads.findIndex((h) => re.test(h));
      const ix = {
        name: col(/agent\s*name|^name$|user\s*name|^user$/), id: col(/agent\s*id|^id$|extension|^ext$/),
        autoCall: col(/auto\s*call/), status: col(/^agent\s*status|^status/),
        callStatus: col(/agent\s*call\s*status/), callType: col(/call\s*type/),
        phone: col(/phone/), custStatus: col(/customer\s*call\s*status/),
      };
      const rows = Array.from(tbl.querySelectorAll('tbody tr')).length
        ? Array.from(tbl.querySelectorAll('tbody tr'))
        : Array.from(tbl.querySelectorAll('tr')).slice(1);
      const get = (cells, i) => (i >= 0 && cells[i] ? (cells[i].textContent || '').trim() : null);
      const agents = rows.map((tr) => {
        const c = Array.from(tr.querySelectorAll('td'));
        if (!c.length) return null;
        return {
          name: get(c, ix.name), agentId: get(c, ix.id),
          autoCallStatus: get(c, ix.autoCall), status: get(c, ix.status),
          callStatus: get(c, ix.callStatus), callType: get(c, ix.callType),
          phone: get(c, ix.phone), customerCallStatus: get(c, ix.custStatus),
        };
      }).filter((a) => a && (a.name || a.agentId));
      if (agents.length) return agents;
    }
    return [];
  }

  // ── 3) build + send snapshot ────────────────────────────────────────────────
  let lastSnapshot = null;
  function buildSnapshot() {
    const agents = scrapeAgents();
    const kpis = scrapeKpis();
    const snapshot = {
      capturedAt: new Date().toISOString(),
      captureMethod: 'dom+network',
      kpis,
      agents,
      queues: [],                                   // refined once Ameyo's API shape is known
      discovery: Array.from(discovery.values()).slice(0, 12),
    };
    if (!agents.length && !Object.keys(kpis).length && !discovery.size) return null;
    lastSnapshot = snapshot;
    return snapshot;
  }

  // background-tab fallback: service-worker alarm pulls directly (timers throttle when unfocused)
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg && msg.type === 'PULL_AMEYO') {
      const snap = looksLikeAmeyo() ? (buildSnapshot() || lastSnapshot) : null;
      reply({ ok: !!snap, snapshot: snap });
    }
    return true;
  });

  // True once the extension is reloaded/updated while this old script lingers —
  // any chrome.* call then throws "Extension context invalidated". Stop quietly
  // (a page refresh re-injects the fresh script).
  const dead = () => { try { return !chrome.runtime || !chrome.runtime.id; } catch { return true; } };

  // hash-dedup: only push when the agents/KPIs actually CHANGED (safe near-live cadence),
  // plus a 30s heartbeat so the backend can still tell fresh from stale.
  let lastHash = '', lastSentAt = 0;
  const hashSnap = (s) => { try { return JSON.stringify({ a: s.agents, k: s.kpis, q: s.queues }); } catch { return String(Math.random()); } };

  function tick() {
    if (dead()) { clearInterval(timer); return; }
    if (!looksLikeAmeyo()) return;
    const snapshot = buildSnapshot();
    if (!snapshot) return;
    const h = hashSnap(snapshot), now = Date.now();
    if (h === lastHash && now - lastSentAt < 30000) return;   // unchanged & within heartbeat → skip
    lastHash = h; lastSentAt = now;
    try {
      chrome.runtime.sendMessage({ type: 'WFM_AMEYO_SNAPSHOT', snapshot }, (res) => {
        if (chrome.runtime.lastError) return;        // background asleep — ignore
        if (res && res.ok) console.log(TAG, 'sent →', res);
      });
    } catch { clearInterval(timer); }               // context invalidated mid-send
  }

  let timer = null;
  const start = () => { console.log(TAG, 'content script active'); tick(); timer = setInterval(tick, SEND_INTERVAL_MS); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
