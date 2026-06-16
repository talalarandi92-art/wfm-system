'use strict';

/* ── i18n ──────────────────────────────────────────────────────────────────── */
const I18N = {
  ar: {
    tagline: 'Sprinklr ← → منصة WFM',
    waiting: 'في الانتظار', queues: 'طوابير', availNow: 'متاح الآن',
    available: 'متاح', busy: 'مشغول', break: 'استراحة', offline: 'غير متصل',
    tabQueues: 'الطوابير', tabAgents: 'الموظفين',
    pushBtn: '↑ إرسال', settings: '⚙ الإعدادات', apiUrlLbl: 'WFM API URL',
    autoLoginDiv: 'تسجيل دخول تلقائي (موصى به)', emailLbl: 'البريد الإلكتروني', passwordLbl: 'كلمة المرور',
    passwordHint: '🔒 كلمة المرور تُستخدم مرة واحدة فقط ثم تُحذف نهائياً — التجديد التلقائي يتم عبر refresh token آمن. لو انقطع التجديد ستظهر شارة AUTH وتعيد إدخالها مرة واحدة.',
    manualTokenDiv: 'أو token يدوي', saveTest: 'حفظ + اختبار الاتصال',
    tokenPh: 'يُملأ تلقائياً عند تسجيل الدخول',
    // dynamic
    connected: '<strong>متصل</strong> — سبرينكلر نشط',
    disconnected: (t) => `<strong>انقطع الاتصال</strong> — آخر نشاط ${t}`,
    notConnected: '<strong>غير متصل</strong> — افتح سبرينكلر في تاب',
    extError: '<strong>خطأ</strong> — الإضافة غير نشطة',
    pushOk: '✓ يُرسل بنجاح', pushNever: 'لم يُرسل بعد', pushBad: (s) => `✗ ${s}`,
    chipNames: '👤 كاش الأسماء', chipQueues: '📦 كاش الطوابير',
    lastPush: (t) => `آخر إرسال ${t}`, lastSnap: (t) => `آخر لقطة ${t}`,
    qWaiting: 'انتظار', qActive: 'جارية', qAgents: 'متاح',
    emptyQTitle: 'لم تُكتشف طوابير بعد', emptyQSub: 'افتح Supervisor Console في سبرينكلر — الطوابير تُحفظ في الكاش وتبقى ظاهرة',
    emptyATitle: 'لا توجد أسماء بعد', emptyASub: 'تنقّل بين الـ views في Supervisor Console لتجميع الأسماء',
    enable: 'تفعيل', pause: 'إيقاف مؤقت',
    saving: '⏳ جاري الحفظ والاختبار...',
    saveLoginOk: '✅ تسجيل الدخول ناجح — كلمة المرور حُذفت والتجديد تلقائي عبر refresh token',
    saveTokenOk: '✅ تم الحفظ بالـ token اليدوي (ينتهي خلال 15 دقيقة — يُفضل البريد وكلمة المرور)',
    saveFail: (e) => `✗ ${e || 'فشل تسجيل الدخول — تحقق من البيانات'}`,
    pushSent: '✓ أُرسل', pushFail: '✗ فشل',
    stAvailable: 'متاح', stIdle: 'خامل', stBusy: 'مشغول', stBreak: 'استراحة', stAway: 'استراحة', stOffline: 'غير متصل', stUnknown: '—',
    agoNow: 'الآن', agoSec: (s) => `${s}ث`, agoMin: (m) => `${m}د`, agoHr: (h) => `${h}س`,
  },
  en: {
    tagline: 'Sprinklr ← → WFM Platform',
    waiting: 'Waiting', queues: 'Queues', availNow: 'Available now',
    available: 'Available', busy: 'Busy', break: 'Break', offline: 'Offline',
    tabQueues: 'Queues', tabAgents: 'Agents',
    pushBtn: '↑ Push', settings: '⚙ Settings', apiUrlLbl: 'WFM API URL',
    autoLoginDiv: 'Auto sign-in (recommended)', emailLbl: 'Email', passwordLbl: 'Password',
    passwordHint: '🔒 The password is used once then permanently wiped — renewal is automatic via a secure refresh token. If renewal breaks, an AUTH badge appears and you re-enter it once.',
    manualTokenDiv: 'Or manual token', saveTest: 'Save + test connection',
    tokenPh: 'Auto-filled on sign-in',
    connected: '<strong>Connected</strong> — Sprinklr active',
    disconnected: (t) => `<strong>Disconnected</strong> — last activity ${t}`,
    notConnected: '<strong>Not connected</strong> — open Sprinklr in a tab',
    extError: '<strong>Error</strong> — extension inactive',
    pushOk: '✓ Pushing OK', pushNever: 'Not pushed yet', pushBad: (s) => `✗ ${s}`,
    chipNames: '👤 Names cache', chipQueues: '📦 Queues cache',
    lastPush: (t) => `Last push ${t}`, lastSnap: (t) => `Last snapshot ${t}`,
    qWaiting: 'Waiting', qActive: 'Active', qAgents: 'Avail',
    emptyQTitle: 'No queues detected yet', emptyQSub: 'Open the Supervisor Console in Sprinklr — queues are cached and stay visible',
    emptyATitle: 'No names yet', emptyASub: 'Switch between views in the Supervisor Console to collect names',
    enable: 'Enable', pause: 'Pause',
    saving: '⏳ Saving and testing...',
    saveLoginOk: '✅ Signed in — password wiped, renewal automatic via refresh token',
    saveTokenOk: '✅ Saved with manual token (expires in 15 min — email + password preferred)',
    saveFail: (e) => `✗ ${e || 'Sign-in failed — check your details'}`,
    pushSent: '✓ Sent', pushFail: '✗ Failed',
    stAvailable: 'Available', stIdle: 'Idle', stBusy: 'Busy', stBreak: 'Break', stAway: 'Break', stOffline: 'Offline', stUnknown: '—',
    agoNow: 'now', agoSec: (s) => `${s}s`, agoMin: (m) => `${m}m`, agoHr: (h) => `${h}h`,
  },
};
let lang = 'ar';
const T = () => I18N[lang];

