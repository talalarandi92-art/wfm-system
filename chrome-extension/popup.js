'use strict';

const CH = {
  whatsapp: { icon: '📱', cls: 'whatsapp', label: 'WhatsApp' },
  chat:     { icon: '💬', cls: 'chat',     label: 'Chat'     },
  email:    { icon: '📧', cls: 'email',    label: 'Email'    },
  social:   { icon: '📣', cls: 'social',   label: 'Social'   },
  voice:    { icon: '📞', cls: 'voice',    label: 'Voice'    },
  unknown:  { icon: '⬡',  cls: 'unknown',  label: '—'        },
};

const ST_COLOR = {
  available: '#22c55e', idle: '#84cc16', busy: '#f59e0b',
  break: '#818cf8', away: '#818cf8', offline: '#475569', unknown: '#475569',
};
const ST_LABEL = {
  available: 'متاح', idle: 'خامل', busy: 'مشغول',
  break: 'استراحة', away: 'استراحة', offline: 'غير متصل', unknown: '—',
};

function fmtNum(n) {
  if (n == null || n === '—') return '—';
  return Number(n).toLocaleString('en-US');
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5)  return 'الآن';
  if (s < 60) return `${s}ث`;
  if (s < 3600) return `${Math.round(s / 60)}د`;
  return `${Math.round(s / 3600)}س`;
}

