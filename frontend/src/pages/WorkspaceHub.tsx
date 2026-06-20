import { useSearchParams } from 'react-router-dom';
import { MessageCircle, BookOpen } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
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
  const hasPermission = useAuthStore(s => s.hasPermission);
  const [params, setParams] = useSearchParams();

  const visible = TABS.filter(t => !t.permission || hasPermission(t.permission));
  const raw = params.get('tab') as HubTab | null;
  const tab: HubTab = visible.some(t => t.key === raw) ? raw! : (visible[0]?.key ?? 'chat');

  return (
    <div className="page-enter">
      {visible.length > 1 && (
        <HubTabs tabs={visible} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />
      )}

      {tab === 'chat' && <ChatPage />}
      {tab === 'kb'   && <KnowledgeBasePage />}
    </div>
  );
}
