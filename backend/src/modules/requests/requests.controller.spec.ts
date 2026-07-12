/**
 * IDOR REGRESSION — request create handlers must derive the requester from the
 * authenticated user, not from the request body.
 *
 * createLeave/createOvertime/createBreak/createSwap previously passed the DTO
 * straight through, so any caller with requests.create could file a request
 * naming another employee. The fix forces the subject/requester employee to
 * user.employeeId for non-approvers; a body-supplied employee is honoured ONLY
 * for approvers (requests.approve_l1) filing on someone's behalf.
 */
// The controller transitively imports requests.service, which pulls two peer
// services via the `@modules/*` path alias (mapped by tsc, not by this repo's
// jest moduleNameMapper). Virtual-mock them so the unit test stays self-contained
// and does not require touching the shared jest config.
jest.mock('@modules/leave-balances/leave-balances.service', () => ({ LeaveBalancesService: class {} }), { virtual: true });
jest.mock('@modules/breaks/break-policy.service', () => ({ BreakPolicyService: class {} }), { virtual: true });

import { RequestsController } from './requests.controller';

function makeSvc() {
  return {
    createLeave: jest.fn(async (_tid: string, dto: any) => dto),
    createOvertime: jest.fn(async (_tid: string, dto: any) => dto),
    createBreak: jest.fn(async (_tid: string, dto: any) => dto),
    createShiftSwap: jest.fn(async (_tid: string, dto: any) => dto),
  };
}

const agent = { tenantId: 't1', employeeId: 'emp-self', permissionCodes: ['requests.create'] };
const approver = { tenantId: 't1', employeeId: 'emp-tl', permissionCodes: ['requests.create', 'requests.approve_l1'] };

describe('RequestsController create handlers — requester forced server-side (IDOR)', () => {
  it('non-approver: createLeave forces employeeId to the caller, ignoring the body', async () => {
    const svc = makeSvc();
    const c = new RequestsController(svc as any);
    await c.createLeave(agent, { employeeId: 'emp-victim', leaveType: 'annual_leave', startDate: '2026-07-01', endDate: '2026-07-02' } as any);
    expect(svc.createLeave).toHaveBeenCalledWith('t1', expect.objectContaining({ employeeId: 'emp-self' }));
  });

  it('non-approver: createOvertime & createBreak also force the caller', async () => {
    const svc = makeSvc();
    const c = new RequestsController(svc as any);
    await c.createOvertime(agent, { employeeId: 'emp-victim', otDate: '2026-07-01', hours: 2 } as any);
    await c.createBreak(agent, { employeeId: 'emp-victim', startTime: '12:00', endTime: '12:30' } as any);
    expect(svc.createOvertime).toHaveBeenCalledWith('t1', expect.objectContaining({ employeeId: 'emp-self' }));
    expect(svc.createBreak).toHaveBeenCalledWith('t1', expect.objectContaining({ employeeId: 'emp-self' }));
  });

  it('non-approver: createSwap forces requesterEmployeeId to caller but keeps the swap counterparty', async () => {
    const svc = makeSvc();
    const c = new RequestsController(svc as any);
    await c.createSwap(agent, { requesterEmployeeId: 'emp-victim', requesterDate: '2026-07-01', targetEmployeeId: 'emp-peer', targetDate: '2026-07-02', swapType: 'shift' } as any);
    expect(svc.createShiftSwap).toHaveBeenCalledWith('t1', expect.objectContaining({
      requesterEmployeeId: 'emp-self',   // forged requester overridden
      targetEmployeeId: 'emp-peer',      // legitimate peer preserved (must still peer-accept)
    }));
  });

  it('approver: may file leave on another employee behalf via the body', async () => {
    const svc = makeSvc();
    const c = new RequestsController(svc as any);
    await c.createLeave(approver, { employeeId: 'emp-target', leaveType: 'annual_leave', startDate: '2026-07-01', endDate: '2026-07-02' } as any);
    expect(svc.createLeave).toHaveBeenCalledWith('t1', expect.objectContaining({ employeeId: 'emp-target' }));
  });
});
