import { resolve, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import * as dotenv from 'dotenv';

// Load .env from repo root (covers both tsx src/ and compiled dist/ contexts)
dotenv.config({ path: resolve(__dirname, '../../../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const dbPath = resolve(process.env.DATABASE_URL || './data/sats.db');
const dbDir = dirname(dbPath);

console.log(`  DB path: ${dbPath}`);

if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
  console.log(`  Created dir: ${dbDir}`);
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Create tables directly — idempotent (IF NOT EXISTS)
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

try {
  for (const sql of statements) {
    sqlite.exec(sql);
  }
  console.log('✅ Database tables created successfully');
} catch (err) {
  console.error('❌ Migration failed:', err);
  process.exit(1);
} finally {
  sqlite.close();
}
