/**
 * Admin seed script — run ONCE after applying SQL migrations.
 * Usage: npm run seed:admin
 *
 * Reads SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD from .env.
 * Updates the placeholder admin user created by 002_seed_boutiqaat.sql
 * with a real bcrypt hash.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';

dotenv.config({ path: path.resolve(__dirname, '../../../..', '.env') });

const ds = new DataSource({
  type: 'postgres',
  host:     process.env.POSTGRES_HOST     ?? 'localhost',
  port:     Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB       ?? 'wfm_db',
  username: process.env.POSTGRES_USER     ?? 'wfm_user',
  password: process.env.POSTGRES_PASSWORD ?? '',
  entities: [],
  synchronize: false,
});

async function main() {
  const email    = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env');
    process.exit(1);
  }

  await ds.initialize();

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const hash   = await bcrypt.hash(password, rounds);

  const result = await ds.query(
    `UPDATE users
        SET password_hash        = $1,
            must_change_password = FALSE,
            status               = 'active',
            updated_at           = NOW()
      WHERE email      = $2
        AND tenant_id  = 'a0000000-0000-0000-0000-000000000001'`,
    [hash, email.toLowerCase()],
  );

  if (result[1] === 0) {
    console.error(`No user found with email: ${email} in Boutiqaat tenant.`);
    console.error('Make sure 002_seed_boutiqaat.sql has been applied first.');
    process.exit(1);
  }

  console.log(`Admin password set for: ${email}`);
  console.log('You can now log in at http://localhost:3000/api/docs');

  await ds.destroy();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
