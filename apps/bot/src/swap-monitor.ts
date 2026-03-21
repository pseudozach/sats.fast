/**
 * Swap Monitor — Background payment event listener.
 *
 * After a swap or any operation that leaves pending/in-progress payments,
 * the bot registers an event listener on the user's Breez SDK instance.
 * When a payment succeeds or fails, the bot proactively notifies the user
 * via Telegram without the user having to ask for a balance update.
 */

import { Bot } from 'grammy';
import { liquidAdapter, type SdkEvent } from '@sats-fast/wallet-liquid';
import { sparkAdapter } from '@sats-fast/wallet-spark';
import { satsToUsd } from '@sats-fast/shared';

/** Max time to watch a user before auto-cleanup (30 minutes). */
const WATCH_TIMEOUT_MS = 30 * 60 * 1000;

interface SwapWatch {
  chatId: number;
  mnemonic: string;
  dbUserId: number;
  listenerId: string;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/** Active watches keyed by Telegram ID. */
const watches = new Map<string, SwapWatch>();

/** Bot instance for sending proactive messages. */
let bot: Bot | null = null;

/**
 * Initialize the swap monitor with the bot instance.
 * Must be called once during bot startup.
 */
export function initSwapMonitor(b: Bot): void {
  bot = b;
  console.log('[SwapMonitor] Initialized');
}

/**
 * Start watching for payment events for a user.
 * If already watching, this is a no-op (idempotent).
 *
 * @param telegramId - The user's Telegram ID (string)
 * @param chatId - The chat ID to send notifications to (number)
 * @param mnemonic - The user's decrypted mnemonic
 * @param dbUserId - The user's database ID
 */
export async function watchUserSwaps(
  telegramId: string,
  chatId: number,
  mnemonic: string,
  dbUserId: number
): Promise<void> {
  // Already watching this user — skip
  if (watches.has(telegramId)) return;
  if (!bot) return;

  try {
    const listenerId = await liquidAdapter.addEventListener(
      telegramId,
      mnemonic,
      (event: SdkEvent) => {
        // Fire-and-forget: onEvent is synchronous in the Breez WASM binding,
        // but we need async work (Telegram API, balance fetch).
        handleEvent(telegramId, event).catch((err) =>
          console.error(`[SwapMonitor] Event handler error for ${telegramId}: ${err.message || err}`)
        );
      }
    );

    // Auto-cleanup after timeout to prevent memory leaks
    const timeoutHandle = setTimeout(() => {
      console.log(`[SwapMonitor] Timeout reached for ${telegramId}, cleaning up`);
      unwatchUserSwaps(telegramId).catch(() => {});
    }, WATCH_TIMEOUT_MS);

    watches.set(telegramId, {
      chatId,
      mnemonic,
      dbUserId,
      listenerId,
      timeoutHandle,
    });

    console.log(`[SwapMonitor] Started watching user ${telegramId}, listenerId=${listenerId}`);
  } catch (err: any) {
    console.error(`[SwapMonitor] Failed to start watching ${telegramId}: ${err.message || err}`);
  }
}

/**
 * Handle a Breez SDK event for a user.
 */
async function handleEvent(telegramId: string, event: SdkEvent): Promise<void> {
  const watch = watches.get(telegramId);
  if (!watch || !bot) return;

  console.log(`[SwapMonitor] Event for ${telegramId}: ${event.type}`);

  // Only act on terminal or important payment events
  if (event.type === 'paymentSucceeded') {
    await notifyPaymentComplete(telegramId, watch);
    await unwatchUserSwaps(telegramId);
    return;
  }

  if (event.type === 'paymentFailed') {
    try {
      await bot.api.sendMessage(
        watch.chatId,
        '❌ A payment has failed. Check /balance to see your current state.'
      );
    } catch (err: any) {
      console.error(`[SwapMonitor] Error sending failure notification: ${err.message}`);
    }
    await unwatchUserSwaps(telegramId);
    return;
  }

  if (event.type === 'paymentRefundable') {
    try {
      await bot.api.sendMessage(
        watch.chatId,
        '⚠️ A payment is eligible for refund. Check /balance for details.'
      );
    } catch (err: any) {
      console.error(`[SwapMonitor] Error sending refund notification: ${err.message}`);
    }
    // Don't stop watching — the refund might still process
    return;
  }

  // Ignore sync events, pending events, waiting events — no user notification needed
}

/**
 * Notify the user that a payment completed, including updated balances.
 */
async function notifyPaymentComplete(telegramId: string, watch: SwapWatch): Promise<void> {
  if (!bot) return;

  try {
    // Fetch updated balances from both wallets
    const [sparkResult, liquidResult] = await Promise.allSettled([
      sparkAdapter.getBalance(telegramId, watch.mnemonic),
      liquidAdapter.getBalance(telegramId, watch.mnemonic),
    ]);

    let msg = '✅ Payment confirmed!\n\nUpdated balances:\n';

    if (sparkResult.status === 'fulfilled') {
      const sats = Number(sparkResult.value);
      const usd = await satsToUsd(sats);
      msg += `⚡ Lightning BTC: ${sats.toLocaleString()} sats (~$${usd})\n`;
    }

    if (liquidResult.status === 'fulfilled') {
      const bal = liquidResult.value;
      msg += `💵 Liquid USDT: ${bal.usdtBalance.toFixed(2)} USDT\n`;

      // If there's still L-BTC or pending, mention it subtly
      if (bal.lBtcBalanceSat > 0 || bal.pendingSendSat > 0 || bal.pendingReceiveSat > 0) {
        msg += `\n⏳ Additional transactions still processing...`;
      }
    }

    await bot.api.sendMessage(watch.chatId, msg);
  } catch (err: any) {
    console.error(`[SwapMonitor] Error sending success notification: ${err.message}`);
    // Fallback: send a simple message
    try {
      await bot.api.sendMessage(
        watch.chatId,
        '✅ A payment has been confirmed! Use /balance to check your updated balances.'
      );
    } catch (_) {
      /* give up */
    }
  }
}

/**
 * Stop watching a user's payment events and clean up.
 */
export async function unwatchUserSwaps(telegramId: string): Promise<void> {
  const watch = watches.get(telegramId);
  if (!watch) return;

  clearTimeout(watch.timeoutHandle);

  try {
    await liquidAdapter.removeEventListener(telegramId, watch.mnemonic, watch.listenerId);
  } catch (err: any) {
    console.error(`[SwapMonitor] Error removing listener for ${telegramId}: ${err.message}`);
  }

  watches.delete(telegramId);
  console.log(`[SwapMonitor] Stopped watching user ${telegramId}`);
}

/**
 * Check if a user currently has active monitoring.
 */
export function isWatching(telegramId: string): boolean {
  return watches.has(telegramId);
}

/**
 * Shutdown all watches (called during bot shutdown).
 */
export async function shutdownSwapMonitor(): Promise<void> {
  console.log(`[SwapMonitor] Shutting down, ${watches.size} active watches...`);
  const ids = Array.from(watches.keys());
  for (const telegramId of ids) {
    await unwatchUserSwaps(telegramId);
  }
  console.log('[SwapMonitor] Shutdown complete');
}
