import { useSearchParams } from 'react-router-dom';
import { Crown, Bot, HeartPulse, Brain, FileBarChart, ShieldAlert, ClipboardCheck, Microscope, BookOpen, MessageSquareReply, Library, GraduationCap, Stethoscope, Sparkles } from 'lucide-react';
import HubTabs from '@/components/HubTabs';
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

const TABS: { key: HubTab; icon: typeof Crown; ar: string; en: string }[] = [
  { key: 'chief',       icon: Crown,             ar: 'الرئيس',          en: 'Chief' },
  { key: 'bots',        icon: Bot,               ar: 'الفريق',          en: 'The Team' },
  { key: 'health',      icon: HeartPulse,        ar: 'صحة النظام',      en: 'Health' },
  { key: 'analyst',     icon: Brain,             ar: 'المحلّل',         en: 'Analyst' },
  { key: 'reports',     icon: FileBarChart,      ar: 'المراسل',         en: 'Reporter' },
  { key: 'security',    icon: ShieldAlert,       ar: 'حارس الأمن',      en: 'Security' },
  { key: 'scorecard',   icon: ClipboardCheck,    ar: 'حارس الأداء',     en: 'Scorecard' },
  { key: 'researcher',  icon: Microscope,        ar: 'الباحث',          en: 'Researcher' },
  { key: 'expert',      icon: BookOpen,          ar: 'الخبير',          en: 'Expert' },
  { key: 'reply',       icon: MessageSquareReply, ar: 'مساعد الردود',   en: 'Reply Helper' },
  { key: 'advisor',     icon: Sparkles,          ar: 'المستشار',        en: 'Advisor' },
  { key: 'ledger',      icon: Library,           ar: 'سجل المعرفة',     en: 'Knowledge' },
  { key: 'learning',    icon: GraduationCap,     ar: 'تعلّم الفريق',    en: 'Learning' },
  { key: 'diagnostics', icon: Stethoscope,       ar: 'التشخيص',         en: 'Diagnostics' },
];

/**
 * Chief hub — the autonomous guard TEAM under one roof. The Chief stays the
 * face (default tab); the 13 guard pages that were flat top-level routes are
 * now tabs sharing one shell with a consistent back-to-Chief affordance.
 * Old routes (/bots, /system-health, /analyst, /reports-bot, /security-guard,
 * /scorecard-guard, /researcher, /expert, /reply-helper, /advisor,
 * /knowledge-ledger, /team-learning, /diagnostics) redirect here.
 */
export default function ChiefHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: HubTab = TABS.some(t => t.key === raw) ? (raw as HubTab) : 'chief';

  return (
    <div className="page-enter">
      <HubTabs tabs={TABS} active={tab} onChange={k => setParams({ tab: k }, { replace: true })} />

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
