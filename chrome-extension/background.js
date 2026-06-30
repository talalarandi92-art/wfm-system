/**
 * background.js — Extension service worker.
 *
 * Responsibilities:
 * 1. Receive SPRINKLR_SNAPSHOT from content.js.
 * 2. POST snapshot to WFM backend (/api/v1/integrations/sprinklr/push).
 * 3. Cache last snapshot in chrome.storage.local for popup display.
 * 4. Retry failed pushes with exponential backoff.
 * 5. Badge the extension icon with connection status.
 */

'use strict';

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  wfmApiUrl:    'http://localhost:3000/api/v1',
  wfmApiToken:  '',   // auto-filled by login, or set manually in popup
  wfmEmail:     '',   // WFM account — enables auto-login + token refresh
  wfmPassword:  '',
  enabled:      true,
  pushInterval: 30,   // seconds (content.js controls actual interval)
};

// ── Auth: access tokens live 15 min. Security model:
//   1. Password is used ONCE for the initial login, then wiped from storage.
//   2. Ongoing renewal uses the rotating refresh token (POST /auth/refresh).
//   3. If the refresh chain breaks, badge shows AUTH and the user re-enters
//      the password once in the popup.
let authInFlight = null;

async function storeTokenPair(config, d) {
  const access  = d.accessToken  || d.access_token  || '';
  const refresh = d.refreshToken || d.refresh_token || '';
  if (!access) return null;
  config.wfmApiToken = access;
  config.wfmPassword = '';   // never keep the password after a successful login
  await chrome.storage.local.set({
    config,
    wfmRefreshToken: refresh || undefined,
    lastLoginAt: Date.now(),
  });
  return access;
}

async function wfmRefresh(config) {
  const { wfmRefreshToken } = await chrome.storage.local.get('wfmRefreshToken');
  if (!wfmRefreshToken) return null;
  try {
    const res = await fetch(`${config.wfmApiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: wfmRefreshToken }),
    });
    if (!res.ok) {
      await chrome.storage.local.remove('wfmRefreshToken'); // rotated/expired — dead chain
      return null;
    }
    const token = await storeTokenPair(config, await res.json());
    if (token) console.log('[WFM Bridge] 🔄 Token pair rotated via refresh');
    return token;
  } catch {
    return null;
  }
}

async function wfmPasswordLogin(config) {
  if (!config.wfmEmail || !config.wfmPassword) return null;
  try {
    const res = await fetch(`${config.wfmApiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: config.wfmEmail, password: config.wfmPassword }),
    });
    if (!res.ok) {
      await chrome.storage.local.set({ lastPushStatus: `Login failed ${res.status}` });
      return null;
    }
    const token = await storeTokenPair(config, await res.json());
    if (token) console.log('[WFM Bridge] 🔑 Logged in — password wiped, refresh token stored');
    return token;
  } catch {
    await chrome.storage.local.set({ lastPushStatus: 'Login network error' });
    return null;
  }
}

// Unified renewal: refresh token first, password fallback (first run only)
async function wfmLogin(config) {
  if (authInFlight) return authInFlight;
  authInFlight = (async () => {
    try {
      return (await wfmRefresh(config)) || (await wfmPasswordLogin(config));
    } finally {
      authInFlight = null;
    }
  })();
  return authInFlight;
}

// ── Alarms: retry failed pushes + proactive token refresh + tab pull ──────────
chrome.alarms.create('wfm_retry',         { periodInMinutes: 1 });
chrome.alarms.create('wfm_token_refresh', { periodInMinutes: 10 }); // token lives 15 min
chrome.alarms.create('wfm_pull',          { periodInMinutes: 1 });  // background-tab safe

// Chrome throttles content-script timers in background tabs, which made the
// bridge "keep disconnecting" whenever the Sprinklr tab lost focus. Alarms in
// the service worker are NOT throttled — pull a snapshot from the tab directly.
async function pullFromSprinklrTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.sprinklr.com/*' });
    for (const tab of tabs) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'PULL_SNAPSHOT' });
        if (res?.ok && res.snapshot) {
          await chrome.storage.local.set({ lastHeartbeat: Date.now(), sprinklrUrl: tab.url });
          await handleSnapshot(res.snapshot);
          return; // one good snapshot per cycle is enough
        }
      } catch { /* tab not ready / no content script — try next */ }
    }
  } catch { /* tabs API unavailable — ignore */ }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'wfm_pull') {
    await pullFromSprinklrTabs();
  }

  if (alarm.name === 'wfm_retry') {
    const { pendingSnapshot } = await chrome.storage.local.get('pendingSnapshot');
    if (pendingSnapshot) await pushToWfm(pendingSnapshot);
  }

  if (alarm.name === 'wfm_token_refresh') {
    const { config = DEFAULT_CONFIG, wfmRefreshToken } =
      await chrome.storage.local.get(['config', 'wfmRefreshToken']);
    if (config.enabled && (wfmRefreshToken || config.wfmPassword)) {
      const token = await wfmLogin(config); // rotate before the 15-min expiry
      if (!token) setBadge('AUTH', '#ef4444');
    }
  }
});

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SPRINKLR_SNAPSHOT') {
    handleSnapshot(msg.snapshot);
    sendResponse({ ok: true });
  }

  if (msg.type === 'SPRINKLR_HEARTBEAT') {
    chrome.storage.local.set({
      lastHeartbeat: Date.now(),
      sprinklrUrl: msg.url,
    });
    sendResponse({ ok: true });
  }

  if (msg.type === 'GET_STATUS') {
    getStatus().then(sendResponse);
    return true; // async response
  }

  if (msg.type === 'SAVE_CONFIG') {
    chrome.storage.local.set({ config: msg.config }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'PUSH_NOW') {
    chrome.storage.local.get('lastSnapshot').then(({ lastSnapshot }) => {
      if (lastSnapshot) pushToWfm(lastSnapshot).then(sendResponse);
      else sendResponse({ ok: false, error: 'No snapshot available yet' });
    });
    return true;
  }

  if (msg.type === 'TEST_LOGIN') {
    (async () => {
      const { config = DEFAULT_CONFIG, wfmRefreshToken } =
        await chrome.storage.local.get(['config', 'wfmRefreshToken']);
      if (!wfmRefreshToken && (!config.wfmEmail || !config.wfmPassword)) {
        sendResponse({ ok: false, error: 'لا يوجد بريد/كلمة مرور محفوظة' });
        return;
      }
      const token = await wfmLogin(config);
      sendResponse(token ? { ok: true } : { ok: false, error: 'فشل تسجيل الدخول — تحقق من البريد وكلمة المرور' });
    })();
    return true;
  }
});