/* ── Render ──────────────────────────────────────────────────────────────────── */
async function render(status) {
  const snap = status?.lastSnapshot;

  // ── Hero status ──
  const hero  = document.getElementById('heroBox');
  const ring  = document.getElementById('pulseRing');
  const stTxt = document.getElementById('statusText');
  const stTim = document.getElementById('statusTime');
  const meta  = document.getElementById('heroMeta');

  ring.className = 'pulse-ring';
  hero.className = 'hero';
  if (status?.connected) {
    ring.classList.add('connected'); hero.classList.add('connected');
    stTxt.innerHTML = '<strong>متصل</strong> — سبرينكلر نشط';
  } else if (status?.lastHeartbeat) {
    ring.classList.add('warning'); hero.classList.add('warning');
    stTxt.innerHTML = `<strong>انقطع الاتصال</strong> — آخر نشاط ${timeAgo(status.lastHeartbeat)}`;
  } else {
    stTxt.innerHTML = '<strong>غير متصل</strong> — افتح سبرينكلر في تاب';
  }
  if (status?.lastPushStatus && status.lastPushStatus !== 'ok' && status.lastPushStatus !== 'never') {
    ring.classList.add('error'); hero.classList.add('error');
  }
  stTim.textContent = status?.lastPushAt ? `آخر إرسال ${timeAgo(status.lastPushAt)}` : '';

  // ── Hero meta chips: push status / caches / capture method ──
  const { agentCache = {}, queueCache = {} } = await chrome.storage.local.get(['agentCache', 'queueCache']);
  const cachedAgents = Object.keys(agentCache).length;
  const cachedQueues = Object.keys(queueCache).length;
  const pushSt  = status?.lastPushStatus || 'never';
  const pushCls = pushSt === 'ok' ? 'ok' : (pushSt === 'never' ? '' : 'bad');
  const pushTxt = pushSt === 'ok' ? '✓ يُرسل بنجاح' : (pushSt === 'never' ? 'لم يُرسل بعد' : `✗ ${pushSt}`);

  meta.innerHTML = `
    <span class="chip ${pushCls}">${pushTxt}</span>
    <span class="chip">👤 كاش الأسماء <b>${cachedAgents}</b></span>
    <span class="chip">📦 كاش الطوابير <b>${cachedQueues}</b></span>
    ${snap?.captureMethod ? `<span class="chip">⚡ ${snap.captureMethod}</span>` : ''}
  `;

  // ── KPIs ──
  const queues  = snap?.queues  || [];
  const agents  = snap?.agents  || [];
  const waiting = queues.reduce((s, q) => s + (q.waiting || 0), 0);
  const avail   = agents.filter(a => a.status === 'available' || a.status === 'idle').length;

  document.getElementById('kpiWaiting').textContent = fmtNum(waiting);
  document.getElementById('kpiQueues').textContent  = queues.length || '—';
  document.getElementById('kpiAvail').textContent   = fmtNum(avail);

  // ── Agent breakdown + bar ──
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

  // ── Badges ──
  document.getElementById('queueBadge').textContent = queues.length ? `(${queues.length})` : '';
  document.getElementById('agentBadge').textContent = agents.length ? `(${agents.length})` : '';

  // ── Queue list ──
  const list = document.getElementById('queueList');
  if (!queues.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📡</div>
        <p>لم تُكتشف طوابير بعد</p>
        <small>افتح Supervisor Console في سبرينكلر — الطوابير تُحفظ في الكاش وتبقى ظاهرة</small>
      </div>`;
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
            <div class="q-stat qs-waiting"><div class="q-stat-val">${fmtNum(q.waiting)}</div><div class="q-stat-lbl">انتظار</div></div>
            <div class="q-stat qs-active"><div class="q-stat-val">${fmtNum(q.inProgress)}</div><div class="q-stat-lbl">جارية</div></div>
            <div class="q-stat qs-agents"><div class="q-stat-val">${fmtNum(q.agentsAvailable)}</div><div class="q-stat-lbl">متاح</div></div>
          </div>
          <div class="q-bar"><div class="q-bar-fill${isRisk ? ' danger' : ''}" style="width:${barPct}%"></div></div>
        </div>`;
    }).join('');
  }

  // ── Agents list (real names from cache + live status) ──
  const agList = document.getElementById('agentList');
  if (!agents.length) {
    agList.innerHTML = `
      <div class="empty">
        <div class="empty-icon">👥</div>
        <p>لا توجد أسماء بعد</p>
        <small>تنقّل بين الـ views في Supervisor Console لتجميع الأسماء</small>
      </div>`;
  } else {
    const order  = { available: 0, idle: 1, busy: 2, break: 3, away: 3, offline: 4, unknown: 5 };
    const sorted = [...agents].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
                                            || a.agentName.localeCompare(b.agentName));
    agList.innerHTML = sorted.map(a => `
      <div class="a-row">
        <span class="a-dot" style="background:${ST_COLOR[a.status] || '#475569'}"></span>
        <span class="a-name" title="${a.agentName}">${a.agentName}</span>
        <span class="a-status" style="color:${ST_COLOR[a.status] || '#475569'}">${ST_LABEL[a.status] || a.status}</span>
      </div>`).join('');
  }

  // ── Footer ──
  if (snap?.capturedAt) {
    const d = new Date(snap.capturedAt);
    document.getElementById('footerTime').textContent =
      `آخر لقطة ${d.toLocaleTimeString('ar-KW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }

  // ── Config fields ──
  const cfg = status?.config || {};
  document.getElementById('apiUrl').value      = cfg.wfmApiUrl   || 'http://localhost:3000/api/v1';
  document.getElementById('wfmEmail').value    = cfg.wfmEmail    || '';
  document.getElementById('wfmPassword').value = cfg.wfmPassword || '';
  document.getElementById('apiToken').value    = cfg.wfmApiToken || '';
  document.getElementById('toggleSyncBtn').textContent = cfg.enabled === false ? 'تفعيل' : 'إيقاف مؤقت';
}

/* ── Load & Poll ─────────────────────────────────────────────────────────────── */
async function refresh() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    render(status);
  } catch {
    document.getElementById('statusText').innerHTML = '<strong>خطأ</strong> — الإضافة غير نشطة';
  }
}

refresh();
setInterval(refresh, 4000);

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

/* ── Settings toggle ─────────────────────────────────────────────────────────── */
document.getElementById('gearBtn').addEventListener('click', () => {
  document.getElementById('settingsPanel').classList.toggle('hidden');
});

/* ── Save config + test connection ───────────────────────────────────────────── */
document.getElementById('saveBtn').addEventListener('click', async () => {
  const msg = document.getElementById('saveMsg');
  msg.className = 'save-msg';
  msg.textContent = '⏳ جاري الحفظ والاختبار...';

  const config = {
    wfmApiUrl:   document.getElementById('apiUrl').value.trim().replace(/\/+$/, ''),
    wfmEmail:    document.getElementById('wfmEmail').value.trim(),
    wfmPassword: document.getElementById('wfmPassword').value,
    wfmApiToken: document.getElementById('apiToken').value.trim(),
    enabled:     true,
  };
  await chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config });

  // Test: if credentials provided, try login through background
  const res = await chrome.runtime.sendMessage({ type: 'TEST_LOGIN' });
  if (res?.ok) {
    msg.className = 'save-msg ok';
    msg.textContent = '✅ تسجيل الدخول ناجح — كلمة المرور حُذفت والتجديد تلقائي عبر refresh token';
  } else if (config.wfmApiToken && !config.wfmEmail) {
    msg.className = 'save-msg ok';
    msg.textContent = '✅ تم الحفظ بالـ token اليدوي (ينتهي خلال 15 دقيقة — يُفضل البريد وكلمة المرور)';
  } else {
    msg.className = 'save-msg err';
    msg.textContent = `✗ ${res?.error || 'فشل تسجيل الدخول — تحقق من البيانات'}`;
  }
  setTimeout(() => { msg.textContent = ''; }, 6000);
  refresh();
});

/* ── Toggle sync ─────────────────────────────────────────────────────────────── */
document.getElementById('toggleSyncBtn').addEventListener('click', async () => {
  const { config = {} } = await chrome.storage.local.get('config');
  config.enabled = !(config.enabled !== false);
  await chrome.storage.local.set({ config });
  refresh();
});

/* ── Push now ────────────────────────────────────────────────────────────────── */
document.getElementById('pushNowBtn').addEventListener('click', async () => {
  const btn = document.getElementById('pushNowBtn');
  btn.textContent = '…';
  btn.disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'PUSH_NOW' });
  btn.textContent = res?.ok ? '✓ أُرسل' : '✗ فشل';
  setTimeout(() => { btn.textContent = '↑ إرسال'; btn.disabled = false; }, 2000);
});

/* ── Refresh button ──────────────────────────────────────────────────────────── */
document.getElementById('refreshBtn').addEventListener('click', () => {
  const btn = document.getElementById('refreshBtn');
  btn.style.transform = 'rotate(360deg)';
  btn.style.transition = 'transform .4s ease';
  setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 400);
  refresh();
});
