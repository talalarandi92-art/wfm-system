import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  resolveSignal,
  bestFuzzy,
  nameSimilarity,
  normEmail,
  HARD_LINK_THRESHOLD,
} from './resolution';

/**
 * Employee Identity (Scorecard program wave B2, spec §10).
 *
 * A resolved MAP over the canonical `employee_identity` spine, linking each
 * person to their Odoo / Sprinklr / email identities so every downstream source
 * attributes to the right person_no. ADDITIVE — nothing in the live path reads
 * this yet; the main thread integrates it after handoff.
 *
 * Resolution precedence: exact email > sprinklr_agent_id (structured) >
 * fuzzy-name (flagged, NEVER a hard link → routed to identity_unresolved).
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ---- lookups (used by downstream attribution) --------------------------

  async resolveByEmail(tenantId: string, email: string): Promise<string | null> {
    const e = normEmail(email);
    if (!e) return null;
    const [r] = await this.ds.query(
      `SELECT person_no FROM employee_identity_map
        WHERE tenant_id = $1 AND (lower(email) = $2 OR lower(sprinklr_email) = $2)
        LIMIT 1`,
      [tenantId, e],
    );
    return r?.person_no ?? null;
  }

  async resolveBySprinklrAgentId(tenantId: string, agentId: string): Promise<string | null> {
    if (!agentId) return null;
    const [r] = await this.ds.query(
      `SELECT person_no FROM employee_identity_map
        WHERE tenant_id = $1 AND sprinklr_agent_id = $2 LIMIT 1`,
      [tenantId, agentId],
    );
    return r?.person_no ?? null;
  }

  /**
   * Fuzzy name resolution — ALWAYS flagged low-confidence, never authoritative.
   * Returns the suggestion + a flag so callers know not to hard-link on it.
   */
  async resolveByName(
    tenantId: string,
    name: string,
  ): Promise<{ personNo: string | null; confidence: number; flagged: boolean }> {
    const roster = await this.ds.query(
      `SELECT DISTINCT person_no AS "personNo", clean_name AS name
         FROM employee_identity WHERE tenant_id = $1 AND is_canonical`,
      [tenantId],
    );
    const best = bestFuzzy(name, roster);
    if (!best) return { personNo: null, confidence: 0, flagged: true };
    return { personNo: best.personNo, confidence: Math.min(0.79, best.score), flagged: true };
  }

  // ---- refresh (rebuild the map + queue) ---------------------------------

  /**
   * Idempotent rebuild: seed one map row per canonical person, enrich with the
   * strongest cross-system link, and route unmatched external signals to the
   * unresolved queue. Never writes a hard link below HARD_LINK_THRESHOLD.
   */
  async refresh(tenantId: string): Promise<{
    persons: number;
    resolved: number;
    queued: number;
    transfers: number;
  }> {
    // 1) canonical persons (the spine)
    const persons: Array<{
      person_no: string;
      employee_no: string;
      clean_name: string;
      status: string;
    }> = await this.ds.query(
      `SELECT person_no, employee_no, clean_name, status
         FROM employee_identity WHERE tenant_id = $1 AND is_canonical`,
      [tenantId],
    );

    // 2) employees master (uuid id + odoo_id) keyed by employee_no
    const emps: Array<{ id: string; employee_no: string; odoo_id: number | null }> =
      await this.ds.query(
        `SELECT id, employee_no, odoo_id FROM employees WHERE tenant_id = $1`,
        [tenantId],
      );
    const empByNo = new Map(emps.map((e) => [e.employee_no, e]));

    // 3) known person emails (users linked to an employee) → for exact-email path
    const userEmails: Array<{ employee_no: string; email: string }> = await this.ds.query(
      `SELECT e.employee_no, lower(u.email) AS email
         FROM users u JOIN employees e ON e.id = u.employee_id
        WHERE u.tenant_id = $1 AND u.employee_id IS NOT NULL AND u.email IS NOT NULL`,
      [tenantId],
    );
    const emailToPerson = new Map<string, string>();
    for (const u of userEmails) {
      const p = persons.find((x) => x.employee_no === u.employee_no);
      if (p) emailToPerson.set(u.email, p.person_no);
    }

    // 4) sprinklr signals with their structured employee_id link (if any)
    const sprinklr: Array<{
      sprinklr_agent_id: string;
      agent_name: string;
      agent_email: string | null;
      user_id: string | null;
      person_no: string | null; // via employee_id → employees → identity
    }> = await this.ds.query(
      `SELECT s.sprinklr_agent_id, s.agent_name, s.agent_email, s.user_id::text AS user_id,
              i.person_no
         FROM sprinklr_agent_map s
         LEFT JOIN employees e ON e.id = s.employee_id
         LEFT JOIN employee_identity i ON i.employee_no = e.employee_no AND i.is_canonical
        WHERE s.tenant_id = $1`,
      [tenantId],
    );

    const rosterForFuzzy = persons.map((p) => ({ personNo: p.person_no, name: p.clean_name }));

    // Resolve each sprinklr signal → attach to a person (hard) or queue it.
    const linkByPerson = new Map<
      string,
      { agentId: string; email: string | null; userId: string | null; confidence: number; method: string }
    >();
    const queue: Array<{
      source: string;
      raw_key: string;
      raw_kind: string;
      raw_name: string | null;
      suggested: string | null;
      suggestedConf: number | null;
      note: string;
    }> = [];

    for (const s of sprinklr) {
      const email = normEmail(s.agent_email);
      const emailMatch = email ? emailToPerson.get(email) ?? null : null;
      const fuzzy = !emailMatch && !s.person_no ? bestFuzzy(s.agent_name, rosterForFuzzy) : null;
      const outcome = resolveSignal({
        emailMatchPersonNo: emailMatch,
        structuralPersonNo: s.person_no,
        fuzzy,
      });

      if (outcome.hardLink && outcome.personNo) {
        // keep the highest-confidence link per person
        const prev = linkByPerson.get(outcome.personNo);
        if (!prev || outcome.confidence > prev.confidence) {
          linkByPerson.set(outcome.personNo, {
            agentId: s.sprinklr_agent_id,
            email: s.agent_email,
            userId: s.user_id,
            confidence: outcome.confidence,
            method: outcome.method,
          });
        }
      } else {
        queue.push({
          source: 'sprinklr',
          raw_key: s.agent_email || s.sprinklr_agent_id,
          raw_kind: s.agent_email ? 'email' : 'agent_id',
          raw_name: s.agent_name,
          suggested: outcome.personNo,
          suggestedConf: outcome.personNo ? outcome.confidence : null,
          note:
            outcome.method === 'fuzzy_name'
              ? `fuzzy name match (${outcome.confidence.toFixed(2)}) — below hard-link threshold ${HARD_LINK_THRESHOLD}`
              : 'no structured link and no confident name match',
        });
      }
    }

    // 5) transfer log from roster function changes per person
    const transfers: Array<{ person_no: string; from_fn: string; to_fn: string; eff: string }> =
      await this.ds.query(
        `WITH months AS (
           SELECT person_no,
                  date_trunc('month', work_date)::date AS m,
                  mode() WITHIN GROUP (ORDER BY COALESCE(NULLIF(role_function,''), function_name)) AS fn
             FROM roster_days
            WHERE tenant_id = $1 AND person_no IS NOT NULL
            GROUP BY person_no, date_trunc('month', work_date)
         ), seq AS (
           SELECT person_no, m, fn,
                  lag(fn) OVER (PARTITION BY person_no ORDER BY m) AS prev_fn
             FROM months
         )
         SELECT person_no, prev_fn AS from_fn, fn AS to_fn, m AS eff
           FROM seq WHERE prev_fn IS NOT NULL AND prev_fn <> fn`,
        [tenantId],
      );

    // ---- write everything in one transaction ----
    const runner = this.ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let resolvedCount = 0;
    try {
      for (const p of persons) {
        const emp = empByNo.get(p.employee_no);
        const link = linkByPerson.get(p.person_no);
        // person email: known user email (reverse of emailToPerson) or the sprinklr email
        let email: string | null = null;
        for (const [em, pn] of emailToPerson) if (pn === p.person_no) email = em;
        if (!email && link?.email) email = link.email;
        const resolved = !!link; // has at least one hard cross-system link
        if (resolved) resolvedCount++;
        await runner.query(
          `INSERT INTO employee_identity_map
             (tenant_id, person_no, employee_id, employee_no, full_name, email, odoo_id,
              sprinklr_agent_id, sprinklr_user_id, sprinklr_email, status, resolved, confidence,
              resolve_method, last_seen, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(), now())
           ON CONFLICT (tenant_id, person_no) DO UPDATE SET
             employee_id = EXCLUDED.employee_id, employee_no = EXCLUDED.employee_no,
             full_name = EXCLUDED.full_name, email = EXCLUDED.email, odoo_id = EXCLUDED.odoo_id,
             sprinklr_agent_id = EXCLUDED.sprinklr_agent_id,
             sprinklr_user_id = EXCLUDED.sprinklr_user_id, sprinklr_email = EXCLUDED.sprinklr_email,
             status = EXCLUDED.status, resolved = EXCLUDED.resolved, confidence = EXCLUDED.confidence,
             resolve_method = EXCLUDED.resolve_method, last_seen = now(), updated_at = now()`,
          [
            tenantId,
            p.person_no,
            emp?.id ?? null,
            p.employee_no,
            p.clean_name,
            email,
            emp?.odoo_id ?? null,
            link?.agentId ?? null,
            link?.userId ?? null,
            link?.email ?? null,
            p.status,
            resolved,
            link ? link.confidence : 1.0,
            link ? link.method : 'canonical',
          ],
        );
      }

      for (const u of queue) {
        await runner.query(
          `INSERT INTO identity_unresolved
             (tenant_id, source, raw_key, raw_kind, raw_name, suggested_person_no,
              suggested_confidence, note, last_seen)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
           ON CONFLICT (tenant_id, source, raw_key) DO UPDATE SET
             occurrences = identity_unresolved.occurrences + 1,
             raw_name = EXCLUDED.raw_name,
             suggested_person_no = CASE WHEN identity_unresolved.status = 'open'
                                        THEN EXCLUDED.suggested_person_no
                                        ELSE identity_unresolved.suggested_person_no END,
             suggested_confidence = EXCLUDED.suggested_confidence,
             note = EXCLUDED.note, last_seen = now()`,
          [tenantId, u.source, u.raw_key, u.raw_kind, u.raw_name, u.suggested, u.suggestedConf, u.note],
        );
      }

      for (const t of transfers) {
        await runner.query(
          `INSERT INTO identity_transfer_log (tenant_id, person_no, from_function, to_function, effective_date)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, person_no, effective_date, to_function) DO NOTHING`,
          [tenantId, t.person_no, t.from_fn, t.to_fn, t.eff],
        );
      }

      await runner.commitTransaction();
    } catch (e) {
      await runner.rollbackTransaction();
      throw e;
    } finally {
      await runner.release();
    }

    return {
      persons: persons.length,
      resolved: resolvedCount,
      queued: queue.length,
      transfers: transfers.length,
    };
  }

  // ---- endpoints backing ------------------------------------------------

  async list(tenantId: string, filters: { resolved?: string; q?: string } = {}) {
    const where: string[] = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    if (filters.resolved === 'true' || filters.resolved === 'false') {
      params.push(filters.resolved === 'true');
      where.push(`resolved = $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q.toLowerCase()}%`);
      where.push(
        `(lower(full_name) LIKE $${params.length} OR person_no LIKE $${params.length} OR lower(email) LIKE $${params.length})`,
      );
    }
    const rows = await this.ds.query(
      `SELECT person_no, employee_no, full_name, email, odoo_id, sprinklr_agent_id,
              sprinklr_email, status, resolved, confidence, resolve_method, last_seen
         FROM employee_identity_map WHERE ${where.join(' AND ')}
        ORDER BY resolved DESC, full_name`,
      params,
    );
    return { count: rows.length, identities: rows };
  }

  async unresolved(tenantId: string, status = 'open') {
    const rows = await this.ds.query(
      `SELECT u.id, u.source, u.raw_key, u.raw_kind, u.raw_name, u.suggested_person_no,
              u.suggested_confidence, i.clean_name AS suggested_name, u.occurrences, u.status,
              u.note, u.first_seen, u.last_seen
         FROM identity_unresolved u
         LEFT JOIN employee_identity i
           ON i.tenant_id = u.tenant_id AND i.person_no = u.suggested_person_no AND i.is_canonical
        WHERE u.tenant_id = $1 AND u.status = $2
        ORDER BY u.occurrences DESC, u.last_seen DESC`,
      [tenantId, status],
    );
    return { count: rows.length, queue: rows };
  }

  /** Manual hard-link of a queued signal to a person, with audit. */
  async resolveManual(tenantId: string, rawId: string, personNo: string, actor: any) {
    const [row] = await this.ds.query(
      `SELECT * FROM identity_unresolved WHERE id = $1 AND tenant_id = $2`,
      [rawId, tenantId],
    );
    if (!row) throw new NotFoundException('Unresolved signal not found');
    const [person] = await this.ds.query(
      `SELECT person_no, clean_name FROM employee_identity WHERE tenant_id = $1 AND person_no = $2 AND is_canonical LIMIT 1`,
      [tenantId, personNo],
    );
    if (!person) throw new NotFoundException(`Person ${personNo} not found in identity spine`);

    const runner = this.ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // write the cross-system link onto the map row (manual = high confidence)
      const field = row.raw_kind === 'agent_id' ? 'sprinklr_agent_id' : 'sprinklr_email';
      await runner.query(
        `UPDATE employee_identity_map
            SET ${field} = $3, ${row.raw_kind === 'email' ? 'email = COALESCE(email,$3),' : ''}
                resolved = TRUE, confidence = 1.0, resolve_method = 'manual', updated_at = now()
          WHERE tenant_id = $1 AND person_no = $2`,
        [tenantId, personNo, row.raw_key],
      );
      await runner.query(
        `UPDATE identity_unresolved
            SET status = 'resolved', resolved_person_no = $3, resolved_by = $4, resolved_at = now()
          WHERE id = $1 AND tenant_id = $2`,
        [rawId, tenantId, personNo, actor?.id ?? null],
      );
      await runner.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, notes)
         VALUES ($1,$2,$3,'identity.resolve','employee-identity','identity_unresolved',$4,$5)`,
        [
          tenantId,
          actor?.id ?? null,
          actor?.email ?? null,
          rawId,
          `Linked ${row.raw_kind} '${row.raw_key}' → person ${personNo} (${person.clean_name})`,
        ],
      );
      await runner.commitTransaction();
    } catch (e) {
      await runner.rollbackTransaction();
      throw e;
    } finally {
      await runner.release();
    }
    return { ok: true, person_no: personNo };
  }

  async ignore(tenantId: string, rawId: string, actor: any) {
    const [row] = await this.ds.query(
      `UPDATE identity_unresolved SET status = 'ignored', resolved_by = $3, resolved_at = now()
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [rawId, tenantId, actor?.id ?? null],
    );
    if (!row) throw new NotFoundException('Unresolved signal not found');
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id, notes)
       VALUES ($1,$2,$3,'identity.ignore','employee-identity','identity_unresolved',$4,'ignored')`,
      [tenantId, actor?.id ?? null, actor?.email ?? null, rawId],
    );
    return { ok: true };
  }
}
