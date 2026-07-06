/* WFM Odoo Bridge — page-world interceptor.
 * The Odoo web client loads every list/form through its OWN JSON-RPC data calls
 * (/web/dataset/call_kw · search_read · web_search_read). We wrap fetch/XHR, read the
 * REQUEST to learn the model + method, and the RESPONSE to grab the returned records —
 * then forward {model, method, records} to the content script. No API key: this rides
 * the supervisor's existing Odoo session. (Same pattern as the Sprinklr/Ameyo bridges.) */
(function () {
  'use strict';
  const TAG = '[WFM Odoo]';
  const isData = (u) => /\/web\/dataset\/(call_kw|search_read|web_search_read|call)/i.test(u || '');
  const send = (model, method, records, length) => {
    try { window.postMessage({ __wfmOdoo: true, model, method, records, length }, '*'); } catch { /* */ }
  };

  // Pull {model, method} out of the JSON-RPC request body Odoo sends.
  const reqInfo = (body) => {
    try {
      const p = (typeof body === 'string' ? JSON.parse(body) : body) || {};
      const params = p.params || p;
      return { model: params.model || null, method: params.method || null };
    } catch { return { model: null, method: null }; }
  };
  // Extract the record array from an Odoo response result (search_read → array; web_search_read → {records}).
  const recsOf = (result) => {
    if (!result) return null;
    if (Array.isArray(result)) return { records: result, length: result.length };
    if (Array.isArray(result.records)) return { records: result.records, length: result.length ?? result.records.length };
    return null;
  };

  // ── fetch ──
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = (args[0] && args[0].url) || String(args[0] || '');
    const body = args[1] && args[1].body;
    const res = await origFetch.apply(this, args);
    if (isData(url)) {
      const { model, method } = reqInfo(body);
      res.clone().json().then((j) => { const r = recsOf(j && j.result); if (r && r.records.length) send(model, method, r.records, r.length); }).catch(() => {});
    }
    return res;
  };

  // ── XHR ──
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__wfmUrl = u; return origOpen.call(this, m, u, ...rest); };
  XMLHttpRequest.prototype.send = function (bodyArg, ...a) {
    this.__wfmBody = bodyArg;
    this.addEventListener('load', () => {
      try {
        const rt = this.responseText;
        if (isData(this.__wfmUrl) && rt && (rt[0] === '{' || rt[0] === '[')) {
          const j = JSON.parse(rt);
          const r = recsOf(j && j.result);
          if (r && r.records.length) { const { model, method } = reqInfo(this.__wfmBody); send(model, method, r.records, r.length); }
        }
      } catch { /* */ }
    });
    return origSend.call(this, bodyArg, ...a);
  };

  console.log(TAG, 'Odoo data-call interceptor installed ✓');
})();
