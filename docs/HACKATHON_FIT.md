# Hackathon Fit — Tether WDK Galactica, Agent Wallets Track

## Track Requirements → sats.fast Implementation

### ✅ WDK as Primary Wallet Layer

sats.fast uses `@tetherto/wdk-wallet-spark` as the **primary** wallet SDK:

- **Lightning BTC** — all Bitcoin operations route through WDK Spark
- Zero-fee Spark-to-Spark transfers
- Lightning invoice creation and payment
- Bitcoin L1 deposit addresses
- Self-custodial: user holds their BIP-39 mnemonic

The Breez SDK is used **only** for Liquid USDT (stablecoin), which is a complementary feature — not a replacement for WDK.

### ✅ Agent Wallet Architecture

sats.fast is an **AI-powered wallet agent**:

- **LangChain** (`createReactAgent`) provides agent reasoning
  - Satisfies the "OpenClaw or equivalent agent framework" requirement
- 18 tool functions the agent can call (see [ARCHITECTURE.md](ARCHITECTURE.md))
- Natural language understanding for financial operations
- Human-in-the-loop confirmation flow via Telegram inline buttons
- Policy engine prevents unauthorized transactions

### ✅ Self-Custodial Model

- One BIP-39 mnemonic per user, generated locally
- Mnemonic encrypted with AES-256-GCM at rest
- User can export their seed phrase at any time (`/exportkey`)
- Same mnemonic initializes both Spark and Breez wallets
- No custodial service — user controls their own keys

### ✅ Distribution Channel

- **Telegram bot** — reaches 900M+ users
- No app download required
- Works on mobile and desktop
- Inline buttons for transaction confirmation
- Natural language interface — no crypto jargon needed

### ✅ Real Functionality (Not Mocked)

Everything uses real SDK calls:

| Feature | SDK | Real? |
|---------|-----|-------|
| Lightning payments | WDK Spark | ✅ |
| Spark transfers | WDK Spark | ✅ |
| L1 deposits | WDK Spark | ✅ |
| USDT send/receive | Breez SDK Liquid | ✅ |
| Balance queries | Both | ✅ |
| AI reasoning | LangChain + OpenAI/Anthropic | ✅ |

### ✅ One-Command Deploy

```bash
curl -sSL https://raw.githubusercontent.com/pseudozach/sats.fast/main/scripts/install.sh | bash
```

- Targets Ubuntu 22.04 / Debian 12
- Interactive configuration wizard
- pm2 process management
- nginx reverse proxy
- Runs on a $5/mo VPS

## Why This Matters

sats.fast demonstrates that:

1. **WDK Spark makes Bitcoin accessible** — zero-fee Lightning via a clean SDK
2. **AI agents can handle real money safely** — policy engine + human-in-the-loop
3. **Telegram is a powerful distribution channel** — no app store friction
4. **Self-custody and UX aren't mutually exclusive** — users own their keys while chatting naturally

## Technical Differentiators

- **Strict wallet separation**: WDK Spark for BTC, Breez for USDT. No overlap.
- **Policy engine**: Per-user spending limits, auto-approve thresholds, allowlists
- **Audit trail**: Every transaction produces a structured receipt
- **Pluggable AI**: Users bring their own OpenAI or Anthropic key
- **pnpm monorepo**: Clean package boundaries, easy to extend
