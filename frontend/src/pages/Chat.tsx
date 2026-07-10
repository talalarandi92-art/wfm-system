import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { io, Socket } from 'socket.io-client';
import {
  Hash, MessageCircle, Search, Send, Users, Plus, X, ChevronDown,
  Circle, MoreHorizontal, Reply, Clock, Wifi, WifiOff, AlertCircle,
  Smile, Paperclip, Mic, MicOff, Square, Download, FileText,
  Image as ImageIcon, Film, Volume2, File as FileIcon,
  Settings, UserPlus, Trash2, Shield, ShieldOff, LogOut,
  Download as DownloadIcon, Printer, ZoomIn,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useUiStore } from '@/store/ui.store';
import { tp, ts as tsColor } from '@/components/ds';

// Theme-aware neutral tokens (semantic status colors stay hardcoded — same meaning in every theme)
const neutralT = (dark: boolean) => ({
  panel: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)',
  bdr:   dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.10)',
});

// ─── Types ────────────────────────────────────────────────────────────────────
interface Channel {
  id: string; name: string; name_ar: string;
  channel_type: 'system' | 'group' | 'direct';
  icon: string; description: string; is_system: boolean;
  unread_count: number; is_admin?: boolean;
  last_message?: { content: string; created_at: string; sender_name: string; attachment_type?: string };
}
interface Message {
  id: string; channelId: string; content: string;
  message_type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'system_event';
  sender_id: string; sender_name: string; sender_name_ar: string;
  created_at: string; is_edited: boolean;
  reply_to?: { id: string; content: string; sender_name: string } | null;
  attachment_url?: string; attachment_type?: string;
  attachment_name?: string; attachment_size?: number;
}
interface UserItem {
  id: string; name: string; name_ar: string;
  presence: 'online' | 'away' | 'offline';
}
interface MemberItem {
  id: string; name: string; is_admin: boolean; presence: string;
}
interface PendingFile {
  url: string; type: string; name: string; size: number; localUrl?: string;
}
interface Notif {
  id: string; channelId: string; channelName: string;
  sender: string; content: string;
}