const CH = {
  whatsapp: { icon: '📱', cls: 'whatsapp' }, chat: { icon: '💬', cls: 'chat' },
  email: { icon: '📧', cls: 'email' }, social: { icon: '📣', cls: 'social' },
  voice: { icon: '📞', cls: 'voice' }, unknown: { icon: '⬡', cls: 'unknown' },
};
const ST_COLOR = {
  available: '#22c55e', idle: '#84cc16', busy: '#f59e0b',
  break: '#818cf8', away: '#818cf8', offline: '#475569', unknown: '#475569',
};
const stLabel = (s) => {
  const k = { available: 'stAvailable', idle: 'stIdle', busy: 'stBusy', break: 'stBreak', away: 'stAway', offline: 'stOffline', unknown: 'stUnknown' }[s];
  return k ? T()[k] : s;
};

function fmtNum(n) {
  if (n == null || n === '—') return '—';
  return Number(n).toLocaleString('en-US');
}
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5)  return T().agoNow;
  if (s < 60) return T().agoSec(s);
  if (s < 3600) return T().agoMin(Math.round(s / 60));
  return T().agoHr(Math.round(s / 3600));
}

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.getElementById('langBtn').textContent = lang === 'ar' ? 'EN' : 'ع';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.innerHTML = T()[el.getAttribute('data-i18n')] ?? el.innerHTML;
  });
  const tok = document.getElementById('apiToken');
  if (tok) tok.placeholder = T().tokenPh;
}

