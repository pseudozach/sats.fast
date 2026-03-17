import { eq, desc } from 'drizzle-orm';
import {
  getDb,
  receipts,
  auditEvents,
  nowUtc,
  truncateMiddle,
  satsToUsd,
  type ReceiptData,
} from '@sats-fast/shared';

export interface SaveReceiptInput {
  userId: number;
  actionType: string;
  amountSats?: number;
  feeSats?: number;
  txId?: string;
  destination?: string;
  model?: string;
  policyNote?: string;
  extra?: Record<string, unknown>;
}

/**
 * Save a receipt to the database and return a formatted message.
 */
export async function saveReceipt(input: SaveReceiptInput): Promise<string> {
  const db = getDb();
  const now = nowUtc();
  const usdApprox = input.amountSats
    ? await satsToUsd(input.amountSats)
    : '0.00';

  const receiptData: ReceiptData = {
    action: input.actionType,
    amount: input.amountSats
      ? `${input.amountSats.toLocaleString()} sats (~$${usdApprox})`
      : 'N/A',
    fee: input.feeSats !== undefined ? `${input.feeSats} sats` : '0 sats',
    to: input.destination ? truncateMiddle(input.destination, 24) : 'N/A',
    txId: input.txId ? truncateMiddle(input.txId, 24) : 'N/A',
    time: now,
    model: input.model || 'unknown',
    policyNote: input.policyNote || '',
  };

  const summary = formatReceipt(receiptData);

  await db.insert(receipts).values({
    userId: input.userId,
    actionType: input.actionType,
    amountSats: input.amountSats ?? null,
    feeSats: input.feeSats ?? null,
    txId: input.txId ?? null,
    summary,
    receiptJson: JSON.stringify({ ...receiptData, ...input.extra }),
    createdAt: now,
  });

  // Also log to audit trail
  await db.insert(auditEvents).values({
    userId: input.userId,
    eventType: `receipt:${input.actionType}`,
    dataJson: JSON.stringify(receiptData),
    createdAt: now,
  });

  return summary;
}

/**
 * Format a receipt into the standard Telegram message.
 */
function formatReceipt(data: ReceiptData): string {
  return [
    '✅ Receipt',
    '──────────────────────',
    `Action:   ${data.action}`,
    `Amount:   ${data.amount}`,
    `Fee:      ${data.fee}`,
    `To:       ${data.to}`,
    `Tx ID:    ${data.txId}`,
    `Time:     ${data.time}`,
    `Model:    ${data.model}`,
    `Policy:   ${data.policyNote}`,
    '──────────────────────',
  ].join('\n');
}

/**
 * Get recent receipts for a user.
 */
export async function getReceipts(
  userId: number,
  limit: number = 10
): Promise<Array<typeof receipts.$inferSelect>> {
  const db = getDb();
  return db
    .select()
    .from(receipts)
    .where(eq(receipts.userId, userId))
    .orderBy(desc(receipts.id))
    .limit(limit);
}

/**
 * Log an audit event.
 */
export async function logAuditEvent(
  userId: number | null,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  await db.insert(auditEvents).values({
    userId,
    eventType,
    dataJson: JSON.stringify(data),
    createdAt: nowUtc(),
  });
}
