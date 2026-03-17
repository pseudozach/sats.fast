import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

import { Bot } from 'grammy';
import { getDb, closeDb } from '@sats-fast/shared';
import { sparkAdapter } from '@sats-fast/wallet-spark';
import { liquidAdapter } from '@sats-fast/wallet-liquid';
import { registerHandlers } from './handlers';

async function main() {
  // Validate required env vars
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN is required');
    process.exit(1);
  }

  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKey || masterKey.length !== 64) {
    console.error('❌ MASTER_ENCRYPTION_KEY must be a 64-character hex string');
    process.exit(1);
  }

  // Initialize database
  console.log('📦 Initializing database...');
  getDb();

  // Create bot
  const bot = new Bot(token);

  // Register all command and message handlers
  registerHandlers(bot);

  // Error handler
  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🔄 Shutting down...');
    bot.stop();
    await sparkAdapter.disposeAll();
    await liquidAdapter.disconnectAll();
    closeDb();
    console.log('✅ Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start bot
  console.log('🤖 sats.fast bot starting...');
  await bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Bot @${botInfo.username} is running!`);
    },
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
