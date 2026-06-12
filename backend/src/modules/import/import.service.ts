import {
  Injectable, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { ImportBatch } from '../../database/entities/import-batch.entity';
import { ImportRow } from '../../database/entities/import-row.entity';
import { ShiftCode } from '../../database/entities/shift-code.entity';

import { parseTimingSheet } from './parsers/timing-sheet.parser';
import { parseShiftsSheet } from './parsers/shifts-sheet.parser';
import { parseMonthlyMatrix } from './parsers/monthly-matrix.parser';

/** User-facing type aliases (short names the UI sends) */
export type ImportType = 'timing' | 'shifts' | 'schedule';

/** Map UI type → PostgreSQL import_type_enum values */
const TYPE_TO_DB: Record<string, string> = {
  timing:   'timing_sheet',
  shifts:   'shifts_sheet',
  schedule: 'monthly_matrix',
};

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(ImportBatch) private batchRepo: Repository<ImportBatch>,
    @InjectRepository(ImportRow)   private rowRepo:   Repository<ImportRow>,
    @InjectRepository(ShiftCode)   private shiftCodeRepo: Repository<ShiftCode>,
    @InjectDataSource()            private dataSource: DataSource,
  ) {}

  /** Step 1 — Upload file, parse, store rows, return preview */
  async upload(
    tenantId: string,
    userId: string,
    file: Express.Multer.File,
    importType: ImportType,
    sheetName?: string,
  ): Promise<{ batchId: string; summary: any }> {
    // Parse workbook
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: false });
    } catch {
      throw new BadRequestException('Invalid Excel file. Could not parse workbook.');
    }

    // Route to correct parser
    let parsedRows: any[];
    let globalErrors: string[];

    let backfilledFromMatrix = 0;
    let matrixSheetsParsed: string[] = [];

    if (importType === 'timing') {
      const result = parseTimingSheet(workbook, sheetName);
      parsedRows  = result.rows;
      globalErrors = result.errors;
    } else if (importType === 'shifts') {
      // The Shifts sheet only carries codes up to "today" (future cells are
      // stale formula zeros) — backfill planned codes from the monthly matrix.
      const matrix = parseMonthlyMatrix(workbook);
      matrixSheetsParsed = matrix.sheetsParsed;
      const result = parseShiftsSheet(workbook, sheetName, matrix.lookup);
      parsedRows  = result.rows;
      globalErrors = result.errors;
      backfilledFromMatrix = result.backfilledFromMatrix;
    } else {
      throw new BadRequestException(`Unsupported import type: ${importType}`);
    }

    if (globalErrors.length && !parsedRows.length) {
      throw new BadRequestException(globalErrors.join('; '));
    }

    // Flag rows whose employee_no is a retired number (merged duplicate) so
    // WFM sees the alias resolution in the preview before committing.
    let aliasResolutions: { oldEmployeeNo: string; survivorNo: string; survivorName: string }[] = [];
    if (importType === 'shifts') {
      aliasResolutions = await this.annotateAliasResolutions(tenantId, parsedRows);
    }

    const totalRows   = parsedRows.length;
    const errorRows   = parsedRows.filter(r => r.errors?.length > 0).length;
    const warningRows = parsedRows.filter(r => r.warnings?.length > 0).length;
    const validRows   = totalRows - errorRows;

    // Create batch record — use DB enum values for importType and status
    const batch = this.batchRepo.create({
      tenantId,
      importType:       TYPE_TO_DB[importType] ?? importType,
      originalFilename: file.originalname,
      storedFilename:   file.originalname,
      fileSizeBytes:    file.size,
      status:           'processing',   // DB enum: uploaded|processing|validated|committed|failed|cancelled
      totalRows,
      validRows,
      errorRows,
      warningRows,
      skippedRows:      0,
      createdById:      userId,
      metadata: {
        sheetNames:   workbook.SheetNames,
        parsedSheet:  sheetName ?? workbook.SheetNames[0],
        importTypeUi: importType,
        globalErrors,
        aliasResolutions,
        backfilledFromMatrix,
        matrixSheetsParsed,
      },
    });
    await this.batchRepo.save(batch);

    // Bulk insert import rows
    const importRows = parsedRows.map(r => this.rowRepo.create({
      importBatchId: batch.id,
      tenantId,
      rowNumber:     r.rowNumber,
      sheetName:     sheetName ?? '',
      rawData:       r,
      parsedData:    r,
      status:        r.errors?.length > 0 ? 'error' : r.warnings?.length > 0 ? 'warning' : 'valid',
      errors:        r.errors?.length > 0 ? r.errors : null,
      warnings:      r.warnings?.length > 0 ? r.warnings : null,
    }));

    // Insert in chunks to avoid hitting max parameter limits
    const CHUNK = 500;
    for (let i = 0; i < importRows.length; i += CHUNK) {
      await this.rowRepo.save(importRows.slice(i, i + CHUNK));
    }

    return {
      batchId: batch.id,
      summary: {
        totalRows,
        validRows,
        errorRows,
        warningRows,
        globalErrors,
        aliasResolutions,
        backfilledFromMatrix,
        matrixSheetsParsed,
        sheetNames: workbook.SheetNames,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EMPLOYEE ALIAS RESOLUTION  (merged duplicate employee numbers)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Bulk lookup of retired employee numbers in employee_aliases.
   * Returns map: old_employee_no → surviving employee info.
   */
  private async lookupEmployeeAliases(
    tenantId: string,
    employeeNos: string[],
  ): Promise<Map<string, { employeeId: string; survivorNo: string; survivorName: string }>> {
    const map = new Map<string, { employeeId: string; survivorNo: string; survivorName: string }>();
    if (!employeeNos.length) return map;

    const placeholders = employeeNos.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await this.dataSource.query(
      `SELECT a.old_employee_no,
              a.employee_id,
              e.employee_no AS survivor_no,
              TRIM(COALESCE(e.first_name_en, '') || ' ' || COALESCE(e.last_name_en, '')) AS survivor_name
         FROM employee_aliases a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.tenant_id = $1
          AND a.old_employee_no IN (${placeholders})`,
      [tenantId, ...employeeNos],
    );
    for (const r of rows) {
      map.set(String(r.old_employee_no), {
        employeeId:   r.employee_id,
        survivorNo:   r.survivor_no,
        survivorName: r.survivor_name,
      });
    }
    return map;
  }

  /**
   * Adds a preview warning to every parsed shifts row whose employee_no is a
   * retired number that will be resolved through employee_aliases at commit.
   */
  private async annotateAliasResolutions(
    tenantId: string,
    parsedRows: any[],
  ): Promise<{ oldEmployeeNo: string; survivorNo: string; survivorName: string }[]> {
    const uniqueNos = [...new Set(
      parsedRows.map(r => r.employeeNo).filter(Boolean).map(String)
    )];
    const aliasMap = await this.lookupEmployeeAliases(tenantId, uniqueNos);
    if (!aliasMap.size) return [];

    for (const row of parsedRows) {
      if (!row.employeeNo) continue;
      const alias = aliasMap.get(String(row.employeeNo));
      if (!alias) continue;
      row.warnings = row.warnings ?? [];
      row.warnings.push(
        `Employee no ${row.employeeNo} is a retired number (merged): ` +
        `will be recorded under ${alias.survivorName || 'surviving employee'} (${alias.survivorNo})`
      );
    }

    return [...aliasMap.entries()].map(([oldNo, a]) => ({
      oldEmployeeNo: oldNo,
      survivorNo:    a.survivorNo,
      survivorName:  a.survivorName,
    }));
  }

  /** Step 2 — Return preview rows for a batch (paginated) */
  async getPreview(
    tenantId: string,
    batchId: string,
    page = 1,
    limit = 100,
    filter?: 'all' | 'valid' | 'error' | 'warning',
  ) {
    const batch = await this.batchRepo.findOne({
      where: { id: batchId, tenantId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');

    const qb = this.rowRepo.createQueryBuilder('r')
      .where('r.import_batch_id = :batchId AND r.tenant_id = :tenantId', { batchId, tenantId });

    if (filter && filter !== 'all') {
      qb.andWhere('r.status = :status', { status: filter });
    }

    const [rows, total] = await qb
      .orderBy('r.row_number', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      batch: {
        id: batch.id,
        importType:  batch.importType,
        filename:    batch.originalFilename,
        status:      batch.status,
        totalRows:   batch.totalRows,
        validRows:   batch.validRows,
        errorRows:   batch.errorRows,
        warningRows: batch.warningRows,
        metadata:    batch.metadata,
      },
      rows: rows.map(r => ({
        id:        r.id,
        rowNumber: r.rowNumber,
        status:    r.status,
        errors:    r.errors,
        warnings:  r.warnings,
        data:      r.parsedData,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /** Step 3 — Commit: upsert data into real tables */
  async commit(
    tenantId: string,
    userId: string,
    batchId: string,
    skipErrors = false,
  ) {
    const batch = await this.batchRepo.findOne({
      where: { id: batchId, tenantId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status === 'committed') throw new BadRequestException('Batch already committed');

    const rows = await this.rowRepo.find({
      where: { importBatchId: batchId, tenantId },
      order: { rowNumber: 'ASC' },
    });

    const errorRows = rows.filter(r => r.status === 'error');
    if (errorRows.length > 0 && !skipErrors) {
      throw new BadRequestException(
        `Cannot commit: ${errorRows.length} rows have errors. ` +
        'Pass skipErrors=true to commit valid rows only.'
      );
    }

    const validRows = skipErrors ? rows.filter(r => r.status !== 'error') : rows;

    // 'processing' is the closest DB enum value for "committing in progress"
    await this.batchRepo.update(batchId, { status: 'processing' });

    let committed = 0;
    let skipped   = 0;

    try {
      // Match against DB enum values
      if (batch.importType === 'timing_sheet' || batch.importType === 'timing') {
        committed = await this.commitTimingRows(tenantId, validRows);
      } else if (batch.importType === 'shifts_sheet' || batch.importType === 'shifts') {
        committed = await this.commitShiftsRows(tenantId, validRows, batchId);
      }
      skipped = rows.length - validRows.length;
    } catch (err) {
      await this.batchRepo.update(batchId, { status: 'failed' }); // DB enum: failed
      throw err;
    }

    await this.batchRepo.update(batchId, {
      status:        'committed',
      committedAt:   new Date(),
      committedById: userId,
      skippedRows:   skipped,
    });

    return {
      batchId,
      committed,
      skipped,
      message: `Committed ${committed} rows. Skipped ${skipped} rows with errors.`,
    };
  }

  /** Upsert shift codes from Timing sheet */
  private async commitTimingRows(tenantId: string, rows: ImportRow[]): Promise<number> {
    let count = 0;
    for (const row of rows) {
      const d = row.parsedData;
      if (!d?.code) continue;

      const existing = await this.shiftCodeRepo.findOne({
        where: { tenantId, code: d.code },
      });

      if (existing) {
        await this.shiftCodeRepo.update(existing.id, {
          description:      d.description ?? existing.description,
          startTime:        d.startTime    ?? existing.startTime,
          endTime:          d.endTime      ?? existing.endTime,
          startTime2:       d.startTime2   ?? existing.startTime2,
          endTime2:         d.endTime2     ?? existing.endTime2,
          workingHours:     d.workingHours ?? existing.workingHours,
          breakHours:       d.breakHours   ?? existing.breakHours,
          totalHours:       d.totalHours   ?? existing.totalHours,
          isSplitShift:     d.isSplitShift,
          isCrossMidnight:  d.isCrossMidnight,
          isWfh:            d.isWfh,
          isRamadan:        d.isRamadan,
          isSupervisorShift: d.isSupervisorShift,
          isWorkingShift:   d.isWorkingShift,
          isLeaveCode:      d.isLeaveCode,
          isAbsenceCode:    d.isAbsenceCode,
          allowsFemale:     d.allowsFemale,
          source:           'timing_sheet',
        });
      } else {
        const sc = this.shiftCodeRepo.create({
          tenantId,
          code:             d.code,
          description:      d.description,
          startTime:        d.startTime,
          endTime:          d.endTime,
          startTime2:       d.startTime2,
          endTime2:         d.endTime2,
          workingHours:     d.workingHours,
          breakHours:       d.breakHours,
          totalHours:       d.totalHours,
          isSplitShift:     d.isSplitShift,
          isCrossMidnight:  d.isCrossMidnight,
          isWfh:            d.isWfh,
          isRamadan:        d.isRamadan,
          isSupervisorShift: d.isSupervisorShift,
          isWorkingShift:   d.isWorkingShift,
          isLeaveCode:      d.isLeaveCode,
          isAbsenceCode:    d.isAbsenceCode,
          allowsFemale:     d.allowsFemale,
          source:           'timing_sheet',
        });
        await this.shiftCodeRepo.save(sc);
      }
      count++;
    }
    return count;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHIFTS COMMIT  (Phase 1: auto-upsert refs → Phase 2: bulk attendance)
  // ─────────────────────────────────────────────────────────────────────────

  /** Map shift code text → attendance_marker_enum value */
  private shiftToMarker(shiftCode: string | null): string {
    if (!shiftCode) return 'unknown';
    const sc = shiftCode.toUpperCase().trim();
    if (sc === 'OFF')  return 'off';
    if (sc === 'H')    return 'holiday';
    if (['L','SL','DL','UPL','AL','EL','COV'].includes(sc)) return 'leave';
    if (sc === 'A' || sc.endsWith('A'))  return 'absent';
    if (sc === 'S' || sc.endsWith('S'))  return 'sick';
    if (sc === 'COMP') return 'comp';
    if (['RES','TER'].includes(sc)) return 'absent';
    if (/^[A-Z0-9]/.test(sc))   return 'present';
    return 'unknown';
  }

  /** Split "Abdul Rahman Al-Kanj" → { first: "Abdul Rahman", last: "Al-Kanj" } */
  private splitName(fullName: string): { first: string; last: string | null } {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: null };
    const last  = parts[parts.length - 1];
    const first = parts.slice(0, parts.length - 1).join(' ');
    return { first, last };
  }

  /** Insert/update attendance records from Shifts sheet */
  private async commitShiftsRows(
    tenantId: string,
    rows: ImportRow[],
    batchId?: string,
  ): Promise<number> {
    const validRows = rows.filter(r => r.parsedData?.employeeNo && r.parsedData?.attendanceDate);
    if (!validRows.length) return 0;

    // ── Step 1: build lookup maps from row data ─────────────────────────────
    // Unique functions
    const uniqueFunctions = new Map<string, string | null>(); // name → id (filled after upsert)
    // Unique employees: key = employee_no
    const uniqueEmployees = new Map<string, {
      employeeNo: string; name: string; gender: string;
      email: string | null; functionName: string | null;
      isIntern: boolean;
    }>();

    for (const row of validRows) {
      const d = row.parsedData;
      const fnName = (d.functionName ?? '').trim();
      if (fnName) uniqueFunctions.set(fnName, null);

      const key = String(d.employeeNo);
      if (!uniqueEmployees.has(key)) {
        uniqueEmployees.set(key, {
          employeeNo:   key,
          name:         d.employeeName ?? key,
          gender:       (d.gender ?? 'Male').toLowerCase() === 'female' ? 'female' : 'male',
          email:        d.email ?? null,
          functionName: fnName || null,
          isIntern:     /intern/i.test(fnName),
        });
      }
    }

    // ── Step 2: upsert functions ────────────────────────────────────────────
    for (const [fnName] of uniqueFunctions) {
      const existing = await this.dataSource.query(
        `SELECT id FROM functions WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
        [tenantId, fnName],
      );
      if (existing.length) {
        uniqueFunctions.set(fnName, existing[0].id);
      } else {
        // Generate a safe code from function name: "SM/Mail" → "SM_MAIL"
        const fnCode = fnName.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30);
        // Get max sort_order for this tenant
        const orderRes = await this.dataSource.query(
          `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM functions WHERE tenant_id = $1`,
          [tenantId],
        );
        const sortOrder = orderRes[0]?.next_order ?? 99;

        const res = await this.dataSource.query(
          `INSERT INTO functions (id, tenant_id, name, code, is_active, sort_order, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, true, $4, now(), now())
           ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
           RETURNING id`,
          [tenantId, fnName, fnCode, sortOrder],
        );
        uniqueFunctions.set(fnName, res[0].id);
      }
    }

    // ── Step 3: resolve aliases, then upsert employees ──────────────────────
    const empNoToId = new Map<string, string>(); // employee_no → employees.id

    // Retired numbers from duplicate-employee merges resolve to the survivor
    // instead of creating (or reviving) a record under the old number.
    const employeeNos = [...uniqueEmployees.keys()];
    const aliasMap = await this.lookupEmployeeAliases(tenantId, employeeNos);

    // Status of records that already exist under these numbers, so an alias
    // only overrides when the direct match is missing or no longer active.
    const existingStatus = new Map<string, { id: string; status: string }>();
    if (employeeNos.length) {
      const placeholders = employeeNos.map((_, i) => `$${i + 2}`).join(', ');
      const existingRows = await this.dataSource.query(
        `SELECT id, employee_no, status FROM employees
          WHERE tenant_id = $1 AND employee_no IN (${placeholders})`,
        [tenantId, ...employeeNos],
      );
      for (const r of existingRows) {
        existingStatus.set(String(r.employee_no), { id: r.id, status: r.status });
      }
    }

    for (const [, emp] of uniqueEmployees) {
      const alias    = aliasMap.get(emp.employeeNo);
      const existing = existingStatus.get(emp.employeeNo);
      const directMatchUsable =
        existing && (existing.status === 'active' || existing.status === 'on_leave');

      if (alias && !directMatchUsable) {
        empNoToId.set(emp.employeeNo, alias.employeeId);
        continue; // resolved via alias — never create a new employee for a retired number
      }
      const fnId = emp.functionName ? (uniqueFunctions.get(emp.functionName) ?? null) : null;
      const { first, last } = this.splitName(emp.name);
      const empType = emp.isIntern ? 'intern' : 'full_time';

      const res = await this.dataSource.query(
        `INSERT INTO employees (
           id, tenant_id, employee_no,
           first_name_en, last_name_en,
           gender, function_id, employment_type, status,
           is_supervisor, productivity_factor,
           created_at, updated_at
         ) VALUES (
           gen_random_uuid(), $1, $2,
           $3, $4,
           $5::gender_enum, $6::uuid, $7::employment_type_enum, 'active'::employee_status_enum,
           false, $8,
           now(), now()
         )
         ON CONFLICT (tenant_id, employee_no) DO UPDATE SET
           first_name_en    = CASE WHEN employees.first_name_en = '' THEN EXCLUDED.first_name_en ELSE employees.first_name_en END,
           last_name_en     = COALESCE(employees.last_name_en, EXCLUDED.last_name_en),
           function_id      = COALESCE(employees.function_id, EXCLUDED.function_id),
           updated_at       = now()
         RETURNING id`,
        [
          tenantId,
          emp.employeeNo,
          first,
          last,
          emp.gender,
          fnId,
          empType,
          emp.isIntern ? 0.7 : 1.0,
        ],
      );
      empNoToId.set(emp.employeeNo, res[0].id);
    }

    // ── Step 4: bulk resolve shift_codes ────────────────────────────────────
    const uniqueShiftCodes = [...new Set(
      validRows.map(r => r.parsedData?.shiftCode).filter(Boolean) as string[]
    )];
    const shiftCodeToId = new Map<string, string>();
    // Timing-dictionary times per code — fills scheduled times for rows where
    // the code came from the monthly matrix (no times in the Shifts sheet).
    const shiftCodeTimes = new Map<string, {
      start: string | null; end: string | null;
      start2: string | null; end2: string | null;
      isWorking: boolean;
    }>();
    if (uniqueShiftCodes.length) {
      const placeholders = uniqueShiftCodes.map((_, i) => `$${i + 2}`).join(', ');
      const scRows = await this.dataSource.query(
        `SELECT code, id, start_time, end_time, start_time_2, end_time_2, is_working_shift
           FROM shift_codes WHERE tenant_id = $1 AND code IN (${placeholders})`,
        [tenantId, ...uniqueShiftCodes],
      );
      for (const sc of scRows) {
        shiftCodeToId.set(sc.code, sc.id);
        shiftCodeTimes.set(sc.code, {
          start:  sc.start_time,
          end:    sc.end_time,
          start2: sc.start_time_2,
          end2:   sc.end_time_2,
          isWorking: sc.is_working_shift,
        });
      }
    }

    // ── Step 5: upsert attendance records in chunks ─────────────────────────
    const CHUNK = 200;
    let count = 0;

    // Alias resolution can map a retired and a surviving employee_no to the
    // same employee_id; only one row per (employee_id, date) may go into a
    // multi-row upsert, so keep the first and skip the rest.
    const seenEmpDate = new Set<string>();

    for (let start = 0; start < validRows.length; start += CHUNK) {
      const chunk = validRows.slice(start, start + CHUNK);
      const params: any[] = [];
      const valueClauses: string[] = [];
      let p = 1;

      for (const row of chunk) {
        const d = row.parsedData;
        const empId    = empNoToId.get(String(d.employeeNo));
        if (!empId) continue; // should not happen after upsert

        const empDateKey = `${empId}|${d.attendanceDate}`;
        if (seenEmpDate.has(empDateKey)) continue;
        seenEmpDate.add(empDateKey);

        const scId     = d.shiftCode ? (shiftCodeToId.get(d.shiftCode) ?? null) : null;
        const marker   = this.shiftToMarker(d.shiftCode);

        // Matrix-backfilled rows have a code but no times — take the times
        // from the Timing dictionary so coverage/rest calculations work.
        const dictTimes = d.shiftCode ? shiftCodeTimes.get(d.shiftCode) : null;
        const useDict   = !d.scheduledStart && dictTimes?.isWorking;
        const schedStart  = d.scheduledStart  ?? (useDict ? dictTimes!.start  : null);
        const schedEnd    = d.scheduledEnd    ?? (useDict ? dictTimes!.end    : null);
        const schedStart2 = d.scheduledStart2 ?? (useDict ? dictTimes!.start2 : null);
        const schedEnd2   = d.scheduledEnd2   ?? (useDict ? dictTimes!.end2   : null);
        const notes    = [
          d.notes,
          d.shiftCode && !scId ? `shift:${d.shiftCode}` : null,
        ].filter(Boolean).join(' | ') || null;

        // 23 params per row: $p … $p+22
        valueClauses.push(`(
          gen_random_uuid(),
          $${p},$${p+1},$${p+2}::date,
          $${p+3}::uuid,
          $${p+4}::time,$${p+5}::time,$${p+6}::time,$${p+7}::time,
          $${p+8}::timestamptz,$${p+9}::timestamptz,
          $${p+10}::timestamptz,$${p+11}::timestamptz,
          $${p+12},$${p+13},$${p+14},$${p+15},
          $${p+16},$${p+17},$${p+18},
          $${p+19},$${p+20}::attendance_marker_enum,
          $${p+21}::uuid,$${p+22},
          now(),now()
        )`);

        params.push(
          tenantId,                           // $p+0  tenant_id
          empId,                              // $p+1  employee_id
          d.attendanceDate,                   // $p+2  attendance_date
          scId,                               // $p+3  scheduled_shift_code_id
          schedStart,                         // $p+4  scheduled_start
          schedEnd,                           // $p+5  scheduled_end
          schedStart2,                        // $p+6  scheduled_start_2
          schedEnd2,                          // $p+7  scheduled_end_2
          d.punchIn          ?? null,         // $p+8  punch_in
          d.punchOut         ?? null,         // $p+9  punch_out
          d.systemLogin      ?? null,         // $p+10 system_login
          d.systemLogout     ?? null,         // $p+11 system_logout
          d.punchLateMinutes      ?? 0,       // $p+12 punch_late_minutes
          d.punchEarlyOutMinutes  ?? 0,       // $p+13 punch_early_out_minutes
          d.systemLateMinutes     ?? 0,       // $p+14 system_late_minutes
          d.systemEarlyOutMinutes ?? 0,       // $p+15 system_early_out_minutes
          d.otMinutes        ?? 0,            // $p+16 ot_minutes
          d.isMissingPunch   ?? false,        // $p+17 is_missing_punch
          d.isMissingSystem  ?? false,        // $p+18 is_missing_system
          d.isWfh            ?? false,        // $p+19 is_wfh
          marker,                             // $p+20 attendance_marker
          batchId ?? null,                    // $p+21 import_batch_id
          notes,                              // $p+22 notes
        );
        p += 23;
        count++;
      }

      if (!valueClauses.length) continue;

      await this.dataSource.query(
        `INSERT INTO attendance_records (
           id, tenant_id, employee_id, attendance_date,
           scheduled_shift_code_id,
           scheduled_start, scheduled_end, scheduled_start_2, scheduled_end_2,
           punch_in, punch_out,
           system_login, system_logout,
           punch_late_minutes, punch_early_out_minutes,
           system_late_minutes, system_early_out_minutes,
           ot_minutes, is_missing_punch, is_missing_system,
           is_wfh, attendance_marker,
           import_batch_id, notes,
           created_at, updated_at
         ) VALUES ${valueClauses.join(', ')}
         ON CONFLICT (tenant_id, employee_id, attendance_date) DO UPDATE SET
           scheduled_shift_code_id  = EXCLUDED.scheduled_shift_code_id,
           scheduled_start          = EXCLUDED.scheduled_start,
           scheduled_end            = EXCLUDED.scheduled_end,
           scheduled_start_2        = EXCLUDED.scheduled_start_2,
           scheduled_end_2          = EXCLUDED.scheduled_end_2,
           punch_in                 = EXCLUDED.punch_in,
           punch_out                = EXCLUDED.punch_out,
           system_login             = EXCLUDED.system_login,
           system_logout            = EXCLUDED.system_logout,
           punch_late_minutes       = EXCLUDED.punch_late_minutes,
           punch_early_out_minutes  = EXCLUDED.punch_early_out_minutes,
           system_late_minutes      = EXCLUDED.system_late_minutes,
           system_early_out_minutes = EXCLUDED.system_early_out_minutes,
           ot_minutes               = EXCLUDED.ot_minutes,
           is_missing_punch         = EXCLUDED.is_missing_punch,
           is_missing_system        = EXCLUDED.is_missing_system,
           is_wfh                   = EXCLUDED.is_wfh,
           attendance_marker        = EXCLUDED.attendance_marker,
           notes                    = EXCLUDED.notes,
           updated_at               = now()`,
        params,
      );
    }

    return count;
  }

  /** List batches for a tenant */
  async listBatches(tenantId: string, importType?: ImportType) {
    const qb = this.batchRepo.createQueryBuilder('b')
      .where('b.tenant_id = :tenantId', { tenantId })
      .orderBy('b.created_at', 'DESC')
      .take(50);

    if (importType) {
      const dbType = TYPE_TO_DB[importType] ?? importType;
      qb.andWhere('b.import_type = :importType', { importType: dbType });
    }
    return qb.getMany();
  }
}
