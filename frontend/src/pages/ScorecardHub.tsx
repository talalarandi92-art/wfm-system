import { useSearchParams } from 'react-router-dom';
import { Award, ClipboardCheck, Trophy, Activity, UserCircle, Users, GraduationCap, Gauge } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
import ScorecardPage from '@/pages/Scorecard';
import ScorecardBoardPage from '@/pages/ScorecardBoard';
import AgentScoresPage from '@/pages/AgentScores';
import TrendsPage from '@/pages/Trends';
import Agent360Page from '@/pages/Agent360';
import Team360Page from '@/pages/Team360';
import CoachingPage from '@/pages/Coaching';
import ProductivityPage from '@/pages/Productivity';

type HubTab = 'overview' | 'board' | 'leaderboard' | 'trends' | 'agent360' | 'team360' | 'coaching' | 'productivity';

const TABS: { key: HubTab; icon: typeof Award; ar: string; en: string }[] = [
  { key: 'overview',     icon: Award,          ar: 'السكوركارد',      en: 'Scorecard' },
  { key: 'board',        icon: ClipboardCheck, ar: 'لوحة النتائج',    en: 'Board' },
  { key: 'leaderboard',  icon: Trophy,         ar: 'الترتيب',         en: 'Leaderboard' },
  { key: 'trends',       icon: Activity,       ar: 'الاتجاهات',       en: 'Trends' },
  { key: 'agent360',     icon: UserCircle,     ar: 'ملف 360',         en: 'Agent 360' },
  { key: 'team360',      icon: Users,          ar: 'الفريق 360',      en: 'Team 360' },
  { key: 'coaching',     icon: GraduationCap,  ar: 'التدريب',         en: 'Coaching' },
  { key: 'productivity', icon: Gauge,          ar: 'الإنتاجية',       en: 'Productivity' },
];

/**
 * Scorecard hub — one home for the performance-scoring & coaching theme that
 * was split across 8 sibling routes in two different sidebar sections. Old
 * routes (/scorecard-board, /agent-scores, /trends, /agent-360, /team-360,
 * /coaching, /productivity) redirect here, so existing links keep working.
 */
export default function ScorecardHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = TABS.some(t => t.key === raw) ? (raw as HubTab) : 'overview';

  return (
    <div className="page-enter">
      <HubTabs tabs={TABS} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />

      {tab === 'overview'     && <ScorecardPage />}
      {tab === 'board'        && <ScorecardBoardPage />}
      {tab === 'leaderboard'  && <AgentScoresPage />}
      {tab === 'trends'       && <TrendsPage />}
      {tab === 'agent360'     && <Agent360Page />}
      {tab === 'team360'      && <Team360Page />}
      {tab === 'coaching'     && <CoachingPage />}
      {tab === 'productivity' && <ProductivityPage />}
    </div>
  );
}