/* ── Render ──────────────────────────────────────────────────────────────────── */
async function render(status) {
  const t = T();
  const snap = status?.lastSnapshot;

  const hero  = document.getElementById('heroBox');
  const ring  = document.getElementById('pulseRing');
  const stTxt = document.getElementById('statusText');
  const stTim = document.getElementById('statusTime');
  const meta  = document.getElementById('heroMeta');

  ring.className = 'pulse-ring';
  hero.className = 'hero';
  if (status?.connected) {
    ring.classList.add('connected'); hero.classList.add('connected');
    stTxt.innerHTML = t.connected;
  } else if (status?.lastHeartbeat) {
    ring.classList.add('warning'); hero.classList.add('warning');
    stTxt.innerHTML = t.disconnected(timeAgo(status.lastHeartbeat));
  } else {
    stTxt.innerHTML = t.notConnected;
  }
  if (status?.lastPushStatus && status.lastPushStatus !== 'ok' && status.lastPushStatus !== 'never') {
    ring.classList.add('error'); hero.classList.add('error');
  }
  stTim.textContent = status?.lastPushAt ? t.lastPush(timeAgo(status.lastPushAt)) : '';

  const { agentCache = {}, queueCache = {} } = await chrome.storage.local.get(['agentCache', 'queueCache']);
  const pushSt  = status?.lastPushStatus || 'never';
  const pushCls = pushSt === 'ok' ? 'ok' : (pushSt === 'never' ? '' : 'bad');
  const pushTxt = pushSt === 'ok' ? t.pushOk : (pushSt === 'never' ? t.pushNever : t.pushBad(pushSt));

  meta.innerHTML = `
    <span class="chip ${pushCls}">${pushTxt}</span>
    <span class="chip">${t.chipNames} <b>${Object.keys(agentCache).length}</b></span>
    <span class="chip">${t.chipQueues} <b>${Object.keys(queueCache).length}</b></span>
    ${snap?.captureMethod ? `<span class="chip">⚡ ${snap.captureMethod}</span>` : ''}
  `;

  const queues  = snap?.queues  || [];
  const agents  = snap?.agents  || [];
  const waiting = queues.reduce((s, q) => s + (q.waiting || 0), 0);
  const avail   = agents.filter(a => a.status === 'available' || a.status === 'idle').length;

  document.getElementById('kpiWaiting').textContent = fmtNum(waiting);
  document.getElementById('kpiQueues').textContent  = queues.length || '—';
  document.getElementById('kpiAvail').textContent   = fmtNum(avail);

  const busy    = agents.filter(a => a.status === 'busy').length;
  const onBreak = agents.filter(a => a.status === 'break' || a.status === 'away').length;
  const offline = agents.filter(a => a.status === 'offline' || a.status === 'unknown').length;
  const totalAg = Math.max(1, avail + busy + onBreak + offline);

  document.getElementById('agAvail').textContent   = avail;
  document.getElementById('agBusy').textContent    = busy;
  document.getElementById('agBreak').textContent   = onBreak;
  document.getElementById('agOffline').textContent = offline;

  document.getElementById('agBar').innerHTML = `
    <span class="ab-avail" style="width:${(avail   / totalAg) * 100}%"></span>
    <span class="ab-busy"  style="width:${(busy    / totalAg) * 100}%"></span>
    <span class="ab-break" style="width:${(onBreak / totalAg) * 100}%"></span>
    <span class="ab-off"   style="width:${(offline / totalAg) * 100}%"></span>
  `;

  document.getElementById('queueBadge').textContent = queues.length ? `(${queues.length})` : '';
  document.getElementById('agentBadge').textContent = agents.length ? `(${agents.length})` : '';

  const list = document.getElementById('queueList');
  if (!queues.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">📡</div><p>${t.emptyQTitle}</p><small>${t.emptyQSub}</small></div>`;
  } else {
    const sorted  = [...queues].sort((a, b) => (b.waiting || 0) - (a.waiting || 0));
    const maxWait = sorted[0]?.waiting || 1;
    list.innerHTML = sorted.map(q => {
      const ch     = CH[q.channel] || CH.unknown;
      const sla    = q.slaPct ?? 100;
      const isRisk = sla < 80 || (q.waiting || 0) > 50;
      const barPct = Math.min(100, Math.round(((q.waiting || 0) / maxWait) * 100));
      return `
        <div class="q-card${isRisk ? ' risk' : ''}">
          <div class="q-top">
            <div class="q-icon ${ch.cls}">${ch.icon}</div>
            <span class="q-name" title="${q.queueName}">${q.queueName}</span>
            <span class="q-sla${sla < 80 ? ' bad' : ''}">SLA ${sla}%</span>
          </div>
          <div class="q-stats">
            <div class="q-stat qs-waiting"><div class="q-stat-val">${fmtNum(q.waiting)}</div><div class="q-stat-lbl">${t.qWaiting}</div></div>
            <div class="q-stat qs-active"><div class="q-stat-val">${fmtNum(q.inProgress)}</div><div class="q-stat-lbl">${t.qActive}</div></div>
            <div class="q-stat qs-agents"><div class="q-stat-val">${fmtNum(q.agentsAvailable)}</div><div class="q-stat-lbl">${t.qAgents}</div></div>
          </div>
          <div class="q-bar"><div class="q-bar-fill${isRisk ? ' danger' : ''}" style="width:${barPct}%"></div></div>
        </div>`;
    }).join('');
  }

  const agList = document.getElementById('agentList');
  if (!agents.length) {
    agList.innerHTML = `<div class="empty"><div class="empty-icon">👥</div><p>${t.emptyATitle}</p><small>${t.emptyASub}</small></div>`;
  } else {
    const order  = { available: 0, idle: 1, busy: 2, break: 3, away: 3, offline: 4, unknown: 5 };
    const sorted = [...agents].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
                                            || a.agentName.localeCompare(b.agentName));
    agList.innerHTML = sorted.map(a => `
      <div class="a-row">
        <span class="a-dot" style="background:${ST_COLOR[a.status] || '#475569'}"></span>
        <span class="a-name" title="${a.agentName}">${a.agentName}</span>
        <span class="a-status" style="color:${ST_COLOR[a.status] || '#475569'}">${stLabel(a.status)}</span>
      </div>`).join('');
  }

  if (snap?.capturedAt) {
    const d = new Date(snap.capturedAt);
    document.getElementById('footerTime').textContent =
      t.lastSnap(d.toLocaleTimeString(lang === 'ar' ? 'ar-KW' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }

  const cfg = status?.config || {};
  document.getElementById('apiUrl').value      = cfg.wfmApiUrl   || 'http://localhost:3000/api/v1';
  document.getElementById('wfmEmail').value    = cfg.wfmEmail    || '';
  document.getElementById('wfmPassword').value = cfg.wfmPassword || '';
  document.getElementById('apiToken').value    = cfg.wfmApiToken || '';
  document.getElementById('toggleSyncBtn').textContent = cfg.enabled === false ? t.enable : t.pause;
}

/* ── Load & Poll ─────────────────────────────────────────────────────────────── */
async function refresh() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    render(status);
  } catch {
    document.getElementById('statusText').innerHTML = T().extError;
  }
}

