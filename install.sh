#!/usr/bin/env bash
# Nemesis HA Console -- Install script (Linux / macOS / WSL)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$ROOT/frontend"
MIN_NODE=18

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "  ${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "  ${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "  ${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "  ${RED}[ERR ]${NC}  $*"; exit 1; }

echo ""
echo -e "  ${BOLD}Nemesis HA Console v1.0 -- Install${NC}"
echo "  ===================================="
echo ""

# ── Node.js check ─────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    err "Node.js not found. Install v${MIN_NODE}+ from https://nodejs.org"
fi

NODE_MAJOR=$(node -e "console.log(+process.version.slice(1).split('.')[0])")
if [ "$NODE_MAJOR" -lt "$MIN_NODE" ]; then
    err "Node.js v${MIN_NODE}+ required. Current: $(node --version)"
fi
ok "Node.js $(node --version)"

if ! command -v npm &>/dev/null; then
    err "npm not found. Reinstall Node.js."
fi
ok "npm $(npm --version)"

# ── Frontend dependencies ─────────────────────────────────────
info "Installing frontend dependencies..."
if ! cd "$FRONTEND" && npm install; then
    err "npm install failed. Check network or package.json."
fi
cd "$ROOT"
ok "Frontend dependencies installed"

# ── Make scripts executable ───────────────────────────────────
chmod +x "$ROOT/nemesis.sh"
ok "nemesis.sh marked executable"

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}Installation complete!${NC}"
echo ""
echo "  Commands:"
echo "    ./nemesis.sh start    -- start both servers"
echo "    ./nemesis.sh stop     -- stop all servers"
echo "    ./nemesis.sh restart  -- restart"
echo "    ./nemesis.sh status   -- show running status"
echo "    ./nemesis.sh logs     -- tail logs (Ctrl+C to exit)"
echo ""
