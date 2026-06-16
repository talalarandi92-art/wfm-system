import { useEffect, useState } from 'react';
import { Filter } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { useFilterStore } from '@/store/filter.store';

/**
 * Shared function filter bound to the global filter store. Drop it on any page;
 * the selection persists and is shared across pages that read useFilterStore().
 */
export function FunctionFilter({ compact = false }: { compact?: boolean }) {
  const ar = useUiStore(s => s.lang) === 'ar';
  const { functionId, setFunction, clearFunction } = useFilterStore();
  const [funcs, setFuncs] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    apiClient.get('/schedule-generator/functions')
      .then(r => setFuncs((Array.isArray(r.data) ? r.data : [])
        .filter((f: any) => parseInt(f.employee_count ?? '1', 10) > 0)
        .map((f: any) => ({ id: f.id, name: f.name }))))
      .catch(() => setFuncs([]));
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      {!compact && <Filter size={13} style={{ color: functionId ? '#818cf8' : '#475569' }} />}
      <select
        value={functionId}
        onChange={e => {
          const id = e.target.value;
          if (!id) clearFunction();
          else setFunction(id, funcs.find(f => f.id === id)?.name ?? '');
        }}
        className="text-xs rounded-xl px-3 py-1.5 outline-none"
        style={{
          background: functionId ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${functionId ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.1)'}`,
          color: functionId ? '#a5b4fc' : '#e2e8f0',
        }}>
        <option value="" style={{ background: '#0f172a', color: '#e2e8f0' }}>{ar ? 'كل الأقسام' : 'All functions'}</option>
        {funcs.map(f => <option key={f.id} value={f.id} style={{ background: '#0f172a', color: '#e2e8f0' }}>{f.name}</option>)}
      </select>
    </div>
  );
}
