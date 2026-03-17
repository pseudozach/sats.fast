# Demo Script — 3 Minutes

## Setup (before demo)

1. Fresh VPS or local machine with Node.js 22+
2. Bot token from @BotFather
3. Breez API key (free)
4. OpenAI or Anthropic API key
5. Small amount of BTC funded to the Spark wallet

---

## Demo Flow

### 1. Fresh Install (30 sec)

```bash
git clone https://github.com/pseudozach/sats.fast.git
cd sats-fast && pnpm install && pnpm build
cp .env.example .env  # pre-configured for demo
pnpm db:migrate
pnpm dev:bot &
pnpm dev:admin &
```

*"One command on a VPS. We're up."*

### 2. /start → /balance (30 sec)

Open Telegram, find the bot.

```
/start
```

> 🚀 Welcome to sats.fast!
> Your wallet has been created...

```
/balance
```

> ⚡ Lightning BTC (Spark)
> Balance: 0.00150000 BTC (150,000 sats)
> ≈ $90.00 USD
>
> 💵 Liquid USDT
> Balance: 25.00 USDT

*"Two separate wallets. One seed phrase. Self-custodial."*

### 3. Create & Pay Lightning Invoice (30 sec)

```
/invoice 50000 demo payment
```

> ⚡ Lightning Invoice
> lnbc500u1...
> Amount: 50,000 sats

Copy the invoice. From another wallet (or the same bot in a different chat):

```
/pay lnbc500u1...
```

> 💸 Confirm payment?
> To: lnbc500u1... (50,000 sats)
> Fee: ~120 sats
> [✓ Confirm]  [✗ Cancel]

Tap **Confirm**.

> ✅ Receipt
> Action: Lightning payment
> Amount: 50,000 sats (~$30.00)
> Fee: 120 sats

*"Real Lightning payment. Policy checked. Receipt logged."*

### 4. Natural Language Send (30 sec)

```
Send 5000 sats to spark1abc...
```

> 🔍 Processing...
> I'll send 5,000 sats to spark1abc... via Spark (zero fee).
> 
> 💸 Confirm payment?
> To: spark1abc...
> Amount: 5,000 sats (~$3.00)
> Fee: 0 sats (Spark)
> [✓ Confirm]  [✗ Cancel]

Tap **Confirm**.

> ✅ Receipt
> Action: Spark transfer
> Amount: 5,000 sats (~$3.00)
> Fee: 0 sats
> Policy: Above auto-approve limit

*"Natural language. Agent understands intent, checks policy, confirms with user."*

### 5. Update Policy (20 sec)

```
Don't ask me next time under 5000 sats
```

> ✅ Auto-approve threshold updated to 5,000 sats.
> Transactions under 5,000 sats will be auto-approved.

*"The agent understands preference updates too."*

### 6. Auto-Approved Small Payment (20 sec)

```
Send 2000 sats to spark1abc...
```

> ✅ Receipt
> Action: Spark transfer
> Amount: 2,000 sats (~$1.20)
> Fee: 0 sats
> Policy: Auto-approved (under 5,000 sat limit)

*"Under the new limit — no confirmation needed. Instant."*

### 7. Admin Panel (20 sec)

Open browser to `http://localhost:3000`

- Login with admin credentials
- Dashboard: user count, receipt count, pending approvals
- Receipts tab: full transaction history
- Users tab: all registered users

*"Admin can see everything. Approve pending transactions. Full audit trail."*

---

## Key Talking Points

- **WDK Spark** is the primary wallet — zero-fee, self-custodial Lightning
- **LangChain agent** reasons about user intent and calls the right tools
- **Policy engine** prevents unauthorized transactions
- **Two wallets, one seed** — BTC and USDT without complexity
- **Telegram** reaches 900M+ users — no app store friction
- **One-command deploy** on any cheap VPS
