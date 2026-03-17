import { eq, sql } from 'drizzle-orm';
import {
  getDb,
  policyRules,
  receipts,
  type PolicyDecision,
} from '@sats-fast/shared';

export interface PolicyCheckInput {
  userId: number;
  actionType: string;
  amountSats: number;
  destination?: string;
}

/**
 * Ensure policy rules exist for a user (insert defaults if missing).
 */
export async function ensurePolicyRules(userId: number): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(policyRules)
    .where(eq(policyRules.userId, userId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(policyRules).values({
      userId,
      dailyLimitSats: 1_000_000,
      perTxLimitSats: 100_000,
      autoApproveSats: 10_000,
      autopilot: 0,
      allowlistJson: '[]',
    });
  }
}

/**
 * Get policy rules for a user.
 */
export async function getPolicyRules(userId: number) {
  const db = getDb();
  await ensurePolicyRules(userId);

  const rows = await db
    .select()
    .from(policyRules)
    .where(eq(policyRules.userId, userId))
    .limit(1);

  return rows[0]!;
}

/**
 * Get today's total spend for a user.
 */
async function getTodaySpend(userId: number): Promise<number> {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(${receipts.amountSats}), 0)`,
    })
    .from(receipts)
    .where(
      sql`${receipts.userId} = ${userId} AND ${receipts.createdAt} LIKE ${today + '%'}`
    );

  return result[0]?.total ?? 0;
}

/**
 * Check a proposed action against the user's policy rules.
 */
export async function checkPolicy(
  input: PolicyCheckInput
): Promise<PolicyDecision> {
  const rules = await getPolicyRules(input.userId);

  // Check per-transaction limit
  if (input.amountSats > rules.perTxLimitSats) {
    return {
      decision: 'blocked',
      reason: `This transaction of ${input.amountSats.toLocaleString()} sats exceeds your per-transaction limit of ${rules.perTxLimitSats.toLocaleString()} sats. Update with /setlimit per_tx <amount>.`,
    };
  }

  // Check daily limit
  const todaySpend = await getTodaySpend(input.userId);
  if (todaySpend + input.amountSats > rules.dailyLimitSats) {
    return {
      decision: 'blocked',
      reason: `This would bring your daily spend to ${(todaySpend + input.amountSats).toLocaleString()} sats, exceeding your daily limit of ${rules.dailyLimitSats.toLocaleString()} sats.`,
    };
  }

  // Check allowlist
  if (input.destination && rules.allowlistJson !== '[]') {
    try {
      const allowlist: string[] = JSON.parse(rules.allowlistJson);
      if (allowlist.length > 0 && !allowlist.includes(input.destination)) {
        return {
          decision: 'requires_confirmation',
          reason: `Destination ${input.destination.slice(0, 12)}... is not on your allowlist. Confirm to proceed?`,
        };
      }
    } catch (_) { /* if JSON parse fails, skip allowlist check */ }
  }

  // Auto-approve if under threshold or autopilot enabled
  if (rules.autopilot || input.amountSats <= rules.autoApproveSats) {
    return {
      decision: 'approved',
      reason:
        rules.autopilot
          ? 'Autopilot mode: auto-approved.'
          : `Auto-approved (under ${rules.autoApproveSats.toLocaleString()} sat limit).`,
    };
  }

  // Requires confirmation
  return {
    decision: 'requires_confirmation',
    reason: `This is above your auto-approve limit of ${rules.autoApproveSats.toLocaleString()} sats. Confirm to proceed?`,
  };
}

/**
 * Update a policy rule.
 */
export async function updatePolicyRule(
  userId: number,
  field: 'daily_limit' | 'per_tx' | 'auto_approve' | 'autopilot',
  value: number
): Promise<string> {
  const db = getDb();
  await ensurePolicyRules(userId);

  switch (field) {
    case 'daily_limit':
      await db
        .update(policyRules)
        .set({ dailyLimitSats: value })
        .where(eq(policyRules.userId, userId));
      return `Daily spend limit updated to ${value.toLocaleString()} sats.`;

    case 'per_tx':
      await db
        .update(policyRules)
        .set({ perTxLimitSats: value })
        .where(eq(policyRules.userId, userId));
      return `Per-transaction limit updated to ${value.toLocaleString()} sats.`;

    case 'auto_approve':
      await db
        .update(policyRules)
        .set({ autoApproveSats: value })
        .where(eq(policyRules.userId, userId));
      return `Auto-approve threshold updated to ${value.toLocaleString()} sats.`;

    case 'autopilot':
      await db
        .update(policyRules)
        .set({ autopilot: value ? 1 : 0 })
        .where(eq(policyRules.userId, userId));
      return value ? 'Autopilot enabled — all transactions auto-approved.' : 'Autopilot disabled.';

    default:
      return 'Unknown policy field.';
  }
}

/**
 * Update the allowlist.
 */
export async function updateAllowlist(
  userId: number,
  addresses: string[]
): Promise<string> {
  const db = getDb();
  await ensurePolicyRules(userId);

  await db
    .update(policyRules)
    .set({ allowlistJson: JSON.stringify(addresses) })
    .where(eq(policyRules.userId, userId));

  return `Allowlist updated with ${addresses.length} address(es).`;
}
