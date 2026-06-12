// ─────────────────────────────────────────────────────────────────────────────
// Permission Request Types
// ─────────────────────────────────────────────────────────────────────────────
import {
  IsString, IsUUID, IsDateString, IsEnum, IsBoolean,
  IsOptional, MaxLength, Matches, IsNotEmpty,
} from 'class-validator';

/**
 * Permission types:
 *  late_in             — Employee arrives late (start of shift)
 *  early_out           — Employee leaves before shift ends
 *  temp_out            — Temporary exit during shift (will return)
 *  return_during_shift — Return after a temporary exit (used to record re-entry)
 *
 * Business rules (enforced in service):
 *  - Minimum duration: 30 minutes
 *  - Maximum duration per request: 3 hours (180 min)
 *  - Maximum 3 permissions per week (Mon–Sun, or Sat–Fri per WFM week rule)
 *  - COMP requests are NOT subject to the 3h cap (handled separately)
 */
export type PermissionType = 'late_in' | 'early_out' | 'temp_out' | 'return_during_shift';

export const PERMISSION_TYPE_LABELS: Record<PermissionType, { ar: string; en: string }> = {
  late_in:             { ar: 'تأخير دخول',         en: 'Late In'              },
  early_out:           { ar: 'خروج مبكر',            en: 'Early Out'            },
  temp_out:            { ar: 'خروج مؤقت',            en: 'Temporary Exit'       },
  return_during_shift: { ar: 'رجوع أثناء الوردية',   en: 'Return During Shift'  },
};

export const PERMISSION_RULES = {
  MIN_DURATION_MINUTES: 30,
  MAX_DURATION_MINUTES: 180,   // 3 hours
  MAX_PER_WEEK: 3,
} as const;

export class CreatePermissionRequestDto {
  @IsUUID()
  employeeId: string;

  @IsDateString({}, { message: 'permissionDate must be YYYY-MM-DD' })
  permissionDate: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'startTime must be HH:MM' })
  startTime: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'endTime must be HH:MM' })
  endTime: string;

  @IsEnum(['late_in', 'early_out', 'temp_out', 'return_during_shift'])
  permissionType: PermissionType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsUUID()
  functionId?: string;

  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ApproveRequestDto {
  @IsUUID()
  approverId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class RejectRequestDto {
  @IsUUID()
  rejectorId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export interface HcIntervalCell {
  intervalStart: string;       // HH:MM
  intervalEnd: string;
  scheduledHc: number;
  onPermissionHc: number;
  pendingHc: number;
  availableHc: number;
  requiredHc: number | null;
  gap: number | null;
  riskLevel: 'ok' | 'warning' | 'critical';
  affectedEmployees: { id: string; name: string; status: string }[];
}

export interface HcImpactFunction {
  functionId: string;
  functionName: string;
  intervals: HcIntervalCell[];
  peakScheduledHc: number;
  peakOnPermHc: number;
  minAvailableHc: number;
  overallRisk: 'ok' | 'warning' | 'critical';
}

export interface HcImpactResult {
  date: string;
  requestId?: string;
  employeeName?: string;
  employeeFunction?: string;
  permissionStart?: string;
  permissionEnd?: string;
  functions: HcImpactFunction[];
  worstRisk: 'ok' | 'warning' | 'critical';
  warnings: string[];
}

export interface PermissionRequestRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  functionName: string;
  functionId: string;
  permissionDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  permissionType: PermissionType | null;
  reason: string;
  status: string;
  isUrgent: boolean;
  submittedAt: string;
  approverL1Name: string | null;
  approverL2Name: string | null;
  notes: string | null;
  rejectionReason: string | null;
  hcImpact: any;
  slaRemainingHours: number | null;
}