/* ── Language toggle ─────────────────────────────────────────────────────────── */
document.getElementById('langBtn').addEventListener('click', async () => {
  lang = lang === 'ar' ? 'en' : 'ar';
  await chrome.storage.local.set({ popupLang: lang });
  applyLang();
  refresh();
});

/* ── Tabs ────────────────────────────────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('panelQueues').classList.toggle('hidden', tab !== 'queues');
    document.getElementById('panelAgents').classList.toggle('hidden', tab !== 'agents');
  });
});

document.getElementById('gearBtn').addEventListener('click', () => {
  document.getElementById('settingsPanel').classList.toggle('hidden');
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const t = T();
  const msg = document.getElementById('saveMsg');
  msg.className = 'save-msg';
  msg.textContent = t.saving;

  const config = {
    wfmApiUrl:   document.getElementById('apiUrl').value.trim().replace(/\/+$/, ''),
    wfmEmail:    document.getElementById('wfmEmail').value.trim(),
    wfmPassword: document.getElementById('wfmPassword').value,
    wfmApiToken: document.getElementById('apiToken').value.trim(),
    enabled:     true,
  };
  await chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config });

  const res = await chrome.runtime.sendMessage({ type: 'TEST_LOGIN' });
  if (res?.ok) {
    msg.className = 'save-msg ok'; msg.textContent = t.saveLoginOk;
  } else if (config.wfmApiToken && !config.wfmEmail) {
    msg.className = 'save-msg ok'; msg.textContent = t.saveTokenOk;
  } else {
    msg.className = 'save-msg err'; msg.textContent = t.saveFail(res?.error);
  }
  setTimeout(() => { msg.textContent = ''; }, 6000);
  refresh();
});

document.getElementById('toggleSyncBtn').addEventListener('click', async () => {
  const { config = {} } = await chrome.storage.local.get('config');
  config.enabled = !(config.enabled !== false);
  await chrome.storage.local.set({ config });
  refresh();
});

document.getElementById('pushNowBtn').addEventListener('click', async () => {
  const btn = document.getElementById('pushNowBtn');
  btn.textContent = '…';
  btn.disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'PUSH_NOW' });
  btn.textContent = res?.ok ? T().pushSent : T().pushFail;
  setTimeout(() => { btn.textContent = T().pushBtn; btn.disabled = false; }, 2000);
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  const btn = document.getElementById('refreshBtn');
  btn.style.transform = 'rotate(360deg)';
  btn.style.transition = 'transform .4s ease';
  setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 400);
  refresh();
});

/* ── Boot ────────────────────────────────────────────────────────────────────── */
(async () => {
  const { popupLang } = await chrome.storage.local.get('popupLang').catch(() => ({}));
  lang = popupLang === 'en' ? 'en' : 'ar';
  applyLang();
  refresh();
  setInterval(refresh, 4000);
})();
