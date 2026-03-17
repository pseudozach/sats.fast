# Disclosure — What's Real, What's Planned

## ✅ Real Today

### WDK Spark for Lightning BTC
- `@tetherto/wdk-wallet-spark` is the primary wallet SDK
- Zero-fee Spark-to-Spark transfers
- Lightning invoice creation and payment
- Bitcoin L1 deposit addresses
- Self-custodial BIP-39 mnemonic

### Breez SDK Nodeless for Liquid USDT
- `@breeztech/breez-sdk-liquid` handles USDT on Liquid
- Boltz swaps are internal to Breez SDK
- Prepare → confirm → execute flow with fee transparency
- Per-user SDK instances with unique working directories

### LangChain Agent Reasoning
- `createReactAgent` from `@langchain/langgraph`
- 18 tool functions for wallet operations, policy, and receipts
- Supports OpenAI and Anthropic (user brings their own key)
- Satisfies "OpenClaw or equivalent agent framework" requirement

### Policy Engine
- Per-user spending limits (daily, per-tx, auto-approve)
- Autopilot mode for power users
- Recipient allowlist
- Human-in-the-loop via Telegram inline buttons

### Receipts & Audit Trail
- Every transaction produces a structured receipt
- JSON receipt stored alongside human-readable summary
- Full audit event log in SQLite

### Admin Panel
- Express + EJS dashboard
- User management, approval queue, receipt history
- Session-based authentication
- Health check endpoint

### One-Command Deploy
- `install.sh` targets Ubuntu 22.04 / Debian 12
- Installs Node.js 22, pnpm, pm2, nginx
- Interactive configuration wizard
- Automatic TLS via nginx (add certbot for HTTPS)

## 🔮 Planned / Future

### Native Tether WDK Swap Module
- When WDK adds native BTC↔USDT swap support, replace Breez SDK
- Would unify both wallets under a single SDK
- Eliminate Breez API key dependency

### Production Key Management
- Hardware Security Module (HSM) for master encryption key
- Shamir's Secret Sharing for key backup
- Key rotation without re-encrypting all seeds

### Multi-User Hardening
- Rate limiting per user (Telegram + API)
- Anti-abuse: velocity checks, cooling periods
- Proper session management for admin panel
- CSRF protection
- Content Security Policy headers

### Advanced Agent Features
- Multi-turn conversation memory (persistent across sessions)
- Scheduled/recurring payments
- Price alerts and notifications
- Portfolio tracking across both wallets
- Natural language transaction search

### Additional Integrations
- Nostr zaps via Lightning
- LNURL support (pay, withdraw, auth)
- NWC (Nostr Wallet Connect) compatibility
- More stablecoins as WDK supports them

## ⚠️ Known Limitations

1. **Demo-grade security**: Admin panel uses basic session auth. Add proper auth (OIDC, 2FA) before production.
2. **Single-server**: No clustering or horizontal scaling. Fine for personal use.
3. **No HTTPS by default**: install.sh sets up HTTP nginx. Add certbot for TLS.
4. **AI costs**: Users pay for their own OpenAI/Anthropic API calls.
5. **No offline support**: Bot requires internet connectivity (Telegram + wallet SDKs).
6. **Breez SDK Node.js v22 requirement**: Cannot run on older Node.js versions.
