import { Bot, InlineKeyboard, type Context } from 'grammy';
import { sparkAdapter } from '@sats-fast/wallet-spark';
import { liquidAdapter } from '@sats-fast/wallet-liquid';
import { checkPolicy } from '@sats-fast/policy';
import { getPolicyRules, updatePolicyRule } from '@sats-fast/policy';
import { getReceipts } from '@sats-fast/receipts';
import { runAgent } from '@sats-fast/agent';
import { satsToBtc, satsToUsd, decrypt, truncateMiddle } from '@sats-fast/shared';
import {
  getOrCreateUser,
  getUserByTelegramId,
  getProviderConfig,
  setProviderConfig,
  createPendingApproval,
  resolvePendingApproval,
} from './user-service';
import { qrInputFile } from './qr';
import { watchUserSwaps } from './swap-monitor';

/**
 * Send a message with Markdown, falling back to plain text if Telegram
 * can't parse the entities (e.g. unmatched *, <, >, | etc.).
 */
async function safeSend(ctx: Context, text: string, extra?: Record<string, unknown>) {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
  } catch (err: any) {
    if (err?.error_code === 400 && err?.description?.includes("can't parse entities")) {
      // Strip markdown formatting and retry as plain text
      const plain = text.replace(/[*_`\[\]]/g, '');
      await ctx.reply(plain, extra);
    } else {
      throw err;
    }
  }
}

export function registerHandlers(bot: Bot) {
  // ── /start ──────────────────────────────────────────
  bot.command('start', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;

    const { isNew } = await getOrCreateUser(tgId, ctx.from?.username);

    if (isNew) {
      await safeSend(ctx,
        '🚀 *Welcome to sats.fast!*\n\n' +
          'Your wallet has been created. You have two separate balances:\n\n' +
          '⚡ *Lightning BTC* — instant Bitcoin via Spark\n' +
          '💵 *Liquid USDT* — stablecoin on Liquid network\n\n' +
          'Use /balance to see both balances.\n' +
          'Use /help for all commands.\n' +
          'Or just type in plain English — I understand!\n\n' +
          '⚠️ *Back up your seed:* Use /exportkey to save your recovery phrase.\n\n' +
          'What would you like to do?'
      );
    } else {
      await ctx.reply('👋 Welcome back! Use /balance to check your wallets or just ask me anything.');
    }
  });

  // ── /help ───────────────────────────────────────────
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '📖 sats.fast Commands\n\n' +
        '/balance — Show both wallet balances\n' +
        '/deposit — Get Lightning deposit invoice\n' +
        '/invoice [amt] — Create Lightning invoice\n' +
        '/pay [bolt11] — Pay Lightning invoice\n' +
        '/send [addr] [amt] — Send BTC or USDT\n' +
        '/receive — Get Liquid USDT address\n' +
        '/history — Recent transactions\n' +
        '/limits — View spending limits\n' +
        '/setlimit [type] [amount] — Update limit\n' +
        '/preferences — View settings\n' +
        '/provider — Current AI provider\n' +
        '/setprovider [openai or anthropic] — Switch AI\n' +
        '/setkey [api_key] — Set your AI API key\n' +
        '/exportkey — Export wallet seed phrase\n' +
        '/status — Bot & wallet status\n\n' +
        '💬 Or just type naturally: "send 5000 sats to pseudozach@cash.app"\n\n' +
        'What would you like to do?'
    );
  });

  // ── /status ─────────────────────────────────────────
  bot.command('status', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const config = await getProviderConfig(user.id);
    await safeSend(ctx,
      '🤖 *sats.fast Status*\n\n' +
        `Bot: ✅ Online\n` +
        `AI: ${config.provider} (${config.model})\n` +
        `API Key: ${config.apiKey ? '✅ Set' : '❌ Not set'}\n` +
        `User ID: ${user.id}`
    );
  });

  // ── /balance ────────────────────────────────────────
  bot.command('balance', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;

    const { id, mnemonic } = await getOrCreateUser(tgId, ctx.from?.username);

    try {
      // Fetch both balances in parallel
      const [sparkBalance, liquidBalance] = await Promise.allSettled([
        sparkAdapter.getBalance(tgId, mnemonic),
        liquidAdapter.getBalance(tgId, mnemonic),
      ]);

      let sparkLine = '⚡ *Lightning BTC (Spark)*\n';
      if (sparkBalance.status === 'fulfilled') {
        const sats = sparkBalance.value;
        const btc = satsToBtc(sats);
        const usd = await satsToUsd(sats);
        sparkLine += `Balance: ${btc} BTC (${Number(sats).toLocaleString()} sats)\n≈ $${usd} USD`;
      } else {
        sparkLine += 'Balance: ⚠️ Unable to fetch';
      }

      let liquidLine = '\n\n💵 *Liquid USDT*\n';
      if (liquidBalance.status === 'fulfilled') {
        liquidLine += `Balance: ${liquidBalance.value.usdtBalance.toFixed(2)} USDT`;
      } else {
        liquidLine += 'Balance: ⚠️ Unable to fetch';
      }

      await safeSend(ctx,
        sparkLine + liquidLine +
          '\n\n_(Balances are separate. Use /send or ask me to move funds.)_'
      );
    } catch (err: any) {
      await ctx.reply(`❌ Error fetching balances: ${err.message}`);
    }
  });

  // ── /deposit ────────────────────────────────────────
  bot.command('deposit', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const { mnemonic } = await getOrCreateUser(tgId, ctx.from?.username);

    try {
      // Default to a 100k sats invoice — user can also use /invoice <amt> for a specific amount
      const defaultSats = 100_000;
      const result = await sparkAdapter.createInvoice(tgId, mnemonic, defaultSats, 'Deposit via sats.fast');
      const bolt11 = result?.invoice?.encodedInvoice || result?.invoice || 'unknown';
      const { source } = await qrInputFile(String(bolt11));
      await ctx.replyWithPhoto(source, {
        caption:
          '⚡ Lightning Deposit Invoice\n\n' +
          `${bolt11}\n\n` +
          `Amount: ${defaultSats.toLocaleString()} sats\n\n` +
          'Scan or paste this in any Lightning-enabled app (Cash App, Strike, etc.)\n' +
          'Use /invoice [amount] for a specific sat amount.',
      });
    } catch (err: any) {
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // ── /invoice [amt] ──────────────────────────────────
  bot.command('invoice', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const { mnemonic } = await getOrCreateUser(tgId, ctx.from?.username);

    const args = ctx.match?.trim();
    if (!args) {
      return ctx.reply('Usage: /invoice <amount_in_sats> [memo]\nExample: /invoice 50000 coffee');
    }

    const parts = args.split(/\s+/);
    const amount = parseInt(parts[0]!, 10);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('Please provide a valid positive amount in sats.');
    }
    const memo = parts.slice(1).join(' ') || '';

    try {
      const result = await sparkAdapter.createInvoice(tgId, mnemonic, amount, memo);
      // LightningReceiveRequest.invoice is an Invoice object with encodedInvoice
      const bolt11 = result?.invoice?.encodedInvoice || result?.invoice || 'unknown';
      const { source } = await qrInputFile(String(bolt11));
      await ctx.replyWithPhoto(source, {
        caption:
          `⚡ Lightning Invoice\n\n` +
          `${bolt11}\n\n` +
          `Amount: ${amount.toLocaleString()} sats` +
          (memo ? `\nMemo: ${memo}` : '') +
          `\n\nScan or copy the invoice above. It expires shortly! 🕐`,
      });
    } catch (err: any) {
      await ctx.reply(`❌ Error creating invoice: ${err.message}`);
    }
  });

  // ── /pay <bolt11> ───────────────────────────────────
  bot.command('pay', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const { id, mnemonic } = await getOrCreateUser(tgId, ctx.from?.username);

    const invoice = ctx.match?.trim();
    if (!invoice || !invoice.startsWith('lnbc')) {
      return ctx.reply('Usage: /pay <bolt11_invoice>\nExample: /pay lnbc50u1...');
    }

    // Route through agent for policy check
    const config = await getProviderConfig(id);
    if (!config.apiKey) {
      return ctx.reply('❌ No AI API key set. Use /setkey to configure.');
    }

    await ctx.reply('🔍 Checking payment...');
    const response = await runAgent(
      `Pay this Lightning invoice: ${invoice}`,
      config,
      { userId: tgId, dbUserId: id, mnemonic }
    );
    await safeSend(ctx, response);
  });

  // ── /send <addr> <amt> ──────────────────────────────
  bot.command('send', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const { id, mnemonic } = await getOrCreateUser(tgId, ctx.from?.username);

    const args = ctx.match?.trim();
    if (!args) {
      return ctx.reply('Usage: /send <address> <amount>\nExample: /send spark1... 50000');
    }

    const config = await getProviderConfig(id);
    if (!config.apiKey) {
      return ctx.reply('❌ No AI API key set. Use /setkey to configure.');
    }

    await ctx.reply('🔍 Processing send request...');
    const response = await runAgent(
      `Send: ${args}`,
      config,
      { userId: tgId, dbUserId: id, mnemonic }
    );
    await safeSend(ctx, response);
  });

  // ── /receive ────────────────────────────────────────
  bot.command('receive', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const { mnemonic } = await getOrCreateUser(tgId, ctx.from?.username);

    try {
      const { prepareResponse, feesSat } = await liquidAdapter.prepareReceive(tgId, mnemonic);
      const address = await liquidAdapter.executeReceive(tgId, mnemonic, prepareResponse);
      const { source } = await qrInputFile(String(address));
      await ctx.replyWithPhoto(source, {
        caption:
          '💵 Liquid USDT Receive Address\n\n' +
          `${address}\n\n` +
          `Fee: ${feesSat} sats\n` +
          'Send USDT (Liquid) to this address.',
      });
    } catch (err: any) {
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // ── /history ────────────────────────────────────────
  bot.command('history', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const items = await getReceipts(user.id, 10);
    if (items.length === 0) {
      return ctx.reply('📋 No transactions yet. Start by creating an invoice or depositing funds!');
    }

    const lines = items.map((r, i) =>
      `${i + 1}. *${r.actionType}* — ${r.amountSats ? r.amountSats.toLocaleString() + ' sats' : 'N/A'} — ${r.createdAt}`
    );
    await safeSend(ctx, '📋 *Recent Transactions*\n\n' + lines.join('\n'));
  });

  // ── /limits ─────────────────────────────────────────
  bot.command('limits', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const rules = await getPolicyRules(user.id);
    await safeSend(ctx,
      '⚙️ *Spending Limits*\n\n' +
        `Daily limit: ${rules.dailyLimitSats.toLocaleString()} sats\n` +
        `Per-tx limit: ${rules.perTxLimitSats.toLocaleString()} sats\n` +
        `Auto-approve under: ${rules.autoApproveSats.toLocaleString()} sats\n` +
        `Autopilot: ${rules.autopilot ? '✅ On' : '❌ Off'}\n\n` +
        'Use /setlimit to update: daily\_limit, per\_tx, auto\_approve, autopilot'
    );
  });

  // ── /setlimit ───────────────────────────────────────
  bot.command('setlimit', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const args = ctx.match?.trim().split(/\s+/);
    if (!args || args.length < 2) {
      return ctx.reply('Usage: /setlimit [daily_limit / per_tx / auto_approve / autopilot] [value]');
    }

    const field = args[0] as any;
    const value = parseInt(args[1]!, 10);
    if (isNaN(value)) {
      return ctx.reply('Please provide a numeric value.');
    }

    const msg = await updatePolicyRule(user.id, field, value);
    await ctx.reply(`✅ ${msg}`);
  });

  // ── /preferences ────────────────────────────────────
  bot.command('preferences', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const config = await getProviderConfig(user.id);
    const rules = await getPolicyRules(user.id);

    await safeSend(ctx,
      '⚙️ *Preferences*\n\n' +
        `AI Provider: ${config.provider}\n` +
        `AI Model: ${config.model}\n` +
        `API Key: ${config.apiKey ? '✅ Set' : '❌ Not set'}\n` +
        `Auto-approve: under ${rules.autoApproveSats.toLocaleString()} sats\n` +
        `Autopilot: ${rules.autopilot ? 'On' : 'Off'}`
    );
  });

  // ── /provider ───────────────────────────────────────
  bot.command('provider', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const config = await getProviderConfig(user.id);
    await safeSend(ctx, `🤖 Current AI: *${config.provider}* — ${config.model}`);
  });

  // ── /setprovider ────────────────────────────────────
  bot.command('setprovider', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const provider = ctx.match?.trim().toLowerCase();
    if (provider !== 'openai' && provider !== 'anthropic') {
      return ctx.reply('Usage: /setprovider [openai or anthropic]');
    }

    const currentConfig = await getProviderConfig(user.id);
    await setProviderConfig(user.id, provider, currentConfig.apiKey, undefined);
    await safeSend(ctx, `✅ AI provider switched to *${provider}*.`);
  });

  // ── /setkey ─────────────────────────────────────────
  bot.command('setkey', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const apiKey = ctx.match?.trim();
    if (!apiKey) {
      return ctx.reply('Usage: /setkey <your_api_key>\n\n⚠️ Send this in a private chat only!');
    }

    // Delete the message containing the key for security
    try {
      await ctx.deleteMessage();
    } catch (_) { /* may not have permission */ }

    const currentConfig = await getProviderConfig(user.id);
    await setProviderConfig(user.id, currentConfig.provider, apiKey, currentConfig.model);
    await ctx.reply('✅ API key saved securely. The message with your key has been deleted.');
  });

  // ── /exportkey ──────────────────────────────────────
  bot.command('exportkey', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const mnemonic = decrypt(user.seedEnc);

    // Send via DM only
    try {
      const seedMsg =
        '🔐 Your Recovery Seed Phrase\n\n' +
        `${mnemonic}\n\n` +
        '⚠️ WARNING: This controls REAL FUNDS.\n' +
        '• Never share this with anyone\n' +
        '• Store it offline in a safe place\n' +
        '• Anyone with this phrase can access your Bitcoin and USDT\n' +
        '• sats.fast will never ask for your seed phrase';
      try {
        await ctx.api.sendMessage(ctx.from!.id, seedMsg, { parse_mode: 'Markdown' });
      } catch (parseErr: any) {
        if (parseErr?.error_code === 400 && parseErr?.description?.includes("can't parse entities")) {
          await ctx.api.sendMessage(ctx.from!.id, seedMsg);
        } else {
          throw parseErr;
        }
      }
      if (ctx.chat?.type !== 'private') {
        await ctx.reply('📬 Seed phrase sent to your DMs.');
      }
    } catch (err: any) {
      await ctx.reply('❌ Could not send DM. Please start a private chat with me first.');
    }
  });

  // ── /approve <id> ───────────────────────────────────
  bot.command('approve', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const approvalId = parseInt(ctx.match?.trim() || '', 10);
    if (isNaN(approvalId)) {
      return ctx.reply('Usage: /approve <approval_id>');
    }

    const action = await resolvePendingApproval(approvalId, 'approved');
    if (!action) {
      return ctx.reply('❌ Approval not found or already resolved.');
    }
    await ctx.reply(`✅ Approved! Executing action...`);
    // The agent will handle execution based on the action data
  });

  // ── /deny <id> ──────────────────────────────────────
  bot.command('deny', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const user = await getUserByTelegramId(tgId);
    if (!user) return ctx.reply('Please run /start first.');

    const approvalId = parseInt(ctx.match?.trim() || '', 10);
    if (isNaN(approvalId)) {
      return ctx.reply('Usage: /deny <approval_id>');
    }

    const action = await resolvePendingApproval(approvalId, 'denied');
    if (!action) {
      return ctx.reply('❌ Approval not found or already resolved.');
    }
    await ctx.reply('❌ Action denied and cancelled.');
  });

  // ── Inline button callbacks ─────────────────────────
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;

    const user = await getUserByTelegramId(tgId);
    if (!user) {
      await ctx.answerCallbackQuery({ text: 'Please run /start first.' });
      return;
    }

    if (data.startsWith('approve:')) {
      const approvalId = parseInt(data.split(':')[1]!, 10);
      const action = await resolvePendingApproval(approvalId, 'approved');
      if (!action) {
        await ctx.answerCallbackQuery({ text: 'Already resolved.' });
        return;
      }
      await ctx.answerCallbackQuery({ text: '✅ Approved!' });
      await ctx.editMessageText('✅ Approved! Executing...');

      // Execute the pending action via agent
      const mnemonic = decrypt(user.seedEnc);
      const config = await getProviderConfig(user.id);
      if (config.apiKey) {
        const response = await runAgent(
          `Execute this previously approved action: ${JSON.stringify(action)}`,
          config,
          { userId: tgId, dbUserId: user.id, mnemonic }
        );
        await safeSend(ctx, response);
      }
    }

    if (data.startsWith('deny:')) {
      const approvalId = parseInt(data.split(':')[1]!, 10);
      const action = await resolvePendingApproval(approvalId, 'denied');
      if (!action) {
        await ctx.answerCallbackQuery({ text: 'Already resolved.' });
        return;
      }
      await ctx.answerCallbackQuery({ text: '❌ Denied.' });
      await ctx.editMessageText('❌ Action cancelled.');
    }
  });

  // ── Natural language → Agent ────────────────────────
  bot.on('message:text', async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;

    const { id, mnemonic } = await getOrCreateUser(tgId, ctx.from?.username);
    const config = await getProviderConfig(id);

    if (!config.apiKey) {
      await ctx.reply(
        '❌ No AI API key configured.\n\n' +
          'Use /setkey <your_key> to set an OpenAI or Anthropic API key.\n' +
          'Or use /setprovider to switch providers.'
      );
      return;
    }

    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    const response = await runAgent(
      ctx.message.text,
      config,
      { userId: tgId, dbUserId: id, mnemonic }
    );

    // Check if the response contains a confirmation request (inline buttons)
    if (response.includes('CONFIRM_REQUEST:')) {
      const match = response.match(/CONFIRM_REQUEST:(\d+)/);
      if (match) {
        const approvalId = match[1];
        const cleanMsg = response.replace(/CONFIRM_REQUEST:\d+/, '').trim();
        const keyboard = new InlineKeyboard()
          .text('✓ Confirm', `approve:${approvalId}`)
          .text('✗ Cancel', `deny:${approvalId}`);
        await safeSend(ctx, cleanMsg, { reply_markup: keyboard });
        return;
      }
    }

    await safeSend(ctx, response);

    // Start background monitoring if the user has pending Liquid payments
    // (e.g., swap in progress, L-BTC arriving, etc.)
    if (liquidAdapter.hasSdk(tgId) && ctx.chat) {
      try {
        const bal = await liquidAdapter.getBalance(tgId, mnemonic);
        if (
          bal.lBtcBalanceSat > 0 ||
          bal.pendingSendSat > 0 ||
          bal.pendingReceiveSat > 0
        ) {
          await watchUserSwaps(tgId, ctx.chat.id, mnemonic, id);
        }
      } catch (_) {
        /* Liquid SDK not initialized or error — skip monitoring */
      }
    }

    // Auto-attach QR code if the agent response contains an invoice or address
    const qrMatch = response.match(/(lnbc[a-z0-9]{50,}|spark1[a-z0-9]{30,}|bc1[a-z0-9]{25,}|lq1[a-z0-9]{25,})/i);
    if (qrMatch) {
      try {
        const { source } = await qrInputFile(qrMatch[1]!);
        await ctx.replyWithPhoto(source, { caption: '📱 Scan to pay / receive' });
      } catch (_) { /* QR generation failed, not critical */ }
    }
  });
}
