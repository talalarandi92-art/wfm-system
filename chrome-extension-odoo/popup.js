'use strict';

/* ── i18n ──────────────────────────────────────────────────────────────────── */
const I18N = {
  ar: {
    tagline: 'جسر بيانات Odoo — بدون API',
    agents: 'سجلات', metrics: 'موديلات', netSamples: 'التقاطات',
    apiUrl: 'رابط الـ WFM API', email: 'البريد الإلكتروني',
    password: 'كلمة المرور <span style="color:#4b566e">(تُستخدم مرة واحدة)</span>',
    autoSync: 'تفعيل المزامنة التلقائية',
    saveLogin: 'حفظ وتسجيل الدخول', copySamples: 'نسخ عيّنات البيانات',
    stOff: 'متوقّف', stOk: 'متصل ويزامن', stWait: 'بانتظار البيانات',
    subOff: 'فعّل المزامنة للبدء', subOk: 'يزامن Odoo تلقائيًا', subWait: 'افتح Odoo وتصفّح Supervisor Requests',
    notReady: 'غير مُهيّأ', loginToStart: 'سجّل الدخول لبدء المزامنة',
    lastPush: 'آخر إرسال', lastRead: 'آخر قراءة',
    loggingIn: '...جارٍ تسجيل الدخول',
    loginOk: '✅ <b>تم تسجيل الدخول</b> — افتح Odoo وستبدأ المزامنة',
    loginFail: 'فشل تسجيل الدخول',
    copied: '✓ تم النسخ — الصقها في الشات',
    agoNow: (s) => `قبل ${s}ث`, agoMin: (m) => `قبل ${m}د`, agoHr: (h) => `قبل ${h}س`,
  },
  en: {
    tagline: 'Odoo data bridge — no API',
    agents: 'records', metrics: 'models', netSamples: 'captures',
    apiUrl: 'WFM API URL', email: 'Email',
    password: 'Password <span style="color:#4b566e">(used once)</span>',
    autoSync: 'Enable auto-sync',
    saveLogin: 'Save & sign in', copySamples: 'Copy data samples',
    stOff: 'Paused', stOk: 'Connected & syncing', stWait: 'Awaiting data',
    subOff: 'Enable sync to start', subOk: 'Syncing Odoo automatically', subWait: 'Open Odoo → browse Supervisor Requests',
    notReady: 'Not configured', loginToStart: 'Sign in to start syncing',
    lastPush: 'Last push', lastRead: 'Last read',
    loggingIn: 'Signing in…',
    loginOk: '✅ <b>Signed in</b> — open Odoo and sync will begin',
    loginFail: 'Sign-in failed',
    copied: '✓ Copied — paste it in chat',
    agoNow: (s) => `${s}s ago`, agoMin: (m) => `${m}m ago`, agoHr: (h) => `${h}h ago`,
  },
};
let lang = 'ar';
const T = () => I18N[lang];

const $ = (id) => document.getElementById(id);
const ago = (ts) => {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return T().agoNow(s);
  if (s < 3600) return T().agoMin(Math.round(s / 60));
  return T().agoHr(Math.round(s / 3600));
};

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  $('langBtn').textContent = lang === 'ar' ? 'EN' : 'ع';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.innerHTML = T()[el.getAttribute('data-i18n')] ?? el.innerHTML; });
}

async function load() {
  const st = await chrome.runtime.sendMessage({ type: 'GET_STATUS' }).catch(() => null);
  if (!st) return;
  const c = st.config || {};
  if (!$('apiUrl').value) $('apiUrl').value = c.wfmApiUrl || 'http://localhost:3000/api/v1';
  if (!$('email').value)  $('email').value = c.wfmEmail || '';
  $('enabled').checked = c.enabled !== false;
  render(st);
}

