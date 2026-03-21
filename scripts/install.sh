#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
#  sats.fast installer
#  Target: macOS (Homebrew), Ubuntu 22+, Debian 12+, Amazon Linux 2023, RHEL/Fedora
#  Usage:  curl -sSL https://raw.githubusercontent.com/pseudozach/sats.fast/main/scripts/install.sh | bash
# ─────────────────────────────────────────────────────────

main() {

# ── Detect platform first (sets INSTALL_DIR, IS_MACOS) ──
IS_MACOS=0
if [[ "$(uname -s)" == "Darwin" ]]; then
  IS_MACOS=1
  INSTALL_DIR="$HOME/Documents/sats-fast-agent"
else
  INSTALL_DIR="/opt/sats-fast"
fi
DATA_DIR="$INSTALL_DIR/data"

echo ""
echo "  ⚡ sats.fast installer"
echo "  ─────────────────────────────────────"
echo ""

# Ensure we can read from terminal even when piped
if [ -t 0 ]; then
  : # stdin is already a terminal
elif [ -e /dev/tty ]; then
  exec </dev/tty
else
  echo "  ❌ Cannot open /dev/tty for interactive input."
  echo "  Download and run the script directly instead:"
  echo "    curl -O https://raw.githubusercontent.com/pseudozach/sats.fast/main/scripts/install.sh"
  echo "    bash install.sh"
  exit 1
fi

# ── Detect OS ─────────────────────────────────────────
echo "🔍 Detecting operating system..."
detect_os() {
  if [ "$IS_MACOS" = "1" ]; then
    PKG_MANAGER="brew"
    if ! command -v brew &>/dev/null; then
      echo "  ❌ Homebrew is required but not installed."
      echo "  Install it first: https://brew.sh"
      exit 1
    fi
    echo "  OS: macOS $(sw_vers -productVersion) (using brew)"
    return
  fi

  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_ID_LIKE="${ID_LIKE:-}"
  else
    OS_ID="unknown"
    OS_ID_LIKE=""
  fi

  case "$OS_ID" in
    ubuntu|debian)     PKG_MANAGER="apt" ;;
    amzn|fedora|rhel|centos|rocky|almalinux)  PKG_MANAGER="dnf" ;;
    *)
      case "$OS_ID_LIKE" in
        *debian*|*ubuntu*)  PKG_MANAGER="apt" ;;
        *rhel*|*fedora*)    PKG_MANAGER="dnf" ;;
        *)
          if command -v apt-get &>/dev/null; then
            PKG_MANAGER="apt"
          elif command -v dnf &>/dev/null; then
            PKG_MANAGER="dnf"
          elif command -v yum &>/dev/null; then
            PKG_MANAGER="yum"
          else
            echo "  ❌ No supported package manager found (apt/dnf/yum/brew)."
            exit 1
          fi
          ;;
      esac
      ;;
  esac

  echo "  OS: ${PRETTY_NAME:-$OS_ID} (using $PKG_MANAGER)"
}
detect_os

# ── 1. System packages ────────────────────────────────
echo ""
if [ "$IS_MACOS" = "1" ]; then
  if command -v git &>/dev/null && command -v sqlite3 &>/dev/null; then
    echo "📦 [1/5] System packages — already installed ✅"
  else
    echo "📦 [1/5] Installing system packages..."
    brew install git sqlite openssl 2>/dev/null || true
    echo "   ✅ System packages installed"
  fi
else
if command -v git &>/dev/null && command -v nginx &>/dev/null && command -v gcc &>/dev/null; then
  echo "📦 [1/5] System packages — already installed ✅"
else
  echo "📦 [1/5] Installing system packages..."
  case "$PKG_MANAGER" in
    apt)
      sudo apt-get update -qq 2>&1 | tail -1
      sudo apt-get install -y -qq git curl sqlite3 nginx build-essential openssl > /dev/null
      ;;
    dnf)
      # Amazon Linux ships curl-minimal which conflicts with curl — skip it
      sudo dnf install -q -y git sqlite nginx gcc gcc-c++ make openssl > /dev/null 2>&1 || true
      ;;
    yum)
      sudo yum install -q -y git sqlite nginx gcc gcc-c++ make openssl > /dev/null 2>&1 || true
      ;;
  esac
  echo "   ✅ System packages installed"
fi
fi

