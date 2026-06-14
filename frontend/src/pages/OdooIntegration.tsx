import { useState, useEffect } from 'react';
import {
  Plug, CheckCircle2, XCircle, Loader2, Users, CalendarDays,
  Save, Eye, RefreshCw, AlertCircle, History, Link2,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useUiStore } from '@/store/ui.store';

interface OdooConfig { url: string; db: string; username: string; apiKey: string }
interface SyncLog {
  id: string; data_type: string; total_records: number; applied_records: number;
  error_count: number; created_at: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthAgoISO = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };
const fmtDT = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

export default function OdooIntegrationPage() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';

  const [cfg, setCfg] = useState<OdooConfig>({ url: '', db: '', username: '', apiKey: '' });
  const [savedMasked, setSavedMasked] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; version?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [empResult, setEmpResult] = useState<any>(null);
  const [leaveRange, setLeaveRange] = useState({ from: monthAgoISO(), to: todayISO() });
  const [leaveResult, setLeaveResult] = useState<any>(null);
  const [history, setHistory] = useState<SyncLog[]>([]);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadConfig = () => {
    apiClient.get('/integrations/odoo/config').then((r: any) => {
      if (r.data) {
        setCfg(c => ({ ...c, url: r.data.url ?? '', db: r.data.db ?? '', username: r.data.username ?? '' }));
        setSavedMasked(r.data.apiKey ?? null);
      }
    }).catch(() => {});
  };
  const loadHistory = () => {
    apiClient.get('/integrations/odoo/history').then((r: any) => setHistory(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  };
  useEffect(() => { loadConfig(); loadHistory(); }, []);

  const flash = (type: 'ok' | 'err', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

  const test = async () => {
    setBusy('test'); setTestResult(null);
    try {
      const { data } = await apiClient.post('/integrations/odoo/test', cfg);
      setTestResult(data);
    } catch (e: any) { setTestResult({ ok: false, error: e?.response?.data?.message ?? 'Connection failed' }); }
    finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save');
    try { await apiClient.put('/integrations/odoo/config', cfg); flash('ok', ar ? 'تم حفظ الإعدادات' : 'Configuration saved'); loadConfig(); }
    catch (e: any) { flash('err', e?.response?.data?.message ?? 'Save failed'); }
    finally { setBusy(null); }
  };
  const previewEmp = async () => {
    setBusy('emp-preview'); setEmpResult(null);
    try { const { data } = await apiClient.post('/integrations/odoo/employees/preview', {}); setEmpResult(data); if (data.error) flash('err', data.error); }
    catch (e: any) { flash('err', e?.response?.data?.message ?? 'Preview failed'); }
    finally { setBusy(null); }
  };
  const syncEmp = async () => {
    setBusy('emp-sync');
    try { const { data } = await apiClient.post('/integrations/odoo/employees/sync', {});
      if (data.error) flash('err', data.error);
      else flash('ok', ar ? `تمت المزامنة: ${data.created} جديد، ${data.updated} محدّث` : `Synced: ${data.created} created, ${data.updated} updated`);
      loadHistory();
    } catch (e: any) { flash('err', e?.response?.data?.message ?? 'Sync failed'); }
    finally { setBusy(null); }
  };
  const previewLeaves = async () => {
    setBusy('leave-preview'); setLeaveResult(null);
    try { const { data } = await apiClient.post('/integrations/odoo/leaves/preview', { dateFrom: leaveRange.from, dateTo: leaveRange.to }); setLeaveResult(data); if (data.error) flash('err', data.error); }
    catch (e: any) { flash('err', e?.response?.data?.message ?? 'Preview failed'); }
    finally { setBusy(null); }
  };
  const syncLeaves = async () => {
    setBusy('leave-sync');
    try { const { data } = await apiClient.post('/integrations/odoo/leaves/sync', { dateFrom: leaveRange.from, dateTo: leaveRange.to });
      if (data.error) flash('err', data.error);
      else flash('ok', ar ? `تمت مزامنة ${data.applied} يوم إجازة` : `Applied ${data.applied} leave days`);
      loadHistory();
    } catch (e: any) { flash('err', e?.response?.data?.message ?? 'Sync failed'); }
    finally { setBusy(null); }
  };

  const inputCls = "w-full px-3 py-2 rounded-xl text-sm text-white outline-none";
  const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' };
  const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(168,85,247,0.15)' }}>
          <Plug size={18} className="text-purple-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{ar ? 'تكامل Odoo' : 'Odoo Integration'}</h1>
          <p className="text-xs text-slate-500">{ar ? 'مزامنة الموظفين والإجازات من Odoo عبر XML-RPC الرسمي' : 'Sync employees & leaves from Odoo via the official XML-RPC API'}</p>
        </div>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold ${msg.type === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}
          style={{ background: msg.type === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${msg.type === 'ok' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
          {msg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{msg.text}
        </div>
      )}

      {/* ── Connection ── */}
      <div className="p-5 rounded-2xl space-y-3" style={card}>
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><Link2 size={15} className="text-purple-400" /> {ar ? 'الاتصال' : 'Connection'}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-slate-500 font-semibold uppercase">{ar ? 'رابط Odoo' : 'Odoo URL'}</label>
            <input className={inputCls} style={inputStyle} placeholder="https://boutiqaat.odoo.com" value={cfg.url} onChange={e => setCfg({ ...cfg, url: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-semibold uppercase">{ar ? 'قاعدة البيانات' : 'Database'}</label>
            <input className={inputCls} style={inputStyle} placeholder="boutiqaat-prod" value={cfg.db} onChange={e => setCfg({ ...cfg, db: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-semibold uppercase">{ar ? 'اسم المستخدم' : 'Username'}</label>
            <input className={inputCls} style={inputStyle} placeholder="admin@boutiqaat.com" value={cfg.username} onChange={e => setCfg({ ...cfg, username: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-semibold uppercase">{ar ? 'مفتاح API' : 'API Key'}</label>
            <input className={inputCls} style={inputStyle} type="password"
              placeholder={savedMasked ? `${ar ? 'محفوظ' : 'saved'}: ${savedMasked}` : 'API key'}
              value={cfg.apiKey} onChange={e => setCfg({ ...cfg, apiKey: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button onClick={test} disabled={busy !== null || !cfg.url || !cfg.db}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-200 transition-all disabled:opacity-40"
            style={inputStyle}>
            {busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} {ar ? 'اختبار الاتصال' : 'Test Connection'}
          </button>
          <button onClick={save} disabled={busy !== null || !cfg.url || !cfg.db}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)' }}>
            {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {ar ? 'حفظ' : 'Save'}
          </button>
          {testResult && (
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {testResult.ok ? (ar ? `متصل — Odoo ${testResult.version ?? ''}` : `Connected — Odoo ${testResult.version ?? ''}`) : (testResult.error ?? (ar ? 'فشل' : 'Failed'))}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Employees ── */}
        <div className="p-5 rounded-2xl space-y-3" style={card}>
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Users size={15} className="text-indigo-400" /> {ar ? 'مزامنة الموظفين' : 'Employee Sync'}</h2>
          <p className="text-[11px] text-slate-500">{ar ? 'يجلب الموظفين من hr.employee ويربطهم برقم الموظف.' : 'Fetches from hr.employee and links by employee number.'}</p>
          <div className="flex items-center gap-2">
            <button onClick={previewEmp} disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-200 disabled:opacity-40" style={inputStyle}>
              {busy === 'emp-preview' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} {ar ? 'معاينة' : 'Preview'}
            </button>
            <button onClick={syncEmp} disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)' }}>
              {busy === 'emp-sync' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {ar ? 'مزامنة' : 'Sync'}
            </button>
          </div>
          {empResult && !empResult.error && (
            <div className="text-[11px] text-slate-400 pt-1">
              {empResult.count !== undefined && <p className="text-white font-semibold mb-1">{empResult.count} {ar ? 'موظف في Odoo' : 'employees in Odoo'}</p>}
              {empResult.created !== undefined && <p>{ar ? `${empResult.created} جديد · ${empResult.updated} محدّث · ${empResult.errors?.length ?? 0} أخطاء` : `${empResult.created} created · ${empResult.updated} updated · ${empResult.errors?.length ?? 0} errors`}</p>}
              {empResult.sample?.slice(0, 5).map((e: any, i: number) => <p key={i} className="text-slate-600 truncate">• {e.name} {e.employeeNo ? `(#${e.employeeNo})` : ''}</p>)}
            </div>
          )}
        </div>

        {/* ── Leaves ── */}
        <div className="p-5 rounded-2xl space-y-3" style={card}>
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><CalendarDays size={15} className="text-amber-400" /> {ar ? 'مزامنة الإجازات' : 'Leave Sync'}</h2>
          <div className="flex items-center gap-2">
            <input type="date" className={inputCls} style={inputStyle} value={leaveRange.from} onChange={e => setLeaveRange({ ...leaveRange, from: e.target.value })} />
            <input type="date" className={inputCls} style={inputStyle} value={leaveRange.to} onChange={e => setLeaveRange({ ...leaveRange, to: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={previewLeaves} disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-200 disabled:opacity-40" style={inputStyle}>
              {busy === 'leave-preview' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} {ar ? 'معاينة' : 'Preview'}
            </button>
            <button onClick={syncLeaves} disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#d97706,#f59e0b)' }}>
              {busy === 'leave-sync' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {ar ? 'مزامنة' : 'Sync'}
            </button>
          </div>
          {leaveResult && !leaveResult.error && (
            <div className="text-[11px] text-slate-400 pt-1">
              {leaveResult.count !== undefined && <p className="text-white font-semibold mb-1">{leaveResult.count} {ar ? 'إجازة' : 'leaves'}</p>}
              {leaveResult.applied !== undefined && <p>{ar ? `${leaveResult.applied} يوم تمت مزامنته` : `${leaveResult.applied} days applied`}</p>}
              {leaveResult.leaves?.slice(0, 5).map((l: any, i: number) => <p key={i} className="text-slate-600 truncate">• {l.employeeName}: {l.leaveType} ({l.dateFrom}→{l.dateTo})</p>)}
            </div>
          )}
        </div>
      </div>

      {/* ── History ── */}
      <div className="p-5 rounded-2xl" style={card}>
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3"><History size={15} className="text-slate-400" /> {ar ? 'سجل المزامنة' : 'Sync History'}</h2>
        {history.length === 0 ? <p className="text-xs text-slate-600 text-center py-4">{ar ? 'لا يوجد سجل بعد' : 'No sync history yet'}</p> : (
          <div className="space-y-1">
            {history.map(h => (
              <div key={h.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <span className="text-slate-300 capitalize">{h.data_type}</span>
                <span className="text-slate-500">{ar ? `${h.applied_records}/${h.total_records} تم` : `${h.applied_records}/${h.total_records} applied`}{h.error_count > 0 && <span className="text-red-400"> · {h.error_count} {ar ? 'خطأ' : 'err'}</span>}</span>
                <span className="text-slate-600">{fmtDT(h.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
