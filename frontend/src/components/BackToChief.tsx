import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';

/**
 * Reusable "back to Chief" affordance for every guard/bot page.
 * Guard pages are reached from the Chief / Bots Hub but had no way back —
 * this drops a consistent back button at the top-start of any page.
 * Uses history.back() when there's history, else routes to /chief.
 */
export function BackToChief({ to = '/chief' }: { to?: string }) {
  const nav = useNavigate();
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const Icon = ar ? ArrowRight : ArrowLeft;
  return (
    <button
      onClick={() => { if (window.history.length > 1) nav(-1); else nav(to); }}
      className="flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 mb-3"
      style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.22)', color: '#fde047' }}
    >
      <Icon size={14} /> {ar ? 'رجوع للقائد' : 'Back to Chief'}
    </button>
  );
}