# ── 2. Node.js 22 ────────────────────────────────────
# Source nvm if available (needed for nvm-managed node to be in PATH)
if [ "$IS_MACOS" = "1" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
if command -v node &>/dev/null && [[ $(node -v | cut -d. -f1 | tr -d 'v') -ge 22 ]]; then
  echo "📦 [2/5] Node.js $(node -v) — already installed ✅"
else
  echo "📦 [2/5] Installing Node.js 22..."
  if [ "$IS_MACOS" = "1" ]; then
    # Prefer nvm if available
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    if command -v nvm &>/dev/null; then
      nvm install 22 > /dev/null 2>&1
      nvm use 22 > /dev/null 2>&1
    else
      brew install node@22 2>/dev/null || brew upgrade node@22 2>/dev/null || true
      if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 22 ]]; then
        brew link --overwrite node@22 2>/dev/null || true
      fi
    fi
  else
  case "$PKG_MANAGER" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - > /dev/null 2>&1
      sudo apt-get install -y -qq nodejs > /dev/null
      ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash - > /dev/null 2>&1
      sudo $PKG_MANAGER install -q -y nodejs > /dev/null 2>&1
      ;;
  esac
  fi
  echo "   ✅ Node.js $(node -v)"
fi

# ── 3. pnpm (+ pm2 on Linux) ───────────────────────────
echo "📦 [3/5] Checking pnpm..."
if command -v pnpm &>/dev/null; then
  echo "   pnpm $(pnpm -v) ✅"
else
  echo "   Installing pnpm..."
  if [ "$IS_MACOS" = "1" ]; then
    npm install -g pnpm > /dev/null 2>&1
  else
    sudo npm install -g pnpm > /dev/null 2>&1
  fi
  echo "   pnpm $(pnpm -v) ✅"
fi
if [ "$IS_MACOS" = "0" ]; then
  if command -v pm2 &>/dev/null; then
    echo "   pm2 $(pm2 -v 2>/dev/null) ✅"
  else
    echo "   Installing pm2..."
    sudo npm install -g pm2 > /dev/null 2>&1
    echo "   pm2 $(pm2 -v 2>/dev/null) ✅"
  fi
fi

# ── 4. Clone or update repo ───────────────────────────
echo "📦 [4/5] Getting source code..."
if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  # Preserve .env and data/ across reinstall
  [ -f .env ] && cp .env /tmp/sats-fast-env-backup
  [ -d data ] && cp -r data /tmp/sats-fast-data-backup
  cd /
  rm -rf "$INSTALL_DIR"
elif [ -d "$INSTALL_DIR" ]; then
  echo "  ❌ $INSTALL_DIR already exists but is not a sats.fast install."
  echo "     Remove it manually or choose a different location."
  exit 1
fi
if [ "$IS_MACOS" = "1" ]; then
  : # git clone will create the directory
else
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$USER:$USER" "$INSTALL_DIR"
fi
git clone -q https://github.com/pseudozach/sats.fast.git "$INSTALL_DIR"
cd "$INSTALL_DIR"
# Restore .env and data/ if they existed
[ -f /tmp/sats-fast-env-backup ] && mv /tmp/sats-fast-env-backup "$INSTALL_DIR/.env"
[ -d /tmp/sats-fast-data-backup ] && mv /tmp/sats-fast-data-backup "$INSTALL_DIR/data"
echo "   ✅ Cloned into $INSTALL_DIR"

# ── 5. Install dependencies + build ───────────────────
echo "📦 [5/5] Installing deps + building..."
set +eo pipefail
INSTALL_OUT=$(pnpm install --frozen-lockfile 2>&1)
INSTALL_RC=$?
if [ $INSTALL_RC -ne 0 ]; then
  echo "   Lockfile mismatch (pnpm $(pnpm -v) vs repo lockfile) — running fresh install..."
  INSTALL_OUT=$(pnpm install 2>&1)
  INSTALL_RC=$?
fi
set -eo pipefail
if [ $INSTALL_RC -ne 0 ]; then
  echo "   ❌ pnpm install failed:"
  echo "$INSTALL_OUT" | tail -10
else
  echo "   ✅ Dependencies installed"
fi

# Verify workspace links (pnpm puts them inside each package's node_modules)
if [ -L "$INSTALL_DIR/packages/receipts/node_modules/@sats-fast/shared" ]; then
  echo "   ✅ Workspace links OK"
else
  echo "   ⚠️  Workspace links may be missing — build errors possible"
fi

# Clean stale tsbuildinfo (incremental cache breaks fresh clones)
find "$INSTALL_DIR" -name 'tsconfig.tsbuildinfo' -delete 2>/dev/null || true

# Build each package sequentially in dependency order
echo "   Building packages..."
set +eo pipefail
BUILD_FAIL=0
for pkg in shared policy receipts wallet-spark wallet-liquid agent; do
  BUILD_OUT=$(pnpm --filter "@sats-fast/$pkg" build 2>&1)
  RC=$?
  if [ $RC -ne 0 ]; then
    echo "   ❌ @sats-fast/$pkg FAILED (exit $RC):"
    echo "$BUILD_OUT"
    BUILD_FAIL=1
  else
    echo "   ✅ $pkg"
  fi
