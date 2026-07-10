export interface CreateShiftSwapDto {
  requesterEmployeeId: string;
  requesterDate: string;        // YYYY-MM-DD
  targetEmployeeId: string;
  targetDate: string;           // YYYY-MM-DD (can differ for cross-day swaps)
  swapType: 'shift' | 'off';
  notes?: string;
}

export interface CreateLeaveDto {
  employeeId: string;
  leaveType: 'annual_leave' | 'sick_leave' | 'death_leave' | 'comp_off' | 'wfh';
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  notes?: string;
  attachmentSubmitted?: boolean;
}

export interface CreateBreakDto {
  employeeId: string;
  startTime: string;     // HH:MM (from)
  endTime: string;       // HH:MM (to)
  breakDate?: string;    // YYYY-MM-DD — optional; defaults to submission date (today, Asia/Kuwait)
  breakType?: 'manual' | 'lunch' | 'coffee' | 'prayer' | 'medical' | 'other';
  reason?: string;
  notes?: string;
  overrideEntitlement?: boolean;   // explicit exception past the daily break entitlement — audited
}

export interface CreateOvertimeDto {
  employeeId: string;
  otDate: string;       // YYYY-MM-DD
  startTime?: string;   // HH:MM (optional, defaults to end-of-shift)
  hours: number;
  reason?: string;
  notes?: string;
}

export interface PeerRespondDto {
  targetEmployeeId: string;  // Must match the target employee to prevent spoofing
  accept: boolean;
  reason?: string;
}

export interface ApproveRejectDto {
  approverId: string;  // user id
  reason?: string;
}

export interface SwapValidation {
  restCheckPassed: boolean;
  genderCheckPassed: boolean;
  coverageCheckPassed: boolean;
  restWarning?: string;
  genderWarning?: string;
  coverageWarning?: string;
}

export interface ShiftInfo {
  employeeId: string;
  employeeName: string;
  gender: string;
  functionId: string;
  functionName: string;
  date: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  shiftCode: string | null;
  isNightShift: boolean;
  isMidnightShift: boolean;
}

export interface SwapDetails {
  requester: ShiftInfo;
  target: ShiftInfo;
  validation: SwapValidation;
  swapType: string;
  status: string;
  peerAcceptedAt?: string;
  peerRejectedAt?: string;
  peerRejectionReason?: string;
}

export interface UnifiedRequest {
  id: string;
  type: string;          // request type code
  typeNameAr: string;
  status: string;
  requesterName: string;
  requesterEmployeeNo: string;
  requesterFunction: string;
  submittedAt: string;
  notes?: string;
  // type-specific
  // Permission
  permissionDate?: string;
  permissionStart?: string;
  permissionEnd?: string;
  permissionDuration?: number;
  // Swap
  swapType?: string;
  requesterDate?: string;
  requesterShift?: string;
  targetName?: string;
  targetDate?: string;
  targetShift?: string;
  peerAcceptedAt?: string;
  peerRejectedAt?: string;
  peerRejectionReason?: string;
  // Leave
  leaveType?: string;
  leaveStart?: string;
  leaveEnd?: string;
  leaveDays?: number;
  isHalfDay?: boolean;
  // Coverage impact
  hcImpact?: any;
  // Approval
  approverName?: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectReason?: string;
}