function render(st) {
  const enabled = st.config?.enabled !== false;
  const ok = st.lastPushStatus === 'ok';
  const snap = st.lastSnapshot || {};
  const records = snap.count ?? st.recordCount ?? 0;
  const models = snap.models?.length ?? 0;
  const captures = snap.captures?.length ?? 0;
  const t = T();

  const pill = $('pill');
  pill.className = 'pill ' + (!enabled ? 's-off' : ok ? 's-ok' : 's-err');
  $('pillLbl').textContent = !enabled ? t.stOff : ok ? t.stOk : (st.lastPushStatus === 'never' || !st.lastPushStatus ? t.notReady : t.stWait);
  $('pillSub').textContent = !enabled ? t.subOff : ok ? t.subOk : t.subWait;
  $('pillWhen').innerHTML = st.lastPushAt ? `${t.lastPush}<br>${ago(st.lastPushAt)}` : (st.lastSnapshotAt ? `${t.lastRead}<br>${ago(st.lastSnapshotAt)}` : '');

  $('stAgents').textContent = records;
  $('stKpis').textContent = models;
  $('stNet').textContent = captures;
  $('src').textContent = st.odooUrl || '';
}

$('langBtn').onclick = async () => { lang = lang === 'ar' ? 'en' : 'ar'; await chrome.storage.local.set({ popupLang: lang }); applyLang(); load(); };

$('save').onclick = async () => {
  const config = { wfmApiUrl: $('apiUrl').value.trim().replace(/\/$/, ''), wfmEmail: $('email').value.trim(), wfmPassword: $('password').value, wfmApiToken: '', enabled: $('enabled').checked };
  $('hint').innerHTML = `<b>${T().loggingIn}</b>`;
  await chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config });
  $('password').value = '';
  const res = await chrome.runtime.sendMessage({ type: 'TEST_LOGIN' }).catch(() => ({ ok: false }));
  $('hint').innerHTML = res.ok ? T().loginOk : `❌ ${res.error || T().loginFail}`;
  setTimeout(load, 1200);
};

$('enabled').onchange = async () => {
  const st = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  const config = { ...(st.config || {}), enabled: $('enabled').checked };
  await chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config });
  render({ ...st, config });
};

$('copy').onclick = async () => {
  const st = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  const s = st.lastSnapshot || {};
  // sample: model names + up to 3 records each, so the exact Odoo field shape can be finalized
  const sample = (s.captures || []).map((c) => ({ model: c.model, method: c.method, count: (c.records || []).length, sample: (c.records || []).slice(0, 3) }));
  const payload = JSON.stringify({ capturedAt: s.capturedAt ?? null, models: s.models ?? [], captures: sample }, null, 2);
  await navigator.clipboard.writeText(payload).catch(() => {});
  const btn = $('copy'); const orig = btn.innerHTML; btn.innerHTML = T().copied; setTimeout(() => (btn.innerHTML = orig), 1800);
};

(async () => {
  const { popupLang } = await chrome.storage.local.get('popupLang').catch(() => ({}));
  lang = popupLang === 'en' ? 'en' : 'ar';
  applyLang();
  load();
  setInterval(load, 3000);
})();

/* ── Bridge Doctor — 6-stage self-diagnosis ──────────────────────────────────── */
function runDoctor(st) {
  const a = lang === 'ar';
  const c = st.config || {}, snap = st.lastSnapshot || {};
  const records = snap.count ?? 0, models = snap.models?.length ?? 0;
  const authBad = /401|AUTH|login/i.test(st.lastPushStatus || '');
  return [
    { ok: c.enabled !== false, label: a ? 'المزامنة مفعّلة' : 'Sync enabled', fix: a ? 'فعّل «تفعيل المزامنة التلقائية»' : 'Enable auto-sync' },
    { ok: !!st.connected || !!st.odooUrl, label: a ? 'تبويب Odoo مفتوح' : 'Odoo tab open', fix: a ? 'افتح Odoo (نفس المتصفّح) وثبّت التبويب' : 'Open Odoo in this browser + pin the tab' },
    { ok: models > 0, label: a ? 'يلتقط بيانات Odoo' : 'Capturing Odoo data', fix: a ? 'تصفّح Supervisor Requests (Sick / Extra Hours / Comp / Permissions) — الالتقاط يصير وقت تفتح القوائم' : 'Browse Supervisor Requests (Sick/Extra Hours/Comp/Permissions) — capture happens as lists load' },
    { ok: records > 0, label: a ? 'سجلات مقروءة' : 'Records parsed', fix: a ? 'ما انقرأت سجلات — اضغط «نسخ العيّنات» وأرسلها' : 'No records parsed — click Copy samples and send it' },
    { ok: (st.hasToken || st.hasRefreshToken) && !authBad, label: a ? 'مصادقة WFM' : 'WFM auth', fix: a ? 'سجّل الدخول من جديد (إيميل + باسورد)' : 'Sign in again (email + password)' },
    { ok: st.lastPushStatus === 'ok', label: a ? 'الإرسال للسيرفر' : 'Backend push', fix: st.lastPushStatus === 'never' ? (a ? 'ما أرسل بعد — انتظر أو اضغط «فحص حي»' : 'Never pushed — wait or Live check') : (a ? 'خطأ: ' + st.lastPushStatus : 'Error: ' + st.lastPushStatus) },
  ];
}

