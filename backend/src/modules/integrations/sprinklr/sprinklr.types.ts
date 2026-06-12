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

export interface SprinklrSnapshot {
  source:      'sprinklr' | 'extension' | 'api';
  capturedAt:  string;  // ISO
  queues:      SprinklrQueue[];
  agents:      SprinklrAgent[];
  rawUrls?:    string[];
}

// ── Sprinklr direct API config (stored per tenant in settings) ───────────────
export interface SprinklrApiConfig {
  apiKey:        string;
  partnerId:     string;
  environmentId: string;
  baseUrl:       string;  // e.g. https://api2.sprinklr.com
  pollingIntervalSeconds: number;
}