// ── Core handler ─────────────────────────────────────────────────────────────
async function handleSnapshot(snapshot) {
  // Save locally
  await chrome.storage.local.set({
    lastSnapshot: snapshot,
    lastSnapshotAt: Date.now(),
  });

  // Push to WFM
  await pushToWfm(snapshot);
}

async function pushToWfm(snapshot, isRetryAfterLogin = false) {
  const { config = DEFAULT_CONFIG } = await chrome.storage.local.get('config');

  if (!config.enabled) {
    setBadge('OFF', '#64748b');
    return { ok: false, error: 'Disabled' };
  }

  // No token yet — try auto-login if credentials are saved
  if (!config.wfmApiToken) {
    const token = await wfmLogin(config);
    if (!token) {
      setBadge('OFF', '#64748b');
      return { ok: false, error: 'Not configured' };
    }
    config.wfmApiToken = token;
  }

  const url = `${config.wfmApiUrl}/integrations/sprinklr/push`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.wfmApiToken}`,
      },
      body: JSON.stringify(snapshot),
    });

    if (res.ok) {
      // Clear pending, update status
      await chrome.storage.local.remove('pendingSnapshot');
      await chrome.storage.local.set({
        lastPushAt: Date.now(),
        lastPushStatus: 'ok',
        lastPushQueueCount: snapshot.queues?.length ?? 0,
        lastPushAgentCount: snapshot.agents?.length ?? 0,
      });
      setBadge(`${snapshot.queues?.length ?? 0}Q`, '#22c55e');
      return { ok: true };
    }

    // Token expired (WFM access tokens live 15 min) → auto re-login + retry once
    if (res.status === 401 && !isRetryAfterLogin) {
      const token = await wfmLogin(config);
      if (token) return pushToWfm(snapshot, true);
    }

    const err = await res.text();
    await chrome.storage.local.set({ lastPushStatus: `HTTP ${res.status}` });
    setBadge('ERR', '#ef4444');

    // Save for retry
    await chrome.storage.local.set({ pendingSnapshot: snapshot });
    return { ok: false, error: err };

  } catch (e) {
    await chrome.storage.local.set({ lastPushStatus: 'Network error', pendingSnapshot: snapshot });
    setBadge('NET', '#f59e0b');
    return { ok: false, error: e.message };
  }
}

async function getStatus() {
  const data = await chrome.storage.local.get([
    'config', 'lastSnapshot', 'lastSnapshotAt',
    'lastPushAt', 'lastPushStatus', 'lastHeartbeat',
    'lastPushQueueCount', 'lastPushAgentCount', 'sprinklrUrl',
    'wfmRefreshToken', 'lastLoginAt', 'pendingSnapshot',
  ]);

  const cfg = data.config ?? DEFAULT_CONFIG;
  return {
    config:          cfg,
    lastSnapshot:    data.lastSnapshot ?? null,
    lastSnapshotAt:  data.lastSnapshotAt ?? null,
    lastPushAt:      data.lastPushAt ?? null,
    lastPushStatus:  data.lastPushStatus ?? 'never',
    lastHeartbeat:   data.lastHeartbeat ?? null,
    queueCount:      data.lastPushQueueCount ?? 0,
    agentCount:      data.lastPushAgentCount ?? 0,
    sprinklrUrl:     data.sprinklrUrl ?? '',
    // 90s window: heartbeats throttle in background tabs; the 1-min alarm pull
    // refreshes lastHeartbeat, so anything under 90s means the bridge is alive.
    connected:       Date.now() - (data.lastHeartbeat ?? 0) < 90_000,
    // ── Doctor signals (booleans only — never leak the token) ──
    hasToken:        !!cfg.wfmApiToken,
    hasRefreshToken: !!data.wfmRefreshToken,
    hasCredentials:  !!(cfg.wfmEmail && (cfg.wfmPassword || data.wfmRefreshToken || cfg.wfmApiToken)),
    lastLoginAt:     data.lastLoginAt ?? null,
    hasPending:      !!data.pendingSnapshot,
  };
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ── On install: set defaults ──────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const { config } = await chrome.storage.local.get('config');
  if (!config) await chrome.storage.local.set({ config: DEFAULT_CONFIG });
  setBadge('OFF', '#64748b');
  console.log('[WFM Bridge] Installed.');
});