// ─── Emojis ───────────────────────────────────────────────────────────────────
const EMOJI_ROWS = [
  ['😀','😂','🥲','😊','🥰','😍','🤩','😎','🤔','😐','😒','😢','😭','😤','😠','🤯'],
  ['👍','👎','👏','🙌','🤝','✌️','🤞','👌','💪','🙏','🫶','❤️','🧡','💛','💚','💙'],
  ['🎉','🎊','🎯','🏆','⭐','🌟','✨','🔥','💡','💯','🚀','📌','🔔','💬','📝','✅'],
  ['😅','😬','🙄','😏','😔','😞','😟','😨','😰','🥺','😳','😲','🤗','😴','🤒','😷'],
  ['🍕','🍔','☕','🧃','🍰','🎂','🍣','🌮','🍜','🥗','🍦','🍩','🍫','🥤','🍵','🍷'],
  ['🌸','🌺','🌻','🍀','🌿','🌱','🌲','☀️','🌙','⭐','🌈','❄️','⚡','💧','🔥','🌊'],
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(ts: string) {
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date}  ${time}`;
}
function fmtSize(bytes: number) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function presenceDot(s: string) {
  return s === 'online' ? '#22c55e' : s === 'away' ? '#f59e0b' : '#475569';
}
function fileIcon(type?: string) {
  if (type === 'image') return <ImageIcon size={14} />;
  if (type === 'video') return <Film size={14} />;
  if (type === 'audio') return <Volume2 size={14} />;
  return <FileIcon size={14} />;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const hue = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div className="rounded-xl flex items-center justify-center font-bold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.35,
        background: `hsl(${hue},50%,22%)`, color: `hsl(${hue},70%,72%)`,
        border: `1px solid hsl(${hue},50%,32%)` }}>
      {initials}
    </div>
  );
}

// ─── Emoji Picker ─────────────────────────────────────────────────────────────
function EmojiPicker({ onSelect, onClose, ar }: { onSelect: (e: string) => void; onClose: () => void; ar: boolean }) {
  const { dark } = useUiStore();
  const T = neutralT(dark);
  return createPortal(
    <div className="fixed inset-0 z-[200]" onClick={onClose}>
      <div
        className="absolute p-3 rounded-2xl shadow-2xl"
        style={{ background: 'var(--surface)', border: `1px solid ${T.bdr}`,
          bottom: 80, right: 16, width: 280 }}
        onClick={e => e.stopPropagation()}
      >
        <p className="text-[9px] text-slate-600 uppercase font-bold mb-2 px-1">{ar ? 'إيموجي' : 'Emoji'}</p>
        {EMOJI_ROWS.map((row, ri) => (
          <div key={ri} className="flex gap-0.5 mb-0.5">
            {row.map(em => (
              <button key={em} onClick={() => { onSelect(em); onClose(); }}
                className="w-8 h-8 text-base rounded-lg hover:bg-white/10 transition-all flex items-center justify-center">
                {em}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}

// ─── Image Lightbox ───────────────────────────────────────────────────────────
function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90"
      onClick={onClose}>
      <img src={url} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
        onClick={e => e.stopPropagation()} />
      <button onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center text-white"
        style={{ background: 'rgba(0,0,0,0.6)' }}>
        <X size={18} />
      </button>
      <a href={url} download className="absolute top-4 right-16 w-10 h-10 rounded-full flex items-center justify-center text-white"
        style={{ background: 'rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}>
        <Download size={16} />
      </a>
    </div>,
    document.body
  );
}

// ─── Media Display ────────────────────────────────────────────────────────────
function MediaDisplay({ url, type, name, size, onImageClick }: {
  url: string; type: string; name?: string; size?: number; onImageClick: (u: string) => void;
}) {
  const { dark } = useUiStore();
  const T = neutralT(dark);
  // Keep relative paths (Vite proxies /uploads → backend); abs URLs pass through
  const full = url.startsWith('http') ? url : url;
  if (type === 'image') return (
    <div className="mt-1.5 cursor-pointer relative group" onClick={() => onImageClick(full)}>
      <img src={full} alt={name || 'image'}
        className="max-w-[240px] max-h-[180px] rounded-xl object-cover"
        style={{ border: `1px solid ${T.bdr}` }} />
      <div className="absolute inset-0 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
        style={{ background: 'rgba(0,0,0,0.4)' }}>
        <ZoomIn size={22} className="text-white" />
      </div>
    </div>
  );
  if (type === 'video') return (
    <div className="mt-1.5">
      <video src={full} controls className="max-w-[280px] rounded-xl"
        style={{ border: `1px solid ${T.bdr}` }} />
    </div>
  );
  if (type === 'audio') return (
    <div className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', maxWidth: 260 }}>
      <Volume2 size={16} className="text-indigo-400 flex-shrink-0" />
      <audio src={full} controls className="flex-1 h-7"
        style={{ filter: 'invert(0.8) sepia(1) hue-rotate(200deg)', maxWidth: 200 }} />
    </div>
  );
  return (
    <a href={full} download={name} target="_blank" rel="noreferrer"
      className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:bg-white/10"
      style={{ background: T.panel, border: `1px solid ${T.bdr}`, maxWidth: 240, display: 'flex' }}>
      <FileIcon size={18} className="text-indigo-400 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-xs truncate" style={{ color: tp(dark) }}>{name}</p>
        {size && <p className="text-[9px] text-slate-500">{fmtSize(size)}</p>}
      </div>
      <Download size={13} className="text-slate-500 flex-shrink-0 ms-1" />
    </a>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg, isMine, showAvatar, onReply, onImageClick, lang }: {
  msg: Message; isMine: boolean; showAvatar: boolean;
  onReply: (m: Message) => void; onImageClick: (u: string) => void; lang: 'ar' | 'en';
}) {
  const ar = lang === 'ar';
  const [hover, setHover] = useState(false);
  const { dark } = useUiStore();
  const T = neutralT(dark);

  if (msg.message_type === 'system_event') return (
    <div className="flex items-center justify-center my-2">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] text-slate-500"
        style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
        <AlertCircle size={10} className="text-amber-500" />
        {msg.content}
      </div>
    </div>
  );

  return (
    <div className={`flex gap-2 group ${isMine ? 'flex-row-reverse' : ''}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="w-8 flex-shrink-0 mt-auto">
        {showAvatar && !isMine && <Avatar name={ar ? msg.sender_name_ar : msg.sender_name} size={28} />}
      </div>
      <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} max-w-[72%]`}>
        {showAvatar && !isMine && (
          <span className="text-[10px] font-semibold text-slate-400 mb-1 px-1">
            {ar ? msg.sender_name_ar : msg.sender_name}
          </span>
        )}
        {msg.reply_to && (
          <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-t-xl mb-0.5 max-w-full"
            style={{ background: T.panel, borderInlineStart: '2px solid rgba(99,102,241,0.6)' }}>
            <Reply size={10} className="text-indigo-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[9px] font-semibold text-indigo-400 truncate">{msg.reply_to.sender_name}</p>
              <p className="text-[10px] text-slate-500 truncate">{msg.reply_to.content}</p>
            </div>
          </div>
        )}
        <div className="relative flex items-end gap-1.5">
          <div className="px-3 py-2 rounded-2xl text-sm leading-relaxed break-words"
            style={{
              background: isMine ? 'linear-gradient(135deg,#4338ca,#6366f1)' : T.panel,
              color: isMine ? '#fff' : tp(dark),
              border: isMine ? 'none' : `1px solid ${T.bdr}`,
              borderBottomRightRadius: isMine ? 4 : 16,
              borderBottomLeftRadius: isMine ? 16 : 4,
              maxWidth: 320,
            }}>
            {msg.content && <p>{msg.content}</p>}
            {msg.attachment_url && (
              <MediaDisplay
                url={msg.attachment_url}
                type={msg.attachment_type || 'file'}
                name={msg.attachment_name}
                size={msg.attachment_size}
                onImageClick={onImageClick}
              />
            )}
          </div>
          {hover && (
            <button onClick={() => onReply(msg)}
              className={`flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center ${isMine ? 'order-first' : ''}`}
              style={{ background: T.panel, color: tsColor(dark) }}>
              <Reply size={11} />
            </button>
          )}
        </div>
        <span className="text-[11px] text-slate-400 mt-1 px-1">{fmtTime(msg.created_at)}</span>
      </div>
    </div>
  );
}

// ─── Channel Item ─────────────────────────────────────────────────────────────
function ChannelItem({ ch, active, onClick, ar }: {
  ch: Channel; active: boolean; onClick: () => void; ar: boolean;
}) {
  const { dark } = useUiStore();
  const T = neutralT(dark);
  const lastContent = ch.last_message
    ? (ch.last_message.attachment_type
        ? `[${ch.last_message.attachment_type}]`
        : ch.last_message.content)
    : '';
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-xl transition-all text-start group
        ${active ? 'bg-indigo-500/15 border border-indigo-500/25' : 'hover:bg-white/5 border border-transparent'}`}>
      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
        style={{ background: active ? 'rgba(99,102,241,0.25)' : T.panel }}>
        {ch.icon || <Hash size={12} className="text-slate-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`text-xs font-${active ? 'bold' : 'medium'} truncate`} style={{ color: active ? tp(dark) : tsColor(dark) }}>
            {ar ? (ch.name_ar || ch.name) : ch.name}
          </span>
          {ch.last_message && (
            <span className="text-[9px] text-slate-600 flex-shrink-0 ms-1">{fmtTime(ch.last_message.created_at)}</span>
          )}
        </div>
        {lastContent && (
          <p className="text-[10px] text-slate-500 truncate">
            {ch.last_message?.sender_name}: {lastContent}
          </p>
        )}
      </div>
      {ch.unread_count > 0 && (
        <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)' }}>
          {ch.unread_count > 99 ? '99+' : ch.unread_count}
        </span>
      )}
    </button>
  );
}

