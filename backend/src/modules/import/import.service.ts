import {
  Injectable, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

import { ImportBatch } from '../../database/entities/import-batch.entity';
import { ImportRow } from '../../database/entities/import-row.entity';
import { ShiftCode } from '../../database/entities/shift-code.entity';

import { parseTimingSheet } from './parsers/timing-sheet.parser';
import { parseShiftsSheet } from './parsers/shifts-sheet.parser';

export type ImportType = 'timing' | 'shifts' | 'schedule';

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(ImportBatch) private batchRepo: Repository<ImportBatch>,
    @InjectRepository(ImportRow)   private rowRepo:   Repository<ImportRow>,
    @InjectRepository(ShiftCode)   private shiftCodeRepo: Repository<ShiftCode>,
    private dataSource: DataSource,
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

    if (importType === 'timing') {
      const result = parseTimingSheet(workbook, sheetName);
      parsedRows  = result.rows;
      globalErrors = result.errors;
    } else if (importType === 'shifts') {
      const result = parseShiftsSheet(workbook, sheetName);
      parsedRows  = result.rows;
      globalErrors = result.errors;
    } else {
      throw new BadRequestException(`Unsupported import type: ${importType}`);
    }

    if (globalErrors.length && !parsedRows.length) {
      throw new BadRequestException(globalErrors.join('; '));
    }

    const totalRows   = parsedRows.length;
    const errorRows   = parsedRows.filter(r => r.errors?.length > 0).length;
    const warningRows = parsedRows.filter(r => r.warnings?.length > 0).length;
    const validRows   = totalRows - errorRows;

    // Create batch record
    const batch = this.batchRepo.create({
      tenantId,
      importType,
      originalFilename: file.originalname,
      storedFilename:   file.originalname,
      fileSizeBytes:    file.size,
      status:           'previewing',
      totalRows,
      validRows,
      errorRows,
      warningRows,
      skippedRows:      0,
      createdById:      userId,
      metadata: {
        sheetNames: workbook.SheetNames,
        parsedSheet: sheetName ?? workbook.SheetNames[0],
        globalErrors,
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
        sheetNames: workbook.SheetNames,
      },
    };
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

    await this.batchRepo.update(batchId, { status: 'committing' });

    let committed = 0;
    let skipped   = 0;

    try {
      if (batch.importType === 'timing') {
        committed = await this.commitTimingRows(tenantId, validRows);
      } else if (batch.importType === 'shifts') {
        committed = await this.commitShiftsRows(tenantId, validRows);
      }
      skipped = rows.length - validRows.length;
    } catch (err) {
      await this.batchRepo.update(batchId, { status: 'error' });
      throw err;
    }

    await this.batchRepo.update(batchId, {
      status:      'committed',
      committedAt: new Date(),
      committedById: userId,
      skippedRows: skipped,
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

  /** Insert/update attendance records from Shifts sheet */
  private async commitShiftsRows(tenantId: string, rows: ImportRow[]): Promise<number> {
    let count = 0;
    for (const row of rows) {
      const d = row.parsedData;
      if (!d?.employeeNo || !d?.attendanceDate) continue;

      // Raw SQL upsert so we don't need a full AttendanceRecord entity yet
      await this.dataSource.query(
        `INSERT INTO attendance_records (
           id, tenant_id, employee_id, attendance_date,
           shift_code, punch_in, punch_out,
           system_login, system_logout,
           punch_late_minutes, system_late_minutes,
           punch_early_out_minutes, system_early_out_minutes,
           ot_minutes, is_missing_punch, is_missing_system,
           is_wfh, notes, source, created_at, updated_at
         )
         SELECT
           gen_random_uuid(), $1,
           e.id, $3::date,
           $4, $5::timestamptz, $6::timestamptz,
           $7::timestamptz, $8::timestamptz,
           $9, $10, $11, $12,
           $13, $14, $15,
           $16, $17, 'import', now(), now()
         FROM employees e
         WHERE e.tenant_id = $1 AND e.employee_no = $2
         ON CONFLICT (tenant_id, employee_id, attendance_date)
         DO UPDATE SET
           shift_code              = EXCLUDED.shift_code,
           punch_in                = EXCLUDED.punch_in,
           punch_out               = EXCLUDED.punch_out,
           system_login            = EXCLUDED.system_login,
           system_logout           = EXCLUDED.system_logout,
           punch_late_minutes      = EXCLUDED.punch_late_minutes,
           system_late_minutes     = EXCLUDED.system_late_minutes,
           punch_early_out_minutes = EXCLUDED.punch_early_out_minutes,
           system_early_out_minutes= EXCLUDED.system_early_out_minutes,
           ot_minutes              = EXCLUDED.ot_minutes,
           is_missing_punch        = EXCLUDED.is_missing_punch,
           is_missing_system       = EXCLUDED.is_missing_system,
           is_wfh                  = EXCLUDED.is_wfh,
           notes                   = EXCLUDED.notes,
           updated_at              = now()`,
        [
          tenantId,
          d.employeeNo,
          d.attendanceDate,
          d.shiftCode   ?? null,
          d.punchIn     ?? null,
          d.punchOut    ?? null,
          d.systemLogin ?? null,
          d.systemLogout ?? null,
          d.punchLateMinutes      ?? 0,
          d.systemLateMinutes     ?? 0,
          d.punchEarlyOutMinutes  ?? 0,
          d.systemEarlyOutMinutes ?? 0,
          d.otMinutes ?? 0,
          d.isMissingPunch  ?? false,
          d.isMissingSystem ?? false,
          d.isWfh ?? false,
          d.notes ?? null,
        ],
      );
      count++;
    }
    return count;
  }

  /** List batches for a tenant */
  async listBatches(tenantId: string, importType?: ImportType) {
    const qb = this.batchRepo.createQueryBuilder('b')
      .where('b.tenant_id = :tenantId', { tenantId })
      .orderBy('b.created_at', 'DESC')
      .take(50);

    if (importType) qb.andWhere('b.import_type = :importType', { importType });
    return qb.getMany();
  }
}
