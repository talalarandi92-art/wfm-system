import { useState, useEffect, useCallback } from 'react';
import {
  Calendar as CalIcon, Plus, ChevronLeft, ChevronRight,
  Clock, MapPin, Users, BookOpen, Loader2, X, Check,
  ArrowRightLeft, Briefcase, Coffee, Bell,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useUiStore } from '../store/ui.store';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface CalEvent {
  id: string;
  title: string;
  eventType: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location?: string;
  description?: string;
  color?: string;
  status: string;
  createdByName?: string;
  attendees: { name: string; role: string; status: string }[];
}

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const EVENT_COLORS: Record<string, string> = {
  coaching:     '#818cf8',
  meeting:      '#34d399',
  shift_change: '#fbbf24',
  training:     '#f472b6',
  cross_skill:  '#fb923c',
  off:          '#64748b',
  leave:        '#94a3b8',
  general:      '#60a5fa',
};

const EVENT_ICONS: Record<string, any> = {
  coaching:     BookOpen,
  meeting:      Users,
  shift_change: ArrowRightLeft,
  training:     Briefcase,
  cross_skill:  ArrowRightLeft,
  off:          Coffee,
  general:      CalIcon,
};

const TYPE_LABELS_AR: Record<string, string> = {
  coaching:     'كوتشينج',
  meeting:      'اجتماع',
  shift_change: 'تغيير شيفت',
  training:     'تدريب',
  cross_skill:  'تغيير فنكشن',
  off:          'إجازة',
  general:      'عام',
};

const TYPE_LABELS_EN: Record<string, string> = {
  coaching:     'Coaching',
  meeting:      'Meeting',
  shift_change: 'Shift Change',
  training:     'Training',
  cross_skill:  'Cross-Skill',
  off:          'Off',
  general:      'General',
};

function typeLabel(type: string, ar: boolean) {
  return ar ? (TYPE_LABELS_AR[type] ?? type) : (TYPE_LABELS_EN[type] ?? type);
}

function fmt(iso: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString('ar-KW', opts ?? { hour: '2-digit', minute: '2-digit' });
}

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function firstDayOfMonth(y: number, m: number) {
  const d = new Date(y, m, 1).getDay(); // 0=Sun
  return d === 0 ? 6 : d - 1; // shift so Mon=0
}

/* ─── Mini event chip ─────────────────────────────────────────────────────── */
function EventChip({ ev, onClick }: { ev: CalEvent; onClick: () => void }) {
  const color = ev.color ?? EVENT_COLORS[ev.eventType] ?? '#60a5fa';
  const Icon  = EVENT_ICONS[ev.eventType] ?? CalIcon;
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      className="w-full text-start text-[10px] px-1.5 py-0.5 rounded truncate flex items-center gap-1 transition-opacity hover:opacity-90"
      style={{ background: `${color}22`, color, border: `1px solid ${color}30` }}>
      <Icon size={8} />{ev.title}
    </button>
  );
}

