#!/usr/bin/env bash
# Nemesis HA Console -- start / stop / restart / status / logs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$ROOT/frontend"
API_PORT=18080
UI_PORT=5174
API_LOG="$ROOT/api.log"
UI_LOG="$ROOT/ui.log"
API_PID="$ROOT/.api.pid"
UI_PID="$ROOT/.ui.pid"
API_PORT_FILE="$ROOT/.api.port"
UI_PORT_FILE="$ROOT/.ui.port"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "  ${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "  ${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "  ${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "  ${RED}[ERR ]${NC}  $*"; }

port_in_use() {
    lsof -ti tcp:"$1" &>/dev/null
}

# Find the first free TCP port at or above $1
find_free_port() {
    local p="$1"
    while lsof -ti tcp:"$p" &>/dev/null; do
        p=$((p+1))
    done
    echo "$p"
}

read_pid() {
    [ -f "$1" ] && cat "$1" || echo ""
}

is_running() {
    local pid; pid=$(read_pid "$1")
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# ── START ──────────────────────────────────────────────────────
cmd_start() {
    echo ""
    echo -e "  ${BOLD}Nemesis HA Console v1.0${NC}"
    echo "  ========================"
    echo ""

    if ! command -v node &>/dev/null; then
        err "Node.js not found. Run ./install.sh first."
        exit 1
    fi
    info "Node.js $(node --version)"

    if [ ! -d "$FRONTEND/node_modules/vite" ]; then
        info "node_modules not found -- running npm install..."
        (cd "$FRONTEND" && npm install) || { err "npm install failed"; exit 1; }
        ok "Dependencies installed"
    fi

    # Mock API
    if is_running "$API_PID"; then
        warn "Mock API already running (PID $(read_pid "$API_PID"))"
    elif port_in_use "$API_PORT"; then
        warn "Port $API_PORT in use by another process"
    else
        info "Starting Mock API on port $API_PORT..."
        node "$ROOT/mock-api.js" >> "$API_LOG" 2>&1 &
        echo $! > "$API_PID"
        echo "$API_PORT" > "$API_PORT_FILE"
        sleep 1
        if is_running "$API_PID"; then
            ok "Mock API started  (PID $(read_pid "$API_PID"))"
        else
            err "Mock API failed. Check: $API_LOG"
            exit 1
        fi
    fi

    # Vite UI
    if is_running "$UI_PID"; then
        warn "Vite UI already running (PID $(read_pid "$UI_PID"))"
    else
        if port_in_use "$UI_PORT"; then
            local newport; newport=$(find_free_port "$UI_PORT")
            warn "Port $UI_PORT in use by another process -- using port $newport instead"
            UI_PORT="$newport"
        fi
        info "Starting Vite UI on port $UI_PORT..."
        (cd "$FRONTEND" && npx vite --host --port "$UI_PORT" --strictPort >> "$UI_LOG" 2>&1) &
        echo $! > "$UI_PID"
        echo "$UI_PORT" > "$UI_PORT_FILE"
        sleep 3
        if is_running "$UI_PID"; then
            ok "Vite UI started   (PID $(read_pid "$UI_PID"))  port=$UI_PORT"
        else
            err "Vite UI failed. Check: $UI_LOG"
            exit 1
        fi
    fi

    echo ""
    echo -e "  ${GREEN}${BOLD}Nemesis HA Console is running${NC}"
    echo -e "  UI  : ${CYAN}http://localhost:$UI_PORT${NC}"
    echo -e "  API : ${CYAN}http://localhost:$API_PORT${NC}"
    echo ""
    echo "  Stop : ./nemesis.sh stop"
    echo "  Logs : ./nemesis.sh logs"
    echo ""

    command -v xdg-open &>/dev/null && xdg-open "http://localhost:$UI_PORT" &>/dev/null & true
    command -v open     &>/dev/null && open     "http://localhost:$UI_PORT" &>/dev/null & true
}

# ── STOP ───────────────────────────────────────────────────────
cmd_stop() {
    info "Stopping Nemesis servers..."
    local stopped=0

    for entry in "$API_PID Mock API" "$UI_PID Vite UI"; do
        local pidfile label
        pidfile=$(echo "$entry" | awk '{print $1}')
        label=$(echo "$entry" | awk '{$1=""; print $0}' | xargs)
        if is_running "$pidfile"; then
            local pid; pid=$(read_pid "$pidfile")
            kill "$pid" 2>/dev/null || true
            ok "$label stopped (PID $pid)"
            rm -f "$pidfile"
            stopped=$((stopped+1))
        fi
    done

    # Only clean up ports WE recorded on start -- never blindly kill whatever
    # happens to sit on the default 5173/18080 (could be another project).
    for portfile in "$API_PORT_FILE" "$UI_PORT_FILE"; do
        [ -f "$portfile" ] || continue
        local port; port=$(cat "$portfile" 2>/dev/null || true)
        rm -f "$portfile"
        [ -n "$port" ] || continue
        local pids; pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo "$pids" | xargs kill -9 2>/dev/null || true
            ok "Killed leftover process on port $port"
            stopped=$((stopped+1))
        fi
    done

    if [ "$stopped" -eq 0 ]; then
        warn "No running Nemesis processes found"
    else
        ok "All stopped"
    fi
}

# ── RESTART ────────────────────────────────────────────────────
cmd_restart() {
    cmd_stop
    sleep 1
    cmd_start
}

# ── STATUS ─────────────────────────────────────────────────────
cmd_status() {
    echo ""
    echo -e "  ${BOLD}Nemesis HA Console -- Status${NC}"
    echo "  --------------------------------"

    if is_running "$API_PID"; then
        echo -e "  Mock API  :  ${GREEN}RUNNING${NC}  PID=$(read_pid "$API_PID")  port=$API_PORT"
    elif port_in_use "$API_PORT"; then
        echo -e "  Mock API  :  ${YELLOW}PORT IN USE${NC}  port=$API_PORT"
    else
        echo -e "  Mock API  :  ${RED}STOPPED${NC}  port=$API_PORT"
    fi

    if is_running "$UI_PID"; then
        echo -e "  Vite UI   :  ${GREEN}RUNNING${NC}  PID=$(read_pid "$UI_PID")  port=$UI_PORT"
    elif port_in_use "$UI_PORT"; then
        echo -e "  Vite UI   :  ${YELLOW}PORT IN USE${NC}  port=$UI_PORT"
    else
        echo -e "  Vite UI   :  ${RED}STOPPED${NC}  port=$UI_PORT"
    fi

    echo "  --------------------------------"
    echo "  Logs: api.log  ui.log"
    echo ""
}

# ── LOGS ───────────────────────────────────────────────────────
cmd_logs() {
    local target="${2:-all}"
    if   [ "$target" = "api" ]; then tail -f "$API_LOG"
    elif [ "$target" = "ui"  ]; then tail -f "$UI_LOG"
    else
        echo -e "  ${CYAN}=== api.log + ui.log (Ctrl+C to exit) ===${NC}"
        tail -f "$API_LOG" "$UI_LOG"
    fi
}

# ── Main ───────────────────────────────────────────────────────
CMD="${1:-help}"
case "$CMD" in
    start)   cmd_start   ;;
    stop)    cmd_stop    ;;
    restart) cmd_restart ;;
    status)  cmd_status  ;;
    logs)    cmd_logs "$@" ;;
    *)
        echo ""
        echo "  Usage: ./nemesis.sh <command>"
        echo ""
        echo "  Commands:"
        echo "    start    -- start Mock API + Vite UI"
        echo "    stop     -- stop all servers"
        echo "    restart  -- restart all servers"
        echo "    status   -- show running status"
        echo "    logs     -- tail logs  (optional: api | ui)"
        echo ""
        ;;
esac