done
for app in bot admin; do
  BUILD_OUT=$(pnpm --filter "@sats-fast/$app" build 2>&1)
  RC=$?
  if [ $RC -ne 0 ]; then
    echo "   ❌ @sats-fast/$app FAILED (exit $RC):"
    echo "$BUILD_OUT"
    BUILD_FAIL=1
  else
    echo "   ✅ $app"
  fi
done
set -eo pipefail

if [ "$BUILD_FAIL" = "1" ]; then
  echo ""
  echo "   ⚠️  Some packages failed — check output above"
  echo "   Continuing with what we have..."
else
  echo "   ✅ All packages built"
fi

# ── 6. Interactive configuration ──────────────────────
if [ -f "$INSTALL_DIR/.env" ]; then
  echo ""
  echo "  🔧 Existing .env found at $INSTALL_DIR/.env"
  read -rp "  Reconfigure? (y/N): " RECONFIGURE
  if [[ ! "$RECONFIGURE" =~ ^[Yy]$ ]]; then
    echo "   Keeping existing config ✅"
    SKIP_CONFIG=1
  fi
fi

if [ "${SKIP_CONFIG:-0}" = "0" ]; then
echo ""
echo "  🔧 Configuration"
echo "  ─────────────────────────────────────"
echo ""

read -rp "  Telegram bot token (from @BotFather): " TELEGRAM_BOT_TOKEN
while [ -z "$TELEGRAM_BOT_TOKEN" ]; do
  read -rp "  ⚠️  Required. Telegram bot token: " TELEGRAM_BOT_TOKEN
done

echo ""
echo "  Breez API key is free. Get one at:"
echo "  https://breez.technology/request-api-key/#contact-us-form-sdk"
read -rp "  Breez API key: " BREEZ_API_KEY
while [ -z "$BREEZ_API_KEY" ]; do
  read -rp "  ⚠️  Required. Breez API key: " BREEZ_API_KEY
done

echo ""
read -rp "  Admin username [admin]: " ADMIN_USERNAME
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"

