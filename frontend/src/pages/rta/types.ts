import { fmtDuration, fmtDateTimeTime } from '@/utils/format';

/* ── Types ─────────────────────────────────────────────────────────────────── */
export interface SpQueue {
  queueId: string; queueName: string;
  channel: 'whatsapp' | 'chat' | 'email' | 'social' | 'voice' | 'unknown';
  waiting: number; inProgress: number; backlog: number;
  avgWaitSeconds: number; slaBreached: number; slaPct: number;
  agentsAvailable: number; agentsBusy: number; agentsBreak: number; aht: number;
  agentsIdle?: number; agentsLoggedIn?: number;
}
export interface SpAgent {
  agentId: string; agentName: string;
  status: 'available' | 'idle' | 'busy' | 'break' | 'away' | 'offline' | 'unknown';
  statusRaw?: string;
  currentChannel: string; queueId: string; loginTime: string;
  statusSince?: string; statusSec?: number;  // live "in current status for X" (status-transition engine)
}
export interface StationSummary {
  queueSummary?: {
    customersWaiting: number; casesInProgress: number;
    avgWaitSeconds: number; oldestWaitSeconds: number;
  } | null;
  agentStatus?: { label: string; count: number }[];
  agentState?:  { label: string; count: number; pct: number }[];
  capturedAt?: string;
}
export interface SpLive {
  capturedAt: string; staleSec: number; isStale: boolean;
  summary: { totalWaiting: number; totalInProgress: number; totalAvailable: number; totalBusy: number; avgSla: number };
  atRisk: SpQueue[]; queues: SpQueue[]; agents: SpAgent[];
  stationSummary?: StationSummary | null;
}
export interface BreakAgent {
  agentId: string; agentName: string;
  employeeName: string | null; employeeNo: string | null; functionName: string | null;
  status: string; statusRaw: string;
  breakCount: number; totalBreakMinutes: number;
  lastBreakStart: string | null;
  breaks: { start: string; end: string; minutes: number }[];
  currentlyBreaking?: boolean;
  breakStartedAt?: string | null; minutesSoFar?: number | null;
  isAuthorized?: boolean; authSource?: 'break_management' | 'permission' | null;
}
export interface BreakTracker {
  capturedAt: string | null; isStale?: boolean;
  onBreakNow: BreakAgent[];
  availableNow?: BreakAgent[]; busyNow?: BreakAgent[];
  unauthorizedCount: number; authorizedCount: number;
  breakMgmtActiveRequests?: number;
  agentHistory: AgentBreakHistory[];
  activePermissions: ActivePermission[];
}
export interface AgentBreakHistory {
  agentId: string; name: string; breakCount: number;
  totalBreakMinutes: number; currentlyBreaking: boolean;
  loginTime: string | null; lastBreakStart?: string | null;
  breaks: { start: string; end: string; minutes: number }[];
}
export interface ActivePermission {
  id: string; employee_name: string; employee_no: string;
  starts_at: string; ends_at: string; reason: string; function_name: string;
}
export interface AgentTimeline {
  agentId: string; name: string; loginTime: string | null;
  firstSeen: string; lastSeen: string;
  workingMinutes: number; idleMinutes?: number; busyMinutes?: number; breakMinutes: number;
  totalTrackedMinutes: number; utilizationPct: number;
  statusMinutes: Record<string, number>;
}
export interface QueueDetail {
  queue: SpQueue; agents: SpAgent[]; overflow: SpAgent[];
  capturedAt: string; staleSec: number;
}
export interface Coverage {
  intervals: { interval_start: string; required_hc: number; scheduled_hc: number; live_hc: number }[];
  attendance: { punched_in: number; total_scheduled: number };
  onPermission: number;
  liveSprinklr: { available: number; busy: number; onBreak: number; offline: number; totalLoggedIn: number } | null;
  capturedAt: string | null;
}

/* ── Incident / Unauthorized Break Types ───────────────────────────────────── */
export interface IncidentReport {
  employeeId: string; employeeName: string;
  incidentType: 'unauthorized_break' | 'status_change_no_approval';
  occurredAt: string; durationMinutes: number;
  severity: 'low' | 'medium' | 'high'; notes: string;
}

/* ── Cross-Skill Types ──────────────────────────────────────────────────────── */
export interface CrossSkillCandidate {
  employeeId: string; name: string; function: string; proficiency: string;
}
export interface SkillDispatchForm {
  employeeId: string; employeeName: string;
  fromFunction: string; toFunction: string;
  skillCode: string; startAt: string; endAt: string; reason: string;
}

