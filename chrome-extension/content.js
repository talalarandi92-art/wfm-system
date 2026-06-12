'use strict';
console.log('[WFM Bridge] content.js v16.4 loaded ✓ (content-sniffing harvest)');

const SEND_INTERVAL_MS = 30_000;
const MIN_SEND_GAP_MS  = 20_000;  // hard floor — KEY_OPS bursts must not flood the backend
const CACHE_STALE_MS   = 15 * 60_000; // cached agent status older than this → 'unknown'

// ── Inject page-context script ────────────────────────────────────────────────
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// ── Sprinklr operation store (Apollo GraphQL) ─────────────────────────────────
const sprinklrOps  = new Map(); // opName → latest data
let pendingSend    = false;
let sendCount      = 0;

// ── Persistent agent name cache ───────────────────────────────────────────────
// agentId → { name, status, lastSeen }
// Survives page refreshes via chrome.storage.local — grows over time as
// reportingQuery returns different agents from different Supervisor views.
let agentCache = {};
chrome.storage.local.get('agentCache', (d) => {
  agentCache = d.agentCache || {};
  const count = Object.keys(agentCache).length;
  if (count > 0) console.log(`[WFM Bridge] 📋 Loaded ${count} cached agent names`);
});

function saveAgentCache() {
  chrome.storage.local.set({ agentCache });
}

function updateAgentCache(agents) {
  let added = 0;
  agents.forEach(a => {
    if (!a.agentId || !a.agentName) return;
    const existing = agentCache[a.agentId];
    if (!existing || existing.name !== a.agentName || (a.email && !existing.email)) {
      agentCache[a.agentId] = {
        name: a.agentName, status: a.status,
        statusRaw: a.statusRaw || '',
        email: a.email || existing?.email || '',
        lastSeen: Date.now(),
      };
      added++;
    } else {
      // Update status and lastSeen without changing name
      agentCache[a.agentId].status    = a.status;
      agentCache[a.agentId].statusRaw = a.statusRaw || existing.statusRaw || '';
      agentCache[a.agentId].lastSeen  = Date.now();
      if (a.email) agentCache[a.agentId].email = a.email;
    }
  });
  if (added > 0) {
    console.log(`[WFM Bridge] 📋 Cache: +${added} new agents, total=${Object.keys(agentCache).length}`);
    saveAgentCache();
  }
}

// ── Synthetic name detection (DOM placeholders + Sprinklr widget labels) ─────
const SYNTH_RES = [
  /^(available|unavailable|busy|idle|break|away|offline|unknown)\s*\d*$/i,
  /^agent\s+status/i,
  /^(bio\s*break|prayer(\s*break)?|lunch(\s*break)?|short\s*break|meeting|training|coaching|wrap\s*up)(\s+\d+)?$/i,
  /^(no\s+data|user\s+current\s+status|current\s+status|n\/?a|null|undefined|total|grand\s+total|all\s+agents?|active\s+queue)/i,
];
const isSyntheticName = (name) => !name || SYNTH_RES.some(re => re.test(name.trim()));

// ── Per-agent daily metrics accumulated from ALL reportingQuery variants ─────
// Sprinklr's Supervisor widgets (Agent Performance, Case metrics…) all go through
// reportingQuery with different measurement columns. We harvest every numeric
// measurement we see, keyed by agentId, and ship them with each snapshot.
// agentId → { name, email, metrics: { MEASUREMENT_NAME: value }, updatedAt }
let agentMetrics = {};
chrome.storage.local.get('agentMetrics', (d) => {
  agentMetrics = d.agentMetrics || {};
  // Drop metrics older than 26h (they're daily counters)
  const cutoff = Date.now() - 26 * 3600e3;
  for (const id of Object.keys(agentMetrics)) {
    if ((agentMetrics[id].updatedAt || 0) < cutoff) delete agentMetrics[id];
  }
});

function mergeAgentMetrics(agentId, name, email, metrics) {
  if (!agentId) return;
  const cur = agentMetrics[agentId] || { name: '', email: '', metrics: {} };
  agentMetrics[agentId] = {
    name:      name  || cur.name,
    email:     email || cur.email,
    metrics:   { ...cur.metrics, ...metrics },
    updatedAt: Date.now(),
  };
}

let metricsSaveTimer = null;
function saveAgentMetricsDebounced() {
  if (metricsSaveTimer) return;
  metricsSaveTimer = setTimeout(() => {
    metricsSaveTimer = null;
    chrome.storage.local.set({ agentMetrics });
  }, 2000);
}

// Find an email anywhere inside an object (shallow scan of values)
function findEmail(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return '';
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v.toLowerCase();
    if (v && typeof v === 'object') {
      const found = findEmail(v, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

// Extract numeric measurements from a reportingQuery row item
function extractMeasurements(item) {
  const out = {};
  const scan = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 2) return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && /^[A-Z][A-Z0-9_]{2,60}$/.test(k)) out[k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) scan(v, depth + 1);
    }
  };
  // Sprinklr puts measurement values in: projections (confirmed — M_* keys),
  // measurements, additional, or the item itself
  scan(item.projections || {});
  scan(item.measurements || {});
  scan(item.additional || {}, 1);
  scan(item, 1);
  return out;
}

