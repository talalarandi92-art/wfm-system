'use strict';

/* ── i18n ──────────────────────────────────────────────────────────────────── */
const I18N = {
  ar: {
    tagline: 'جسر المراقبة المباشرة للمكالمات',
    agents: 'وكلاء', metrics: 'مؤشرات', netSamples: 'عيّنات شبكة',
    apiUrl: 'رابط الـ WFM API', email: 'البريد الإلكتروني',
    password: 'كلمة المرور <span style="color:#4b566e">(تُستخدم مرة واحدة)</span>',
    autoSync: 'تفعيل المزامنة التلقائية',
    saveLogin: 'حفظ وتسجيل الدخول', copySamples: 'نسخ عيّنات البيانات',
    // dynamic
    stOff: 'متوقّف', stOk: 'متصل ويزامن', stWait: 'بانتظار البيانات',
    subOff: 'فعّل المزامنة للبدء', subOk: 'يُرسل كل 8 ثوانٍ', subWait: 'افتح شاشة Ameyo Live Monitoring',
    notReady: 'غير مُهيّأ', loginToStart: 'سجّل الدخول لبدء المزامنة',
    lastPush: 'آخر إرسال', lastRead: 'آخر قراءة',
    loggingIn: '...جارٍ تسجيل الدخول',
    loginOk: '✅ <b>تم تسجيل الدخول</b> — افتح شاشة Ameyo وستبدأ المزامنة',
    loginFail: 'فشل تسجيل الدخول',
    copied: '✓ تم النسخ — الصقها في الشات',
    agoNow: (s) => `قبل ${s}ث`, agoMin: (m) => `قبل ${m}د`, agoHr: (h) => `قبل ${h}س`,
  },
  en: {
    tagline: 'Live call-monitoring bridge',
    agents: 'agents', metrics: 'metrics', netSamples: 'net samples',
    apiUrl: 'WFM API URL', email: 'Email',
    password: 'Password <span style="color:#4b566e">(used once)</span>',
    autoSync: 'Enable auto-sync',
    saveLogin: 'Save & sign in', copySamples: 'Copy data samples',
    stOff: 'Paused', stOk: 'Connected & syncing', stWait: 'Awaiting data',
    subOff: 'Enable sync to start', subOk: 'Sending every 8s', subWait: 'Open Ameyo Live Monitoring',
    notReady: 'Not configured', loginToStart: 'Sign in to start syncing',
    lastPush: 'Last push', lastRead: 'Last read',
    loggingIn: 'Signing in…',
    loginOk: '✅ <b>Signed in</b> — open Ameyo and sync will begin',
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
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.innerHTML = T()[el.getAttribute('data-i18n')] ?? el.innerHTML;
  });
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
  const agents = snap.agents?.length ?? st.agentCount ?? 0;
  const kpis = snap.kpis ? Object.keys(snap.kpis).length : 0;
  const net = snap.discovery?.length ?? 0;
  const t = T();

  const pill = $('pill');
  pill.className = 'pill ' + (!enabled ? 's-off' : ok ? 's-ok' : 's-err');
  $('pillLbl').textContent = !enabled ? t.stOff : ok ? t.stOk : (st.lastPushStatus === 'never' || !st.lastPushStatus ? t.notReady : t.stWait);
  $('pillSub').textContent = !enabled ? t.subOff : ok ? t.subOk : t.subWait;
  $('pillWhen').innerHTML = st.lastPushAt
    ? `${t.lastPush}<br>${ago(st.lastPushAt)}`
    : (st.lastSnapshotAt ? `${t.lastRead}<br>${ago(st.lastSnapshotAt)}` : '');

  $('stAgents').textContent = agents;
  $('stKpis').textContent = kpis;
  $('stNet').textContent = net;
  $('src').textContent = st.ameyoUrl || '';
}

$('langBtn').onclick = async () => {
  lang = lang === 'ar' ? 'en' : 'ar';
  await chrome.storage.local.set({ popupLang: lang });
  applyLang();
  load();
};

