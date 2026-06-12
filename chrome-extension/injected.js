/**
 * injected.js — PAGE context v5.
 * Intercepts fetch + XHR + WebSocket. Infers op type from RESPONSE shape (duck typing)
 * so we work even when the POST body isn't readable or uses persisted queries.
 */
(function () {
  'use strict';

  function dispatch(type, payload) {
    window.dispatchEvent(new CustomEvent('__wfm_sprinklr_data__', {
      detail: { type, payload, ts: Date.now() },
    }));
  }

  // ── Extract operation name (multiple strategies) ──────────────────────────
  function extractOpName(url, bodyText, responseData) {
    // 1) ?op= in URL
    const urlMatch = url?.match(/[?&]op=([^&]+)/);
    if (urlMatch) return decodeURIComponent(urlMatch[1]);

    // 2) operationName in POST body JSON
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed?.operationName) return parsed.operationName;
        if (Array.isArray(parsed) && parsed[0]?.operationName) return parsed[0].operationName;
      } catch { /* not JSON */ }
    }

    // 3) Duck-type from response structure (works with persisted queries)
    if (responseData) {
      const d = responseData?.data || responseData;
      // Queue stats shape
      if (d?.workQueueStats || d?.queueStats || d?.queues) return 'getWorkQueueStatsV2';
      // Entity/agent feed shape
      if (d?.entities && Array.isArray(d.entities)) return 'entityFeed';
      if (d?.users && Array.isArray(d.users) && d.users[0]?.userName !== undefined) return 'entityFeed';
      // Running calls
      if (d?.runningCalls !== undefined) return 'runningCalls';
      // Reporting / metrics
      if (d?.reportingData || d?.metrics || d?.intervals) return 'reportingQuery';
      // Supervisor dashboard (may contain both queues and agents)
      if (d?.supervisorDashboard) return 'supervisorDashboard';
      // Arrays that look like queue objects
      if (Array.isArray(d)) {
        if (d[0]?.queueName || d[0]?.queueId || d[0]?.channelId) return 'getWorkQueueStatsV2';
        if (d[0]?.agentId || d[0]?.userName || d[0]?.userId) return 'entityFeed';
      }
    }

    return null;
  }

  // ── Read body text from various formats ───────────────────────────────────
  async function readBodyText(input, init) {
    try {
      // init.body is most common when calling fetch(url, {method:'POST', body: '...'})
      if (init?.body !== undefined && init.body !== null) {
        const b = init.body;
        if (typeof b === 'string')               return b;
        if (b instanceof URLSearchParams)        return b.toString();
        if (b instanceof ArrayBuffer)            return new TextDecoder().decode(b);
        if (b instanceof Blob)                   return await b.text();
        // FormData & ReadableStream — skip (complex, rare for Apollo)
        // Try JSON.stringify as last resort
        try { return JSON.stringify(b); } catch { return null; }
      }
      // fetch(request) — clone the Request
      if (input instanceof Request && !input.bodyUsed) {
        return await input.clone().text();
      }
    } catch { /* ignore */ }
    return null;
  }

  // ── Intercept fetch ───────────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input
      : (input instanceof Request ? input.url : String(input));

    const bodyText = await readBodyText(input, init);
    const response = await _fetch(input, init);

    // Only process API / sprinklr responses to avoid noise
    const isApi = url.includes('/api/') || url.includes('sprinklr.com') || url.includes('/graphql');
    if (isApi && response.status < 400) {
      try {
        const clone = response.clone();
        const text  = await clone.text();
        if (text && text[0] === '{' || text[0] === '[') {
          const json   = JSON.parse(text);
          const opName = extractOpName(url, bodyText, json);
          dispatch('fetch_response', { url, opName, data: json, bodyText });
        }
      } catch { /* non-JSON */ }
    }

    return response;
  };

  // ── Intercept XHR ─────────────────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this.__wfm_url = url;
    return _open.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const url  = this.__wfm_url || '';
    let bodyTx = null;
    try { if (typeof body === 'string') bodyTx = body; } catch { }

    this.addEventListener('load', () => {
      if (this.responseText) {
        try {
          const json   = JSON.parse(this.responseText);
          const opName = extractOpName(url, bodyTx, json);
          dispatch('fetch_response', { url, opName, data: json, bodyText: bodyTx });
        } catch { }
      }
    });
    return _send.call(this, body);
  };

  // ── Intercept WebSocket ───────────────────────────────────────────────────
  const _WS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new _WS(url, protocols) : new _WS(url);

    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        try {
          const json   = JSON.parse(event.data);
          const opName = extractOpName(url, null, json)
                      || json?.op || json?.type || json?.event || json?.operationName;
          dispatch('ws_message', { url, opName, data: json });
        } catch { /* binary */ }
      }
    });
    return ws;
  };
  window.WebSocket.prototype = _WS.prototype;
  window.WebSocket.CONNECTING = _WS.CONNECTING;
  window.WebSocket.OPEN       = _WS.OPEN;
  window.WebSocket.CLOSING    = _WS.CLOSING;
  window.WebSocket.CLOSED     = _WS.CLOSED;

  console.log('[WFM Bridge] injected.js v5 — duck-typing response shapes to identify ops.');
})();