// ─── Create Group Modal ───────────────────────────────────────────────────────
function CreateGroupModal({ users, onClose, onCreate, ar }: {
  users: UserItem[];
  onClose: () => void;
  onCreate: (name: string, nameAr: string, icon: string, memberIds: string[]) => void;
  ar: boolean;
}) {
  const [name, setName]           = useState('');
  const [nameAr, setNameAr]       = useState('');
  const [icon, setIcon]           = useState('💬');
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState<string[]>([]);
  const [showIcons, setShowIcons] = useState(false);
  const { dark } = useUiStore();
  const T = neutralT(dark);
  const ICONS = ['💬','📢','🚨','📡','🔧','📋','🏢','👥','🎯','📊','🌟','🔔','⚡','🔒','🎮','📌'];

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[440px] rounded-2xl p-0 overflow-hidden"
        style={{ background: 'var(--surface)', border: `1px solid ${T.bdr}` }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.07]">
          <h3 className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'إنشاء مجموعة جديدة' : 'Create new group'}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Icon + Name */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <button onClick={() => setShowIcons(v => !v)}
                className="w-12 h-12 rounded-xl text-2xl flex items-center justify-center hover:bg-white/10 transition-all"
                style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
                {icon}
              </button>
              {showIcons && (
                <div className="absolute top-14 left-0 z-10 p-2 rounded-xl grid grid-cols-4 gap-1"
                  style={{ background: 'var(--surface-2)', border: `1px solid ${T.bdr}` }}>
                  {ICONS.map(ic => (
                    <button key={ic} onClick={() => { setIcon(ic); setShowIcons(false); }}
                      className="w-8 h-8 text-lg rounded-lg hover:bg-white/10 flex items-center justify-center">{ic}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder={ar ? 'اسم المجموعة (إنجليزي)' : 'Group name (English)'}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: T.panel, border: `1px solid ${T.bdr}`, color: tp(dark) }} />
              <input value={nameAr} onChange={e => setNameAr(e.target.value)}
                placeholder={ar ? 'اسم المجموعة (عربي) - اختياري' : 'Group name (Arabic) — optional'}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: T.panel, border: `1px solid ${T.bdr}`, color: tp(dark) }} />
            </div>
          </div>

          {/* Members */}
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-2">{ar ? `إضافة أعضاء (${selected.length} محدد)` : `Add members (${selected.length} selected)`}</p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-2"
              style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
              <Search size={12} className="text-slate-500" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={ar ? 'بحث عن موظف...' : 'Search employee...'}
                className="flex-1 bg-transparent text-xs outline-none placeholder-slate-600" style={{ color: tp(dark) }} />
            </div>
            <div className="max-h-44 overflow-y-auto space-y-0.5">
              {users.filter(u => u.name.toLowerCase().includes(search.toLowerCase())).map(u => (
                <label key={u.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-white/5 transition-all">
                  <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)}
                    className="w-3.5 h-3.5 rounded accent-indigo-500" />
                  <Avatar name={u.name} size={24} />
                  <span className="text-xs" style={{ color: tp(dark) }}>{u.name}</span>
                  <span className="ms-auto w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: presenceDot(u.presence) }} />
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={() => { if (name.trim()) { onCreate(name.trim(), nameAr.trim(), icon, selected); onClose(); } }}
            disabled={!name.trim()}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)' }}>
            {ar ? 'إنشاء المجموعة' : 'Create group'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Members Modal ────────────────────────────────────────────────────────────
function MembersModal({ channelId, currentUserId, iAmAdmin, users, onClose, ar }: {
  channelId: string; currentUserId: string; iAmAdmin: boolean;
  users: UserItem[]; onClose: () => void; ar: boolean;
}) {
  const [members, setMembers]   = useState<MemberItem[]>([]);
  const [search, setSearch]     = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [tab, setTab]           = useState<'list' | 'add'>('list');
  const { dark } = useUiStore();
  const T = neutralT(dark);

  useEffect(() => {
    apiClient.get(`/chat/channels/${channelId}/members`).then((r: any) => setMembers(r.data)).catch(() => {});
  }, [channelId]);

  const remove = async (uid: string) => {
    await apiClient.delete(`/chat/channels/${channelId}/members/${uid}`).catch(() => {});
    setMembers(m => m.filter(x => x.id !== uid));
  };
  const toggleAdmin = async (uid: string, current: boolean) => {
    await apiClient.patch(`/chat/channels/${channelId}/members/${uid}/admin`, { isAdmin: !current }).catch(() => {});
    setMembers(m => m.map(x => x.id === uid ? { ...x, is_admin: !current } : x));
  };
  const addMember = async (uid: string) => {
    await apiClient.post(`/chat/channels/${channelId}/members`, { userId: uid }).catch(() => {});
    const user = users.find(u => u.id === uid);
    if (user) setMembers(m => [...m, { id: uid, name: user.name, is_admin: false, presence: user.presence }]);
    setTab('list');
  };

  const memberIds = new Set(members.map(m => m.id));
  const addable = users.filter(u => !memberIds.has(u.id) && u.name.toLowerCase().includes(addSearch.toLowerCase()));

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[380px] rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface)', border: `1px solid ${T.bdr}` }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.07]">
          <h3 className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? `الأعضاء (${members.length})` : `Members (${members.length})`}</h3>
          <div className="flex items-center gap-2">
            {iAmAdmin && (
              <button onClick={() => setTab(t => t === 'add' ? 'list' : 'add')}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-indigo-400 hover:bg-indigo-500/15">
                <UserPlus size={14} />
              </button>
            )}
            <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>
          </div>
        </div>

        {tab === 'add' ? (
          <div className="p-4 space-y-3">
            <p className="text-xs text-slate-400">{ar ? 'إضافة عضو جديد' : 'Add new member'}</p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
              <Search size={12} className="text-slate-500" />
              <input value={addSearch} onChange={e => setAddSearch(e.target.value)}
                placeholder={ar ? 'بحث...' : 'Search...'} autoFocus
                className="flex-1 bg-transparent text-xs outline-none placeholder-slate-600" style={{ color: tp(dark) }} />
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {addable.map(u => (
                <button key={u.id} onClick={() => addMember(u.id)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-white/5 transition-all text-start">
                  <Avatar name={u.name} size={26} />
                  <span className="text-xs flex-1" style={{ color: tp(dark) }}>{u.name}</span>
                  <Plus size={13} className="text-indigo-400" />
                </button>
              ))}
              {addable.length === 0 && <p className="text-xs text-slate-600 text-center py-4">{ar ? 'لا يوجد نتائج' : 'No results'}</p>}
            </div>
          </div>
        ) : (
          <>
            <div className="px-3 pt-3 pb-1">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
                <Search size={12} className="text-slate-500" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={ar ? 'بحث عن عضو...' : 'Search member...'}
                  className="flex-1 bg-transparent text-xs outline-none placeholder-slate-600" style={{ color: tp(dark) }} />
              </div>
            </div>
            <div className="px-3 pb-4 max-h-72 overflow-y-auto space-y-0.5">
              {members.filter(m => m.name.toLowerCase().includes(search.toLowerCase())).map(m => (
                <div key={m.id} className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-white/5 transition-all group">
                  <div className="relative">
                    <Avatar name={m.name} size={28} />
                    <span className="absolute -bottom-0.5 -end-0.5 w-2.5 h-2.5 rounded-full border-2"
                      style={{ background: presenceDot(m.presence), borderColor: 'var(--surface)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate" style={{ color: tp(dark) }}>{m.name}</p>
                    {m.is_admin && (
                      <span className="text-[9px] font-bold text-amber-400">{ar ? 'أدمن' : 'Admin'}</span>
                    )}
                  </div>
                  {iAmAdmin && m.id !== currentUserId && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={() => toggleAdmin(m.id, m.is_admin)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-amber-500/20 text-slate-500 hover:text-amber-400 transition-all"
                        title={m.is_admin ? (ar ? 'إزالة صلاحية الأدمن' : 'Remove admin') : (ar ? 'منح صلاحية الأدمن' : 'Make admin')}>
                        {m.is_admin ? <ShieldOff size={11} /> : <Shield size={11} />}
                      </button>
                      <button onClick={() => remove(m.id)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-all">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Notification Toast ───────────────────────────────────────────────────────
function NotifToast({ notif, onClick, onDismiss, ar }: {
  notif: Notif; onClick: () => void; onDismiss: () => void; ar: boolean;
}) {
  const { dark } = useUiStore();
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="flex items-start gap-3 p-3 rounded-2xl cursor-pointer hover:bg-white/10 transition-all"
      style={{ background: 'var(--surface)', border: '1px solid rgba(99,102,241,0.4)', minWidth: 280, maxWidth: 340 }}
      onClick={onClick}>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0"
        style={{ background: 'rgba(99,102,241,0.2)' }}>
        💬
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-indigo-400 truncate">{notif.channelName}</p>
        <p className="text-[11px] font-semibold" style={{ color: tp(dark) }}>{notif.sender}</p>
        <p className="text-[10px] text-slate-400 truncate">{notif.content || (ar ? '[ملف مرفق]' : '[Attachment]')}</p>
      </div>
      <button onClick={e => { e.stopPropagation(); onDismiss(); }}
        className="text-slate-600 hover:text-slate-400 flex-shrink-0"><X size={12} /></button>
    </div>
  );
}

// ─── Main Chat Page ───────────────────────────────────────────────────────────
export default function ChatPage({ lang: langProp }: { lang?: 'ar' | 'en' }) {
  const storeLang = useUiStore(s => s.lang);
  const dark = useUiStore(s => s.dark);
  const T = neutralT(dark);
  const lang: 'ar' | 'en' = (langProp ?? storeLang) as 'ar' | 'en';
  const ar = lang === 'ar';
  const token = localStorage.getItem('access_token') ?? '';

  // Core
  const [socket, setSocket]               = useState<Socket | null>(null);
  const [connected, setConnected]         = useState(false);
  const [channels, setChannels]           = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [messages, setMessages]           = useState<Message[]>([]);
  const [msgLoading, setMsgLoading]       = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [users, setUsers]                 = useState<UserItem[]>([]);
  const [presence, setPresence]           = useState<Record<string, string>>({});

  // Input
  const [input, setInput]         = useState('');
  const [replyTo, setReplyTo]     = useState<Message | null>(null);
  const [search, setSearch]       = useState('');
  const [showEmoji, setShowEmoji] = useState(false);

  // File upload
  const [pendingFile, setPendingFile]   = useState<PendingFile | null>(null);
  const [isUploading, setIsUploading]   = useState(false);
  const fileInputRef                    = useRef<HTMLInputElement>(null);

  // Voice
  const [isRecording, setIsRecording]         = useState(false);
  const [recordingSecs, setRecordingSecs]     = useState(0);
  const [audioBlobUrl, setAudioBlobUrl]       = useState<string | null>(null);
  const mediaRecorderRef                       = useRef<MediaRecorder | null>(null);
  const audioChunksRef                         = useRef<Blob[]>([]);
  const recTimerRef                            = useRef<ReturnType<typeof setInterval> | null>(null);
  const recMimeRef                             = useRef<string>('audio/webm');  // actual recorded mime (browser-dependent)

  // Pick a MediaRecorder mime the browser actually supports (Chrome→webm/opus, Safari→mp4).
  const pickAudioMime = (): string => {
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    const MR: any = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null;
    if (MR?.isTypeSupported) {
      for (const c of cands) { if (MR.isTypeSupported(c)) return c; }
    }
    return '';  // let the browser choose its default
  };
  const mimeExt = (mime: string) => mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';

  // UI
  const [showUsers, setShowUsers]             = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showMembers, setShowMembers]         = useState(false);
  const [lightboxUrl, setLightboxUrl]         = useState<string | null>(null);
  const [typing, setTyping]                   = useState<Record<string, boolean>>({});
  const [notifs, setNotifs]                   = useState<Notif[]>([]);
  const [exportOpen, setExportOpen]           = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChannelRef   = useRef<Channel | null>(null);
  const currentUserIdRef   = useRef('');
  useEffect(() => { activeChannelRef.current = activeChannel; }, [activeChannel]);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadChannels = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/chat/channels');
      setChannels(data);
      if (!activeChannelRef.current && data.length) setActiveChannel(data[0]);
    } catch {}
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    setMsgLoading(true);
    try {
      const { data } = await apiClient.get(`/chat/channels/${channelId}/messages`);
      setMessages(data);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch {} finally { setMsgLoading(false); }
  }, []);

  // ── Socket ────────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setCurrentUserId(payload.sub);
    } catch {}

    // WS endpoint: explicit backend in dev; same-origin in production (reverse proxy
    // forwards /socket.io to the backend). Override with VITE_WS_URL if needed.
    const env = (import.meta as any).env ?? {};
    const wsUrl = env.VITE_WS_URL ?? (env.DEV ? 'http://localhost:3000' : '');
    const s = io(`${wsUrl}/chat`, { auth: { token }, transports: ['websocket'] });

    s.on('connect', () => { setConnected(true); loadChannels(); });
    s.on('disconnect', () => setConnected(false));

    s.on('new_message', (msg: Message) => {
      setMessages(prev => {
        // Remove any optimistic placeholder sent by the same user, then add real message
        let base = prev;
        if (msg.sender_id === currentUserIdRef.current) {
          base = prev.filter(m => !m.id.startsWith('temp-'));
        }
        if (base.some(m => m.id === msg.id)) return base;
        return [...base, msg];
      });
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

      const activeNow = activeChannelRef.current;
      if (msg.channelId !== activeNow?.id) {
        setChannels(prev => prev.map(ch =>
          ch.id === msg.channelId
            ? { ...ch, unread_count: ch.unread_count + 1,
                last_message: { content: msg.content, created_at: msg.created_at,
                  sender_name: msg.sender_name, attachment_type: msg.attachment_type } }
            : ch
        ));
        // Show notification
        setNotifs(n => {
          const chName = channels.find(c => c.id === msg.channelId)?.name_ar ||
                         channels.find(c => c.id === msg.channelId)?.name || '';
          return [...n, { id: msg.id, channelId: msg.channelId, channelName: chName,
            sender: msg.sender_name, content: msg.content }];
        });
      } else {
        setChannels(prev => prev.map(ch =>
          ch.id === msg.channelId
            ? { ...ch, last_message: { content: msg.content, created_at: msg.created_at,
                sender_name: msg.sender_name, attachment_type: msg.attachment_type } }
            : ch
        ));
      }
    });

    s.on('presence_update', ({ userId, status }: { userId: string; status: string }) => {
      setPresence(p => ({ ...p, [userId]: status }));
    });
    s.on('typing', ({ userId, isTyping: t }: { userId: string; isTyping: boolean }) => {
      setTyping(prev => ({ ...prev, [userId]: t }));
    });

    setSocket(s);
    return () => { s.disconnect(); };
  }, [token]);

  useEffect(() => { loadChannels(); }, []);

  useEffect(() => {
    if (activeChannel) {
      socket?.emit('join_channel', { channelId: activeChannel.id });
      loadMessages(activeChannel.id);
      socket?.emit('mark_read', { channelId: activeChannel.id });
      setChannels(prev => prev.map(ch => ch.id === activeChannel.id ? { ...ch, unread_count: 0 } : ch));
    }
  }, [activeChannel?.id, socket]);

  useEffect(() => {
    apiClient.get('/chat/users').then((r: any) => setUsers(r.data)).catch(() => {});
    apiClient.get('/chat/presence').then((r: any) => setPresence(r.data)).catch(() => {});
  }, []);

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = () => {
    if ((!input.trim() && !pendingFile && !audioBlobUrl) || !activeChannel || !socket) return;

    const msgContent  = input.trim();
    const msgFile     = pendingFile;
    const msgReply    = replyTo;

    const payload = {
      channelId:      activeChannel.id,
      content:        msgContent,
      replyToId:      msgReply?.id,
      attachmentUrl:  msgFile?.url,
      attachmentType: msgFile?.type,
      attachmentName: msgFile?.name,
      attachmentSize: msgFile?.size,
    };

    // Optimistic: add message immediately so it shows no matter what
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      channelId: activeChannel.id,
      content: msgContent,
      message_type: (msgFile?.type ?? 'text') as Message['message_type'],
      sender_id: currentUserId,
      sender_name: '',
      sender_name_ar: '',
      created_at: new Date().toISOString(),
      is_edited: false,
      reply_to: msgReply ? { id: msgReply.id, content: msgReply.content, sender_name: msgReply.sender_name } : null,
      attachment_url:  msgFile?.url,
      attachment_type: msgFile?.type,
      attachment_name: msgFile?.name,
      attachment_size: msgFile?.size,
    };
    setMessages(prev => [...prev, optimistic]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

    setInput('');
    setReplyTo(null);
    setPendingFile(null);
    setAudioBlobUrl(null);
    socket.emit('typing', { channelId: activeChannel.id, isTyping: false });
    socket.emit('send_message', payload);
  };

  const handleTyping = (val: string) => {
    setInput(val);
    if (!socket || !activeChannel) return;
    socket.emit('typing', { channelId: activeChannel.id, isTyping: val.length > 0 });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket?.emit('typing', { channelId: activeChannel.id, isTyping: false });
    }, 2000);
  };

  // ── File Upload ───────────────────────────────────────────────────────────
  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await (apiClient as any).post('/chat/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const localUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      setPendingFile({ url: data.url, type: data.type, name: data.name, size: data.size, localUrl });
    } catch { } finally { setIsUploading(false); }
    e.target.value = '';
  };

  // ── Voice ─────────────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickAudioMime();
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      // Record the mime the browser actually used (so playback + upload match the real codec)
      recMimeRef.current = mr.mimeType || mime || 'audio/webm';
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        const type = recMimeRef.current.split(';')[0];   // drop codec suffix for the Blob type
        const blob = new Blob(audioChunksRef.current, { type });
        setAudioBlobUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start(100);
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setRecordingSecs(0);
      recTimerRef.current = setInterval(() => setRecordingSecs(s => s + 1), 1000);
    } catch { alert(ar ? 'تعذر الوصول إلى الميكروفون' : 'Could not access the microphone'); }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    setIsRecording(false);
  };

  const sendVoice = async () => {
    if (!audioBlobUrl || !activeChannel || !socket) return;
    setIsUploading(true);
    try {
      const resp = await fetch(audioBlobUrl);
      const blob = await resp.blob();
      const baseMime = recMimeRef.current.split(';')[0] || 'audio/webm';
      const file = new File([blob], `voice-${Date.now()}.${mimeExt(baseMime)}`, { type: baseMime });
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await (apiClient as any).post('/chat/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const voicePayload = {
        channelId: activeChannel.id, content: '',
        attachmentUrl: data.url, attachmentType: 'audio',
        attachmentName: data.name, attachmentSize: data.size,
      };

      // Optimistic voice note
      const voiceOptimistic: Message = {
        id: `temp-${Date.now()}`,
        channelId: activeChannel.id,
        content: '',
        message_type: 'audio',
        sender_id: currentUserId,
        sender_name: '',
        sender_name_ar: '',
        created_at: new Date().toISOString(),
        is_edited: false,
        reply_to: null,
        attachment_url:  data.url,
        attachment_type: 'audio',
        attachment_name: data.name,
        attachment_size: data.size,
      };
      setMessages(prev => [...prev, voiceOptimistic]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

      socket.emit('send_message', voicePayload);
      setAudioBlobUrl(null);
    } catch { } finally { setIsUploading(false); }
  };

  // ── Open / create DM ─────────────────────────────────────────────────────
  const openDM = async (userId: string) => {
    try {
      const { data } = await (apiClient as any).post('/chat/direct', { targetUserId: userId });
      await loadChannels();
      // Give React a tick to update channels list, then activate it
      setTimeout(() => {
        setChannels(prev => {
          const ch = prev.find(c => c.id === data.id);
          if (ch) setActiveChannel(ch);
          return prev;
        });
        setShowUsers(false);
      }, 150);
    } catch {}
  };

  // ── Create group ──────────────────────────────────────────────────────────
  const createGroup = async (name: string, nameAr: string, icon: string, memberIds: string[]) => {
    try {
      await (apiClient as any).post('/chat/channels', { name, name_ar: nameAr, icon, memberIds });
      loadChannels();
    } catch {}
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [['Time', 'Sender', 'Message', 'Attachment']];
    messages.forEach(m => {
      rows.push([
        new Date(m.created_at).toLocaleString(),
        m.sender_name,
        m.content || '',
        m.attachment_url ? `${m.attachment_name} (${m.attachment_type})` : '',
      ]);
    });
    const csv = '﻿' + rows.map(r =>
      r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `chat-${activeChannel?.name || 'export'}-${Date.now()}.csv`;
    a.click();
    setExportOpen(false);
  };

  // Escape any user-supplied text before injecting into the print window — prevents stored XSS
  // where a crafted message/name/filename could execute script in the exporting user's browser.
  const esc = (s: any) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const exportPDF = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const chName = esc(activeChannel?.name_ar || activeChannel?.name || '');
    w.document.write(`<html><head><title>Chat Export</title><style>
      body{font-family:Cairo,Arial,sans-serif;direction:${ar ? 'rtl' : 'ltr'};padding:24px;background:#fff;color:#111;}
      h2{font-size:18px;margin-bottom:4px;}.meta{font-size:12px;color:#888;margin-bottom:16px;}
      .msg{margin:8px 0;padding:10px 14px;border-radius:10px;max-width:70%;}
      .mine{background:#e8eaf6;margin-left:auto;}.other{background:#f5f5f5;}
      .sender{font-size:11px;color:#666;margin-bottom:3px;font-weight:bold;}
      .content{font-size:13px;}.time{font-size:10px;color:#aaa;margin-top:4px;}
      .att{font-size:11px;color:#4338ca;margin-top:4px;}
    </style></head><body>
    <h2>${ar ? 'محادثة' : 'Conversation'}: ${chName}</h2>
    <div class="meta">${ar ? 'تصدير' : 'Exported'}: ${esc(new Date().toLocaleString(ar ? 'ar-KW' : 'en-GB'))}</div>
    ${messages.map(m => `
      <div class="msg ${m.sender_id === currentUserId ? 'mine' : 'other'}">
        <div class="sender">${esc(m.sender_name)}</div>
        ${m.content ? `<div class="content">${esc(m.content)}</div>` : ''}
        ${m.attachment_url ? `<div class="att">📎 ${esc(m.attachment_name || m.attachment_type)}</div>` : ''}
        <div class="time">${esc(new Date(m.created_at).toLocaleString('ar-KW'))}</div>
      </div>
    `).join('')}
    </body></html>`);
    w.document.close();
    w.print();
    setExportOpen(false);
  };

  // ── Computed ──────────────────────────────────────────────────────────────
  const typingUsers = Object.entries(typing)
    .filter(([uid, t]) => t && uid !== currentUserId)
    .map(([uid]) => users.find(u => u.id === uid)?.name ?? (ar ? 'شخص ما' : 'Someone'));

  const filteredChannels = channels.filter(ch =>
    ch.name.toLowerCase().includes(search.toLowerCase()) ||
    (ch.name_ar ?? '').includes(search)
  );

  const onlineCount = Object.values(presence).filter(s => s === 'online').length;

  const iAmAdmin = activeChannel
    ? (channels.find(c => c.id === activeChannel.id)?.is_admin ?? false)
    : false;

  const fmtRec = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden rounded-2xl border border-white/10"
      style={{ background: 'var(--surface)' }}>

      {/* ══ SIDEBAR ══ */}
      <div className="w-72 flex-shrink-0 flex flex-col border-e border-white/[0.07]"
        style={{ background: T.panel }}>

        <div className="px-4 py-3.5 flex items-center justify-between flex-shrink-0 border-b border-white/[0.07]">
          <div className="flex items-center gap-2">
            <MessageCircle size={15} className="text-indigo-400" />
            <span className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'الشات' : 'Chat'}</span>
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowCreateGroup(true)}
              className="w-7 h-7 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-all"
              title={ar ? 'مجموعة جديدة' : 'New group'}>
              <Plus size={13} />
            </button>
            <button onClick={() => setShowUsers(v => !v)}
              className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all
                ${showUsers ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
              <Users size={13} />
            </button>
          </div>
        </div>

        <div className="px-4 py-2 flex items-center gap-1.5 border-b border-white/[0.05]">
          <Circle size={7} fill="#22c55e" className="text-emerald-400" />
          <span className="text-[10px] text-slate-500">{onlineCount} {ar ? 'أونلاين' : 'online'}</span>
        </div>

        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>
            <Search size={12} className="text-slate-500 flex-shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={ar ? 'بحث...' : 'Search...'}
              className="bg-transparent text-xs outline-none flex-1 placeholder-slate-600" style={{ color: tp(dark) }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider px-2 py-2">
            {ar ? 'القنوات' : 'Channels'}
          </p>
          {filteredChannels.filter(c => c.channel_type !== 'direct').map(ch => (
            <ChannelItem key={ch.id} ch={ch} active={activeChannel?.id === ch.id}
              onClick={() => setActiveChannel(ch)} ar={ar} />
          ))}
          {filteredChannels.filter(c => c.channel_type === 'direct').length > 0 && (
            <>
              <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider px-2 py-2 mt-2">
                {ar ? 'رسائل مباشرة' : 'Direct Messages'}
              </p>
              {filteredChannels.filter(c => c.channel_type === 'direct').map(ch => (
                <ChannelItem key={ch.id} ch={ch} active={activeChannel?.id === ch.id}
                  onClick={() => setActiveChannel(ch)} ar={ar} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* ══ MAIN AREA ══ */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeChannel ? (
          <>
            {/* Header */}
            <div className="flex-shrink-0 px-5 py-3 flex items-center justify-between border-b border-white/[0.07]"
              style={{ background: T.panel }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-lg"
                  style={{ background: 'rgba(99,102,241,0.15)' }}>
                  {activeChannel.icon || '💬'}
                </div>
                <div>
                  <h2 className="text-sm font-bold leading-tight" style={{ color: tp(dark) }}>
                    {ar ? (activeChannel.name_ar || activeChannel.name) : activeChannel.name}
                  </h2>
                  {activeChannel.description && (
                    <p className="text-[10px] text-slate-500 truncate max-w-xs">{activeChannel.description}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Members button — non-system channels */}
                {!activeChannel.is_system && (
                  <button onClick={() => setShowMembers(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all">
                    <Users size={13} />
                    <span className="text-[11px]">{ar ? 'الأعضاء' : 'Members'}</span>
                  </button>
                )}

                {/* Export dropdown */}
                <div className="relative">
                  <button onClick={() => setExportOpen(v => !v)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all">
                    <DownloadIcon size={13} />
                    <span className="text-[11px]">{ar ? 'تصدير' : 'Export'}</span>
                  </button>
                  {exportOpen && (
                    <div className="absolute top-9 end-0 z-50 rounded-xl shadow-2xl overflow-hidden"
                      style={{ background: 'var(--surface)', border: `1px solid ${T.bdr}`, minWidth: 160 }}>
                      <button onClick={exportCSV}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs hover:bg-white/10 transition-all" style={{ color: tsColor(dark) }}>
                        <FileText size={13} className="text-emerald-400" />
                        {ar ? 'تصدير Excel (CSV)' : 'Export CSV'}
                      </button>
                      <button onClick={exportPDF}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs hover:bg-white/10 transition-all" style={{ color: tsColor(dark) }}>
                        <Printer size={13} className="text-red-400" />
                        {ar ? 'طباعة / PDF' : 'Print / PDF'}
                      </button>
                    </div>
                  )}
                </div>

                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
              onClick={() => { setExportOpen(false); }}>
              {msgLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
                  <MessageCircle size={32} className="opacity-30" />
                  <p className="text-sm">{ar ? 'لا رسائل بعد' : 'No messages yet'}</p>
                  <p className="text-xs">{ar ? 'كن أول من يرسل!' : 'Be the first!'}</p>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const prev = messages[i - 1];
                  const showAvatar = !prev || prev.sender_id !== msg.sender_id ||
                    new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;
                  return (
                    <MessageBubble key={msg.id} msg={msg}
                      isMine={msg.sender_id === currentUserId}
                      showAvatar={showAvatar} onReply={setReplyTo}
                      onImageClick={setLightboxUrl} lang={lang} />
                  );
                })
              )}
              {typingUsers.length > 0 && (
                <div className="flex items-center gap-2 px-2 text-[10px] text-slate-500">
                  <div className="flex gap-0.5">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-1 h-1 rounded-full bg-slate-500 animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                  {typingUsers.join(', ')} {ar ? 'يكتب...' : 'typing...'}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input Area */}
            <div className="flex-shrink-0 px-4 pb-4 pt-2">
              {/* Reply preview */}
              {replyTo && (
                <div className="flex items-start justify-between px-3 py-2 rounded-t-xl mb-1"
                  style={{ background: 'rgba(99,102,241,0.1)', borderInlineStart: '2px solid #6366f1' }}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Reply size={11} className="text-indigo-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-indigo-400">{replyTo.sender_name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{replyTo.content}</p>
                    </div>
                  </div>
                  <button onClick={() => setReplyTo(null)} className="text-slate-500 hover:text-white ms-2">
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* Pending file preview */}
              {pendingFile && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-t-xl mb-1"
                  style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                  {pendingFile.type === 'image' && pendingFile.localUrl ? (
                    <img src={pendingFile.localUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-indigo-400 flex-shrink-0"
                      style={{ background: 'rgba(99,102,241,0.15)' }}>
                      {fileIcon(pendingFile.type)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate" style={{ color: tp(dark) }}>{pendingFile.name}</p>
                    <p className="text-[9px] text-slate-500">{fmtSize(pendingFile.size)} · {pendingFile.type}</p>
                  </div>
                  <button onClick={() => setPendingFile(null)} className="text-slate-500 hover:text-white flex-shrink-0">
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Voice note preview */}
              {audioBlobUrl && !isRecording && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-t-xl mb-1"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <Volume2 size={15} className="text-red-400 flex-shrink-0" />
                  <audio src={audioBlobUrl} controls className="flex-1 h-7"
                    style={{ filter: 'invert(0.8) sepia(1) hue-rotate(200deg)' }} />
                  <button onClick={() => setAudioBlobUrl(null)} className="text-slate-500 hover:text-white flex-shrink-0">
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Recording indicator */}
              {isRecording && (
                <div className="flex items-center gap-3 px-3 py-2 rounded-t-xl mb-1"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                  <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  <span className="text-xs font-mono text-red-400">{fmtRec(recordingSecs)}</span>
                  <span className="text-xs text-slate-400 flex-1">{ar ? 'جاري التسجيل...' : 'Recording...'}</span>
                  <button onClick={stopRecording}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white"
                    style={{ background: 'rgba(239,68,68,0.3)' }}>
                    <Square size={11} />
                  </button>
                </div>
              )}

              {/* Main input row */}
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl"
                style={{ background: T.panel, border: `1px solid ${T.bdr}` }}>

                {/* Emoji */}
                <button onClick={() => setShowEmoji(v => !v)}
                  className="text-slate-500 hover:text-amber-400 transition-all flex-shrink-0">
                  <Smile size={17} />
                </button>

                {/* File attach */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="text-slate-500 hover:text-indigo-400 transition-all flex-shrink-0 disabled:opacity-40">
                  {isUploading
                    ? <div className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                    : <Paperclip size={17} />
                  }
                </button>

                <input type="file" ref={fileInputRef} className="hidden"
                  accept="image/*,video/*,audio/*,.pdf,.xlsx,.xls,.csv,.docx,.doc,.zip"
                  onChange={handleFilePick} />

                {/* Text input */}
                <input ref={inputRef} value={input}
                  onChange={e => handleTyping(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={ar ? 'اكتب رسالة...' : 'Type a message...'}
                  className="flex-1 bg-transparent text-sm outline-none placeholder-slate-600" style={{ color: tp(dark) }} />

                {/* Voice */}
                {!audioBlobUrl && (
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`flex-shrink-0 transition-all ${isRecording ? 'text-red-400 animate-pulse' : 'text-slate-500 hover:text-indigo-400'}`}>
                    {isRecording ? <MicOff size={17} /> : <Mic size={17} />}
                  </button>
                )}

                {/* Send voice note */}
                {audioBlobUrl && (
                  <button onClick={sendVoice} disabled={isUploading}
                    className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg,#dc2626,#ef4444)' }}>
                    <Send size={14} className="text-white" />
                  </button>
                )}

                {/* Send text/file */}
                {!audioBlobUrl && (
                  <button onClick={handleSend}
                    disabled={!input.trim() && !pendingFile}
                    className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-30"
                    style={{ background: (input.trim() || pendingFile)
                      ? 'linear-gradient(135deg,#4338ca,#6366f1)' : T.panel }}>
                    <Send size={14} className="text-white" />
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-600">
            <MessageCircle size={48} className="opacity-20" />
            <p className="text-base">{ar ? 'اختر قناة للبدء' : 'Select a channel to start'}</p>
          </div>
        )}
      </div>

      {/* ══ USERS PANEL ══ */}
      {showUsers && (
        <div className="w-60 flex-shrink-0 flex flex-col border-s border-white/[0.07]"
          style={{ background: T.panel }}>
          <div className="px-4 py-4 border-b border-white/[0.07] flex items-center justify-between">
            <span className="text-xs font-bold" style={{ color: tp(dark) }}>{ar ? 'الأعضاء' : 'Members'}</span>
            <button onClick={() => setShowUsers(false)} className="text-slate-500 hover:text-white"><X size={13} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
            {users.filter(u => u.id !== currentUserId).map(u => (
              <button key={u.id} onClick={() => openDM(u.id)}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-white/5 transition-all cursor-pointer group">
                <div className="relative flex-shrink-0">
                  <Avatar name={u.name} size={28} />
                  <span className="absolute -bottom-0.5 -end-0.5 w-2.5 h-2.5 rounded-full border-2"
                    style={{ background: presenceDot(presence[u.id] ?? u.presence), borderColor: 'var(--surface)' }} />
                </div>
                <span className="text-xs truncate flex-1 text-start" style={{ color: tp(dark) }}>{u.name}</span>
                <MessageCircle size={12} className="text-slate-600 group-hover:text-indigo-400 transition-all flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══ PORTALS ══ */}
      {showEmoji && <EmojiPicker onSelect={e => setInput(i => i + e)} onClose={() => setShowEmoji(false)} ar={ar} />}
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {showCreateGroup && <CreateGroupModal users={users} onClose={() => setShowCreateGroup(false)} onCreate={createGroup} ar={ar} />}
      {showMembers && activeChannel && (
        <MembersModal
          channelId={activeChannel.id}
          currentUserId={currentUserId}
          iAmAdmin={iAmAdmin}
          users={users}
          onClose={() => setShowMembers(false)}
          ar={ar}
        />
      )}

      {/* ══ NOTIFICATIONS ══ */}
      {notifs.length > 0 && createPortal(
        <div className="fixed top-4 end-4 z-[500] flex flex-col gap-2">
          {notifs.map(n => (
            <NotifToast key={n.id} notif={n} ar={ar}
              onClick={() => {
                const ch = channels.find(c => c.id === n.channelId);
                if (ch) setActiveChannel(ch);
                setNotifs(prev => prev.filter(x => x.id !== n.id));
              }}
              onDismiss={() => setNotifs(prev => prev.filter(x => x.id !== n.id))}
            />
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
