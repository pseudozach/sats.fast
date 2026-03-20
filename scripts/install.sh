#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
#  sats.fast installer
#  Target: Ubuntu 22+, Debian 12+, Amazon Linux 2023, RHEL/Fedora
#  Usage:  curl -sSL https://raw.githubusercontent.com/pseudozach/sats.fast/main/scripts/install.sh | bash
# ─────────────────────────────────────────────────────────

main() {

INSTALL_DIR="/opt/sats-fast"
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
            echo "  ❌ No supported package manager found (apt/dnf/yum)."
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

# ── 2. Node.js 22 ────────────────────────────────────
if command -v node &>/dev/null && [[ $(node -v | cut -d. -f1 | tr -d 'v') -ge 22 ]]; then
  echo "📦 [2/5] Node.js $(node -v) — already installed ✅"
else
  echo "📦 [2/5] Installing Node.js 22..."
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
  echo "   ✅ Node.js $(node -v)"
fi

# ── 3. pnpm + pm2 ─────────────────────────────────────
echo "📦 [3/5] Checking pnpm + pm2..."
if command -v pnpm &>/dev/null; then
  echo "   pnpm $(pnpm -v) ✅"
else
  echo "   Installing pnpm..."
  sudo npm install -g pnpm > /dev/null 2>&1
  echo "   pnpm $(pnpm -v) ✅"
fi
if command -v pm2 &>/dev/null; then
  echo "   pm2 $(pm2 -v 2>/dev/null) ✅"
else
  echo "   Installing pm2..."
  sudo npm install -g pm2 > /dev/null 2>&1
  echo "   pm2 $(pm2 -v 2>/dev/null) ✅"
fi

# ── 4. Clone or update repo ───────────────────────────
echo "📦 [4/5] Getting source code..."
if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  # Preserve .env and data/ across reinstall
  [ -f .env ] && cp .env /tmp/sats-fast-env-backup
  [ -d data ] && cp -r data /tmp/sats-fast-data-backup
  cd /
  sudo rm -rf "$INSTALL_DIR"
fi
sudo mkdir -p "$INSTALL_DIR"
sudo chown "$USER:$USER" "$INSTALL_DIR"
git clone -q https://github.com/pseudozach/sats.fast.git "$INSTALL_DIR"
cd "$INSTALL_DIR"
# Restore .env and data/ if they existed
[ -f /tmp/sats-fast-env-backup ] && mv /tmp/sats-fast-env-backup "$INSTALL_DIR/.env"
[ -d /tmp/sats-fast-data-backup ] && mv /tmp/sats-fast-data-backup "$INSTALL_DIR/data"
echo "   ✅ Cloned into $INSTALL_DIR"

# ── 5. Install dependencies + build ───────────────────
echo "📦 [5/5] Installing deps + building..."
pnpm install --frozen-lockfile > /dev/null 2>&1 || pnpm install --silent 2>&1 | tail -1
echo "   ✅ Dependencies installed"
pnpm build 2>&1 | grep -E '(Done|Build success|error)' || true
echo "   ✅ Build complete"

# ── 6. Interactive configuration ──────────────────────
if [ -f "$INSTALL_DIR/.env" ]; then
  echo ""
  echo "  🔧 Existing .env found at $INSTALL_DIR/.env"
  read -rp "  Reconfigure? (y/N): " RECONFIGURE
  if [[ ! "$RECONFIGURE" =~ ^[Yy]$ ]]; then
    echo "   Keeping existing config ✅"
    # Source existing values for migration/pm2 steps
    export $(grep -v '^#' "$INSTALL_DIR/.env" | xargs) 2>/dev/null || true
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

read -rp "  Default AI model (claude-sonnet-4-20250514): " DEFAULT_AI_MODEL
DEFAULT_AI_MODEL="${DEFAULT_AI_MODEL:-claude-sonnet-4-20250514}"

read -rp "  Default AI API key (optional, users can set their own): " DEFAULT_AI_KEY

echo ""
echo "🔐 Generating encryption keys..."
MASTER_ENCRYPTION_KEY=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
echo "   ✅ Keys generated"

# ── 7. Write .env ────────────────────────────────────
echo "💾 Writing .env file..."──
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
pnpm db:migrate 2>&1 | tail -2
echo "   ✅ Database ready"

# ── 9. pm2 ─────────────────────────────────────────────
echo "🚀 Starting services with pm2..."
pm2 delete sats-fast-bot > /dev/null 2>&1 || true
pm2 delete sats-fast-admin > /dev/null 2>&1 || true
pm2 start ecosystem.config.js > /dev/null 2>&1
pm2 save > /dev/null 2>&1
pm2 startup -u "$USER" --hp "$HOME" > /dev/null 2>&1 || true
echo "   ✅ pm2 started + configured"

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
echo "  Logs:   pm2 logs"
echo "  Stop:   pm2 stop all"
echo "  Status: pm2 status"
echo ""
echo "  ⚠️  Back up your .env file — it contains"
echo "     your encryption key and credentials."
echo "  ─────────────────────────────────────"
echo ""

} # end main

main "$@"
