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
