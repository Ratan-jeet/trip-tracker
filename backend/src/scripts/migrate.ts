// `npm run db:migrate` — the README documented this command; it did not exist.
import { closeDatabase, initDatabase } from '../db';

async function main() {
  await initDatabase(); // runs pending migrations
  await closeDatabase();
  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