(function initDoctor() {
  const host = document.createElement('div');
  host.style.cssText = 'margin:10px 16px 14px;border-top:1px solid #1e2740;padding-top:10px';
  host.innerHTML = '<button id="docBtn" style="width:100%;padding:8px;border-radius:8px;border:1px solid #2a3550;background:transparent;color:#9fb0c3;cursor:pointer;font-size:12.5px">🩺 Doctor</button><div id="docPanel" style="display:none;margin-top:8px"></div>';
  document.body.appendChild(host);
  const panel = host.querySelector('#docPanel');
  async function render() {
    const st = await chrome.runtime.sendMessage({ type: 'GET_STATUS' }).catch(() => null);
    if (!st) return;
    const a = lang === 'ar';
    const stages = runDoctor(st);
    const bad = stages.findIndex((x) => !x.ok);
    const rows = stages.map((x, i) => `<div style="display:flex;gap:7px;align-items:flex-start;font-size:12px;padding:3px 0;color:${x.ok ? '#8aa0b8' : (i === bad ? '#f0a154' : '#5a6b82')}"><span>${x.ok ? '✅' : (i === bad ? '⚠️' : '⬜')}</span><div><b>${x.label}</b>${(!x.ok && i === bad) ? `<br><span style="color:#c9a35b">${x.fix}</span>` : ''}</div></div>`).join('');
    const verdict = bad < 0 ? (a ? '✅ كل شي شغّال' : '✅ All systems go') : (a ? 'أول مشكلة: ' : 'First blocker: ') + stages[bad].label;
    panel.innerHTML = `<div style="font-weight:700;font-size:12.5px;margin-bottom:6px;color:${bad < 0 ? '#22c55e' : '#f0a154'}">${verdict}</div>${rows}<div style="display:flex;gap:6px;margin-top:8px"><button id="docLive" style="flex:1;padding:6px;border-radius:7px;border:none;background:#c9a35b;color:#12191f;font-weight:600;cursor:pointer;font-size:11.5px">${a ? 'فحص حي' : 'Live check'}</button><button id="docCopy" style="flex:1;padding:6px;border-radius:7px;border:1px solid #2a3550;background:transparent;color:#9fb0c3;cursor:pointer;font-size:11.5px">${a ? 'نسخ التقرير' : 'Copy report'}</button></div>`;
    panel.querySelector('#docLive').onclick = async () => { panel.querySelector('#docLive').textContent = '…'; await chrome.runtime.sendMessage({ type: 'PUSH_NOW' }).catch(() => {}); setTimeout(render, 1000); };
    panel.querySelector('#docCopy').onclick = async () => { const rep = 'WFM Odoo Bridge Doctor\n' + stages.map((x) => (x.ok ? '[OK] ' : '[XX] ') + x.label).join('\n') + `\nlastPush=${st.lastPushStatus} records=${st.lastSnapshot?.count ?? 0} models=${(st.lastSnapshot?.models || []).join(',')} url=${st.odooUrl || ''}`; await navigator.clipboard.writeText(rep).catch(() => {}); panel.querySelector('#docCopy').textContent = '✓'; };
  }
  host.querySelector('#docBtn').onclick = () => { const open = panel.style.display === 'none'; panel.style.display = open ? 'block' : 'none'; if (open) render(); };
})();
