// Universal DB adapter: PostgreSQL when DATABASE_URL is set, SQLite fallback otherwise

const DATABASE_URL = process.env.DATABASE_URL;
const isPostgres = !!DATABASE_URL;

let pgPool: any = null;
let sqliteDb: any = null;

// ---------- PostgreSQL ----------

async function initPostgres() {
  const pg = require('pg');
  pgPool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  pgPool.on('error', (err: any) => {
    console.error('Unexpected error on idle client', err);
  });

  await pgPool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(20),
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      avatar_url TEXT,
      two_factor_secret VARCHAR(255),
      two_factor_enabled BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      invite_code VARCHAR(8) UNIQUE NOT NULL,
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date TIMESTAMP WITH TIME ZONE,
      end_date TIMESTAMP WITH TIME ZONE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS trip_members (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('admin', 'member')),
      is_sharing BOOLEAN DEFAULT FALSE,
      consent_given BOOLEAN DEFAULT FALSE,
      consent_level VARCHAR(20) DEFAULT 'while_using',
      joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(trip_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      device_type VARCHAR(20) NOT NULL CHECK (device_type IN ('phone', 'vehicle')),
      name VARCHAR(100) NOT NULL,
      imei VARCHAR(20),
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(trip_id, imei)
    );
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      accuracy REAL,
      speed REAL,
      heading REAL,
      battery_level INTEGER,
      ignition_status BOOLEAN,
      timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(50) NOT NULL,
      resource_id TEXT,
      metadata JSONB,
      ip_address INET,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_locations_trip_id ON locations(trip_id);
    CREATE INDEX IF NOT EXISTS idx_locations_device_id ON locations(device_id);
    CREATE INDEX IF NOT EXISTS idx_locations_timestamp ON locations(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_trip_members_trip_id ON trip_members(trip_id);
    CREATE INDEX IF NOT EXISTS idx_trip_members_user_id ON trip_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_devices_trip_id ON devices(trip_id);
    CREATE INDEX IF NOT EXISTS idx_devices_imei ON devices(imei) WHERE imei IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
  `);

  console.log('PostgreSQL database initialized.');
}

// ---------- SQLite ----------

async function initSqlite() {
  const path = require('path');
  const fs = require('fs');
  const initSqlJs = require('sql.js');

  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, '..', '..', 'trip_together.db');

  let fileBuffer: Buffer | null = null;
  if (fs.existsSync(dbPath)) {
    fileBuffer = fs.readFileSync(dbPath);
  }
  sqliteDb = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();
  sqliteDb.run('PRAGMA journal_mode = WAL');
  sqliteDb.run('PRAGMA foreign_keys = ON');

  const schema = `
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, avatar_url TEXT, two_factor_secret TEXT, two_factor_enabled INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, invite_code TEXT UNIQUE NOT NULL, creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, start_date TEXT, end_date TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS trip_members (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT DEFAULT 'member', is_sharing INTEGER DEFAULT 0, consent_given INTEGER DEFAULT 0, consent_level TEXT DEFAULT 'while_using', joined_at TEXT DEFAULT (datetime('now')), UNIQUE(trip_id, user_id));
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, device_type TEXT NOT NULL, name TEXT NOT NULL, imei TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), UNIQUE(trip_id, imei));
    CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, lat REAL NOT NULL, lng REAL NOT NULL, accuracy REAL, speed REAL, heading REAL, battery_level INTEGER, ignition_status INTEGER, timestamp TEXT NOT NULL DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, metadata TEXT, ip_address TEXT, created_at TEXT DEFAULT (datetime('now')));
  `;
  schema.split('\n').filter(s => s.trim()).forEach(s => sqliteDb.run(s));

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_locations_trip_id ON locations(trip_id)',
    'CREATE INDEX IF NOT EXISTS idx_locations_device_id ON locations(device_id)',
    'CREATE INDEX IF NOT EXISTS idx_trip_members_trip_id ON trip_members(trip_id)',
    'CREATE INDEX IF NOT EXISTS idx_trip_members_user_id ON trip_members(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_devices_trip_id ON devices(trip_id)',
  ];
  indexes.forEach(s => sqliteDb.run(s));

  saveSqlite();
  console.log('SQLite database initialized.');
}

function saveSqlite() {
  if (sqliteDb) {
    const path = require('path');
    const fs = require('fs');
    const dbPath = path.join(__dirname, '..', '..', 'trip_together.db');
    const data = sqliteDb.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

// ---------- Unified interface ----------

export async function initDatabase() {
  if (isPostgres) {
    await initPostgres();
  } else {
    console.log('No DATABASE_URL set — using SQLite for local development.');
    await initSqlite();
  }
}

export async function queryOne(sql: string, params: any[] = []): Promise<any | null> {
  if (isPostgres) {
    const result = await pgPool.query(sql, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  }
  // SQLite: convert $1, $2 placeholders to ? for sql.js
  const sqliteSql = sql.replace(/\$(\d+)/g, '?');
  const stmt = sqliteDb.prepare(sqliteSql);
  if (params.length > 0) stmt.bind(params);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

export async function queryAll(sql: string, params: any[] = []): Promise<any[]> {
  if (isPostgres) {
    const result = await pgPool.query(sql, params);
    return result.rows;
  }
  const sqliteSql = sql.replace(/\$(\d+)/g, '?');
  const stmt = sqliteDb.prepare(sqliteSql);
  if (params.length > 0) stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

export async function run(sql: string, params: any[] = []): Promise<void> {
  if (isPostgres) {
    await pgPool.query(sql, params);
  } else {
    const sqliteSql = sql.replace(/\$(\d+)/g, '?');
    sqliteDb.run(sqliteSql, params);
    saveSqlite();
  }
}

export async function saveDatabase(): Promise<void> {
  if (!isPostgres) saveSqlite();
}

export async function closeDatabase(): Promise<void> {
  if (isPostgres && pgPool) {
    await pgPool.end();
  }
}