$('save').onclick = async () => {
  const config = {
    wfmApiUrl: $('apiUrl').value.trim().replace(/\/$/, ''),
    wfmEmail: $('email').value.trim(),
    wfmPassword: $('password').value,
    wfmApiToken: '',
    enabled: $('enabled').checked,
  };
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
  const payload = JSON.stringify({
    capturedAt: s.capturedAt ?? null,
    kpis: s.kpis ?? {},
    agents: s.agents ?? [],
    discovery: s.discovery ?? [],
  }, null, 2);
  await navigator.clipboard.writeText(payload).catch(() => {});
  const btn = $('copy');
  const orig = btn.innerHTML;
  btn.innerHTML = T().copied;
  setTimeout(() => (btn.innerHTML = orig), 1800);
};

(async () => {
  const { popupLang } = await chrome.storage.local.get('popupLang').catch(() => ({}));
  lang = popupLang === 'en' ? 'en' : 'ar';
  applyLang();
  load();
  setInterval(load, 3000);
})();

/* ── Bridge Doctor — 6-stage self-diagnosis so the user never needs DevTools ─────── */
function runDoctor(st) {
  const a = lang === 'ar';
  const c = st.config || {}, snap = st.lastSnapshot || {};
  const agents = snap.agents?.length ?? 0;
  const parsed = agents + (snap.kpis ? Object.keys(snap.kpis).length : 0);
  const authBad = /401|AUTH|login/i.test(st.lastPushStatus || '');
  return [
    { ok: c.enabled !== false, label: a ? 'المزامنة مفعّلة' : 'Sync enabled', fix: a ? 'فعّل «تفعيل المزامنة التلقائية»' : 'Enable auto-sync' },
    { ok: !!st.connected || !!st.ameyoUrl, label: a ? 'تبويب Ameyo مفتوح' : 'Ameyo tab open', fix: a ? 'افتح شاشة Ameyo Live Monitoring وثبّت التبويب (Pin)' : 'Open + pin the Ameyo Live-Monitoring tab' },
    { ok: (snap.discovery?.length ?? 0) > 0 || agents > 0, label: a ? 'يلتقط بيانات' : 'Capturing data', fix: a ? 'تأكّد إنك بصفحة المراقبة المباشرة نفسها' : 'Make sure you are on the Live-Monitoring page itself' },
    { ok: parsed > 0, label: a ? 'يقرأ الوكلاء/المؤشرات' : 'Agents/KPIs parsed', fix: a ? 'الجدول ما انقرأ — اضغط «نسخ العيّنات» وأرسلها للشات' : 'Table not parsed — click Copy samples and send it in chat' },
    { ok: (st.hasToken || st.hasRefreshToken) && !authBad, label: a ? 'مصادقة WFM' : 'WFM auth', fix: a ? 'سجّل الدخول من جديد (إيميل + باسورد)' : 'Sign in again (email + password)' },
    { ok: st.lastPushStatus === 'ok', label: a ? 'الإرسال للسيرفر' : 'Backend push', fix: st.lastPushStatus === 'never' ? (a ? 'ما أرسل بعد — انتظر أو اضغط «فحص حي»' : 'Never pushed — wait or click Live check') : (a ? 'خطأ: ' + st.lastPushStatus : 'Error: ' + st.lastPushStatus) },
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
    panel.querySelector('#docCopy').onclick = async () => { const rep = 'WFM Ameyo Bridge Doctor\n' + stages.map((x) => (x.ok ? '[OK] ' : '[XX] ') + x.label).join('\n') + `\nlastPush=${st.lastPushStatus} agents=${st.lastSnapshot?.agents?.length ?? 0} url=${st.ameyoUrl || ''}`; await navigator.clipboard.writeText(rep).catch(() => {}); panel.querySelector('#docCopy').textContent = '✓'; };
  }
  host.querySelector('#docBtn').onclick = () => { const open = panel.style.display === 'none'; panel.style.display = open ? 'block' : 'none'; if (open) render(); };
})();