// Harvest user id→email pairs from user-related ops (users, recordManagerUser…)
// Sprinklr user objects look like { userId|id: 123, email|emailId: x@y.com, name|displayName }
function harvestUserEmails(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return 0;
  let found = 0;
  if (Array.isArray(obj)) {
    for (const item of obj) found += harvestUserEmails(item, depth + 1);
    return found;
  }
  const id    = obj.userId || obj.id || obj.user?.id;
  const email = [obj.email, obj.emailId, obj.userEmail, obj.user?.email]
    .find(v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
  const name  = obj.name || obj.displayName || obj.fullName || obj.user?.displayName || '';
  if (id && email && /^\d{4,}$/.test(String(id))) {
    mergeAgentMetrics(String(id), isSyntheticName(name) ? '' : name, email.toLowerCase(), {});
    found++;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') found += harvestUserEmails(v, depth + 1);
  }
  return found;
}

// ── Harvest live statuses from state-mapping ops ──────────────────────────────
// Sprinklr's activeUserCurrentStateMappings ("User Current Status") carries the
// CURRENT status of ALL logged-in agents — far broader than reportingQuery
// (which only covers agents visible in the open widget). Responses are FLAT.
// Generic miner: find arrays of {numeric user id + status-like string}.
const STATUS_WORD = /^(available|unavailable|busy|idle|away|offline|on\s?call|engaged|wrap.*|bio\s?break|break|lunch(\s?break)?|tea(\s?break)?|prayer(\s?break)?|meeting|training|coaching|manual\s?dial|outbound)/i;

function harvestUserStates(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return 0;
  let updated = 0;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const id = String(item.userId ?? item.agentId ?? item.user?.id ?? item.id ?? '');
        if (/^\d{4,}$/.test(id)) {
          // find a status-like string anywhere shallow in the item
          let statusRaw = '';
          const scan = (o, d = 0) => {
            if (!o || typeof o !== 'object' || d > 2 || statusRaw) return;
            for (const v of Object.values(o)) {
              if (statusRaw) return;
              if (typeof v === 'string' && v.length <= 40 && STATUS_WORD.test(v.trim())) statusRaw = v.trim();
              else if (v && typeof v === 'object') scan(v, d + 1);
            }
          };
          scan(item);
          if (statusRaw) {
            const norm = normalizeStatus(statusRaw);
            const cached = agentCache[id];
            if (cached) {
              cached.status = norm; cached.statusRaw = statusRaw; cached.lastSeen = Date.now();
            } else {
              // status known but name not yet — keep a placeholder keyed by id;
              // the name fills in when reportingQuery/users sees this agent
              const known = agentMetrics[id]?.name;
              if (known && !isSyntheticName(known)) {
                agentCache[id] = { name: known, status: norm, statusRaw, email: agentMetrics[id]?.email || '', lastSeen: Date.now() };
              }
            }
            updated++;
            continue;
          }
        }
      }
      updated += harvestUserStates(item, depth + 1);
    }
    return updated;
  }

  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') updated += harvestUserStates(v, depth + 1);
  }
  return updated;
}

// ── Structure-agnostic metric harvester ───────────────────────────────────────
// Walks ANY response tree; whenever an object carries a numeric user id AND
// M_*-keyed numeric measurements (in itself or its projections/measurements),
// it's an agent metrics row — regardless of endpoint or nesting.
function harvestGenericMetricRows(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return 0;
  let harvested = 0;

  if (Array.isArray(obj)) {
    for (const item of obj) harvested += harvestGenericMetricRows(item, depth + 1);
    return harvested;
  }

  const id = String(
    obj.key ?? obj.userId ?? obj.agentId ?? obj.user?.id ?? obj.groupDetails?.id ?? obj.id ?? '');
  if (/^\d{6,}$/.test(id)) {
    const metrics = {};
    const grab = (o, d = 0) => {
      if (!o || typeof o !== 'object' || d > 2) return;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number' && /^M_[A-Z0-9_]{2,80}$/.test(k)) metrics[k] = v;
        else if (v && typeof v === 'object' && !Array.isArray(v)) grab(v, d + 1);
      }
    };
    grab(obj);
    if (Object.keys(metrics).length) {
      const name = obj.groupDetails?.name || obj.user?.name || obj.name
        || obj.groupDetails?.objectAsUser?.name || '';
      mergeAgentMetrics(id, isSyntheticName(name) ? '' : name, findEmail(obj.groupDetails) || findEmail(obj.user) || '', metrics);
      harvested++;
    }
  }

  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') harvested += harvestGenericMetricRows(v, depth + 1);
  }
  if (depth === 0 && harvested > 0) {
    saveAgentMetricsDebounced();
    console.log(`[WFM Bridge] 📊 generic harvest: ${harvested} metric rows | store: ${Object.keys(agentMetrics).length} agents`);
  }
  return harvested;
}

// Harvest agent rows from ANY reportingQuery response (all widget variants)
function harvestReportingQuery(payloadData) {
  const rq = payloadData?.reportingQuery || payloadData?.data?.reportingQuery;
  if (!rq?.responses) return;
  let harvested = 0;

  const takeItem = (item) => {
    if (!item || typeof item !== 'object') return;
    const agentId = item.key
      || item.groupDetails?.id
      || item.userId || item.user?.id || item.id || '';
    if (!agentId || !/^\d{4,}$/.test(String(agentId))) return; // real Sprinklr user ids are numeric
    const name = item.groupDetails?.name || item.user?.name || item.name
      || item.groupDetails?.objectAsUser?.name || '';
    if (name && isSyntheticName(name)) return;                  // skip widget label rows
    const email   = findEmail(item.groupDetails) || findEmail(item.user) || findEmail(item.additional);
    const metrics = extractMeasurements(item);
    if (name || email || Object.keys(metrics).length) {
      mergeAgentMetrics(String(agentId), name, email, metrics);
      harvested++;
    }
  };

  for (const resp of rq.responses) {
    // Grouped widgets (status charts, agent groupings)
    for (const group of (resp?.groupedData || [])) {
      for (const item of (group?.responses || [])) takeItem(item);
    }
    // TABLE widgets return row objects in `hits` (search-style results)
    for (const hit of (resp?.hits || [])) takeItem(hit);
    // Some table variants nest rows one level deeper
    for (const hit of (resp?.rows || [])) takeItem(hit);
  }

  if (harvested > 0) {
    saveAgentMetricsDebounced();
    console.log(`[WFM Bridge] 📊 reportingQuery harvested ${harvested} agent rows | metrics store: ${Object.keys(agentMetrics).length} agents`);
  }
}

