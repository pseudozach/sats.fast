# ⚡ sats.fast

> Self-hosted Telegram bot — your personal Bitcoin financial agent.

See [docs/README.md](docs/README.md) for full documentation.

## Quick Start

```bash
# One-command install on VPS (Ubuntu 22.04 / Debian 12)
curl -sSL https://raw.githubusercontent.com/pseudozach/sats.fast/main/scripts/install.sh | bash

# Or manual:
git clone https://github.com/pseudozach/sats.fast.git && cd sats.fast
pnpm install && pnpm build
cp .env.example .env  # edit with your keys
pnpm db:migrate
pnpm dev:bot
```

## What It Does

Chat in plain English with a Telegram bot. It manages two separate wallets:

- ⚡ **Lightning BTC** via Tether WDK Spark (zero fees)
- 💵 **Liquid USDT** via Breez SDK (minimal network fees)

Built for the **Tether WDK Hackathon Galactica** — Agent Wallets track.

## License

MIT
