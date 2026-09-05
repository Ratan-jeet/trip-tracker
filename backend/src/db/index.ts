// Unified database access: PostgreSQL when DATABASE_URL is set, SQLite otherwise.
//
// SQLite runs on better-sqlite3. The previous sql.js implementation held the whole
// database in memory and serialised + rewrote the entire file on *every* write, which
// on a location-tracking workload meant a synchronous O(database) disk write several
// times a second on the event loop.

import path from 'node:path';
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database as SqliteDatabase, Statement } from 'better-sqlite3';
import { config } from '../config';

export const isPostgres = config.usePostgres;

let pgPool: any = null;
let sqlite: SqliteDatabase | null = null;
const statementCache = new Map<string, Statement>();

/** Holds the pg client of the transaction the current async context belongs to. */
const txContext = new AsyncLocalStorage<{ query: (sql: string, params?: unknown[]) => Promise<any> }>();

/** Marks the async context that owns the open SQLite transaction. */
const sqliteTxContext = new AsyncLocalStorage<true>();

/**
 * Resolves while a SQLite transaction is open, so unrelated queries can wait it out.
 *
 * better-sqlite3 is synchronous but the callback passed to `transaction()` is not: every
 * `await` inside it yields the event loop, and a query issued by a *different* request in
 * that window would execute inside the open BEGIN IMMEDIATE and be rolled back with it.
 * Serialising transactions against each other is not enough; plain reads and writes have
 * to hold off too.
 */
let sqliteGate: Promise<unknown> | null = null;

async function awaitSqliteGate(): Promise<void> {
  // A transaction's own statements must pass straight through, or it would deadlock.
  while (sqliteGate && !sqliteTxContext.getStore()) {
    await sqliteGate;
  }
}

function pgSslOption() {
  if (!config.isProduction && config.DATABASE_SSL === 'strict') return false;
  switch (config.DATABASE_SSL) {
    case 'off':
      return false;
    // Encrypted but unauthenticated. Only for providers that terminate TLS with a
    // self-signed certificate and publish no CA bundle.
    case 'no-verify':
      return { rejectUnauthorized: false };
    case 'strict':
    default:
      return { rejectUnauthorized: true };
  }
}

function pgExecutor() {
  return txContext.getStore() ?? pgPool;
}

function sqlitePath(): string {
  if (config.SQLITE_PATH) return path.resolve(config.SQLITE_PATH);
  return path.join(__dirname, '..', '..', 'trip_together.db');
}

/**
 * better-sqlite3 binds positionally with `?`, while the shared SQL uses Postgres `$n`.
 * A naive replace breaks whenever a query references the same parameter twice
 * (`SET updated_at = $2, rotated_at = $2`), which is legal in Postgres but emits more
 * `?` placeholders than there are values. Rewriting the parameter list alongside the SQL
 * keeps both dialects on the same queries.
 */
function toSqlite(sql: string, params: readonly unknown[]): { sql: string; params: unknown[] } {
  const ordered: unknown[] = [];
  const rewritten = sql.replace(/\$(\d+)/g, (_match, index: string) => {
    ordered.push(params[Number(index) - 1]);
    return '?';
  });
  return { sql: rewritten, params: ordered.map(toSqliteValue) };
}

/** better-sqlite3 rejects booleans and undefined outright. */
function toSqliteValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function prepare(sql: string): Statement {
  const cached = statementCache.get(sql);
  if (cached) return cached;
  const stmt = sqlite!.prepare(sql);
  statementCache.set(sql, stmt);
  return stmt;
}

export async function initDatabase(): Promise<void> {
  if (isPostgres) {
    const pg = require('pg');
    pgPool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: pgSslOption(),
    });
    pgPool.on('error', (err: Error) => {
      console.error('[db] idle client error:', err.message);
    });
    await pgPool.query('SELECT 1');
  } else {
    const Database = require('better-sqlite3');
    const file = sqlitePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db: SqliteDatabase = new Database(file);
    // WAL is a real setting here (it was a no-op against an in-memory sql.js database).
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    sqlite = db;
  }

  const { runMigrations } = await import('./migrations');
  await runMigrations();
}

export async function queryOne<T = any>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
  if (isPostgres) {
    const result = await pgExecutor().query(sql, params as unknown[]);
    return result.rows.length > 0 ? (result.rows[0] as T) : null;
  }
  await awaitSqliteGate();
  const compiled = toSqlite(sql, params);
  const row = prepare(compiled.sql).get(...compiled.params);
  return (row as T) ?? null;
}

export async function queryAll<T = any>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
  if (isPostgres) {
    const result = await pgExecutor().query(sql, params as unknown[]);
    return result.rows as T[];
  }
  await awaitSqliteGate();
  const compiled = toSqlite(sql, params);
  return prepare(compiled.sql).all(...compiled.params) as T[];
}

export async function run(sql: string, params: readonly unknown[] = []): Promise<void> {
  if (isPostgres) {
    await pgExecutor().query(sql, params as unknown[]);
    return;
  }
  await awaitSqliteGate();
  const compiled = toSqlite(sql, params);
  const stmt = prepare(compiled.sql);
  // A statement with RETURNING yields rows; better-sqlite3 refuses .run() on those.
  if (stmt.reader) stmt.all(...compiled.params);
  else stmt.run(...compiled.params);
}

/** Raw multi-statement DDL. Only used by the migration runner. */
export async function exec(sql: string): Promise<void> {
  if (isPostgres) await pgExecutor().query(sql);
  else sqlite!.exec(sql);
}

// Transactions run one at a time, and `sqliteGate` holds every other query off for the
// duration, so nothing unrelated can be swept into an open BEGIN.
let sqliteTxChain: Promise<unknown> = Promise.resolve();

/**
 * Run a set of statements atomically. Multi-step mutations (create trip + add the
 * creator as admin + write the audit row) must not be able to half-apply.
 */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (isPostgres) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await txContext.run({ query: (sql, params) => client.query(sql, params) }, fn);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  const attempt = sqliteTxChain.then(async () => {
    let release!: () => void;
    sqliteGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      return await sqliteTxContext.run(true, async () => {
        sqlite!.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn();
          sqlite!.exec('COMMIT');
          return result;
        } catch (err) {
          sqlite!.exec('ROLLBACK');
          throw err;
        }
      });
    } finally {
      sqliteGate = null;
      release();
    }
  });
  // Keep the chain alive regardless of this transaction's outcome.
  sqliteTxChain = attempt.catch(() => undefined);
  return attempt;
}

export async function closeDatabase(): Promise<void> {
  if (isPostgres && pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  if (sqlite) {
    statementCache.clear();
    sqlite.close();
    sqlite = null;
  }
}

/** True when the given column already exists — lets migrations stay idempotent. */
export async function columnExists(table: string, column: string): Promise<boolean> {
  if (isPostgres) {
    const row = await queryOne(
      'SELECT 1 AS present FROM information_schema.columns WHERE table_name = $1 AND column_name = $2',
      [table, column],
    );
    return !!row;
  }
  const rows = await queryAll<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}
