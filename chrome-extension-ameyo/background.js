/* WFM Ameyo Bridge — service worker.
 * Receives snapshots from content.js and POSTs them to the WFM backend
 * (/api/v1/integrations/ameyo/push). Auth model mirrors the Sprinklr bridge:
 * password is used once → refresh token rotates the 15-min access token. */
'use strict';

const DEFAULT_CONFIG = {
  wfmApiUrl:   'http://localhost:3000/api/v1',
  wfmApiToken: '',
  wfmEmail:    '',
  wfmPassword: '',
  enabled:     true,
};

let authInFlight = null;

async function storeTokenPair(config, d) {
  const access  = d.accessToken  || d.access_token  || '';
  const refresh = d.refreshToken || d.refresh_token || '';
  if (!access) return null;
  config.wfmApiToken = access;
  config.wfmPassword = '';
  await chrome.storage.local.set({ config, wfmRefreshToken: refresh || undefined, lastLoginAt: Date.now() });
  return access;
}

async function wfmRefresh(config) {
  const { wfmRefreshToken } = await chrome.storage.local.get('wfmRefreshToken');
  if (!wfmRefreshToken) return null;
  try {
    const res = await fetch(`${config.wfmApiUrl}/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: wfmRefreshToken }),
    });
    if (!res.ok) { await chrome.storage.local.remove('wfmRefreshToken'); return null; }
    return storeTokenPair(config, await res.json());
  } catch { return null; }
}

async function wfmPasswordLogin(config) {
  if (!config.wfmEmail || !config.wfmPassword) return null;
  try {
    const res = await fetch(`${config.wfmApiUrl}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: config.wfmEmail, password: config.wfmPassword }),
    });
    if (!res.ok) { await chrome.storage.local.set({ lastPushStatus: `Login failed ${res.status}` }); return null; }
    return storeTokenPair(config, await res.json());
  } catch { await chrome.storage.local.set({ lastPushStatus: 'Login network error' }); return null; }
}

async function wfmLogin(config) {
  if (authInFlight) return authInFlight;
  authInFlight = (async () => {
    try { return (await wfmRefresh(config)) || (await wfmPasswordLogin(config)); }
    finally { authInFlight = null; }
  })();
  return authInFlight;
}

// ── alarms: proactive token refresh + background-tab pull (timers throttle when unfocused) ──
chrome.alarms.create('wfm_token_refresh', { periodInMinutes: 10 });
chrome.alarms.create('wfm_pull',          { periodInMinutes: 1 });

async function pullFromTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://ameyo.boutiqaat.com/*'] });
    for (const tab of tabs) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'PULL_AMEYO' });
        if (res?.ok && res.snapshot) { await chrome.storage.local.set({ lastHeartbeat: Date.now(), ameyoUrl: tab.url }); await handleSnapshot(res.snapshot); return; }
      } catch { /* not an Ameyo tab / no content script */ }
    }
  } catch { /* ignore */ }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'wfm_pull') await pullFromTabs();
  if (alarm.name === 'wfm_token_refresh') {
    const { config = DEFAULT_CONFIG, wfmRefreshToken } = await chrome.storage.local.get(['config', 'wfmRefreshToken']);
    if (config.enabled && (wfmRefreshToken || config.wfmPassword)) { const tok = await wfmLogin(config); if (!tok) setBadge('AUTH', '#ef4444'); }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'WFM_AMEYO_SNAPSHOT') { handleSnapshot(msg.snapshot).then((r) => sendResponse(r)); return true; }
  if (msg.type === 'GET_STATUS')  { getStatus().then(sendResponse); return true; }
  if (msg.type === 'SAVE_CONFIG') { chrome.storage.local.set({ config: msg.config }).then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === 'TEST_LOGIN')  {
    (async () => { const { config = DEFAULT_CONFIG } = await chrome.storage.local.get('config');
      const tok = await wfmLogin(config); sendResponse(tok ? { ok: true } : { ok: false, error: 'فشل تسجيل الدخول' }); })();
    return true;
  }
});

async function handleSnapshot(snapshot) {
  await chrome.storage.local.set({ lastSnapshot: snapshot, lastSnapshotAt: Date.now() });
  return pushToWfm(snapshot);
}

async function pushToWfm(snapshot, isRetry = false) {
  const { config = DEFAULT_CONFIG } = await chrome.storage.local.get('config');
  if (!config.enabled) { setBadge('OFF', '#64748b'); return { ok: false, error: 'Disabled' }; }
  if (!config.wfmApiToken) {
    const token = await wfmLogin(config);
    if (!token) { setBadge('OFF', '#64748b'); return { ok: false, error: 'Not configured' }; }
    config.wfmApiToken = token;
  }
  try {
    const res = await fetch(`${config.wfmApiUrl}/integrations/ameyo/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.wfmApiToken}` },
      body: JSON.stringify(snapshot),
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      await chrome.storage.local.set({ lastPushAt: Date.now(), lastPushStatus: 'ok', lastPushAgentCount: snapshot.agents?.length ?? 0 });
      setBadge(`${snapshot.agents?.length ?? 0}A`, '#22c55e');
      return { ok: true, ...body };
    }
    if (res.status === 401 && !isRetry) { const tok = await wfmLogin(config); if (tok) return pushToWfm(snapshot, true); }
    await chrome.storage.local.set({ lastPushStatus: `HTTP ${res.status}` }); setBadge('ERR', '#ef4444');
    return { ok: false, error: await res.text() };
  } catch (e) {
    await chrome.storage.local.set({ lastPushStatus: 'Network error' }); setBadge('NET', '#f59e0b');
    return { ok: false, error: e.message };
  }
}

async function getStatus() {
  const d = await chrome.storage.local.get(['config', 'lastSnapshot', 'lastSnapshotAt', 'lastPushAt', 'lastPushStatus', 'lastHeartbeat', 'lastPushAgentCount', 'ameyoUrl']);
  return {
    config: d.config ?? DEFAULT_CONFIG,
    lastSnapshot: d.lastSnapshot ?? null, lastSnapshotAt: d.lastSnapshotAt ?? null,
    lastPushAt: d.lastPushAt ?? null, lastPushStatus: d.lastPushStatus ?? 'never',
    agentCount: d.lastPushAgentCount ?? 0, ameyoUrl: d.ameyoUrl ?? '',
    connected: Date.now() - (d.lastHeartbeat ?? d.lastSnapshotAt ?? 0) < 90_000,
  };
}

function setBadge(text, color) { chrome.action.setBadgeText({ text }); chrome.action.setBadgeBackgroundColor({ color }); }

chrome.runtime.onInstalled.addListener(async () => {
  const { config } = await chrome.storage.local.get('config');
  if (!config) await chrome.storage.local.set({ config: DEFAULT_CONFIG });
  setBadge('OFF', '#64748b');
  console.log('[WFM Ameyo Bridge] Installed.');
});
