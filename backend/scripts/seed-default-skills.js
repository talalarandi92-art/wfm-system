/**
 * DEFAULT SKILLS SEED (2026-07-03, Director: "بالنسبة للمهارة عطيني افتراضي حالياً، بعدين بعطيك الصحيح").
 * Placeholder cross-skill matrix so the Gap Remedy / cross-skill feature has data to match on until the
 * real matrix is provided. Gives every ACTIVE employee the CORE customer-facing skills at 'intermediate',
 * status 'active', clearly tagged 'default-seed' so it's obvious it's a placeholder and easy to replace.
 * Idempotent (ON CONFLICT DO NOTHING on the UNIQUE(employee_id, skill_id)).
 *
 * Undo: DELETE FROM employee_skills WHERE training_notes = 'default-seed 2026-07-03';
 */
const { getClient } = require('./recon-db');
const CORE = ['VOICE', 'CHAT', 'WHATSAPP', 'EMAIL', 'SOCIAL', 'CC'];   // channel + customer-care

(async () => {
  const c = getClient();
  await c.connect();
  const [{ tenant }] = (await c.query(`SELECT id tenant FROM tenants ORDER BY created_at LIMIT 1`).catch(() => ({ rows: [{ tenant: 'a0000000-0000-0000-0000-000000000001' }] }))).rows;
  const skills = (await c.query(`SELECT id, code FROM skills WHERE tenant_id=$1 AND is_active AND code = ANY($2)`, [tenant, CORE])).rows;
  const emps = (await c.query(`SELECT id FROM employees WHERE tenant_id=$1 AND status='active'`, [tenant])).rows;
  console.log(`seeding ${emps.length} employees × ${skills.length} core skills…`);
  let ins = 0;
  await c.query('BEGIN');
  try {
    for (const e of emps) for (const s of skills) {
      const r = await c.query(
        `INSERT INTO employee_skills (tenant_id, employee_id, skill_id, proficiency, status, certified_at, training_notes)
         VALUES ($1,$2,$3,'intermediate','active',NOW(),'default-seed 2026-07-03')
         ON CONFLICT (employee_id, skill_id) DO NOTHING`, [tenant, e.id, s.id]);
      ins += r.rowCount || 0;
    }
    await c.query('COMMIT');
  } catch (err) { await c.query('ROLLBACK'); throw err; }
  const [{ total }] = (await c.query(`SELECT COUNT(*)::int total FROM employee_skills WHERE status='active'`)).rows;
  console.log(`inserted ${ins} rows · employee_skills active total now ${total}`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
