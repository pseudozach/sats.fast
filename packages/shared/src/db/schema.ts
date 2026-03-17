import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ── users ────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: text('telegram_id').unique().notNull(),
  username: text('username'),
  seedEnc: text('seed_enc').notNull(),
  createdAt: text('created_at').notNull(),
});

// ── admin_users ──────────────────────────────────────────
export const adminUsers = sqliteTable('admin_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
});

// ── bot_config ───────────────────────────────────────────
export const botConfig = sqliteTable('bot_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ── provider_configs ─────────────────────────────────────
export const providerConfigs = sqliteTable('provider_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  provider: text('provider').notNull(), // 'openai' | 'anthropic'
  apiKeyEnc: text('api_key_enc').notNull(),
  model: text('model').notNull(),
  createdAt: text('created_at').notNull(),
});

// ── policy_rules ─────────────────────────────────────────
export const policyRules = sqliteTable('policy_rules', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id),
  dailyLimitSats: integer('daily_limit_sats').notNull().default(1_000_000),
  perTxLimitSats: integer('per_tx_limit_sats').notNull().default(100_000),
  autoApproveSats: integer('auto_approve_sats').notNull().default(10_000),
  autopilot: integer('autopilot').notNull().default(0),
  allowlistJson: text('allowlist_json').notNull().default('[]'),
});

// ── pending_approvals ────────────────────────────────────
export const pendingApprovals = sqliteTable('pending_approvals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  actionJson: text('action_json').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
});

// ── receipts ─────────────────────────────────────────────
export const receipts = sqliteTable('receipts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  actionType: text('action_type').notNull(),
  amountSats: integer('amount_sats'),
  feeSats: integer('fee_sats'),
  txId: text('tx_id'),
  summary: text('summary').notNull(),
  receiptJson: text('receipt_json').notNull(),
  createdAt: text('created_at').notNull(),
});

// ── audit_events ─────────────────────────────────────────
export const auditEvents = sqliteTable('audit_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id'),
  eventType: text('event_type').notNull(),
  dataJson: text('data_json').notNull(),
  createdAt: text('created_at').notNull(),
});
