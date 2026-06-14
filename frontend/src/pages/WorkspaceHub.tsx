import { useSearchParams } from 'react-router-dom';
import { MessageCircle, BookOpen } from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import ChatPage from '@/pages/Chat';
import KnowledgeBasePage from '@/pages/KnowledgeBase';

type HubTab = 'chat' | 'kb';

const TABS: { key: HubTab; icon: typeof MessageCircle; ar: string; en: string; permission: string | null }[] = [
  { key: 'chat', icon: MessageCircle, ar: 'الشات',        en: 'Chat',           permission: null },
  { key: 'kb',   icon: BookOpen,      ar: 'قاعدة المعرفة', en: 'Knowledge Base', permission: 'kb.view' },
];

/**
 * Merges Chat and the Knowledge Base behind one "Workspace" nav entry with tabs.
 * Active tab lives in ?tab= so the old /knowledge-base route redirects here.
 */
export default function WorkspaceHub() {
  const ar = useUiStore(s => s.lang) === 'ar';
  const hasPermission = useAuthStore(s => s.hasPermission);
  const [params, setParams] = useSearchParams();

  const visible = TABS.filter(t => !t.permission || hasPermission(t.permission));
  const raw = params.get('tab') as HubTab | null;
  const tab: HubTab = visible.some(t => t.key === raw) ? raw! : (visible[0]?.key ?? 'chat');

  return (
    <div className="page-enter">
      {visible.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {visible.map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setParams({ tab: t.key }, { replace: true })}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={16} />
                {ar ? t.ar : t.en}
              </button>
            );
          })}
        </div>
      )}

      {tab === 'chat' && <ChatPage />}
      {tab === 'kb'   && <KnowledgeBasePage />}
    </div>
  );
}
