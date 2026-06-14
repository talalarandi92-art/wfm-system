// ── Normalized snapshot pushed from Chrome Extension OR direct Sprinklr API ──

export interface SprinklrQueue {
  queueId:         string;
  queueName:       string;
  channel:         'chat' | 'email' | 'social' | 'voice' | 'whatsapp' | 'unknown';
  waiting:         number;
  inProgress:      number;
  backlog:         number;
  avgWaitSeconds:  number;
  slaBreached:     number;
  slaPct:          number;
  agentsAvailable: number;
  agentsBusy:      number;
  agentsBreak:     number;
  agentsIdle?:     number;  // idle agents in this queue (from entityFeed)
  agentsLoggedIn?: number;  // total logged-in agents (from entityFeed)
  aht:             number;
  statsRaw?:       Record<string, any>;  // full Sprinklr workQueueStats — mined for cumulative contact counters
}

export interface SprinklrAgent {
  agentId:        string;
  agentName:      string;
  email?:         string;                     // harvested from reportingQuery — links to users.email
  status:         'available' | 'idle' | 'busy' | 'break' | 'away' | 'offline' | 'unknown';
  statusRaw?:     string;                     // raw Sprinklr label: "Bio Break", "Lunch", "Meeting", "Manual Dial"…
  currentChannel: string;
  queueId:        string;
  loginTime:      string;
  metrics?:       Record<string, number>;     // daily Sprinklr measurements (AHT, FRT, case counts…)
}

// ── Station summary: faithful mirror of the Sprinklr Supervisor right-rail ──
// Three panels exactly as the supervisor sees them on the live station.
export interface SprinklrStationSummary {
  // "Queue Summary" panel
  queueSummary?: {
    customersWaiting:  number;
    casesInProgress:   number;
    avgWaitSeconds:    number;
    oldestWaitSeconds: number;
  } | null;
  // "Agent Status" panel — the presence each agent CHOSE (Available, Unavailable, Manual Outbound…)
  agentStatus?: { label: string; count: number }[];
  // "Agent State" panel — what each agent is actually DOING (Logged Out, Idle, Working on a Case) + %
  agentState?:  { label: string; count: number; pct: number }[];
  capturedAt?:  string;
}

export interface SprinklrSnapshot {
  source:          'sprinklr' | 'extension' | 'api';
  capturedAt:      string;  // ISO
  queues:          SprinklrQueue[];
  agents:          SprinklrAgent[];
  stationSummary?: SprinklrStationSummary | null;
  rawUrls?:        string[];
}

// ── Sprinklr direct API config (stored per tenant in settings) ───────────────
export interface SprinklrApiConfig {
  apiKey:        string;
  partnerId:     string;
  environmentId: string;
  baseUrl:       string;  // e.g. https://api2.sprinklr.com
  pollingIntervalSeconds: number;
}
