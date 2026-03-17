# Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        Telegram User                          │
│                     (plain English chat)                       │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    apps/bot (grammy)                           │
│  Commands: /start /balance /pay /send /invoice /receive ...   │
│  Natural language → Agent                                     │
│  Inline buttons for confirmation                              │
└──────────┬────────────────────────────────┬──────────────────┘
           │                                │
           ▼                                ▼
┌─────────────────────┐         ┌─────────────────────────────┐
│   packages/agent    │         │      apps/admin              │
│  (LangChain React)  │         │   (Express + EJS)            │
│                     │         │                              │
│  18 tool functions  │         │  Dashboard, Users,           │
│  System prompt      │         │  Approvals, Receipts,        │
│  OpenAI/Anthropic   │         │  Config, Health              │
└──┬──┬──┬──┬────────┘         └──────────────┬───────────────┘
   │  │  │  │                                  │
   │  │  │  │                                  │
   ▼  │  │  ▼                                  ▼
┌─────┐│  │┌──────────┐              ┌────────────────────┐
│Spark││  ││ Receipts  │              │  packages/shared   │
│Wallet│  ││           │              │  Drizzle ORM       │
│     ││  ││ save()    │              │  SQLite             │
│     ││  ││ get()     │              │  AES-256-GCM       │
└─────┘│  │└──────────┘              │  BIP-39 seeds      │
       │  │                           └────────────────────┘
       ▼  ▼
┌─────────┐┌─────────┐
│ Liquid  ││ Policy  │
│ Wallet  ││ Engine  │
│         ││         │
│ Breez   ││ check() │
│ SDK     ││ limits  │
└─────────┘└─────────┘
```

## Wallet Separation

### WDK Spark (Lightning BTC)

```
@tetherto/wdk-wallet-spark
├── createLightningInvoice()   → receive BTC via Lightning
├── payLightningInvoice()      → send BTC via Lightning
├── sendTransaction()          → send BTC to Spark address (0 fee)
├── getBalance()               → BTC balance in satoshis
├── getSingleUseDepositAddress() → Bitcoin L1 deposit
└── withdraw()                 → Bitcoin L1 withdrawal
```

- **Network**: Lightning Network via Spark
- **Fees**: Always 0 on Spark-to-Spark; Lightning routing fees for BOLT11
- **Initialization**: `new WalletManagerSpark(mnemonic, { network: 'MAINNET' })`

### Breez SDK Liquid (USDT)

```
@breeztech/breez-sdk-liquid/node
├── getInfo()                  → USDT balance
├── prepareSendPayment()       → estimate fees
├── sendPayment()              → send USDT
├── prepareReceivePayment()    → prepare receive
└── receivePayment()           → get Liquid address
```

- **Network**: Liquid sidechain (Boltz swaps internal to Breez)
- **Fees**: Returned by `prepareResponse.feesSat` before execution
- **Asset ID**: `ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2`
- **Initialization**: Per-user instance with unique `workingDir`

## LangChain Agent Tools

| Tool | Package | Description |
|------|---------|-------------|
| `spark_get_balance` | wallet-spark | Get Lightning BTC balance |
| `spark_get_address` | wallet-spark | Get Spark address |
| `spark_get_deposit_address` | wallet-spark | Get Bitcoin L1 deposit address |
| `spark_create_invoice` | wallet-spark | Create Lightning invoice |
| `spark_fee_estimate` | wallet-spark | Estimate Lightning fee |
| `spark_pay_invoice` | wallet-spark | Pay Lightning invoice |
| `spark_send` | wallet-spark | Send to Spark address |
| `spark_get_history` | wallet-spark | Transaction history |
| `liquid_get_balance` | wallet-liquid | Get USDT balance |
| `liquid_get_address` | wallet-liquid | Get Liquid receive address |
| `liquid_send_prepare` | wallet-liquid | Prepare USDT send (fee estimate) |
| `liquid_send_execute` | wallet-liquid | Execute USDT send |
| `liquid_receive_prepare` | wallet-liquid | Prepare USDT receive |
| `liquid_receive_execute` | wallet-liquid | Execute USDT receive |
| `policy_check` | policy | Check spend limits |
| `policy_update` | policy | Update user preferences |
| `receipt_save` | receipts | Save transaction receipt |
| `history_get` | receipts | Get recent receipts |

## Policy Engine Flow

```
User request → Agent → policy_check()
                          │
                          ├─ APPROVED (auto): proceed directly
                          │
                          ├─ REQUIRES_CONFIRMATION: 
                          │   → save to pending_approvals
                          │   → send Telegram inline buttons
                          │   → wait for user tap
                          │   → resume on confirm / cancel on deny
                          │
                          └─ BLOCKED: explain why, stop
```

### Rules (per-user, stored in SQLite):

- `daily_limit_sats`: Max daily spend (default: 1,000,000)
- `per_tx_limit_sats`: Max per transaction (default: 100,000)
- `auto_approve_sats`: Auto-approve under this amount (default: 10,000)
- `autopilot`: Skip all confirmations (default: off)
- `allowlist`: Trusted addresses (skip destination check)

## Seed Encryption

```
User's mnemonic (12 words)
        │
        ▼
AES-256-GCM encrypt(mnemonic, MASTER_ENCRYPTION_KEY)
        │
        ▼
base64(iv + authTag + ciphertext) → stored in SQLite users.seed_enc
```

- `MASTER_ENCRYPTION_KEY`: 32-byte hex (64 characters) in `.env`
- Generated during install: `openssl rand -hex 32`
- Same mnemonic feeds both Spark and Breez (different derivation paths internally)

## Database Schema

- **users**: Telegram ID, encrypted seed, username
- **provider_configs**: Per-user AI provider + encrypted API key
- **policy_rules**: Per-user spending limits
- **pending_approvals**: Actions awaiting confirmation
- **receipts**: Structured transaction log
- **audit_events**: Full audit trail
- **admin_users**: Admin panel credentials
- **bot_config**: Key-value bot configuration
