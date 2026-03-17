import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { eq, desc, sql } from 'drizzle-orm';
import {
  getDb,
  closeDb,
  users,
  pendingApprovals,
  receipts,
  auditEvents,
  adminUsers,
  botConfig,
  nowUtc,
} from '@sats-fast/shared';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.set('view engine', 'ejs');
app.set('views', resolve(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
  })
);

// Declare session type
declare module 'express-session' {
  interface SessionData {
    authenticated: boolean;
    username: string;
  }
}

// Auth middleware
function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
}

// ── Routes ────────────────────────────────────────────

app.get('/login', (_req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Check env-based admin first
  const envUser = process.env.ADMIN_USERNAME;
  const envHash = process.env.ADMIN_PASSWORD_HASH;

  if (envUser && envHash && username === envUser) {
    const valid = await bcrypt.compare(password, envHash);
    if (valid) {
      req.session.authenticated = true;
      req.session.username = username;
      return res.redirect('/');
    }
  }

  // Check DB-based admins
  const db = getDb();
  const admins = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username))
    .limit(1);

  if (admins.length > 0) {
    const valid = await bcrypt.compare(password, admins[0]!.passwordHash);
    if (valid) {
      req.session.authenticated = true;
      req.session.username = username;
      return res.redirect('/');
    }
  }

  res.render('login', { error: 'Invalid credentials.' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ── Dashboard ─────────────────────────────────────────
app.get('/', requireAuth, async (_req, res) => {
  const db = getDb();

  const userCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(users);
  const receiptCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(receipts);
  const pendingCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(pendingApprovals)
    .where(eq(pendingApprovals.status, 'pending'));
  const recentReceipts = await db
    .select()
    .from(receipts)
    .orderBy(desc(receipts.id))
    .limit(10);

  res.render('dashboard', {
    userCount: userCount[0]?.count || 0,
    receiptCount: receiptCount[0]?.count || 0,
    pendingCount: pendingCount[0]?.count || 0,
    recentReceipts,
  });
});

// ── Users ─────────────────────────────────────────────
app.get('/users', requireAuth, async (_req, res) => {
  const db = getDb();
  const allUsers = await db.select().from(users).orderBy(desc(users.id));
  res.render('users', { users: allUsers });
});

// ── Approvals ─────────────────────────────────────────
app.get('/approvals', requireAuth, async (_req, res) => {
  const db = getDb();
  const pending = await db
    .select()
    .from(pendingApprovals)
    .orderBy(desc(pendingApprovals.id))
    .limit(50);
  res.render('approvals', { approvals: pending });
});

app.post('/approvals/:id', requireAuth, async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id as string, 10);
  const { action } = req.body; // 'approve' or 'deny'

  const status = action === 'approve' ? 'approved' : 'denied';
  await db
    .update(pendingApprovals)
    .set({ status, resolvedAt: nowUtc() })
    .where(eq(pendingApprovals.id, id));

  res.redirect('/approvals');
});

// ── Receipts ──────────────────────────────────────────
app.get('/receipts', requireAuth, async (_req, res) => {
  const db = getDb();
  const allReceipts = await db
    .select()
    .from(receipts)
    .orderBy(desc(receipts.id))
    .limit(100);
  res.render('receipts', { receipts: allReceipts });
});

// ── Config ────────────────────────────────────────────
app.get('/config', requireAuth, async (_req, res) => {
  const db = getDb();
  const configs = await db.select().from(botConfig);
  const configMap: Record<string, string> = {};
  configs.forEach((c) => {
    configMap[c.key] = c.value;
  });
  res.render('config', { config: configMap });
});

app.post('/config', requireAuth, async (req, res) => {
  const db = getDb();
  const { key, value } = req.body;
  if (key && value) {
    await db
      .insert(botConfig)
      .values({ key, value })
      .onConflictDoUpdate({ target: botConfig.key, set: { value } });
  }
  res.redirect('/config');
});

// ── Health ────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const envCheck = {
    TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
    MASTER_ENCRYPTION_KEY: !!process.env.MASTER_ENCRYPTION_KEY,
    BREEZ_API_KEY: !!process.env.BREEZ_API_KEY,
    DATABASE_URL: process.env.DATABASE_URL || './data/sats.db',
    NODE_ENV: process.env.NODE_ENV || 'development',
  };

  res.json({
    status: 'ok',
    timestamp: nowUtc(),
    env: envCheck,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🖥️  Admin panel running at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});
