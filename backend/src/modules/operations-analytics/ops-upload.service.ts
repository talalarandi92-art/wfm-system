import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';

/* ─── Header synonym detection ──────────────────────────────────────────────
   Operations exports come from different systems (Sprinklr, CRM, surveys) with
   varying column names. Each field has a synonym list; the first header that
   contains one of them (case-insensitive) wins.
─────────────────────────────────────────────────────────────────────────── */
const FIELD_SYNONYMS: Record<string, string[]> = {
  timestamp: ['created time', 'created at', 'creation time', 'contact time', 'case created',
              'timestamp', 'date & time', 'datetime', 'created_date', 'date'],
  channel:   ['channel', 'source', 'platform', 'media type', 'contact type'],
  payment:   ['payment method', 'payment type', 'payment mode', 'payment'],
  reason:    ['contact reason', 'case reason', 'disposition', 'issue type',
              'inquiry type', 'category', 'reason'],
  agentName: ['agent name', 'employee name', 'assigned to', 'owner', 'advocate', 'agent'],
  agentLogin:['agent email', 'agent login', 'user id', 'login id', 'username', 'email'],
  surveySent:['survey sent', 'survey link sent', 'csat sent', 'link sent'],
  surveyClicked: ['survey clicked', 'link clicked', 'survey response', 'responded', 'clicked'],
  rating:    ['csat', 'rating', 'satisfaction', 'nps', 'survey score', 'feedback score', 'score'],
};

const POSITIVE_WORDS = ['positive', 'good', 'great', 'excellent', 'satisfied', 'happy', 'yes', '👍', 'ممتاز', 'جيد', 'راضي'];
const NEGATIVE_WORDS = ['negative', 'bad', 'poor', 'unsatisfied', 'dissatisfied', 'angry', 'no', '👎', 'سيء', 'غير راضي'];
const TRUTHY = ['yes', 'true', '1', 'sent', 'clicked', 'y', 'تم'];

export interface OpsColumnMap { [field: string]: number }

export interface OpsContactRow {
  contactTs: Date | null;
  contactDate: string | null;
  contactHour: number | null;
  channel: string | null;
  paymentMethod: string | null;
  contactReason: string | null;
  agentName: string | null;
  agentLogin: string | null;
  surveySent: boolean;
  surveyClicked: boolean;
  ratingRaw: string | null;
  ratingSentiment: 'positive' | 'negative' | 'neutral' | null;
  raw: Record<string, any>;
}

export interface OpsPreview {
  fileName: string;
  sheetName: string;
  totalRows: number;
  detectedColumns: Record<string, string>;   // field → original header
  unmappedHeaders: string[];
  periodFrom: string | null;
  periodTo: string | null;
  channels: string[];
  sampleRows: OpsContactRow[];
  warnings: string[];
}

