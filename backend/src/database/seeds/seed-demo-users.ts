/**
 * Demo users seed — creates one test account per role.
 * Safe to run multiple times (uses ON CONFLICT DO NOTHING).
 *
 * Usage:  npm run seed:demo
 *
 * Accounts created (password for all: Demo@2026):
 *
 *  Role             | Email
 *  -----------------+--------------------------------
 *  platform_admin   | demo.admin@boutiqaat.wfm
 *  wfm_analyst      | demo.wfm@boutiqaat.wfm
 *  team_leader      | demo.tl@boutiqaat.wfm
 *  rta              | demo.rta@boutiqaat.wfm
 *  agent            | demo.agent@boutiqaat.wfm
 *  hr_specialist    | demo.hr@boutiqaat.wfm
 */

import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';

dotenv.config({ path: path.resolve(__dirname, '../../../..', '.env') });

// PRODUCTION GUARD (2026-07-06, EXECUTION_BRIEF cleanup): shared-password demo accounts must
// NEVER exist in production. Explicit opt-in with ALLOW_DEMO_SEED=1 for non-prod boxes only.
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== '1') {
  console.error('REFUSED: seed-demo-users creates shared-password accounts — not in production. (ALLOW_DEMO_SEED=1 overrides on a non-prod box.)');
  process.exit(1);
}

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const DEMO_PASSWORD = 'Demo@2026';

const DEMO_USERS: Array<{
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  roleId: string;
  roleName: string;
}> = [
  {
    id:        'd1000000-0000-0000-0000-000000000001',
    email:     'demo.admin@boutiqaat.wfm',
    username:  'demo.admin',
    firstName: 'Demo',
    lastName:  'Admin',
    roleId:    'b0000000-0000-0000-0000-000000000001',
    roleName:  'Platform Admin',
  },
  {
    id:        'd1000000-0000-0000-0000-000000000002',
    email:     'demo.wfm@boutiqaat.wfm',
    username:  'demo.wfm',
    firstName: 'Demo',
    lastName:  'WFM',
    roleId:    'b0000000-0000-0000-0000-000000000002',
    roleName:  'WFM Analyst',
  },
  {
    id:        'd1000000-0000-0000-0000-000000000003',
    email:     'demo.tl@boutiqaat.wfm',
    username:  'demo.tl',
    firstName: 'Demo',
    lastName:  'TL',
    roleId:    'b0000000-0000-0000-0000-000000000003',
    roleName:  'Team Leader',
  },
  {
    id:        'd1000000-0000-0000-0000-000000000004',
    email:     'demo.rta@boutiqaat.wfm',
    username:  'demo.rta',
    firstName: 'Demo',
    lastName:  'RTA',
    roleId:    'b0000000-0000-0000-0000-000000000004',
    roleName:  'RTA Agent',
  },
  {
    id:        'd1000000-0000-0000-0000-000000000005',
    email:     'demo.agent@boutiqaat.wfm',
    username:  'demo.agent',
    firstName: 'Demo',
    lastName:  'Agent',
    roleId:    'b0000000-0000-0000-0000-000000000005',
    roleName:  'Agent',
  },
  {
    id:        'd1000000-0000-0000-0000-000000000006',
    email:     'demo.hr@boutiqaat.wfm',
    username:  'demo.hr',
    firstName: 'Demo',
    lastName:  'HR',
    roleId:    'b0000000-0000-0000-0000-000000000006',
    roleName:  'HR Specialist',
  },
];

const ds = new DataSource({
  type:       'postgres',
  host:       process.env.POSTGRES_HOST     ?? 'localhost',
  port:       Number(process.env.POSTGRES_PORT ?? 5432),
  database:   process.env.POSTGRES_DB       ?? 'wfm_db',
  username:   process.env.POSTGRES_USER     ?? 'wfm_user',
  password:   process.env.POSTGRES_PASSWORD ?? '',
  entities:   [],
  synchronize: false,
});

async function main() {
  await ds.initialize();

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const hash   = await bcrypt.hash(DEMO_PASSWORD, rounds);

  console.log('\nSeeding demo users...\n');

  for (const u of DEMO_USERS) {
    // Upsert user — if exists, refresh the hash so the password stays known
    await ds.query(
      `INSERT INTO users (
          id, tenant_id, employee_id,
          email, username, password_hash,
          first_name, last_name,
          status, must_change_password
       ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, 'active', FALSE)
       ON CONFLICT (tenant_id, email) DO UPDATE
           SET password_hash        = EXCLUDED.password_hash,
               status               = 'active',
               must_change_password = FALSE,
               updated_at           = NOW()`,
      [u.id, TENANT, u.email, u.username, hash, u.firstName, u.lastName],
    );

    // Ensure role assignment exists
    await ds.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [u.id, u.roleId],
    );

    console.log(`  ✓  ${u.roleName.padEnd(18)} → ${u.email}`);
  }

  console.log(`\nPassword for all accounts: ${DEMO_PASSWORD}`);
  console.log('\nLogin at: http://localhost:5173\n');

  await ds.destroy();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
