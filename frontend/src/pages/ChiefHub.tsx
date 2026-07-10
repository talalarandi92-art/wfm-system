import { useSearchParams } from 'react-router-dom';
import { Crown, Bot, HeartPulse, Brain, FileBarChart, ShieldAlert, ClipboardCheck, Microscope, BookOpen, MessageSquareReply, Library, GraduationCap, Stethoscope, Sparkles, LayoutDashboard, Shield, Lightbulb } from 'lucide-react';
import GroupedTabs, { TabGroupDef } from '@/components/GroupedTabs';
import ChiefPage from '@/pages/Chief';
import BotsHubPage from '@/pages/BotsHub';
import SystemHealthPage from '@/pages/SystemHealth';
import AnalystPage from '@/pages/Analyst';
import ReportsBotPage from '@/pages/ReportsBot';
import SecurityGuardPage from '@/pages/SecurityGuard';
import ScorecardGuardPage from '@/pages/ScorecardGuard';
import ResearcherPage from '@/pages/Researcher';
import ExpertPage from '@/pages/Expert';
import ReplyHelperPage from '@/pages/ReplyHelper';
import KnowledgeLedgerPage from '@/pages/KnowledgeLedger';
import TeamLearningPage from '@/pages/TeamLearning';
import DiagnosticsPage from '@/pages/Diagnostics';
import AdvisorPage from '@/pages/Advisor';

type HubTab = 'chief' | 'bots' | 'health' | 'analyst' | 'reports' | 'security' | 'scorecard' | 'researcher' | 'expert' | 'reply' | 'ledger' | 'learning' | 'diagnostics' | 'advisor';

/**
 * The 14 former flat tabs regrouped into 4 groups (R1 IA pilot).
 * Tab KEYS are unchanged — every existing `?tab=` deep link and the
 * App.tsx redirects keep working exactly as before.
 */
const GROUPS: TabGroupDef[] = [
  {
    key: 'overview', label: 'Overview', labelAr: 'نظرة عامة', icon: LayoutDashboard,
    tabs: [
      { key: 'chief',   label: 'Chief',    labelAr: 'الرئيس',   icon: Crown },
      { key: 'bots',    label: 'The Team', labelAr: 'الفريق',   icon: Bot },
      { key: 'advisor', label: 'Advisor',  labelAr: 'المستشار', icon: Sparkles },
    ],
  },
  {
    key: 'guards', label: 'Guards', labelAr: 'الحُرّاس', icon: Shield,
    tabs: [
      { key: 'health',     label: 'Health',       labelAr: 'صحة النظام',   icon: HeartPulse },
      { key: 'analyst',    label: 'Analyst',      labelAr: 'المحلّل',      icon: Brain },
      { key: 'security',   label: 'Security',     labelAr: 'حارس الأمن',   icon: ShieldAlert },
      { key: 'scorecard',  label: 'Scorecard',    labelAr: 'حارس الأداء',  icon: ClipboardCheck },
      { key: 'researcher', label: 'Researcher',   labelAr: 'الباحث',       icon: Microscope },
      { key: 'reply',      label: 'Reply Helper', labelAr: 'مساعد الردود', icon: MessageSquareReply },
    ],
  },
  {
    key: 'knowledge', label: 'Knowledge', labelAr: 'المعرفة', icon: Lightbulb,
    tabs: [
      { key: 'expert',   label: 'Expert',    labelAr: 'الخبير',       icon: BookOpen },
      { key: 'ledger',   label: 'Knowledge', labelAr: 'سجل المعرفة',  icon: Library },
      { key: 'learning', label: 'Learning',  labelAr: 'تعلّم الفريق', icon: GraduationCap },
    ],
  },
  {
    key: 'reports', label: 'Reports & Diagnostics', labelAr: 'التقارير والتشخيص', icon: FileBarChart,
    tabs: [
      { key: 'reports',     label: 'Reporter',    labelAr: 'المراسل',  icon: FileBarChart },
      { key: 'diagnostics', label: 'Diagnostics', labelAr: 'التشخيص',  icon: Stethoscope },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap(g => g.tabs.map(t => t.key));

/**
 * Chief hub — the autonomous guard TEAM under one roof. The Chief stays the
 * face (default tab); the guard pages that were flat top-level routes are
 * tabs sharing one shell, now organized into 4 groups via GroupedTabs.
 * Old routes (/bots, /system-health, /analyst, /reports-bot, /security-guard,
 * /scorecard-guard, /researcher, /expert, /reply-helper, /advisor,
 * /knowledge-ledger, /team-learning, /diagnostics) redirect here and their
 * ?tab= values are unchanged.
 */
export default function ChiefHub() {
  const [params] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = raw && ALL_KEYS.includes(raw) ? (raw as HubTab) : 'chief';

  return (
    <div className="page-enter">
      <GroupedTabs groups={GROUPS} defaultTab="chief" />

      {tab === 'chief'       && <ChiefPage />}
      {tab === 'bots'        && <BotsHubPage />}
      {tab === 'health'      && <SystemHealthPage />}
      {tab === 'analyst'     && <AnalystPage />}
      {tab === 'reports'     && <ReportsBotPage />}
      {tab === 'security'    && <SecurityGuardPage />}
      {tab === 'scorecard'   && <ScorecardGuardPage />}
      {tab === 'researcher'  && <ResearcherPage />}
      {tab === 'expert'      && <ExpertPage />}
      {tab === 'reply'       && <ReplyHelperPage />}
      {tab === 'advisor'     && <AdvisorPage />}
      {tab === 'ledger'      && <KnowledgeLedgerPage />}
      {tab === 'learning'    && <TeamLearningPage />}
      {tab === 'diagnostics' && <DiagnosticsPage />}
    </div>
  );
}
