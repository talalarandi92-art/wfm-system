// ── Shift categories ────────────────────────────────────────────────────────
export type ShiftCategory = 'morning' | 'afternoon' | 'evening' | 'night' | 'midnight' | 'off' | 'leave';

// ── Per-employee shift rate record ──────────────────────────────────────────
export interface EmployeeShiftRate {
  employeeId:          string;
  employeeNo:          string;
  name:                string;
  gender:              string;
  functionId:          string;
  functionName:        string;
  rotationGroupId:     string | null;
  rotationGroupName:   string | null;
  rotationGroupColor:  string | null;
  // YTD counts
  morning:    number;
  afternoon:  number;
  evening:    number;
  night:      number;
  midnight:   number;
  off:        number;
  leave:      number;
  workingTotal: number; // morning+afternoon+evening+night+midnight
  // Percentages (of workingTotal, 0–100)
  morningPct:    number;
  afternoonPct:  number;
  eveningPct:    number;
  nightPct:      number;
  midnightPct:   number;
  // Combined night+midnight (key fairness metric)
  nightMidnightPct:  number;
  // Relative fairness vs team average (100 = exactly average, >100 = above, <100 = below)
  relativeNightScore: number;
  // Last recorded shift
  lastShiftCode: string;
  lastShiftDate: string | null;
  // Recommendation for next assignment
  recommendedNextShift:  string;
  recommendationReason:  string;
}

// ── Rotation group ────────────────────────────────────────────────────────────
export interface RotationGroup {
  id:               string;
  name:             string;
  rotationSequence: string[];   // e.g. ['M','B','C','E','N','OFF']
  color:            string;
  description:      string | null;
  memberCount:      number;
}

// ── Summary stats ────────────────────────────────────────────────────────────
export interface ShiftRatesSummary {
  totalEmployees:    number;
  avgNightPct:       number;
  avgMidnightPct:    number;
  avgMorningPct:     number;
  fairnessScore:     number;   // 0–100, higher = more equitable distribution
  rotationGroupCount: number;
  periodLabel:       string;
  dataSource:        'attendance_records' | 'schedule_entries' | 'combined' | 'none';
}

// ── Full API response ─────────────────────────────────────────────────────────
export interface ShiftRatesResponse {
  summary:     ShiftRatesSummary;
  employees:   EmployeeShiftRate[];
  groups:      RotationGroup[];
}

// ── Request DTOs ─────────────────────────────────────────────────────────────
export interface CreateGroupDto {
  name:             string;
  rotationSequence: string[];
  color?:           string;
  description?:     string;
}

export interface AssignMembersDto {
  employeeIds: string[];
}
