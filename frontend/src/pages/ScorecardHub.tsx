import { useSearchParams } from 'react-router-dom';
import { Award, ClipboardCheck, Trophy, Activity, UserCircle, Users, GraduationCap, Gauge, LayoutDashboard, Orbit } from 'lucide-react';
import GroupedTabs, { TabGroupDef } from '@/components/GroupedTabs';
import ScorecardPage from '@/pages/Scorecard';
import ScorecardBoardPage from '@/pages/ScorecardBoard';
import AgentScoresPage from '@/pages/AgentScores';
import TrendsPage from '@/pages/Trends';
import Agent360Page from '@/pages/Agent360';
import Team360Page from '@/pages/Team360';
import CoachingPage from '@/pages/Coaching';
import ProductivityPage from '@/pages/Productivity';

type HubTab = 'overview' | 'board' | 'leaderboard' | 'trends' | 'agent360' | 'team360' | 'coaching' | 'productivity';

/**
 * The 8 former flat tabs regrouped into 5 groups (R1 rollout).
 * Tab KEYS are unchanged — every existing `?tab=` deep link and the
 * App.tsx redirects keep working exactly as before.
 */
const GROUPS: TabGroupDef[] = [
  {
    key: 'overview', label: 'Overview', labelAr: 'نظرة عامة', icon: LayoutDashboard,
    tabs: [
      { key: 'overview', label: 'Scorecard', labelAr: 'السكوركارد', icon: Award },
    ],
  },
  {
    key: 'board', label: 'Board & Ranking', labelAr: 'اللوحة والترتيب', icon: Trophy,
    tabs: [
      { key: 'board',       label: 'Board',       labelAr: 'لوحة النتائج', icon: ClipboardCheck },
      { key: 'leaderboard', label: 'Leaderboard', labelAr: 'الترتيب',      icon: Trophy },
    ],
  },
  {
    key: 'trends', label: 'Trends', labelAr: 'الاتجاهات', icon: Activity,
    tabs: [
      { key: 'trends', label: 'Trends', labelAr: 'الاتجاهات', icon: Activity },
    ],
  },
  {
    key: '360', label: '360°', labelAr: '360°', icon: Orbit,
    tabs: [
      { key: 'agent360', label: 'Agent 360', labelAr: 'ملف 360',   icon: UserCircle },
      { key: 'team360',  label: 'Team 360',  labelAr: 'الفريق 360', icon: Users },
    ],
  },
  {
    key: 'coaching', label: 'Coaching & Productivity', labelAr: 'التدريب والإنتاجية', icon: GraduationCap,
    tabs: [
      { key: 'coaching',     label: 'Coaching',     labelAr: 'التدريب',   icon: GraduationCap },
      { key: 'productivity', label: 'Productivity', labelAr: 'الإنتاجية', icon: Gauge },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap(g => g.tabs.map(t => t.key));

/**
 * Scorecard hub — one home for the performance-scoring & coaching theme that
 * was split across 8 sibling routes in two different sidebar sections. Old
 * routes (/scorecard-board, /agent-scores, /trends, /agent-360, /team-360,
 * /coaching, /productivity) redirect here, so existing links keep working.
 * (R1) Flat 8-tab strip regrouped into 5 groups via GroupedTabs — the ?tab=
 * keys are unchanged.
 */
export default function ScorecardHub() {
  const [params] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = raw && ALL_KEYS.includes(raw) ? (raw as HubTab) : 'overview';

  return (
    <div className="page-enter">
      <GroupedTabs groups={GROUPS} defaultTab="overview" />

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