@Injectable()
export class OpsUploadService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /* ── Preview: parse only, no DB write ──────────────────────────────────── */
  parsePreview(buffer: Buffer, filename: string): OpsPreview {
    const { sheetName, headers, dataRows, colMap, headerNames } = this.parseWorkbook(buffer);

    const rows = dataRows.map(r => this.normalizeRow(r, colMap, headers));
    const dates = rows.map(r => r.contactDate).filter(Boolean).sort();
    const channels = [...new Set(rows.map(r => r.channel).filter(Boolean))] as string[];

    const warnings: string[] = [];
    if (colMap.timestamp === undefined) warnings.push('No timestamp column detected — hourly analysis will be empty.');
    if (colMap.reason === undefined)    warnings.push('No contact-reason column detected.');
    if (colMap.agentName === undefined && colMap.agentLogin === undefined)
      warnings.push('No agent column detected — employee ranking will be empty.');

    const mappedIdx = new Set(Object.values(colMap));
    const unmapped = headerNames.filter((_, i) => !mappedIdx.has(i));

    return {
      fileName: filename,
      sheetName,
      totalRows: rows.length,
      detectedColumns: Object.fromEntries(
        Object.entries(colMap).map(([f, i]) => [f, headerNames[i]]),
      ),
      unmappedHeaders: unmapped,
      periodFrom: dates[0] ?? null,
      periodTo: dates[dates.length - 1] ?? null,
      channels,
      sampleRows: rows.slice(0, 15),
      warnings,
    };
  }

  /* ── Commit: parse + bulk insert ───────────────────────────────────────── */
  async commitUpload(
    buffer: Buffer, filename: string,
    tenantId: string, userId: string, notes?: string,
  ) {
    const { sheetName, headers, dataRows, colMap, headerNames } = this.parseWorkbook(buffer);
    const rows = dataRows.map(r => this.normalizeRow(r, colMap, headers));
    if (!rows.length) throw new BadRequestException('No data rows found in file.');

    const dates = rows.map(r => r.contactDate).filter(Boolean).sort();

    return this.ds.transaction(async (em) => {
      const [batch] = await em.query(
        `INSERT INTO ops_batches (tenant_id, file_name, period_from, period_to, total_rows, column_map, uploaded_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [tenantId, filename, dates[0] ?? null, dates[dates.length - 1] ?? null,
         rows.length,
         JSON.stringify(Object.fromEntries(Object.entries(colMap).map(([f, i]) => [f, headerNames[i]]))),
         userId, notes ?? null],
      );

      // Bulk insert in chunks of 500
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const values: any[] = [];
        const placeholders = chunk.map((r, j) => {
          const b = j * 14;
          values.push(
            tenantId, batch.id, r.contactTs, r.contactDate, r.contactHour,
            r.channel, r.paymentMethod, r.contactReason, r.agentName, r.agentLogin,
            r.surveySent, r.surveyClicked, r.ratingRaw, r.ratingSentiment,
          );
          return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14})`;
        }).join(',');
        await em.query(
          `INSERT INTO ops_contacts
             (tenant_id, batch_id, contact_ts, contact_date, contact_hour,
              channel, payment_method, contact_reason, agent_name, agent_login,
              survey_sent, survey_clicked, rating_raw, rating_sentiment)
           VALUES ${placeholders}`,
          values,
        );
      }

      return { batchId: batch.id, totalRows: rows.length, periodFrom: dates[0] ?? null, periodTo: dates[dates.length - 1] ?? null };
    });
  }

  /* ── Workbook parsing ──────────────────────────────────────────────────── */
  private parseWorkbook(buffer: Buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

    // Pick the sheet with the most data rows
    let best = { sheetName: '', rows: [] as any[][] };
    for (const name of wb.SheetNames) {
      const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
      if (rows.length > best.rows.length) best = { sheetName: name, rows };
    }
    if (!best.rows.length) throw new BadRequestException('Workbook is empty.');

    // Find the header row: first row where ≥3 cells are non-empty strings
    let headerIdx = 0;
    for (let i = 0; i < Math.min(best.rows.length, 20); i++) {
      const cells = best.rows[i].filter(c => typeof c === 'string' && c.trim());
      if (cells.length >= 3) { headerIdx = i; break; }
    }

    const headerNames = best.rows[headerIdx].map(h => String(h ?? '').trim());
    const colMap = this.detectColumns(headerNames);
    if (Object.keys(colMap).length < 2)
      throw new BadRequestException(
        `Could not detect operations columns. Found headers: ${headerNames.filter(Boolean).slice(0, 12).join(', ')}`,
      );

    const dataRows = best.rows.slice(headerIdx + 1).filter(r => r.some(c => c !== null && c !== ''));
    return { sheetName: best.sheetName, headers: headerNames, dataRows, colMap, headerNames };
  }

  private detectColumns(headers: string[]): OpsColumnMap {
    const map: OpsColumnMap = {};
    const lower = headers.map(h => h.toLowerCase());

    for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
      // Exact-ish match first (header equals or starts with synonym), then contains
      for (const syn of synonyms) {
        let idx = lower.findIndex((h, i) => !Object.values(map).includes(i) && (h === syn || h.startsWith(syn)));
        if (idx === -1) idx = lower.findIndex((h, i) => !Object.values(map).includes(i) && h.includes(syn));
        if (idx !== -1) { map[field] = idx; break; }
      }
    }
    return map;
  }

  /* ── Row normalization ─────────────────────────────────────────────────── */
  private normalizeRow(row: any[], colMap: OpsColumnMap, headers: string[]): OpsContactRow {
    const get = (f: string) => colMap[f] !== undefined ? row[colMap[f]] : null;
    const str = (v: any) => v === null || v === undefined || v === '' ? null : String(v).trim();

    const ts = this.parseTimestamp(get('timestamp'));
    const ratingRaw = str(get('rating'));

    const raw: Record<string, any> = {};
    headers.forEach((h, i) => { if (h && row[i] !== null) raw[h] = row[i]; });

    return {
      contactTs: ts,
      contactDate: ts ? ts.toISOString().slice(0, 10) : null,
      contactHour: ts ? ts.getHours() : null,
      channel: str(get('channel')),
      paymentMethod: str(get('payment')),
      contactReason: str(get('reason')),
      agentName: str(get('agentName')),
      agentLogin: str(get('agentLogin'))?.toLowerCase() ?? null,
      surveySent: this.truthy(get('surveySent')),
      surveyClicked: this.truthy(get('surveyClicked')),
      ratingRaw,
      ratingSentiment: this.sentiment(ratingRaw),
      raw,
    };
  }

  private parseTimestamp(v: any): Date | null {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') {
      // Excel serial date
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
  }

  private truthy(v: any): boolean {
    if (v === null || v === undefined || v === '') return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    return TRUTHY.includes(String(v).trim().toLowerCase());
  }

  private sentiment(raw: string | null): 'positive' | 'negative' | 'neutral' | null {
    if (raw === null) return null;
    const v = raw.toLowerCase();

    const num = parseFloat(v);
    if (!isNaN(num)) {
      // Detect scale: ≤5 → CSAT 1-5; otherwise NPS 0-10
      if (num <= 5) return num >= 4 ? 'positive' : num <= 2 ? 'negative' : 'neutral';
      return num >= 9 ? 'positive' : num <= 6 ? 'negative' : 'neutral';
    }
    if (POSITIVE_WORDS.some(w => v.includes(w))) return 'positive';
    if (NEGATIVE_WORDS.some(w => v.includes(w))) return 'negative';
    return 'neutral';
  }
}
