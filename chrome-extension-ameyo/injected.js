/* WFM Ameyo Bridge — page-world network interceptor.
 * Wraps fetch / XHR / WebSocket so we can SEE how Ameyo's Live-Monitoring screen
 * loads its data (it refreshes ~every 10s → almost certainly polls a REST/WS API).
 * Every response is forwarded to the content script via window.postMessage; the
 * content script logs a sample so we can confirm the exact payload shape and write
 * the precise parser (same way the Sprinklr connector was built). */
(function () {
  'use strict';
  const TAG = '[WFM Ameyo]';
  const send = (kind, url, data) => {
    try { window.postMessage({ __wfmAmeyo: true, kind, url, data }, '*'); } catch { /* */ }
  };
  // On the Ameyo domain we capture broadly: REST stats endpoints AND the GWT
  // server-push channel (live agent/queue updates arrive as push, not discrete REST).
  const interesting = (u) => /ameyorestapi|interactionStats|runtime|push|dacx|agent|queue|monitor|live|stat|call|campaign|realtime|kpi|dashboard/i.test(u || '');

  // ── fetch ──
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = (args[0] && args[0].url) || String(args[0] || '');
    const res = await origFetch.apply(this, args);
    if (interesting(url)) {
      res.clone().json().then(j => send('fetch', url, j)).catch(() => {});
    }
    return res;
  };

  // ── XHR ──
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__wfmUrl = u; return origOpen.call(this, m, u, ...rest); };
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        if (interesting(this.__wfmUrl) && this.responseText && this.responseText[0] === '{') {
          send('xhr', this.__wfmUrl, JSON.parse(this.responseText));
        }
      } catch { /* */ }
    });
    return origSend.apply(this, a);
  };

  // ── WebSocket ──
  const OrigWS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    ws.addEventListener('message', (ev) => {
      try { const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : null; if (d) send('ws', url, d); } catch { /* */ }
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;

  console.log(TAG, 'network interceptor installed ✓');
})();
