// ─── Shift Definition ────────────────────────────────────────────────────────
export interface ShiftDef {
  code: string;
  label: string;          // Arabic
  labelEn: string;        // English
  start: string | null;   // "HH:MM"
  end: string | null;     // "HH:MM"
  hours: number;
  category: 'morning' | 'afternoon' | 'evening' | 'night' | 'midnight' | 'off';
  crossMidnight: boolean;
  femaleRule: 'allowed' | 'warn' | 'blocked';
  color: string;
}

// ─── Canonical Shift Catalog ─────────────────────────────────────────────────
export const SHIFTS: Record<string, ShiftDef> = {
  M: {
    code: 'M', label: 'صباحي', labelEn: 'Morning',
    start: '07:00', end: '16:00', hours: 9,
    category: 'morning', crossMidnight: false,
    femaleRule: 'allowed', color: '#0ea5e9',
  },
  B: {
    code: 'B', label: 'ضحى', labelEn: 'Mid-Morning',
    start: '10:00', end: '19:00', hours: 9,
    category: 'morning', crossMidnight: false,
    femaleRule: 'allowed', color: '#38bdf8',
  },
  C: {
    code: 'C', label: 'ظهيرة', labelEn: 'Afternoon',
    start: '12:00', end: '21:00', hours: 9,
    category: 'afternoon', crossMidnight: false,
    femaleRule: 'allowed', color: '#f59e0b',
  },
  E: {
    code: 'E', label: 'عصري', labelEn: 'Evening',
    start: '14:00', end: '23:00', hours: 9,
    category: 'evening', crossMidnight: false,
    femaleRule: 'allowed', color: '#f97316',
  },
  N: {
    code: 'N', label: 'مسائي', labelEn: 'Late Evening',
    start: '17:00', end: '02:00', hours: 9,
    category: 'night', crossMidnight: true,
    femaleRule: 'warn', color: '#8b5cf6',
  },
  N2: {
    code: 'N2', label: 'ليلي', labelEn: 'Night',
    start: '20:00', end: '05:00', hours: 9,
    category: 'night', crossMidnight: true,
    femaleRule: 'blocked', color: '#6d28d9',
  },
  MD: {
    code: 'MD', label: 'منتصف الليل', labelEn: 'Midnight',
    start: '23:00', end: '08:00', hours: 9,
    category: 'midnight', crossMidnight: true,
    femaleRule: 'blocked', color: '#1e1b4b',
  },
  OFF: {
    code: 'OFF', label: 'إجازة أسبوعية', labelEn: 'Day Off',
    start: null, end: null, hours: 0,
    category: 'off', crossMidnight: false,
    femaleRule: 'allowed', color: '#475569',
  },
};

// ─── Employee Info ────────────────────────────────────────────────────────────
export interface EmployeeInfo {
  id: string;
  employeeNo: string;
  name: string;
  gender: 'male' | 'female';
  employmentType: string;
  functionId: string;
  functionName: string;
}

// ─── Shift Distribution (YTD) ─────────────────────────────────────────────────
export interface ShiftDistribution {
  // Category-level counts
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
  midnight: number;
  off: number;
  leave: number;
  total: number;
  // Individual shift-code counts (M, B, C, N, E, EE, MD, MN…)
  byCodes: Record<string, number>;
  // Weekend fairness
  weekendOff: number;    // OFF days that fall on Fri/Sat (0-indexed: 5=Fri, 6=Sat)
  weekendWork: number;   // Working days on Fri/Sat
  // Consecutive tracking
  maxConsecutive: number;  // historical max consecutive working days
}

// ─── Per-Day Assignment ───────────────────────────────────────────────────────
export interface DayAssignment {
  date: string;
  dayName: string;       // Arabic day name
  shift: ShiftDef;
  violations: string[];  // violation codes
  restHours: number;     // hours of rest before this shift (999 = N/A)
}

// ─── Per-Employee Weekly Schedule ─────────────────────────────────────────────
export interface EmployeeSchedule {
  employee: EmployeeInfo;
  ytdDist: ShiftDistribution;
  assignments: DayAssignment[];
  weekStats: {
    morningCount: number;
    afternoonCount: number;
    eveningCount: number;
    nightCount: number;
    midnightCount: number;
    offCount: number;
    violationCount: number;
  };
}

// ─── Daily Coverage ───────────────────────────────────────────────────────────
export interface CoverageDay {
  date: string;
  dayName: string;
  total: number;
  working: number;
  off: number;
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
  midnight: number;
  coveragePct: number;
}

// ─── Violation ────────────────────────────────────────────────────────────────
export interface GeneratorViolation {
  type: 'rest_violation' | 'female_blocked' | 'female_warn' | 'consecutive_days' | 'coverage_gap';
  employeeId?: string;
  employeeName?: string;
  date?: string;
  shiftCode?: string;
  restHours?: number;
  severity: 'error' | 'warning';
  messageAr: string;
  messageEn: string;
}

// ─── Fairness Report ─────────────────────────────────────────────────────────
export interface FairnessReport {
  score: number;           // 0-100 overall fairness
  nightVariance: number;
  midnightVariance: number;
  morningVariance: number;
  weekendFairnessScore: number;  // 0-100 weekend off fairness
  details: {
    employeeId: string;
    name: string;
    morningPct: number;
    eveningPct: number;
    nightPct: number;
    midnightPct: number;
    weekendOffCount: number;
    weekendWorkCount: number;
    weekendOffPct: number;
    // Per-code breakdown (top codes)
    shiftCodes: Record<string, number>;
  }[];
}

// ─── Generator Options ────────────────────────────────────────────────────────
export interface GeneratorOptions {
  minRestHours: number;         // default 10
  offDaysPerWeek: number;       // default 1
  internProductivity: number;   // default 0.70
  allowFemaleN: boolean;        // default true (warn only)
  weeks: number;                // 1-4 weeks to generate (default 1)
  functionIds?: string[];
}

// ─── Generator Result ─────────────────────────────────────────────────────────
export interface GeneratorResult {
  weekStart: string;
  weekEnd: string;
  dates: string[];
  functions: {
    id: string;
    name: string;
    employees: EmployeeSchedule[];
  }[];
  coverage: CoverageDay[];
  violations: GeneratorViolation[];
  fairness: FairnessReport;
  summary: {
    totalEmployees: number;
    totalErrors: number;
    totalWarnings: number;
    avgCoveragePct: number;
    offAssigned: number;
    workingDays: number;
  };
  generatedAt: string;
  versionId?: string;
}
