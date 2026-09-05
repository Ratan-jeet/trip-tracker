// Versioned, forward-only migrations.
//
// The previous schema was two hand-maintained CREATE TABLE IF NOT EXISTS blocks, which
// meant (a) the dialects had already drifted apart and (b) no schema change could ever
// reach a database that already existed. Every change now goes in here as a new entry.

import { columnExists, exec, isPostgres, queryAll, run } from './index';

interface Migration {
  id: string;
  up: () => Promise<void>;
}

const pgSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    two_factor_secret VARCHAR(255),
    two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    invite_code VARCHAR(16) UNIQUE NOT NULL,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trip_members (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    is_sharing BOOLEAN NOT NULL DEFAULT FALSE,
    consent_given BOOLEAN NOT NULL DEFAULT FALSE,
    consent_level VARCHAR(20) NOT NULL DEFAULT 'while_using'
      CHECK (consent_level IN ('once', 'while_using', 'always')),
    joined_at TIMESTAMPTZ NOT NULL,
    UNIQUE(trip_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    device_type VARCHAR(20) NOT NULL CHECK (device_type IN ('phone', 'vehicle')),
    name VARCHAR(100) NOT NULL,
    imei VARCHAR(32),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE(trip_id, imei)
  );
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    accuracy REAL,
    speed REAL,
    heading REAL,
    battery_level INTEGER,
    ignition_status BOOLEAN,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    trip_id TEXT,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id TEXT,
    metadata TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trip_routes (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    destination_name VARCHAR(200) NOT NULL,
    destination_lat DOUBLE PRECISION NOT NULL,
    destination_lng DOUBLE PRECISION NOT NULL,
    waypoints TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL
  );
`;

const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    two_factor_secret TEXT,
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    invite_code TEXT UNIQUE NOT NULL,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date TEXT,
    end_date TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trip_members (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    is_sharing INTEGER NOT NULL DEFAULT 0,
    consent_given INTEGER NOT NULL DEFAULT 0,
    consent_level TEXT NOT NULL DEFAULT 'while_using'
      CHECK (consent_level IN ('once', 'while_using', 'always')),
    joined_at TEXT NOT NULL,
    UNIQUE(trip_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    device_type TEXT NOT NULL CHECK (device_type IN ('phone', 'vehicle')),
    name TEXT NOT NULL,
    imei TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(trip_id, imei)
  );
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    speed REAL,
    heading REAL,
    battery_level INTEGER,
    ignition_status INTEGER,
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    trip_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trip_routes (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    destination_name TEXT NOT NULL,
    destination_lat REAL NOT NULL,
    destination_lng REAL NOT NULL,
    waypoints TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
`;

const indexes = `
  CREATE INDEX IF NOT EXISTS idx_locations_trip_time ON locations(trip_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_locations_device_time ON locations(device_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_locations_timestamp ON locations(timestamp);
  CREATE INDEX IF NOT EXISTS idx_trip_members_trip_id ON trip_members(trip_id);
  CREATE INDEX IF NOT EXISTS idx_trip_members_user_id ON trip_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_devices_trip_id ON devices(trip_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_trip_id ON audit_logs(trip_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
`;

async function addColumn(table: string, column: string, definition: string): Promise<void> {
  if (await columnExists(table, column)) return;
  await exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const migrations: Migration[] = [
  {
    id: '001_base_schema',
    up: async () => {
      await exec(isPostgres ? pgSchema : sqliteSchema);
      await exec(indexes);
    },
  },
  {
    id: '002_columns_added_after_v1',
    up: async () => {
      // Pre-existing databases were created by the old CREATE TABLE IF NOT EXISTS block
      // and are missing everything added since.
      await addColumn('audit_logs', 'trip_id', 'TEXT');
      // Trackers authenticate with their own secret rather than riding on a user's JWT.
      await addColumn('devices', 'device_token', 'TEXT');
      // Bumping this invalidates every JWT already issued to a user.
      await addColumn('users', 'token_version', isPostgres ? 'INTEGER NOT NULL DEFAULT 0' : 'INTEGER NOT NULL DEFAULT 0');
      await addColumn('trip_members', 'sharing_started_at', isPostgres ? 'TIMESTAMPTZ' : 'TEXT');
      await addColumn('trips', 'invite_code_rotated_at', isPostgres ? 'TIMESTAMPTZ' : 'TEXT');
      // Hashed single-use codes so enabling 2FA cannot lock someone out permanently.
      await addColumn('users', 'two_factor_recovery_codes', 'TEXT');
      // Enrolling a second authenticator must not overwrite the secret that is currently
      // protecting the account until the new one has been proven to work.
      await addColumn('users', 'two_factor_pending_secret', isPostgres ? 'VARCHAR(255)' : 'TEXT');
      await exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_token ON devices(device_token)');
    },
  },
  {
    id: '003_normalise_legacy_timestamps',
    up: async () => {
      if (isPostgres) return; // TIMESTAMPTZ already stores an unambiguous instant.
      // Legacy SQLite rows mixed `datetime('now')` output ("2026-08-30 07:10:12", local
      // time, no zone) with client ISO strings carrying an offset. Range filters compare
      // these as TEXT, so the two formats sorted against each other incorrectly.
      const columns: Array<[string, string[]]> = [
        ['users', ['created_at', 'updated_at']],
        ['trips', ['created_at', 'updated_at', 'start_date', 'end_date']],
        ['trip_members', ['joined_at']],
        ['devices', ['created_at']],
        ['locations', ['timestamp', 'created_at']],
        ['audit_logs', ['created_at']],
        ['trip_routes', ['created_at']],
      ];
      for (const [table, cols] of columns) {
        for (const col of cols) {
          if (!(await columnExists(table, col))) continue;
          const rows = await queryAll<{ id: string; value: string | null }>(
            `SELECT id, ${col} AS value FROM ${table} WHERE ${col} IS NOT NULL AND ${col} NOT LIKE '%Z'`,
          );
          for (const row of rows) {
            const parsed = new Date(
              // A bare "YYYY-MM-DD HH:MM:SS" from datetime('now') is UTC despite looking local.
              /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.value!)
                ? `${row.value!.replace(' ', 'T')}Z`
                : row.value!,
            );
            if (Number.isNaN(parsed.getTime())) continue;
            await run(`UPDATE ${table} SET ${col} = $1 WHERE id = $2`, [parsed.toISOString(), row.id]);
          }
        }
      }
    },
  },
  {
    id: '004_backfill_consent_and_tokens',
    up: async () => {
      // v1 wrote joined_at/created_at defaults but left sharing_started_at empty for
      // members already sharing; give them a value so the UI has something to show.
      await run(
        'UPDATE trip_members SET sharing_started_at = joined_at WHERE is_sharing = true AND sharing_started_at IS NULL',
      );
    },
  },
];

export async function runMigrations(): Promise<void> {
  await exec(
    isPostgres
      ? 'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL)'
      : 'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );

  const applied = new Set(
    (await queryAll<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id),
  );

  let ran = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    await migration.up();
    await run('INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)', [
      migration.id,
      new Date().toISOString(),
    ]);
    ran += 1;
    console.log(`[db] applied migration ${migration.id}`);
  }

  console.log(
    `[db] ${isPostgres ? 'PostgreSQL' : 'SQLite'} ready (${ran} migration${ran === 1 ? '' : 's'} applied, ${migrations.length} total)`,
  );
}
