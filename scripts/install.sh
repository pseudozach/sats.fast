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
echo "📦 [1/5] Installing system packages..."
case "$PKG_MANAGER" in
  apt)
    sudo apt-get update -qq 2>&1 | tail -1
    sudo apt-get install -y -qq git curl sqlite3 nginx build-essential openssl > /dev/null
    ;;
  dnf)
    # Amazon Linux ships curl-minimal which conflicts with curl — skip it
    sudo dnf install -q -y git sqlite nginx gcc gcc-c++ make openssl 2>&1 | grep -v "already installed" || true
    ;;
  yum)
    sudo yum install -q -y git sqlite nginx gcc gcc-c++ make openssl 2>&1 | grep -v "already installed" || true
    ;;
esac
echo "   ✅ System packages installed"

# ── 2. Node.js 22 ────────────────────────────────────
echo "📦 [2/5] Checking Node.js..."
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 22 ]]; then
  echo "   Installing Node.js 22..."
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

# ── 3. pnpm + pm2 ─────────────────────────────────────
echo "📦 [3/5] Checking pnpm + pm2..."
if ! command -v pnpm &>/dev/null; then
  echo "   Installing pnpm..."
  sudo npm install -g pnpm > /dev/null 2>&1
fi
echo "   ✅ pnpm $(pnpm -v)"
if ! command -v pm2 &>/dev/null; then
  echo "   Installing pm2..."
  sudo npm install -g pm2 > /dev/null 2>&1
fi
echo "   ✅ pm2 $(pm2 -v 2>/dev/null || echo 'installed')"

# ── 4. Clone or update repo ───────────────────────────
echo "📦 [4/5] Getting source code..."
if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  git pull --rebase -q
  echo "   ✅ Updated to latest"
else
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$USER:$USER" "$INSTALL_DIR"
  git clone -q https://github.com/pseudozach/sats.fast.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  echo "   ✅ Cloned into $INSTALL_DIR"
fi

# ── 5. Install dependencies + build ───────────────────
echo "📦 [5/5] Installing deps + building..."
pnpm install --frozen-lockfile > /dev/null 2>&1 || pnpm install --silent 2>&1 | tail -1
echo "   ✅ Dependencies installed"
pnpm build 2>&1 | grep -E '(Done|Build success|error)' || true
echo "   ✅ Build complete"

# ── 6. Interactive configuration ──────────────────────
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

ADMIN_PASSWORD_HASH=$(node -e "const b=require('bcryptjs');console.log(b.hashSync('$ADMIN_PASSWORD',10))")

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

# ── 8. Run migrations ───────────────────────────────
echo ""
echo "🗄️  Running database migrations..."
mkdir -p "$DATA_DIR"
pnpm db:migrate
echo "   ✅ Database ready at $DATA_DIR/sats.db"

# ── 9. pm2 ─────────────────────────────────────────────
echo ""
echo "🚀 Starting services with pm2..."
pm2 delete sats-fast-bot 2>/dev/null || true
pm2 delete sats-fast-admin 2>/dev/null || true
pm2 start ecosystem.config.js
echo "   ✅ Bot and admin panel started"
echo "   Saving pm2 config..."
pm2 save
pm2 startup -u "$USER" --hp "$HOME" 2>/dev/null || true
echo "   ✅ pm2 configured for auto-restart"

# ── 10. Nginx reverse proxy ────────────────────────────
echo ""
echo "🌐 Configuring nginx reverse proxy..."
SERVER_IP=$(curl -4 -s ifconfig.me 2>/dev/null || echo "localhost")
echo "   Server IP: $SERVER_IP"

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

sudo nginx -t && sudo systemctl enable nginx && sudo systemctl reload nginx
echo "   ✅ Nginx configured"

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