/* ── Daily Report / Forecast Types ─────────────────────────────────────────── */
export interface DailyRow {
  stat_date: string; sprinklr_agent_id: string;
  agent_name: string; agent_email: string | null;
  employee_id: string | null; employee_no: string | null; employee_name: string | null;
  first_login: string | null; last_logout: string | null;
  total_working_minutes: number; idle_no_case_minutes: number; idle_with_case_minutes: number;
  busy_minutes: number; break_minutes: number; offline_minutes: number;
  contacts_received: number | null; aht_seconds: string | null; avg_response_seconds: string | null;
  break_breakdown?: Record<string, number>;
}
export interface DailyReport {
  from: string; to: string;
  days: Record<string, {
    agents: number; workingMinutes: number; contacts: number;
    avgAhtSec?: number | null; avgFrtSec?: number | null;
  }>;
  rows: DailyRow[];
}
export interface ContactForecast {
  history:  { date: string; contacts: number; agents: number; workingMinutes: number }[];
  forecast: { date: string; predictedContacts: number; p90?: number; method: string; requiredHc?: number | null; requiredHcP90?: number | null }[];
  staffing?: { avgAhtSec: number | null; productiveHoursPerAgent: number; note: string };
  confidence: string;
  note: string | null;
}

/* ── Adherence Types ───────────────────────────────────────────────────────── */
export interface AdherenceRow {
  stat_date: string; employee_id: string; sprinklr_agent_id: string | null;
  employee_name: string; employee_no: string; agent_name: string; shift_code: string | null;
  scheduled_start: string | null; scheduled_end: string | null;
  scheduled_minutes: number; tracked_minutes: number;
  in_adherence_minutes: number; break_in_shift_minutes: number;
  offline_in_shift_minutes: number; worked_total_minutes: number;
  adherence_pct: string | null; conformance_pct: string | null;
  deviations: { from: string; to: string; state: string }[];
}
export interface AdherenceReport {
  from: string; to: string;
  summary: { employees: number; measured: number; unmatched: number;
             avgAdherence: number | null; avgConformance: number | null; below85: number };
  rows: AdherenceRow[];
}
export interface IntradayData {
  date: string;
  intervals: { interval: string; scheduled: number; actual: number | null; gap: number | null }[];
}

/* ── Compliance / Violations Types ─────────────────────────────────────────── */
export interface ViolationRow {
  id: string; violation_date: string; sprinklr_agent_id: string;
  agent_name: string; agent_email: string | null;
  employee_id: string | null; employee_no: string | null; employee_name: string | null;
  violation_type: string; severity: 'low' | 'medium' | 'high';
  minutes: number | null;
  shift_start: string | null; shift_end: string | null; actual_at: string | null;
  details: any; status: 'open' | 'reviewed' | 'justified';
}
export interface ViolationsReport {
  from: string; to: string;
  summary: { total: number; open: number; byType: Record<string, number>; bySeverity: Record<string, number> };
  topOffenders: { agentId: string; name: string; count: number; totalMinutes: number }[];
  rows: ViolationRow[];
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */
export const CH_COLOR: Record<string, string> = {
  whatsapp: '#25d366', chat: '#818cf8', email: '#38bdf8',
  social: '#ec4899', voice: '#22c55e', unknown: '#64748b',
};
export const ST_COLOR: Record<string, string> = {
  available: '#22c55e', idle: '#84cc16', busy: '#f59e0b',
  break: '#818cf8', away: '#818cf8', offline: '#475569', unknown: '#475569',
};
export const slaColor = (p: number) => p >= 85 ? '#22c55e' : p >= 70 ? '#f59e0b' : '#ef4444';
export const pctColor = (p: number) => p >= 80 ? '#34d399' : p >= 60 ? '#fbbf24' : '#f87171';
export const fmtNum = (n: number) => n.toLocaleString('en-US');
export const fmtMin  = (m: number, ar?: boolean) => fmtDuration(m, ar);
export const fmtTime = (iso: string | null, ar?: boolean) => fmtDateTimeTime(iso ?? undefined, ar);
export const stLabel = (s: string, ar: boolean) => ({
  available: ar ? 'متاح' : 'Available', idle: ar ? 'خامل' : 'Idle',
  busy: ar ? 'مشغول' : 'Busy',
  break: ar ? 'استراحة' : 'Break', away: ar ? 'استراحة' : 'Away',
  offline: ar ? 'غير متاح' : 'Offline', unknown: ar ? 'غير معروف' : 'Unknown',
}[s] ?? s);