// ── Persistent queue cache ────────────────────────────────────────────────────
// queueId → full queue object + lastSeen. Survives page refreshes so queues
// keep flowing to WFM even when entityFeed hasn't fired yet in this session.
let queueCache = {};
chrome.storage.local.get('queueCache', (d) => {
  queueCache = d.queueCache || {};
  const count = Object.keys(queueCache).length;
  if (count > 0) console.log(`[WFM Bridge] 📦 Loaded ${count} cached queues`);
});

function updateQueueCache(queues) {
  let changed = 0;
  queues.forEach(q => {
    if (!q.queueId || !q.queueName) return;
    if (q.queueId.startsWith('dom_')) return; // never cache DOM-scraped queues
    queueCache[q.queueId] = { ...q, lastSeen: Date.now() };
    changed++;
  });
  if (changed > 0) {
    chrome.storage.local.set({ queueCache });
    console.log(`[WFM Bridge] 📦 Queue cache updated: ${changed} queues, total=${Object.keys(queueCache).length}`);
  }
}

// Diagnostic raw samples (temporary — until the metrics parser is confirmed)
const lastRawSamples = {};

// Key ops to watch for immediate send
const KEY_OPS = new Set([
  'getWorkQueueStatsV2', 'entityFeed', 'runningCalls', 'reportingQuery',
  'getQueueStats', 'getAgentStats', 'supervisorDashboard', 'queueMetrics',
  'workQueueStats', 'liveQueueData', 'agentPresence',
]);

