import { resolve, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as dotenv from 'dotenv';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

const dbPath = resolve(process.env.DATABASE_URL || './data/sats.db');
const dbDir = dirname(dbPath);

if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const db = drizzle(sqlite);

// Run migrations from the generated migrations folder
const migrationsFolder = resolve(__dirname, '../../drizzle');

try {
  migrate(db, { migrationsFolder });
  console.log('✅ Database migrations applied successfully');
} catch (err) {
  console.error('❌ Migration failed:', err);
  process.exit(1);
} finally {
  sqlite.close();
}
