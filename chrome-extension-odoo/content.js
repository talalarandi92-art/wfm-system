/* WFM Odoo Bridge — content script (isolated world).
 * 1) Injects injected.js to see Odoo's own data calls.
 * 2) Collects the captured records per model and pushes a snapshot to the WFM backend
 *    (/integrations/odoo/push) — idempotent staging by (model, odoo id).
 * Activates only on a page that is an Odoo web client, so it can carry a broad match. */
(function () {
  'use strict';
  const TAG = '[WFM Odoo]';
  const SEND_INTERVAL_MS = 6000;

  // ── activation guard: is this an Odoo web client? ──
  const looksLikeOdoo = () => {
    try {
      if (document.querySelector('.o_web_client, .o_action_manager, .o_list_view, .o_content')) return true;
      if (/odoo/i.test(document.title) || /odoo/i.test(location.hostname)) return true;
      if (location.hash && /(^|#).*(model=|action=|menu_id=)/.test(location.hash)) return true;
      return false;
    } catch { return false; }
  };

  // ── inject the page-world interceptor ──
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injected.js');
    s.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { console.warn(TAG, 'inject failed', e); }

  // ── collect captured records — keep the LATEST record set per model ──
  const byModel = new Map();   // model -> { model, method, records }
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || !m.__wfmOdoo || !m.model) return;
    // keep the largest/most-recent capture per model (list views > single form reads)
    const prev = byModel.get(m.model);
    if (!prev || (m.records && m.records.length >= (prev.records ? prev.records.length : 0))) {
      byModel.set(m.model, { model: m.model, method: m.method, records: m.records || [] });
    }
    console.log(TAG, 'captured', m.model, (m.records || []).length, 'records');
  });

  const KEEP = /leave|attendance|resource|hr\.|extra|comp|permission|overtime|x_|studio|employee/i;
  function buildSnapshot() {
    // prioritize HR/Studio models, but include everything captured
    const caps = Array.from(byModel.values()).sort((a, b) =>
      (KEEP.test(b.model) ? 1 : 0) - (KEEP.test(a.model) ? 1 : 0) || b.records.length - a.records.length);
    if (!caps.length) return null;
    const count = caps.reduce((s, c) => s + (c.records ? c.records.length : 0), 0);
    return { capturedAt: new Date().toISOString(), captures: caps, count, models: caps.map((c) => c.model) };
  }

  // background-tab fallback pull
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg && msg.type === 'PULL_ODOO') { const snap = looksLikeOdoo() ? buildSnapshot() : null; reply({ ok: !!snap, snapshot: snap }); }
    return true;
  });

  const dead = () => { try { return !chrome.runtime || !chrome.runtime.id; } catch { return true; } };

  // hash-dedup: only push when the captured data CHANGED (+ 45s heartbeat)
  let lastHash = '', lastSentAt = 0;
  const hashSnap = (s) => { try { return JSON.stringify(s.models) + '|' + s.count; } catch { return String(Math.random()); } };

  function tick() {
    if (dead()) { clearInterval(timer); return; }
    if (!looksLikeOdoo()) return;
    const snapshot = buildSnapshot();
    if (!snapshot) return;
    const h = hashSnap(snapshot), now = Date.now();
    if (h === lastHash && now - lastSentAt < 45000) return;
    lastHash = h; lastSentAt = now;
    try {
      chrome.runtime.sendMessage({ type: 'WFM_ODOO_SNAPSHOT', snapshot }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.ok) console.log(TAG, 'synced →', res);
      });
    } catch { clearInterval(timer); }
  }

  let timer = null;
  const start = () => { console.log(TAG, 'content script active'); tick(); timer = setInterval(tick, SEND_INTERVAL_MS); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
