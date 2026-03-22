import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { resolve, dirname } from 'path';
import { mkdirSync } from 'fs';

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _sqlite: InstanceType<typeof Database> | null = null;

export function getDbPath(): string {
  return resolve(process.env.DATABASE_URL || './data/sats.db');
}

/** Ensure all tables exist (idempotent — uses IF NOT EXISTS) */
function ensureTables(sqlite: InstanceType<typeof Database>) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      seed_enc TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS bot_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS provider_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      api_key_enc TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS policy_rules (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      daily_limit_sats INTEGER NOT NULL DEFAULT 1000000,
      per_tx_limit_sats INTEGER NOT NULL DEFAULT 100000,
      auto_approve_sats INTEGER NOT NULL DEFAULT 10000,
      autopilot INTEGER NOT NULL DEFAULT 0,
      allowlist_json TEXT NOT NULL DEFAULT '[]'
    )`,
    `CREATE TABLE IF NOT EXISTS pending_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      action_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      action_type TEXT NOT NULL,
      amount_sats INTEGER,
      fee_sats INTEGER,
      tx_id TEXT,
      summary TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      event_type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  ];
  for (const sql of statements) {
    sqlite.exec(sql);
  }
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_db) {
    const dbPath = getDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    _sqlite = new Database(dbPath);
    _sqlite.pragma('journal_mode = WAL');
    _sqlite.pragma('foreign_keys = ON');
    ensureTables(_sqlite);
    _db = drizzle(_sqlite, { schema });
  }
  return _db;
}

export function getSqlite(): InstanceType<typeof Database> {
  if (!_sqlite) {
    getDb(); // initializes _sqlite as side effect
  }
  return _sqlite!;
}

export function closeDb() {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}
