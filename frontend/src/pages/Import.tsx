import { useState, useCallback, useRef } from 'react';
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle,
  AlertTriangle, ChevronRight, ChevronDown, Loader2,
  RefreshCw, Database, Eye, ArrowRight,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportType = 'timing' | 'shifts';
type FilterMode = 'all' | 'valid' | 'error' | 'warning';

interface BatchSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  globalErrors: string[];
  sheetNames: string[];
}

interface PreviewRow {
  id: string;
  rowNumber: number;
  status: 'valid' | 'error' | 'warning';
  errors: string[] | null;
  warnings: string[] | null;
  data: Record<string, any>;
}

interface PreviewResult {
  batch: {
    id: string;
    importType: string;
    filename: string;
    status: string;
    totalRows: number;
    validRows: number;
    errorRows: number;
    warningRows: number;
  };
  rows: PreviewRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ImportType, { en: string; ar: string; desc_en: string; desc_ar: string }> = {
  timing:  { en: 'Timing Sheet',   ar: 'جدول التوقيتات',  desc_en: 'Import shift code dictionary from Timing sheet', desc_ar: 'استيراد قاموس رموز الشيفتات' },
  shifts:  { en: 'Attendance',     ar: 'بيانات الحضور',   desc_en: 'Import daily attendance records',                desc_ar: 'استيراد سجلات الحضور اليومية' },
};

const STATUS_COLOR: Record<string, string> = {
  valid:   'text-emerald-600 dark:text-emerald-400',
  error:   'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
};

const STATUS_BG: Record<string, string> = {
  valid:   'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
  error:   'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';

  // Step state
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [importType, setImportType] = useState<ImportType>('timing');
  const [sheetName, setSheetName] = useState('');
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  // Step 2: preview
  const [batchId, setBatchId] = useState<string | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Step 3: commit
  const [commitResult, setCommitResult] = useState<any | null>(null);

  // Loading/error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── File handling ────────────────────────────────────────────────────────

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }, []);

  const acceptFile = async (f: File) => {
    setFile(f);
    setError(null);
    setAvailableSheets([]);
    setSheetName('');
    // Auto-detect sheet names — show loading state on the drop zone
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { data } = await apiClient.post('/imports/sheets', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const sheets: string[] = data.sheetNames ?? [];
      setAvailableSheets(sheets);
      // Auto-select the most likely Timing/Shifts sheet
      const autoSheet = sheets.find(s => /timing|توقيت/i.test(s)) ?? '';
      if (autoSheet) setSheetName(autoSheet);
    } catch {
      // Non-critical — user can type sheet name manually
    }
  };

  // ─── Step 1 → 2: Upload & Parse ──────────────────────────────────────────

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const params = new URLSearchParams({ type: importType });
      if (sheetName) params.set('sheet', sheetName);

      const { data } = await apiClient.post(`/imports/upload?${params}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setBatchId(data.batchId);
      setSummary(data.summary);
      setStep(2);
      // Load first page of preview automatically
      await loadPreview(data.batchId, 1, 'all');
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  // ─── Load preview rows ────────────────────────────────────────────────────

  const loadPreview = async (bid: string, page: number, filter: FilterMode) => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(
        `/imports/${bid}/preview?page=${page}&limit=50&filter=${filter}`,
      );
      setPreview(data);
      setPreviewPage(page);
      setFilterMode(filter);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 2 → 3: Commit ──────────────────────────────────────────────────

  const handleCommit = async (skipErrors = false) => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.post(`/imports/${batchId}/commit`, { skipErrors });
      setCommitResult(data);
      setStep(3);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Commit failed');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep(1);
    setFile(null);
    setBatchId(null);
    setSummary(null);
    setPreview(null);
    setCommitResult(null);
    setError(null);
    setAvailableSheets([]);
    setSheetName('');
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6" dir={ar ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Database size={24} className="text-blue-600" />
            {ar ? 'استيراد البيانات' : 'Data Import'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {ar
              ? 'استيراد ملف Excel — جدول التوقيتات أو بيانات الحضور'
              : 'Import Excel workbook — Timing sheet or attendance data'}
          </p>
        </div>
        {step > 1 && (
          <button onClick={reset} className="btn-secondary flex items-center gap-2 text-sm">
            <RefreshCw size={14} />
            {ar ? 'استيراد جديد' : 'New Import'}
          </button>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { n: 1, en: 'Upload',  ar: 'رفع الملف' },
          { n: 2, en: 'Preview', ar: 'مراجعة' },
          { n: 3, en: 'Done',    ar: 'اكتمل' },
        ].map(({ n, en, ar: arLabel }, idx) => (
          <div key={n} className="flex items-center gap-2">
            <div className={`
              w-7 h-7 rounded-full flex items-center justify-center font-semibold text-xs
              ${step === n ? 'bg-blue-600 text-white' :
                step > n  ? 'bg-emerald-500 text-white' :
                             'bg-gray-100 dark:bg-gray-800 text-gray-400'}
            `}>
              {step > n ? <CheckCircle2 size={14} /> : n}
            </div>
            <span className={step === n ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-400'}>
              {ar ? arLabel : en}
            </span>
            {idx < 2 && <ArrowRight size={14} className="text-gray-300" />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Upload ─────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Import type selection */}
          <div className="card p-5 space-y-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              {ar ? 'نوع الاستيراد' : 'Import Type'}
            </h2>
            <div className="space-y-3">
              {(Object.keys(TYPE_LABELS) as ImportType[]).map(type => (
                <label
                  key={type}
                  className={`
                    flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                    ${importType === type
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'}
                  `}
                >
                  <input
                    type="radio"
                    name="importType"
                    value={type}
                    checked={importType === type}
                    onChange={() => setImportType(type)}
                    className="mt-0.5 accent-blue-600"
                  />
                  <div>
                    <p className="font-medium text-sm text-gray-900 dark:text-white">
                      {ar ? TYPE_LABELS[type].ar : TYPE_LABELS[type].en}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {ar ? TYPE_LABELS[type].desc_ar : TYPE_LABELS[type].desc_en}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {/* Sheet selector */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {ar ? 'اختر ورقة العمل' : 'Select Sheet'}
                {availableSheets.length > 0 && (
                  <span className="ms-1 text-blue-500">
                    ({availableSheets.length} {ar ? 'ورقة' : 'sheets'})
                  </span>
                )}
              </label>
              {availableSheets.length > 0 ? (
                <>
                  <select
                    value={sheetName}
                    onChange={e => setSheetName(e.target.value)}
                    className="input-field text-sm w-full"
                  >
                    <option value="">{ar ? '— تلقائي —' : '— Auto detect —'}</option>
                    {availableSheets.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {availableSheets.map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSheetName(s)}
                        className={`
                          text-xs px-2 py-0.5 rounded-full border transition-colors
                          ${sheetName === s
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-blue-400 hover:text-blue-600'}
                        `}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <input
                  type="text"
                  value={sheetName}
                  onChange={e => setSheetName(e.target.value)}
                  placeholder={ar ? 'مثال: Timing' : 'e.g. Timing'}
                  className="input-field text-sm w-full"
                />
              )}
            </div>
          </div>

          {/* File drop zone */}
          <div className="card p-5 space-y-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              {ar ? 'رفع ملف Excel' : 'Upload Excel File'}
            </h2>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
                ${dragging
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : file
                  ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                onChange={e => e.target.files?.[0] && acceptFile(e.target.files[0])}
              />
              {file ? (
                <div className="space-y-2">
                  <FileSpreadsheet size={36} className="mx-auto text-emerald-500" />
                  <p className="font-medium text-emerald-700 dark:text-emerald-300 text-sm">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                  {availableSheets.length > 0 && (
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      {availableSheets.length} {ar ? 'ورقة موجودة' : 'sheets found'}:{' '}
                      {availableSheets.slice(0, 4).join(', ')}{availableSheets.length > 4 ? '…' : ''}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload size={36} className="mx-auto text-gray-300 dark:text-gray-600" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {ar ? 'اسحب الملف هنا أو انقر للاختيار' : 'Drag & drop or click to select'}
                  </p>
                  <p className="text-xs text-gray-400">.xlsx / .xls — max 50 MB</p>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <XCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!file || loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> {ar ? 'جاري التحليل…' : 'Parsing…'}</>
                : <><Eye size={16} /> {ar ? 'تحليل ومعاينة' : 'Parse & Preview'}</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Preview ────────────────────────────────────────────── */}
      {step === 2 && summary && preview && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: ar ? 'إجمالي' : 'Total',    val: summary.totalRows,   color: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-50 dark:bg-gray-800' },
              { label: ar ? 'صحيح'  : 'Valid',    val: summary.validRows,   color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
              { label: ar ? 'خطأ'   : 'Errors',   val: summary.errorRows,   color: 'text-red-700 dark:text-red-300',     bg: 'bg-red-50 dark:bg-red-900/20' },
              { label: ar ? 'تحذير' : 'Warnings', val: summary.warningRows, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-900/20' },
            ].map(({ label, val, color, bg }) => (
              <div key={label} className={`card p-4 ${bg}`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                <p className={`text-2xl font-bold mt-1 ${color}`}>{val}</p>
              </div>
            ))}
          </div>

          {/* Global errors from parser */}
          {summary.globalErrors?.length > 0 && (
            <div className="card p-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2 flex items-center gap-2">
                <XCircle size={14} /> {ar ? 'أخطاء المحلل' : 'Parser Errors'}
              </p>
              {summary.globalErrors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>
              ))}
            </div>
          )}

          {/* Filter + table */}
          <div className="card overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-1">
                {(['all', 'valid', 'error', 'warning'] as FilterMode[]).map(f => (
                  <button
                    key={f}
                    onClick={() => batchId && loadPreview(batchId, 1, f)}
                    className={`
                      px-3 py-1 rounded-full text-xs font-medium transition-colors
                      ${filterMode === f
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}
                    `}
                  >
                    {f === 'all'     ? (ar ? 'الكل' : 'All')        :
                     f === 'valid'   ? (ar ? 'صحيح' : 'Valid')      :
                     f === 'error'   ? (ar ? 'خطأ'  : 'Errors')     :
                                       (ar ? 'تحذير': 'Warnings')}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                {preview.pagination.total} {ar ? 'صف' : 'rows'}
              </p>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-2 text-start w-16">#</th>
                    <th className="px-4 py-2 text-start w-24">{ar ? 'الحالة' : 'Status'}</th>
                    {preview.rows[0] && Object.keys(preview.rows[0].data)
                      .filter(k => !['errors', 'warnings', 'rowNumber', 'source'].includes(k))
                      .slice(0, 8)
                      .map(k => (
                        <th key={k} className="px-4 py-2 text-start">{k}</th>
                      ))
                    }
                    <th className="px-4 py-2 text-start">{ar ? 'تفاصيل' : 'Details'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {preview.rows.map(row => {
                    const dataKeys = Object.keys(row.data)
                      .filter(k => !['errors', 'warnings', 'rowNumber', 'source'].includes(k))
                      .slice(0, 8);
                    const isExpanded = expandedRow === row.id;

                    return (
                      <>
                        <tr
                          key={row.id}
                          className={`
                            hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer
                            ${row.status === 'error' ? 'bg-red-50/30 dark:bg-red-900/10' :
                              row.status === 'warning' ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''}
                          `}
                          onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                        >
                          <td className="px-4 py-2 text-gray-400 font-mono text-xs">{row.rowNumber}</td>
                          <td className="px-4 py-2">
                            <span className={`
                              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                              ${STATUS_COLOR[row.status]}
                            `}>
                              {row.status === 'valid'   && <CheckCircle2  size={10} />}
                              {row.status === 'error'   && <XCircle       size={10} />}
                              {row.status === 'warning' && <AlertTriangle size={10} />}
                              {row.status}
                            </span>
                          </td>
                          {dataKeys.map(k => (
                            <td key={k} className="px-4 py-2 text-gray-700 dark:text-gray-300 truncate max-w-32">
                              {row.data[k] == null ? (
                                <span className="text-gray-300 dark:text-gray-600">—</span>
                              ) : (
                                String(row.data[k])
                              )}
                            </td>
                          ))}
                          <td className="px-4 py-2">
                            {(row.errors?.length || row.warnings?.length) ? (
                              <button className={`text-xs ${STATUS_COLOR[row.status]} flex items-center gap-1`}>
                                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                {row.errors?.length || 0}E / {row.warnings?.length || 0}W
                              </button>
                            ) : null}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${row.id}-detail`}>
                            <td colSpan={dataKeys.length + 3} className="px-4 pb-3">
                              <div className={`rounded-lg border p-3 space-y-1 ${STATUS_BG[row.status]}`}>
                                {row.errors?.map((e, i) => (
                                  <p key={i} className="text-xs text-red-700 dark:text-red-300 flex items-center gap-1">
                                    <XCircle size={10} /> {e}
                                  </p>
                                ))}
                                {row.warnings?.map((w, i) => (
                                  <p key={i} className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                                    <AlertTriangle size={10} /> {w}
                                  </p>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {preview.pagination.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                <button
                  disabled={previewPage <= 1 || loading}
                  onClick={() => batchId && loadPreview(batchId, previewPage - 1, filterMode)}
                  className="btn-secondary text-xs py-1 px-3"
                >
                  {ar ? 'السابق' : 'Previous'}
                </button>
                <p className="text-xs text-gray-500">
                  {ar ? `صفحة ${previewPage} من ${preview.pagination.pages}` : `Page ${previewPage} of ${preview.pagination.pages}`}
                </p>
                <button
                  disabled={previewPage >= preview.pagination.pages || loading}
                  onClick={() => batchId && loadPreview(batchId, previewPage + 1, filterMode)}
                  className="btn-secondary text-xs py-1 px-3"
                >
                  {ar ? 'التالي' : 'Next'}
                </button>
              </div>
            )}
          </div>

          {/* Commit actions */}
          <div className="card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-medium text-gray-900 dark:text-white text-sm">
                {ar ? 'جاهز للاستيراد؟' : 'Ready to commit?'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {summary.errorRows > 0
                  ? (ar
                      ? `يوجد ${summary.errorRows} صف به أخطاء. يمكنك تجاهلها واستيراد الصحيحة فقط.`
                      : `${summary.errorRows} rows have errors. You can skip them and commit valid rows only.`)
                  : (ar ? 'كل الصفوف صحيحة وجاهزة.' : 'All rows are valid and ready.')
                }
              </p>
            </div>
            <div className="flex items-center gap-3">
              {summary.errorRows > 0 && (
                <button
                  onClick={() => handleCommit(true)}
                  disabled={loading}
                  className="btn-secondary text-sm flex items-center gap-2"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                  {ar ? 'استيراد الصحيحة فقط' : 'Commit valid only'}
                </button>
              )}
              <button
                onClick={() => handleCommit(false)}
                disabled={loading || summary.errorRows > 0}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                {ar ? 'استيراد الكل' : 'Commit all'}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <XCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: Done ───────────────────────────────────────────────── */}
      {step === 3 && commitResult && (
        <div className="card p-8 text-center space-y-4 max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} className="text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {ar ? 'تم الاستيراد بنجاح' : 'Import Complete'}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {ar
              ? `تم استيراد ${commitResult.committed} صف بنجاح. تم تجاهل ${commitResult.skipped} صف.`
              : `${commitResult.committed} rows committed. ${commitResult.skipped} rows skipped.`}
          </p>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="card p-3 bg-emerald-50 dark:bg-emerald-900/20">
              <p className="text-xs text-gray-500">{ar ? 'مستورد' : 'Committed'}</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{commitResult.committed}</p>
            </div>
            <div className="card p-3 bg-gray-50 dark:bg-gray-800">
              <p className="text-xs text-gray-500">{ar ? 'تجاهل' : 'Skipped'}</p>
              <p className="text-2xl font-bold text-gray-400">{commitResult.skipped}</p>
            </div>
          </div>
          <button onClick={reset} className="btn-primary w-full mt-2">
            {ar ? 'استيراد آخر' : 'Import Another File'}
          </button>
        </div>
      )}
    </div>
  );
}