while true; do
  read -rsp "  Admin password: " ADMIN_PASSWORD
  echo ""
  read -rsp "  Confirm password: " ADMIN_PASSWORD2
  echo ""
  if [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD2" ] && [ -n "$ADMIN_PASSWORD" ]; then
    break
  fi
  echo "  ⚠️  Passwords don't match or are empty. Try again."
done

ADMIN_PASSWORD_HASH=$(node -e "const b=require('$INSTALL_DIR/apps/admin/node_modules/bcryptjs');console.log(b.hashSync('$ADMIN_PASSWORD',10))")

echo ""
echo "  AI Provider (users can override per-user)"
read -rp "  Default AI provider [anthropic/openai] (anthropic): " DEFAULT_AI_PROVIDER
DEFAULT_AI_PROVIDER="${DEFAULT_AI_PROVIDER:-anthropic}"

read -rp "  Default AI model (claude-sonnet-4-6): " DEFAULT_AI_MODEL
DEFAULT_AI_MODEL="${DEFAULT_AI_MODEL:-claude-sonnet-4-6}"

read -rp "  AI API key ($DEFAULT_AI_PROVIDER): " DEFAULT_AI_KEY
while [ -z "$DEFAULT_AI_KEY" ]; do
  read -rp "  ⚠️  Required. AI API key: " DEFAULT_AI_KEY
done

echo ""
echo "🔐 Generating encryption keys..."
MASTER_ENCRYPTION_KEY=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
echo "   ✅ Keys generated"

# ── 7. Write .env ────────────────────────────────────
echo "💾 Writing .env file..."
cat > "$INSTALL_DIR/.env" <<EOF
# Generated by install.sh on $(date -u)
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
MASTER_ENCRYPTION_KEY=$MASTER_ENCRYPTION_KEY
BREEZ_API_KEY=$BREEZ_API_KEY
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD_HASH=$ADMIN_PASSWORD_HASH

DEFAULT_AI_PROVIDER=$DEFAULT_AI_PROVIDER
DEFAULT_AI_MODEL=$DEFAULT_AI_MODEL
$([ "$DEFAULT_AI_PROVIDER" = "openai" ] && echo "DEFAULT_OPENAI_KEY=$DEFAULT_AI_KEY" || echo "DEFAULT_ANTHROPIC_KEY=$DEFAULT_AI_KEY")

NODE_ENV=production
PORT=3000
DATA_DIR=$DATA_DIR
DATABASE_URL=$DATA_DIR/sats.db
SESSION_SECRET=$SESSION_SECRET
EOF

chmod 600 "$INSTALL_DIR/.env"
echo "   ✅ .env written to $INSTALL_DIR/.env"
fi # end SKIP_CONFIG

# ── 8. Run migrations ───────────────────────────────
echo ""
echo "🗄️  Running database migrations..."
mkdir -p "$DATA_DIR"
echo "   DATA_DIR=$DATA_DIR"
echo "   DATABASE_URL=$DATA_DIR/sats.db"
export DATABASE_URL="$DATA_DIR/sats.db"
if pnpm db:migrate 2>&1; then
  echo "   ✅ Database ready"
else
  echo "   ❌ Migration failed. Full log:"
  echo "   DATA_DIR=$DATA_DIR"
  echo "   DATABASE_URL=$DATABASE_URL"
  echo "   Retrying with verbose output..."
  cd "$INSTALL_DIR" && pnpm --filter @sats-fast/shared db:migrate 2>&1 || true
  echo "   ⚠️  Migration may have failed — check output above"
fi

# ── 9. Start services ──────────────────────────────────
cd "$INSTALL_DIR"

# Verify dist files exist
if [ ! -f "$INSTALL_DIR/apps/bot/dist/index.js" ]; then
  echo "   ❌ apps/bot/dist/index.js not found — bot build failed"
fi
if [ ! -f "$INSTALL_DIR/apps/admin/dist/index.js" ]; then
  echo "   ❌ apps/admin/dist/index.js not found — admin build failed"
fi

if [ "$IS_MACOS" = "1" ]; then
  echo "🚀 Starting sats.fast..."
  echo ""
  echo "  ─────────────────────────────────────"
  echo "  ✅ sats.fast is installed!"
  echo ""
  echo "  Install dir: $INSTALL_DIR"
  echo "  Admin panel: http://localhost:3000"
  echo ""
  echo "  To start the bot:"
  echo "    cd $INSTALL_DIR && node apps/bot/dist/index.js"
  echo ""
  echo "  To start the admin panel (separate terminal):"
  echo "    cd $INSTALL_DIR && node apps/admin/dist/index.js"
  echo ""
  echo "  To stop: Ctrl+C"
  echo ""
  echo "  ⚠️  Back up your .env file — it contains"
  echo "     your encryption key and credentials."
  echo "  ─────────────────────────────────────"
  echo ""
  echo "🤖 Starting Telegram bot now..."
  echo "   (Press Ctrl+C to stop)"
  echo ""
  cd "$INSTALL_DIR"
  export $(grep -v '^#' .env | xargs)
  export START_SERVER=true
  node apps/bot/dist/index.js
else

echo "🚀 Starting services with pm2..."

set +eo pipefail
pm2 delete sats-fast-bot 2>/dev/null || true
pm2 delete sats-fast-admin 2>/dev/null || true
echo "   Starting pm2 processes..."
pm2 start ecosystem.config.js 2>&1
sleep 3
echo ""
echo "   📋 pm2 status:"
pm2 list
pm2 save > /dev/null 2>&1
SU_CMD=$(pm2 startup 2>&1 | grep 'sudo' | head -1)
if [ -n "$SU_CMD" ]; then
  echo "   Running pm2 startup command..."
  eval "$SU_CMD" > /dev/null 2>&1 || true
fi
set -eo pipefail
echo ""

# ── 10. Nginx reverse proxy ────────────────────────────
echo "🌐 Configuring nginx..."
SERVER_IP=$(curl -4 -s ifconfig.me 2>/dev/null || echo "localhost")

# Nginx config location differs by distro
if [ -d /etc/nginx/sites-available ]; then
  NGINX_CONF="/etc/nginx/sites-available/sats-fast"
  NGINX_LINK="/etc/nginx/sites-enabled/sats-fast"
else
  NGINX_CONF="/etc/nginx/conf.d/sats-fast.conf"
  NGINX_LINK=""
fi

sudo tee "$NGINX_CONF" > /dev/null <<EOF
server {
    listen 80;
    server_name $SERVER_IP;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

if [ -n "$NGINX_LINK" ]; then
  sudo ln -sf "$NGINX_CONF" "$NGINX_LINK"
  sudo rm -f /etc/nginx/sites-enabled/default
fi

sudo nginx -t > /dev/null 2>&1 && sudo systemctl enable nginx > /dev/null 2>&1 && sudo systemctl reload nginx > /dev/null 2>&1
echo "   ✅ Nginx → http://$SERVER_IP/"

# ── Done! ──────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────"
echo "  ✅ sats.fast is running!"
echo ""
echo "  Admin panel:  http://$SERVER_IP/"
echo "  Telegram bot: running via pm2"
echo ""
echo "  Bot logs:   pm2 logs sats-fast-bot"
echo "  Admin logs: pm2 logs sats-fast-admin"
echo "  Stop:       pm2 stop all"
echo "  Status:     pm2 status"
echo ""
echo "  ⚠️  Back up your .env file — it contains"
echo "     your encryption key and credentials."
echo "  ─────────────────────────────────────"
echo ""

fi # end macOS/Linux branch

} # end main

main "$@"