/* ─── Event detail modal ─────────────────────────────────────────────────── */
function EventModal({ event, dark, ar, onClose }: { event: CalEvent; dark: boolean; ar: boolean; onClose: () => void }) {
  const color = event.color ?? EVENT_COLORS[event.eventType] ?? '#60a5fa';
  const Icon  = EVENT_ICONS[event.eventType] ?? CalIcon;
  const surface = dark ? '#1e293b' : '#ffffff';
  const border  = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
  const textPri = dark ? '#e2e8f0' : '#0f172a';
  const textSec = dark ? '#64748b' : '#94a3b8';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl p-6 space-y-4" dir={ar ? 'rtl' : 'ltr'}
        style={{ background: surface, border: `1px solid ${border}` }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
              <Icon size={18} style={{ color }} />
            </div>
            <div>
              <div className="font-bold text-sm" style={{ color: textPri }}>{event.title}</div>
              <div className="text-xs px-2 py-0.5 rounded-full mt-0.5 inline-block"
                style={{ background: `${color}15`, color }}>
                {typeLabel(event.eventType, ar)}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="opacity-40 hover:opacity-100 transition-opacity">
            <X size={18} style={{ color: textPri }} />
          </button>
        </div>

        {/* Details */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5 text-sm" style={{ color: textSec }}>
            <Clock size={14} />
            <span>
              {new Date(event.startAt).toLocaleDateString('ar-KW', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' · '}
              {fmt(event.startAt)} – {fmt(event.endAt)}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2.5 text-sm" style={{ color: textSec }}>
              <MapPin size={14} /><span>{event.location}</span>
            </div>
          )}
          {event.description && (
            <div className="text-sm rounded-xl p-3" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', color: textSec }}>
              {event.description}
            </div>
          )}
        </div>

        {/* Attendees */}
        {event.attendees.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: textSec }}>
              {ar ? 'الحاضرون' : 'Attendees'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {event.attendees.map((a, i) => (
                <span key={i} className="text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5"
                  style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', color: textPri }}>
                  {a.status === 'accepted' && <Check size={9} style={{ color: '#22c55e' }} />}
                  {a.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Status */}
        <div className="flex items-center justify-between pt-2 border-t"
          style={{ borderColor: border }}>
          <span className="text-xs px-2.5 py-1 rounded-full"
            style={{
              background: event.status === 'completed' ? 'rgba(34,197,94,0.1)' : event.status === 'cancelled' ? 'rgba(239,68,68,0.1)' : 'rgba(251,191,36,0.1)',
              color: event.status === 'completed' ? '#22c55e' : event.status === 'cancelled' ? '#ef4444' : '#fbbf24',
            }}>
            {event.status === 'completed' ? (ar ? 'مكتمل' : 'Completed') :
             event.status === 'cancelled' ? (ar ? 'ملغي' : 'Cancelled') :
             (ar ? 'مجدول' : 'Scheduled')}
          </span>
          {event.createdByName && (
            <span className="text-xs" style={{ color: textSec }}>
              {ar ? 'بواسطة' : 'by'} {event.createdByName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Create Event modal ─────────────────────────────────────────────────── */
function CreateEventModal({ date, dark, ar, onClose, onCreated }: { date: string; dark: boolean; ar: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm]   = useState({ title: '', eventType: 'general', startTime: '09:00', endTime: '10:00', location: '', description: '' });
  const [saving, setSaving] = useState(false);
  const surface = dark ? '#1e293b' : '#ffffff';
  const border  = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
  const textPri = dark ? '#e2e8f0' : '#0f172a';
  const textSec = dark ? '#64748b' : '#94a3b8';
  const inputBg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';

  const handleSave = async () => {
    if (!form.title) return;
    setSaving(true);
    try {
      await apiClient.post('/calendar/events', {
        title: form.title,
        eventType: form.eventType,
        startAt: `${date}T${form.startTime}:00`,
        endAt:   `${date}T${form.endTime}:00`,
        location: form.location || null,
        description: form.description || null,
      });
      onCreated();
      onClose();
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl p-5 space-y-4" dir={ar ? 'rtl' : 'ltr'}
        style={{ background: surface, border: `1px solid ${border}` }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="font-bold text-sm" style={{ color: textPri }}>
            {ar ? 'إضافة حدث' : 'New Event'} — {date}
          </span>
          <button onClick={onClose}><X size={16} style={{ color: textSec }} /></button>
        </div>

        {[
          { label: ar ? 'العنوان' : 'Title', key: 'title', type: 'text' },
          { label: ar ? 'المكان' : 'Location', key: 'location', type: 'text' },
        ].map(({ label, key, type }) => (
          <div key={key}>
            <label className="text-xs mb-1 block" style={{ color: textSec }}>{label}</label>
            <input type={type} value={(form as any)[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={{ background: inputBg, border: `1px solid ${border}`, color: textPri }} />
          </div>
        ))}

        <div>
          <label className="text-xs mb-1 block" style={{ color: textSec }}>{ar ? 'النوع' : 'Type'}</label>
          <select value={form.eventType}
            onChange={e => setForm(f => ({ ...f, eventType: e.target.value }))}
            className="w-full rounded-xl px-3 py-2 text-sm outline-none"
            style={{ background: inputBg, border: `1px solid ${border}`, color: textPri }}>
            {Object.keys(TYPE_LABELS_AR).map(v => (
              <option key={v} value={v}>{typeLabel(v, ar)}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: ar ? 'من' : 'From', key: 'startTime' },
            { label: ar ? 'إلى' : 'To',   key: 'endTime'   },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="text-xs mb-1 block" style={{ color: textSec }}>{label}</label>
              <input type="time" value={(form as any)[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: inputBg, border: `1px solid ${border}`, color: textPri }} />
            </div>
          ))}
        </div>

        <button onClick={handleSave} disabled={!form.title || saving}
          className="w-full py-2.5 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #818cf8, #6366f1)', color: '#fff' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {ar ? 'حفظ' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Calendar Page
═══════════════════════════════════════════════════════════════════════════ */
export default function CalendarPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  const [today]      = useState(new Date());
  const [viewYear,  setYear]  = useState(today.getFullYear());
  const [viewMonth, setMonth] = useState(today.getMonth());
  const [events,    setEvents]  = useState<CalEvent[]>([]);
  const [notifs,    setNotifs]  = useState<Notification[]>([]);
  const [loading,   setLoading] = useState(false);
  const [selected,  setSelected] = useState<CalEvent | null>(null);
  const [creating,  setCreating] = useState<string | null>(null); // date string
  const [showNotifs,setShowNotifs] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'list'>('month');

  const surface   = dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.9)';
  const border    = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
  const textPri   = dark ? '#e2e8f0' : '#0f172a';
  const textSec   = dark ? '#475569' : '#94a3b8';
  const textMuted = dark ? '#334155' : '#cbd5e1';

  const MONTH_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const MONTH_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_AR   = ['إث','ثل','أر','خم','جم','سب','أح'];
  const DAY_EN   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const from = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-01`;
    const lastDay = daysInMonth(viewYear, viewMonth);
    const to   = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    try {
      const { data } = await apiClient.get('/calendar/events', { params: { from, to } });
      setEvents(Array.isArray(data) ? data : []);
    } catch { setEvents([]); }
    setLoading(false);
  }, [viewYear, viewMonth]);

  const loadNotifs = useCallback(async () => {
    try {
      const [{ data: notifData }, { data: countData }] = await Promise.all([
        apiClient.get('/notifications', { params: { limit: 20 } }),
        apiClient.get('/notifications/unread-count'),
      ]);
      setNotifs(Array.isArray(notifData) ? notifData : []);
      setUnreadCount(countData?.count ?? 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { loadNotifs(); }, [loadNotifs]);

  const markRead = async (id: string) => {
    await apiClient.patch(`/notifications/${id}/read`).catch(() => {});
    setNotifs(n => n.map(x => x.id === id ? { ...x, isRead: true } : x));
    setUnreadCount(c => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await apiClient.patch('/notifications/read-all').catch(() => {});
    setNotifs(n => n.map(x => ({ ...x, isRead: true })));
    setUnreadCount(0);
  };

  const prevMonth = () => { if (viewMonth === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  // Group events by date
  const eventsByDate: Record<string, CalEvent[]> = {};
  for (const ev of events) {
    const d = ev.startAt.slice(0, 10);
    (eventsByDate[d] = eventsByDate[d] ?? []).push(ev);
  }

  // Calendar grid
  const numDays  = daysInMonth(viewYear, viewMonth);
  const firstDay = firstDayOfMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: numDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = today.toISOString().slice(0, 10);

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.2)' }}>
            <CalIcon size={18} style={{ color: '#34d399' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: textPri }}>{ar ? 'التقويم' : 'Calendar'}</h1>
            <p className="text-xs" style={{ color: textSec }}>
              {ar ? 'الجداول، الكوتشينج، الاجتماعات' : 'Shifts, Coaching & Meetings'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Notification bell */}
          <div className="relative">
            <button onClick={() => setShowNotifs(v => !v)}
              className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all"
              style={{ background: surface, border: `1px solid ${border}` }}>
              <Bell size={16} style={{ color: textSec }} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
                  style={{ background: '#ef4444', color: '#fff' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Notification dropdown */}
            {showNotifs && (
              <div className="absolute top-11 end-0 w-80 rounded-2xl z-40 shadow-xl overflow-hidden"
                style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${border}` }}>
                <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: border }}>
                  <span className="text-xs font-bold" style={{ color: textPri }}>
                    {ar ? 'الإشعارات' : 'Notifications'}
                  </span>
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-[10px]" style={{ color: '#818cf8' }}>
                      {ar ? 'قراءة الكل' : 'Mark all read'}
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifs.length === 0 ? (
                    <div className="py-8 text-center text-xs" style={{ color: textSec }}>
                      {ar ? 'لا توجد إشعارات' : 'No notifications'}
                    </div>
                  ) : notifs.map(n => (
                    <div key={n.id}
                      onClick={() => !n.isRead && markRead(n.id)}
                      className="px-4 py-3 cursor-pointer transition-colors"
                      style={{
                        background: n.isRead ? 'transparent' : (dark ? 'rgba(129,140,248,0.06)' : 'rgba(129,140,248,0.04)'),
                        borderBottom: `1px solid ${border}`,
                      }}>
                      {!n.isRead && <div className="w-1.5 h-1.5 rounded-full mb-1" style={{ background: '#818cf8' }} />}
                      <div className="text-xs font-semibold" style={{ color: textPri }}>{n.title}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: textSec }}>{n.body}</div>
                      <div className="text-[9px] mt-1" style={{ color: textMuted }}>
                        {new Date(n.createdAt).toLocaleString(ar ? 'ar-KW' : 'en', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* View toggle */}
          <div className="flex gap-1 rounded-xl p-1" style={{ background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
            {(['month','list'] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)}
                className="text-xs px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: viewMode === v ? (dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
                  color: viewMode === v ? textPri : textSec,
                }}>
                {v === 'month' ? (ar ? 'شهر' : 'Month') : (ar ? 'قائمة' : 'List')}
              </button>
            ))}
          </div>

          {/* New event */}
          <button onClick={() => setCreating(todayStr)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl font-semibold transition-all"
            style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }}>
            <Plus size={13} />{ar ? 'إضافة حدث' : 'New Event'}
          </button>
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
          style={{ background: surface, border: `1px solid ${border}` }}>
          <ChevronLeft size={15} style={{ color: textSec }} />
        </button>
        <h2 className="text-lg font-bold" style={{ color: textPri }}>
          {ar ? MONTH_AR[viewMonth] : MONTH_EN[viewMonth]} {viewYear}
        </h2>
        <button onClick={nextMonth} className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
          style={{ background: surface, border: `1px solid ${border}` }}>
          <ChevronRight size={15} style={{ color: textSec }} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin" style={{ color: textSec }} />
        </div>
      ) : viewMode === 'month' ? (
        /* ── Month Grid ── */
        <div className="rounded-3xl overflow-hidden" style={{ background: surface, border: `1px solid ${border}` }}>
          {/* Day headers */}
          <div className="grid grid-cols-7">
            {(ar ? DAY_AR : DAY_EN).map(d => (
              <div key={d} className="py-2.5 text-center text-[10px] font-bold uppercase tracking-wide"
                style={{ color: textSec, borderBottom: `1px solid ${border}` }}>
                {d}
              </div>
            ))}
          </div>

          {/* Date cells */}
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              if (!day) return (
                <div key={idx} className="min-h-[80px] p-1.5"
                  style={{ borderRight: idx % 7 !== 6 ? `1px solid ${border}` : undefined, borderBottom: `1px solid ${border}`, opacity: 0.3 }} />
              );
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const dayEvents = eventsByDate[dateStr] ?? [];
              const isToday   = dateStr === todayStr;
              const isWeekend = [5,6].includes((idx) % 7);

              return (
                <div key={idx}
                  onClick={() => setCreating(dateStr)}
                  className="min-h-[80px] p-1.5 cursor-pointer transition-colors"
                  style={{
                    borderRight:  idx % 7 !== 6 ? `1px solid ${border}` : undefined,
                    borderBottom: `1px solid ${border}`,
                    background:   isToday ? (dark ? 'rgba(129,140,248,0.08)' : 'rgba(129,140,248,0.04)') :
                                  isWeekend ? (dark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)') : undefined,
                  }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full"
                      style={{
                        background: isToday ? '#818cf8' : 'transparent',
                        color: isToday ? '#fff' : isWeekend ? textSec : textPri,
                      }}>
                      {day}
                    </span>
                    {dayEvents.length > 3 && (
                      <span className="text-[9px]" style={{ color: textSec }}>+{dayEvents.length - 2}</span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map(ev => (
                      <EventChip key={ev.id} ev={ev} onClick={() => setSelected(ev)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── List View ── */
        <div className="space-y-3">
          {events.length === 0 ? (
            <div className="rounded-3xl p-12 text-center" style={{ background: surface, border: `1px solid ${border}` }}>
              <CalIcon size={32} className="mx-auto mb-3 opacity-30" style={{ color: textSec }} />
              <div className="text-sm" style={{ color: textSec }}>
                {ar ? 'لا توجد أحداث هذا الشهر' : 'No events this month'}
              </div>
            </div>
          ) : events.map(ev => {
            const color = ev.color ?? EVENT_COLORS[ev.eventType] ?? '#60a5fa';
            const Icon  = EVENT_ICONS[ev.eventType] ?? CalIcon;
            return (
              <div key={ev.id}
                onClick={() => setSelected(ev)}
                className="rounded-2xl p-4 cursor-pointer flex items-start gap-3 transition-all hover:scale-[1.005]"
                style={{ background: surface, border: `1px solid ${color}20` }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}15` }}>
                  <Icon size={16} style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold" style={{ color: textPri }}>{ev.title}</div>
                  <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: textSec }}>
                    <span>{new Date(ev.startAt).toLocaleDateString(ar ? 'ar-KW' : 'en', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <span>·</span>
                    <span>{fmt(ev.startAt)} – {fmt(ev.endAt)}</span>
                    {ev.location && <><span>·</span><span>{ev.location}</span></>}
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: `${color}15`, color }}>
                  {typeLabel(ev.eventType, ar)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Event type legend */}
      <div className="mt-4 flex flex-wrap gap-3">
        {Object.keys(TYPE_LABELS_AR).map(type => (
          <div key={type} className="flex items-center gap-1.5 text-[10px]" style={{ color: textSec }}>
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: EVENT_COLORS[type] }} />
            {typeLabel(type, ar)}
          </div>
        ))}
      </div>

      {/* Modals */}
      {selected  && <EventModal event={selected} dark={dark} ar={ar} onClose={() => setSelected(null)} />}
      {creating  && <CreateEventModal date={creating} dark={dark} ar={ar} onClose={() => setCreating(null)} onCreated={loadEvents} />}
    </div>
  );
}
