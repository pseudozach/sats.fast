import { eq } from 'drizzle-orm';
import * as bip39 from 'bip39';
import {
  getDb,
  users,
  providerConfigs,
  pendingApprovals,
  encrypt,
  decrypt,
  nowUtc,
} from '@sats-fast/shared';

/**
 * Get or create a user record. Generates a mnemonic on first use.
 */
export async function getOrCreateUser(
  telegramId: string,
  username?: string
): Promise<{ id: number; isNew: boolean; mnemonic: string }> {
  const db = getDb();

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  if (existing.length > 0) {
    const user = existing[0]!;
    const mnemonic = decrypt(user.seedEnc);
    return { id: user.id, isNew: false, mnemonic };
  }

  // Generate new mnemonic
  const mnemonic = bip39.generateMnemonic(128); // 12 words
  const seedEnc = encrypt(mnemonic);

  const result = await db.insert(users).values({
    telegramId,
    username: username || null,
    seedEnc,
    createdAt: nowUtc(),
  }).returning({ id: users.id });

  return { id: result[0]!.id, isNew: true, mnemonic };
}

/**
 * Get a user's decrypted mnemonic.
 */
export async function getUserMnemonic(telegramId: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  if (rows.length === 0) return null;
  return decrypt(rows[0]!.seedEnc);
}

/**
 * Get user DB record by telegram ID.
 */
export async function getUserByTelegramId(telegramId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);
  return rows[0] || null;
}

/**
 * Get or set the user's AI provider config.
 */
export async function getProviderConfig(userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(providerConfigs)
    .where(eq(providerConfigs.userId, userId))
    .limit(1);

  if (rows.length > 0) {
    return {
      provider: rows[0]!.provider as 'openai' | 'anthropic',
      apiKey: decrypt(rows[0]!.apiKeyEnc),
      model: rows[0]!.model,
    };
  }

  // Fall back to env defaults
  const provider = (process.env.DEFAULT_AI_PROVIDER || 'anthropic') as 'openai' | 'anthropic';
  const apiKey =
    provider === 'openai'
      ? process.env.DEFAULT_OPENAI_KEY || ''
      : process.env.DEFAULT_ANTHROPIC_KEY || '';
  const model = process.env.DEFAULT_AI_MODEL || 'claude-sonnet-4-20250514';

  return { provider, apiKey, model };
}

/**
 * Save a provider config for a user.
 */
export async function setProviderConfig(
  userId: number,
  provider: 'openai' | 'anthropic',
  apiKey: string,
  model?: string
): Promise<void> {
  const db = getDb();
  const defaultModel =
    provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini';

  // Delete existing config
  await db.delete(providerConfigs).where(eq(providerConfigs.userId, userId));

  await db.insert(providerConfigs).values({
    userId,
    provider,
    apiKeyEnc: encrypt(apiKey),
    model: model || defaultModel,
    createdAt: nowUtc(),
  });
}

/**
 * Create a pending approval.
 */
export async function createPendingApproval(
  userId: number,
  actionData: Record<string, unknown>
): Promise<number> {
  const db = getDb();
  const result = await db.insert(pendingApprovals).values({
    userId,
    actionJson: JSON.stringify(actionData),
    status: 'pending',
    createdAt: nowUtc(),
  }).returning({ id: pendingApprovals.id });

  return result[0]!.id;
}

/**
 * Resolve a pending approval.
 */
export async function resolvePendingApproval(
  approvalId: number,
  status: 'approved' | 'denied'
): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pendingApprovals)
    .where(eq(pendingApprovals.id, approvalId))
    .limit(1);

  if (rows.length === 0 || rows[0]!.status !== 'pending') return null;

  await db
    .update(pendingApprovals)
    .set({ status, resolvedAt: nowUtc() })
    .where(eq(pendingApprovals.id, approvalId));

  return JSON.parse(rows[0]!.actionJson);
}