// ── Listen for captured network data ─────────────────────────────────────────
window.addEventListener('__wfm_sprinklr_data__', (e) => {
  const { type, payload } = e.detail;

  if (type === 'fetch_response' || type === 'xhr_response') {
    const urlMatch = payload.url?.match(/[?&]op=([^&]+)/);
    const opName   = payload.opName || (urlMatch ? decodeURIComponent(urlMatch[1]) : null);

    // ── Content sniffing: the agents TABLE may ship through a REST endpoint
    // with no op name at all. Any response whose body carries rows keyed by
    // numeric user ids + M_* measurements IS our table — capture + harvest it
    // regardless of endpoint name.
    try {
      const body = payload.data;
      if (body && typeof body === 'object') {
        const str = JSON.stringify(body);
        if (str.length < 500_000
            && /M_[A-Z][A-Z0-9_]+/.test(str)
            && (/"key"\s*:\s*"\d{6,}"/.test(str) || /"userId"\s*:\s*\d{6,}/.test(str))) {
          lastRawSamples.tableSample    = str.slice(0, 60000);
          lastRawSamples.tableSampleUrl = payload.url?.split('?')[0] ?? '';
          console.log('[WFM Bridge] 🧪 metrics-bearing payload from', lastRawSamples.tableSampleUrl, `(${str.length} bytes, op=${opName ?? 'none'})`);
          try { harvestReportingQuery(body); } catch (e) {}
          try { harvestGenericMetricRows(body); } catch (e) {}
        }
      }
    } catch (e) { /* non-JSON or huge body */ }

    if (opName) {
      sprinklrOps.set(opName, payload.data);

      // Harvest agent names/emails/measurements from every reportingQuery variant.
      // CONFIRMED from raw samples: the Supervisor agents TABLE (Case Count /
      // FRT / Handle Time) flows through the op named 'queries' — same
      // data.reportingQuery body, measurements live in `projections` as M_* keys.
      if (opName === 'reportingQuery' || opName === 'queries') {
        try { harvestReportingQuery(payload.data); } catch (e) { /* shape varies */ }
        // Diagnostic: keep the latest raw payload so the backend can inspect the
        // agents-table structure (Case Count / FRT / Handle Time columns) until
        // the metrics parser is tuned to the real shape. Removed once confirmed.
        try { lastRawSamples.reportingQuery = JSON.stringify(payload.data).slice(0, 40000); } catch (e) {}
      }
      if (opName === 'queries' || opName === 'sinkPerformanceData') {
        try {
          const str = JSON.stringify(payload.data);
          lastRawSamples[opName] = str.slice(0, 40000);
          // Protect the TABLE payload from being clobbered by summary widgets:
          // table-like = non-empty hits/rows OR rows keyed by numeric user ids.
          if (/"hits":\[\{/.test(str) || /"rows":\[\{/.test(str) || /"key":"\d{6,}"/.test(str)) {
            lastRawSamples.tableSample = str.slice(0, 60000);
            console.log('[WFM Bridge] 🧪 table-like payload captured from', opName, `(${str.length} bytes)`);
          }
        } catch (e) {}
      }

      // Harvest user emails from any user-related op (richest email source)
      if (/user/i.test(opName)) {
        try {
          const n = harvestUserEmails(payload.data);
          if (n > 0) {
            saveAgentMetricsDebounced();
            console.log(`[WFM Bridge] 📧 harvested ${n} user emails from ${opName}`);
          }
        } catch (e) { /* shape varies */ }
      }

      // Harvest LIVE statuses for ALL agents from state-mapping ops —
      // this is the broad feed; reportingQuery only sees the open widget.
      if (/state|status|presence/i.test(opName)) {
        try {
          const n = harvestUserStates(payload.data);
          if (n > 0) {
            saveAgentCache();
            console.log(`[WFM Bridge] 🟢 live statuses updated for ${n} agents from ${opName}`);
          }
        } catch (e) { /* shape varies */ }
      }

      // entityFeed comes in two shapes: (1) full with workQueueStats, (2) UserMapping without.
      // Always keep the richest variant so the queue parser doesn't lose it when (2) arrives later.
      if (opName === 'entityFeed') {
        // Sprinklr returns entityFeed WITHOUT the standard GraphQL {data:...} wrapper.
        // Response is { entityFeed: [...] } not { data: { entityFeed: [...] } }.
        const feed = payload.data?.entityFeed || payload.data?.data?.entityFeed;
        const hasStats = Array.isArray(feed) && feed.some(i => i.workQueueStats);
        if (hasStats) {
          sprinklrOps.set('entityFeedStats', payload.data);
          console.log('[WFM Bridge] ✅ entityFeedStats saved, queues=', feed.filter(i => i.workQueueStats).length);
        }
      }

      console.log('[WFM Bridge] ✅ op:', opName, '|', payload.url?.split('?')[0]?.split('/').slice(-2).join('/'));

      // Log structure of key ops so we can tune the parsers
      const LOG_OPS = new Set(['entityFeed', 'reportingQuery', 'getWorkQueueStatsV2',
        'activeUserCurrentStateMappings', 'recordManagerUser', 'users', 'user']);
      if (LOG_OPS.has(opName)) {
        const d = payload.data?.data || payload.data || {};
        const topKeys = Object.keys(d).join(', ');
        if (opName === 'reportingQuery') {
          // reportingQuery value is not a simple array — log raw
          const rqVal = d.reportingQuery;
          console.log(`[WFM Bridge] 🔍 reportingQuery raw:`, JSON.stringify(rqVal).slice(0, 600));
        } else {
          const firstKey  = Object.keys(d)[0];
          const sample    = firstKey ? d[firstKey] : d;
          const arrSample = Array.isArray(sample) ? sample[0]
            : (Array.isArray(sample?.entities) ? sample.entities[0]
            : (Array.isArray(sample?.data)     ? sample.data[0]
            : (Array.isArray(sample?.workQueues) ? sample.workQueues[0] : null)));
          console.log(`[WFM Bridge] 🔍 ${opName} — keys: {${topKeys}} | first item keys: {${Object.keys(arrSample || {}).join(', ')}}`);
          if (arrSample) console.log(`[WFM Bridge] 🔍 ${opName} sample:`, JSON.stringify(arrSample).slice(0, 500));
          // For ops without clear arrays, just dump the top-level value
          if (!arrSample && firstKey) console.log(`[WFM Bridge] 🔍 ${opName} value:`, JSON.stringify(sample).slice(0, 400));
        }
      }

      // Trigger immediate send for key operations (debounced 500ms)
      if (KEY_OPS.has(opName) && !pendingSend) {
        pendingSend = true;
        setTimeout(() => { pendingSend = false; trySend(true); }, 500);
      }
    } else {
      // Log unrecognized responses so we can discover Sprinklr's API shape
      const path   = payload.url?.split('?')[0]?.split('/').slice(-3).join('/');
      const topKeys = Object.keys(payload.data?.data || payload.data || {}).slice(0, 6).join(', ');
      if (path) console.log('[WFM Bridge] ❓ unknown response:', path, '{ data:', topKeys, '}');
    }
  }

  if (type === 'ws_message') {
    const data = payload.data;
    const key  = data?.op || data?.type || data?.event || data?.operationName;
    if (key) {
      sprinklrOps.set(key, data);
      if (KEY_OPS.has(key) && !pendingSend) {
        pendingSend = true;
        setTimeout(() => { pendingSend = false; trySend(true); }, 500);
      }
    }
  }

  if (type === 'url_seen') {
    const opName = payload.opName;
    if (opName) console.debug('[WFM Bridge] url seen op:', opName);
  }
});

// ── Parse entityFeed → queue stats (confirmed structure from live interception) ─
function parseEntityFeedQueues() {
  // Prefer entityFeedStats (guaranteed to have workQueueStats) over the raw entityFeed key
  // which may have been overwritten by the UserMapping shape (no stats).
  const data = sprinklrOps.get('entityFeedStats') || sprinklrOps.get('entityFeed');
  if (!data) return [];

  // Sprinklr entityFeed returns { entityFeed: [...] } directly (no GraphQL {data:...} wrapper).
  const feed = data?.entityFeed || data?.data?.entityFeed;
  if (!Array.isArray(feed) || feed.length === 0) return [];

  return feed
    .filter(item => item.workQueueId && item.workQueueName && item.workQueueStats)
    .map(item => {
      const s = item.workQueueStats;
      return {
        queueId:         item.workQueueId,
        queueName:       item.workQueueName,
        channel:         detectChannel(item.workQueueType || item.workQueueName || ''),
        waiting:         coerce(s.pendingWorks),
        inProgress:      coerce(s.inProgressWorks),
        backlog:         coerce(s.pendingWorks) + coerce(s.inProgressWorks),
        avgWaitSeconds:  coerce(s.estimatedWorkQueueWaitTime),
        slaBreached:     0,
        slaPct:          coerce(s.percentSLA || s.emailPercentSLA || 100),
        agentsAvailable: coerce(s.noOfAgentsAvailable),
        agentsBusy:      coerce(s.agentsOnCase),
        agentsIdle:      coerce(s.idleAgents),
        agentsLoggedIn:  coerce(s.loggedInAgents),
        agentsBreak:     0,
        aht:             0,
        // Full raw stats passthrough — the backend mines cumulative counters
        // (total/completed/received works) to build per-queue daily contact
        // volumes for the forecast. Field names vary; ship them all.
        statsRaw:        s,
      };
    });
}

// ── Parse getWorkQueueStatsV2 ─────────────────────────────────────────────────
function parseQueueStats() {
  // First try entityFeed — confirmed richest source
  const fromFeed = parseEntityFeedQueues();
  if (fromFeed.length > 0) return fromFeed;

  // Fallback: other known op names
  const candidates = [
    'getWorkQueueStatsV2', 'getQueueStats', 'workQueueStats', 'liveQueueData',
    'supervisorDashboard', 'queueMetrics',
  ];

  for (const op of candidates) {
    const data = sprinklrOps.get(op);
    if (!data) continue;

    const raw = data?.data?.workQueueStats
      || data?.data?.queueStats
      || data?.data?.queues
      || data?.data?.supervisorDashboard?.queues
      || data?.workQueueStats
      || data?.queues
      || (Array.isArray(data) ? data : null)
      || extractFirstArray(data);

    if (raw && raw.length > 0) {
      return raw.map(q => ({
        queueId:         q.queueId         || q.id          || q.channelId   || '',
        queueName:       q.queueName       || q.name        || q.label       || '',
        channel:         detectChannel(q.channelType || q.type || q.channel || q.queueName || ''),
        waiting:         coerce(q.waiting         || q.waitingCount    || q.customersWaiting || q.inQueue),
        inProgress:      coerce(q.inProgress      || q.casesInProgress || q.activeCount      || q.engaged),
        backlog:         coerce(q.backlog         || q.totalOpen       || q.backlogCount),
        avgWaitSeconds:  coerce(q.avgWaitTime     || q.averageWait     || 0),
        slaBreached:     coerce(q.slaBreached     || q.breachedCount   || 0),
        slaPct:          coerce(q.slaPct          || q.slaCompliance   || q.soSla || 100),
        agentsAvailable: coerce(q.agentsAvailable || q.availableAgents || q.activeAgents || 0),
        agentsBusy:      coerce(q.agentsBusy      || q.busyAgents      || 0),
        agentsBreak:     0,
        aht:             coerce(q.aht || 0),
      })).filter(q => q.queueName);
    }
  }
  return [];
}

// ── Parse agent presence from GraphQL ops ────────────────────────────────────
// NOTE: entityFeed contains QUEUE data, not agent data.
// Agent source confirmed: reportingQuery → responses[0].groupedData[0].responses[]
//   each item: { key: agentId, groupDetails: { name }, additional: { ORIGINAL_EXPANDED_KEY: [id, status, loginStatus] } }
function parseEntityFeed() {
  // ── 1. reportingQuery — confirmed live agent source ─────────────────────────
  const rqData = sprinklrOps.get('reportingQuery');
  if (rqData) {
    // reportingQuery response may be flat { reportingQuery: {...} } or wrapped { data: { reportingQuery: {...} } }
    const rq        = rqData?.reportingQuery || rqData?.data?.reportingQuery;
    const agentList = rq?.responses?.[0]?.groupedData?.[0]?.responses;
    if (Array.isArray(agentList) && agentList.length > 0) {
      const mapped = agentList.map(a => {
        const expandedKey  = a.additional?.ORIGINAL_EXPANDED_KEY || [];
        const statusRaw    = expandedKey[1] || '';
        const loginStatus  = expandedKey[2] || '';
        const agentId      = String(a.key || a.groupDetails?.id || '');
        return {
          agentId,
          agentName:      a.groupDetails?.name || '',
          email:          findEmail(a.groupDetails) || agentMetrics[agentId]?.email || '',
          status:         loginStatus.toLowerCase().includes('logged out')
                            ? 'offline'
                            : normalizeStatus(statusRaw),
          statusRaw:      statusRaw || '',   // raw Sprinklr label: "Bio Break", "Lunch", "Meeting", "Manual Dial"…
          currentChannel: '',
          queueId:        '',
          loginTime:      '',
        };
      }).filter(a => a.agentName && !isSyntheticName(a.agentName));
      if (mapped.length > 0) {
        // Save real names to persistent cache so we remember all agents over time
        updateAgentCache(mapped);
        console.log(`[WFM Bridge] 👤 agents from reportingQuery: ${mapped.length} | cache total: ${Object.keys(agentCache).length}`);
        return mapped;
      }
    }
  }

  // ── 2. Fallback: other ops that may carry agent lists ───────────────────────
  const candidates = [
    'activeUserCurrentStateMappings',
    'agentPresence', 'getAgentStats', 'supervisorDashboard',
  ];

  for (const op of candidates) {
    const data = sprinklrOps.get(op);
    if (!data) continue;

    const raw = data?.data?.activeUserCurrentStateMappings
      || data?.data?.entities
      || data?.data?.users
      || data?.data?.agents
      || data?.data?.supervisorDashboard?.agents
      || data?.entities
      || data?.users
      || extractFirstArray(data);

    if (raw && raw.length > 0) {
      const mapped = raw.map(a => ({
        agentId:        a.userId     || a.agentId    || a.id         || '',
        agentName:      a.userName   || a.displayName|| a.name       || a.fullName
                      || a.user?.displayName || a.user?.name || '',
        status:         normalizeStatus(a.status || a.availability || a.agentStatus
                      || a.userStatus || a.currentStatus || ''),
        currentChannel: detectChannel(a.channelType || a.channel || ''),
        queueId:        a.queueId    || a.workQueueId || a.channelId || '',
        loginTime:      a.loginTime  || a.sessionStart || a.loginAt  || '',
      })).filter(a => a.agentName);
      if (mapped.length > 0) return mapped;
    }
  }
  return [];
}

function parseRunningCalls() {
  const data = sprinklrOps.get('runningCalls');
  if (!data) return 0;
  const raw = data?.data?.runningCalls || data?.runningCalls || data;
  return Array.isArray(raw) ? raw.length : (coerce(raw?.count || raw?.total) || 0);
}

// ── DOM scraper ───────────────────────────────────────────────────────────────
function scrapeDOM() {
  const queues = [];
  const agents = [];
  const seenQ  = new Set();
  const seenA  = new Set();

  const bodyText = document.body?.innerText || '';

  // ── 1. MAIN PANEL — active queue name + summary ───────────────────────────
  const waitingMatch    = bodyText.match(/Customers\s+Waiting\s+([\d,]+)/i);
  const inProgressMatch = bodyText.match(/Cases\s+in\s+Progress\s+([\d,]+)/i);

  if (waitingMatch || inProgressMatch) {
    const w = waitingMatch    ? parseInt(waitingMatch[1].replace(/,/g,''),    10) : 0;
    const p = inProgressMatch ? parseInt(inProgressMatch[1].replace(/,/g,''), 10) : 0;

    // Queue name = last meaningful line before "Queue Summary" in visible text
    const summaryIdx = bodyText.indexOf('Queue Summary');
    let qName = '';
    if (summaryIdx > 10) {
      const before = bodyText.substring(Math.max(0, summaryIdx - 300), summaryIdx);
      const lines  = before.split('\n')
        .map(l => l.replace(/[●•◉⊙○▪▸]/g, '').trim())
        .filter(l => l.length > 3 && l.length < 80
               && !/^(Search|Filter|Add|Quick|Queues\s*\(|\d+$|--$|Selected date|Date range|\d{2}\/\d{2}\/\d{4})/.test(l));
      qName = lines[lines.length - 1] || '';
    }
    qName = qName || 'Active Queue';

    seenQ.add(qName);
    queues.push({
      queueId:         'dom_main',
      queueName:       qName,
      channel:         detectChannel(qName),
      waiting:         w, inProgress: p, backlog: w + p,
      avgWaitSeconds:  0, slaBreached: 0, slaPct: 100,
      agentsAvailable: 0, agentsBusy: 0, agentsBreak: 0, aht: 0,
    });
  }

  // ── 2. LEFT PANEL — queue list cards (text-block parsing) ─────────────────
  // Strategy: find elements containing "Total Agents" + "Waiting" with short text.
  // Each queue card is a small self-contained block; large containers are skipped.
  document.querySelectorAll('div,li,section,article').forEach(el => {
    const text = (el.innerText || '').trim();
    if (text.length < 30 || text.length > 700) return;
    if (!text.includes('Total Agents') || !text.includes('Waiting')) return;
    if (text.includes('Queue Summary')) return; // skip main panel

    const lines = text.split('\n').map(l => l.replace(/[●•◉⊙○▪▸]/g, '').trim()).filter(Boolean);

    // First line that looks like a proper name (not a metric line)
    const nameLine = lines.find(l =>
      l.length > 3 && l.length < 80 &&
      !/^(SLA%|Avg\s|So\.|Vo\.|Waiting|Abandoned|Active\s|Total\s|\d|--|Search|Filter|Add|Quick)/i.test(l)
    );
    if (!nameLine || seenQ.has(nameLine)) return;

    const waitM  = text.match(/Waiting\s+([\d,]+)/i);
    const actM   = text.match(/Active\s*Agents?\s+(\d+)/i);
    const slaM   = text.match(/So\.\s*SLA%\s*(\d+)/i) || text.match(/SLA%\s*(\d+)/i);

    const waiting = waitM ? parseInt(waitM[1].replace(/,/g,''), 10) : 0;
    const active  = actM  ? parseInt(actM[1], 10)                   : 0;
    const sla     = slaM  ? parseInt(slaM[1], 10)                   : 100;

    seenQ.add(nameLine);
    queues.push({
      queueId:         `dom_${nameLine.replace(/\W+/g,'_').toLowerCase()}`,
      queueName:       nameLine,
      channel:         detectChannel(nameLine),
      waiting, inProgress: active, backlog: waiting + active,
      avgWaitSeconds:  0, slaBreached: 0, slaPct: sla,
      agentsAvailable: active, agentsBusy: 0, agentsBreak: 0, aht: 0,
    });
  });

  // ── 3. AGENTS — parse from "Agent Status" summary panel ───────────────────
  // Sprinklr shows: "Unavailable (41)"  "Bio Break (1)"  "Available (2)" etc.
  // This is reliable because it's always in the right-side panel.
  const agentStatusBlock = bodyText.match(/Agent\s+Status[\s\S]{0,600}/i)?.[0] || '';
  if (agentStatusBlock) {
    const statusRE = /([A-Za-z][A-Za-z\s]{1,30})\s*\(\s*(\d+)\s*\)/g;
    let m;
    while ((m = statusRE.exec(agentStatusBlock)) !== null) {
      const label = m[1].trim();
      const count = parseInt(m[2], 10);
      if (!count || label.length > 30) continue;
      const norm = normalizeStatus(label);
      // Create synthetic agent entries to represent the count
      for (let i = 0; i < count; i++) {
        const id = `${norm}_${i}`;
        if (!seenA.has(id)) {
          seenA.add(id);
          agents.push({
            agentId:        id,
            agentName:      `${label} ${i + 1}`,
            status:         norm,
            currentChannel: 'unknown',
            queueId:        '',
            loginTime:      '',
          });
        }
      }
    }
  }

  // ── 4. REAL AGENT NAMES — multi-strategy DOM scraper ──────────────────────
  // Sprinklr uses custom div-based rows, not standard tbody/tr.
  // Strategy A: Find status badge elements then walk up to find the agent row + name.
  // Strategy B: Parse any short text block that has a status keyword + a name pattern.

  const STATUS_KEYWORDS = /\b(available|unavailable|idle|busy|break|away|offline|bio break|prayer)\b/i;
  const NAME_RE         = /^[A-Za-z؀-ۿ][A-Za-z؀-ۿ\s'.]{1,50}$/;
  const NOT_NAME_RE     = /^(available|unavailable|idle|busy|break|away|offline|agent|status|total|search|filter|queue|waiting|active|\d)/i;

  // Helper: extract a real name from a DOM element and its ancestors
  function extractNameFromElement(el) {
    // Walk up to find a "row-like" container (max 6 levels)
    let container = el;
    for (let i = 0; i < 6; i++) {
      if (!container.parentElement) break;
      container = container.parentElement;
      const h = container.offsetHeight || 0;
      // A row-like container is typically 30–90px tall and has some text
      if (h >= 28 && h <= 100) break;
    }

    // Collect text nodes from the container's direct children
    const childTexts = [...container.children].map(c => (c.innerText || '').trim()).filter(Boolean);

    for (const t of childTexts) {
      // Take the first text that looks like a real agent name
      if (t.length >= 3 && t.length <= 55
          && NAME_RE.test(t)
          && !NOT_NAME_RE.test(t)) {
        return t;
      }
    }

    // Fallback: check the container's own direct text content
    const direct = [...container.childNodes]
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .find(t => t.length >= 3 && t.length <= 55 && NAME_RE.test(t) && !NOT_NAME_RE.test(t));
    return direct || '';
  }

  // Strategy A: Status badge → containing row → name
  document.querySelectorAll('*').forEach(el => {
    const t = (el.innerText || el.textContent || '').trim();
    if (!STATUS_KEYWORDS.test(t) || t.length > 30 || el.children.length > 2) return;

    const statusRaw = t;
    const name = extractNameFromElement(el);
    if (!name || seenA.has(name)) return;

    const rowText  = el.closest('[class]')?.innerText || '';
    const rowLower = rowText.toLowerCase();
    const hasIdle  = /\bidle\b/.test(rowLower);
    const finalStatus = hasIdle ? 'idle' : normalizeStatus(statusRaw);

    const loginM = rowText.match(/(\d+h\s*\d*m|\d{1,2}:\d{2}\s*(AM|PM|ص|م)?)/i);

    seenA.add(name);
    agents.push({
      agentId:        `row_${name.replace(/\W+/g,'_').toLowerCase()}`,
      agentName:      name,
      status:         finalStatus,
      currentChannel: 'unknown',
      queueId:        '',
      loginTime:      loginM ? loginM[0] : '',
    });
  });

  // Strategy B: standard tbody/tr fallback (in case Sprinklr uses a real table somewhere)
  document.querySelectorAll('tbody tr').forEach(row => {
    const rowText = (row.innerText || '').trim();
    if (!rowText) return;
    const cells = [...row.querySelectorAll('td')];
    if (cells.length < 2) return;

    let name = ''; let statusText = ''; let loginText = '';
    for (const cell of cells) {
      const t = (cell.innerText || '').trim();
      if (!t) continue;
      if (!name && t.length > 2 && t.length < 60 && NAME_RE.test(t) && !NOT_NAME_RE.test(t)) { name = t; continue; }
      if (STATUS_KEYWORDS.test(t) && t.length < 25) { statusText = t; continue; }
      if (/^\d+h\s*\d*m?/.test(t) || /^\d{1,2}:\d{2}/.test(t)) { loginText = t; }
    }
    if (!name || seenA.has(name)) return;
    seenA.add(name);
    const rowLower = rowText.toLowerCase();
    agents.push({
      agentId:        `row_${name.replace(/\W+/g,'_').toLowerCase()}`,
      agentName:      name,
      status:         /\bidle\b/.test(rowLower) ? 'idle' : normalizeStatus(statusText || rowText),
      currentChannel: 'unknown', queueId: '', loginTime: loginText,
    });
  });

  console.log('[WFM Bridge] DOM:', queues.length, 'queues,', agents.length, 'agents');
  return { queues, agents };
}

// ── Build final snapshot ──────────────────────────────────────────────────────
function buildSnapshot() {
  const apiQueues = parseQueueStats();
  const apiAgents = parseEntityFeed();
  const { queues: domQ, agents: domA } = scrapeDOM();

  // Save live API queues to persistent cache
  if (apiQueues.length > 0) updateQueueCache(apiQueues);

  const queueMap = new Map();
  [...apiQueues, ...domQ].forEach(q => {
    if (q.queueName && !queueMap.has(q.queueName)) queueMap.set(q.queueName, q);
  });

  // Merge cached queues (seen within last 12h) so the WFM dashboard never loses
  // queues just because entityFeed hasn't fired yet in this tab/session.
  const QUEUE_TTL = 12 * 3600 * 1000;
  Object.values(queueCache).forEach(c => {
    if (Date.now() - (c.lastSeen || 0) > QUEUE_TTL) return;
    if (!queueMap.has(c.queueName)) {
      const { lastSeen, ...q } = c;
      queueMap.set(q.queueName, q);
    }
  });

  const agentMap = new Map();

  // (isSyntheticName is defined at top level — shared with the metrics harvester)

  // Priority 0: Persistent cache — all agents ever seen, with latest known status
  // Use reportingQuery live status if available, otherwise use cached status
  Object.entries(agentCache).forEach(([agentId, cached]) => {
    // A status we haven't refreshed in 15+ min is stale — report 'unknown'
    // instead of pretending the agent is still available/busy.
    const fresh = Date.now() - (cached.lastSeen || 0) < CACHE_STALE_MS;
    agentMap.set(agentId, {
      agentId,
      agentName:      cached.name,
      email:          cached.email || agentMetrics[agentId]?.email || '',
      status:         fresh ? (cached.status || 'unknown') : 'unknown',
      statusRaw:      fresh ? (cached.statusRaw || '') : '',
      currentChannel: '',
      queueId:        '',
      loginTime:      '',
    });
  });

  // Priority 1: Live API agents from reportingQuery — override cache with real-time status
  apiAgents.forEach(a => {
    if (!a.agentName || isSyntheticName(a.agentName)) return;
    // Use agentId as key so we match correctly even if name changed
    const key = a.agentId || a.agentName;
    agentMap.set(key, a);
  });

  // Priority 2: DOM real agents — only if cache is completely empty
  if (agentMap.size === 0) {
    const domReal = domA.filter(a => a.agentId.startsWith('row_'));
    domReal.forEach(a => {
      if (a.agentName && !isSyntheticName(a.agentName))
        agentMap.set(a.agentId, a);
    });
  }

  // Priority 3: Synthetic — absolute last resort
  if (agentMap.size === 0) {
    const domSynthetic = domA.filter(a => !a.agentId.startsWith('row_'));
    domSynthetic.slice(0, 5).forEach(a => {
      if (a.agentName) agentMap.set(a.agentId, a);
    });
  }

  const queues       = [...queueMap.values()];
  const agents       = [...agentMap.values()];
  const totalWaiting = queues.reduce((s, q) => s + (q.waiting || 0), 0);
  const totalAvail   = agents.filter(a => a.status === 'available').length;
  const runningCalls = parseRunningCalls();

  // Attach harvested daily measurements (AHT, response time, case counts…) per agent
  agents.forEach(a => {
    const m = agentMetrics[a.agentId];
    if (m?.metrics && Object.keys(m.metrics).length) a.metrics = m.metrics;
    if (!a.email && m?.email) a.email = m.email;
  });

  return {
    source:        'sprinklr',
    capturedAt:    new Date().toISOString(),
    queues,
    agents,
    summary:       { totalWaiting, totalAvailable: totalAvail, runningCalls },
    captureMethod: apiQueues.length ? (sprinklrOps.has('entityFeedStats') ? 'api/entityFeed' : 'api')
                  : (queues.length ? 'cache' : (domQ.length ? 'dom' : 'empty')),
    debugSamples: Object.keys(lastRawSamples).length ? lastRawSamples : undefined,
    opsDetected:   [...sprinklrOps.keys()],
  };
}

// ── Send ──────────────────────────────────────────────────────────────────────
let lastHash   = '';
let lastSendAt = 0;

function trySend(force = false) {
  // Hard rate limit: Sprinklr fires entityFeed/reportingQuery continuously and the
  // KEY_OPS immediate-send was flooding the backend (8 snapshots/min). 20s floor.
  if (Date.now() - lastSendAt < MIN_SEND_GAP_MS) return;

  const snapshot = buildSnapshot();

  const hash = snapshot.queues.map(q => `${q.queueName}:${q.waiting}:${q.inProgress}`).join('|')
             + '|agents:' + snapshot.agents.length;

  // First 5 sends: always try even if same hash (page may still loading)
  if (!force && sendCount >= 5 && hash === lastHash) return;

  lastHash = hash;

  if (snapshot.queues.length === 0 && snapshot.agents.length === 0) {
    console.log('[WFM Bridge] ⚠️ snapshot empty — ops so far:', [...sprinklrOps.keys()].join(', ') || 'none');
    return;
  }

  sendCount++;
  lastSendAt = Date.now();
  console.log(`[WFM Bridge] sending snapshot #${sendCount}: ${snapshot.queues.length} queues, ${snapshot.agents.length} agents via ${snapshot.captureMethod}`);
  chrome.runtime.sendMessage({ type: 'SPRINKLR_SNAPSHOT', snapshot });
}

// ── Background-driven pull ────────────────────────────────────────────────────
// Chrome throttles setInterval in background tabs (→ "extension keeps dropping").
// The service worker pulls via chrome.alarms (unthrottled) every minute; message
// handlers fire even in throttled tabs, so the data keeps flowing.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PULL_SNAPSHOT') {
    try {
      const snapshot = buildSnapshot();
      lastSendAt = Date.now();
      sendCount++;
      sendResponse({ ok: true, snapshot });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
});

// ── Timers ────────────────────────────────────────────────────────────────────
// Spread attempts during page load (Sprinklr SPA takes time to render)
[3000, 8000, 15000, 25000, 40000, 60000].forEach(ms => setTimeout(() => trySend(true), ms));
setInterval(() => trySend(false), SEND_INTERVAL_MS);

// Heartbeat
setInterval(() => chrome.runtime.sendMessage({ type: 'SPRINKLR_HEARTBEAT', url: location.href }), 10_000);

// ── Helpers ───────────────────────────────────────────────────────────────────
function coerce(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return parseInt(String(v).replace(/,/g, ''), 10) || 0;
}

function detectChannel(raw = '') {
  const s = raw.toLowerCase();
  if (s.includes('whatsapp') || s.includes('-wa') || s.includes(' wa ')) return 'whatsapp';
  if (s.includes('chat') || s.includes('live'))    return 'chat';
  if (s.includes('email') || s.includes('mail'))   return 'email';
  if (s.includes('social') || s.includes('twitter') || s.includes('instagram') || s.includes('facebook')) return 'social';
  if (s.includes('voice') || s.includes('call') || s.includes('phone')) return 'voice';
  return 'unknown';
}

function normalizeStatus(raw = '') {
  const s = raw.toLowerCase();
  if (s.includes('idle'))                                                       return 'idle';
  if (s.includes('available') && !s.includes('un'))                            return 'available';
  if (s.includes('manual') || s.includes('outbound') || s.includes('dial'))   return 'busy';
  if (s.includes('busy') || s.includes('engaged') || s.includes('on call'))   return 'busy';
  if (s.includes('break') || s.includes('lunch') || s.includes('prayer')
      || s.includes('bio') || s.includes('tea'))                               return 'break';
  if (s.includes('meeting') || s.includes('training') || s.includes('coach')
      || s.includes('away') || s.includes('wrap'))                             return 'away';
  if (s.includes('unavailable') || s.includes('offline'))                      return 'offline';
  return 'unknown';
}

function extractFirstArray(obj, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj) && obj.length > 0) return obj;
  for (const v of Object.values(obj)) {
    const found = extractFirstArray(v, depth + 1);
    if (found) return found;
  }
  return null;
}

console.log('[WFM Bridge] content.js v16 — broad live statuses (state mappings) + raw queue counters');
