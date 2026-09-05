// `npm run db:seed` — demo data for local development.
//
// The previous build seeded these accounts automatically at every boot, in every
// environment, so a deployed instance shipped with two publicly documented passwords.
// Seeding is now an explicit command and refuses to run against production.

import bcrypt from 'bcrypt';
import { config } from '../config';
import { closeDatabase, initDatabase, queryOne, run } from '../db';
import { newId, newInviteCode } from '../lib/ids';
import { nowIso } from '../lib/time';

const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'password123';

async function main() {
  if (config.isProduction) {
    console.error('Refusing to seed demo accounts with NODE_ENV=production.');
    process.exit(1);
  }

  await initDatabase();

  const existing = await queryOne('SELECT id FROM users WHERE email = $1', ['alice@example.com']);
  if (existing) {
    console.log('Demo data already present — nothing to do.');
    await closeDatabase();
    return;
  }

  const now = nowIso();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const aliceId = newId();
  const bobId = newId();

  for (const [id, email, name, phone] of [
    [aliceId, 'alice@example.com', 'Alice', '+15550100'],
    [bobId, 'bob@example.com', 'Bob', '+15550101'],
  ] as const) {
    await run(
      `INSERT INTO users (id, email, password_hash, display_name, phone, two_factor_enabled, token_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, email, passwordHash, name, phone, false, 0, now, now],
    );
  }

  const tripId = newId();
  const inviteCode = newInviteCode();
  await run(
    `INSERT INTO trips (id, name, description, invite_code, creator_id, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [tripId, 'Goa Trip', 'Demo trip seeded for local development', inviteCode, aliceId, true, now],
  );

  // Seeded members start with sharing OFF, matching what a real join now does.
  for (const [userId, role] of [
    [aliceId, 'admin'],
    [bobId, 'member'],
  ] as const) {
    await run(
      `INSERT INTO trip_members (id, trip_id, user_id, role, is_sharing, consent_given, consent_level, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId(), tripId, userId, role, false, false, 'while_using', now],
    );
  }

  await closeDatabase();

  console.log('Seeded demo data:');
  console.log(`  alice@example.com / ${DEMO_PASSWORD} (admin)`);
  console.log(`  bob@example.com   / ${DEMO_PASSWORD} (member)`);
  console.log(`  invite code: ${inviteCode}`);
  console.log('\nBoth start with location sharing turned off — turn it on from the trip screen.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
