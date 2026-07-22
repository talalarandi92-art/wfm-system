import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * KPI Registry (Scorecard program wave B1) — the rulebook DB.
 * ADDITIVE: nothing in the live scoring path reads this yet (B6 will).
 * Every mutation is audited (module='scorecard') and appends an immutable
 * scorecard_formula_versions row — old formulas are never silently replaced.
 */
@Injectable()
export class KpiRegistryService {
  private readonly logger = new Logger(KpiRegistryService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** All KPIs with their function configs. */
  async list(tenantId: string, includeInactive = true) {
    const rows = await this.ds.query(
      `SELECT r.id, r.kpi_code, r.name_en, r.name_ar, r.definition, r.formula_text,
              r.direction, r.unit, r.source, r.attribution_rule, r.active,
              r.created_at, r.updated_at,
              COALESCE(json_agg(json_build_object(
                'id', c.id, 'function_name', c.function_name, 'weight', c.weight,
                'target', c.target, 'band', c.band,
                -- ::text on purpose. A DATE comes back as a JS Date at LOCAL midnight and
                -- JSON-serialises through UTC, which shifted every window a day earlier
                -- (2026-05-01 was served as 2026-04-30) and would resolve the wrong period.
                'applies_from', c.applies_from::text, 'applies_to', c.applies_to::text
              ) ORDER BY c.function_key, c.applies_from DESC)
                FILTER (WHERE c.id IS NOT NULL), '[]') AS configs
         FROM kpi_registry r
         LEFT JOIN kpi_function_config c ON c.kpi_id = r.id
        WHERE r.tenant_id = $1 ${includeInactive ? '' : 'AND r.active = TRUE'}
        GROUP BY r.id
        ORDER BY r.kpi_code`,
      [tenantId],
    );
    return { count: rows.length, kpis: rows };
  }

  /** One KPI by code, with configs + full formula-version history. */
  async getByCode(tenantId: string, code: string) {
    const [kpi] = await this.ds.query(
      `SELECT * FROM kpi_registry WHERE tenant_id = $1 AND kpi_code = $2`,
      [tenantId, code.toUpperCase()],
    );
    if (!kpi) throw new NotFoundException(`KPI '${code}' not found in registry`);
    const configs = await this.ds.query(
      `SELECT id, function_name, weight, target, band,
              applies_from::text AS applies_from, applies_to::text AS applies_to,
              created_at, updated_at
         FROM kpi_function_config WHERE kpi_id = $1
        ORDER BY function_key, applies_from DESC`,
      [kpi.id],
    );
    const versions = await this.ds.query(
      `SELECT version, change_note, definition, effective_from, created_by, created_at
         FROM scorecard_formula_versions WHERE kpi_id = $1 ORDER BY version DESC`,
      [kpi.id],
    );
    return { ...kpi, configs, formula_versions: versions };
  }

  /**
   * Admin update of a KPI's registry row and/or one of its function configs.
   * Appends the next formula version and writes an audit row. Never deletes history.
   */
  async patch(
    tenantId: string,
    code: string,
    body: {
      name_en?: string; name_ar?: string; definition?: any; formula_text?: string;
      direction?: string; unit?: string; source?: string; attribution_rule?: string;
      active?: boolean; change_note?: string;
      config?: { function_name?: string | null; weight?: number; target?: number | null; band?: any; applies_from?: string };
    },
    actor: any,
  ) {
    const [kpi] = await this.ds.query(
      `SELECT * FROM kpi_registry WHERE tenant_id = $1 AND kpi_code = $2`,
      [tenantId, code.toUpperCase()],
    );
    if (!kpi) throw new NotFoundException(`KPI '${code}' not found in registry`);
    if (body.direction && !['higher_better', 'lower_better'].includes(body.direction)) {
      throw new BadRequestException(`direction must be higher_better | lower_better`);
    }

    const runner = this.ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // 1. registry-row fields
      const fields: Record<string, any> = {};
      for (const f of ['name_en', 'name_ar', 'formula_text', 'direction', 'unit', 'source', 'attribution_rule', 'active'] as const) {
        if (body[f] !== undefined) fields[f] = body[f];
      }
      if (body.definition !== undefined) fields['definition'] = JSON.stringify(body.definition);
      if (Object.keys(fields).length) {
        const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}${k === 'definition' ? '::jsonb' : ''}`);
        await runner.query(
          `UPDATE kpi_registry SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
          [kpi.id, ...Object.values(fields)],
        );
      }

      // 2. optional function-config upsert (most-specific wins at read time)
      if (body.config) {
        const c = body.config;
        await runner.query(
          `INSERT INTO kpi_function_config (tenant_id, kpi_id, function_name, weight, target, band, applies_from)
           VALUES ($1,$2,$3,COALESCE($4,1),$5,$6::jsonb,COALESCE($7::date, CURRENT_DATE))
           ON CONFLICT (tenant_id, kpi_id, function_key, applies_from) DO UPDATE SET
             weight = COALESCE(EXCLUDED.weight, kpi_function_config.weight),
             target = EXCLUDED.target,
             band   = COALESCE(EXCLUDED.band, kpi_function_config.band),
             updated_at = NOW()`,
          [tenantId, kpi.id, c.function_name ?? null, c.weight ?? null, c.target ?? null,
           c.band !== undefined ? JSON.stringify(c.band) : null, c.applies_from ?? null],
        );
      }

      // 3. append next formula version (immutable history — spec §13)
      const [{ next }] = await runner.query(
        `SELECT COALESCE(MAX(version),0)+1 AS next FROM scorecard_formula_versions WHERE kpi_id = $1`,
        [kpi.id],
      );
      await runner.query(
        `INSERT INTO scorecard_formula_versions (tenant_id, version, kpi_id, change_note, definition, effective_from, created_by)
         SELECT $1, $2, $3, $4,
                jsonb_build_object(
                  'formula_text', r.formula_text, 'definition', r.definition, 'active', r.active,
                  'configs', (SELECT COALESCE(json_agg(json_build_object(
                     'function_name', c.function_name, 'weight', c.weight, 'target', c.target,
                     'band', c.band, 'applies_from', c.applies_from)), '[]')
                     FROM kpi_function_config c WHERE c.kpi_id = r.id)),
                CURRENT_DATE, $5
           FROM kpi_registry r WHERE r.id = $3`,
        [tenantId, next, kpi.id, body.change_note ?? 'registry update', actor?.id ?? null],
      );

      // 4. audit
      await runner.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, notes)
         VALUES ($1,$2,$3,'kpi_registry.update','scorecard','kpi_registry',$4,$5)`,
        [tenantId, actor?.id ?? null, actor?.email ?? null, kpi.id,
         `KPI ${kpi.kpi_code} updated → formula v${next}. ${body.change_note ?? ''}`.trim()],
      );

      await runner.commitTransaction();
    } catch (e) {
      await runner.rollbackTransaction();
      throw e;
    } finally {
      await runner.release();
    }
    return this.getByCode(tenantId, code);
  }
}
