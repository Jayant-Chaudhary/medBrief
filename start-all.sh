#!/usr/bin/env bash
# ==============================================================================
# MedBrief All-Servers Launcher
# Starts all local MedBrief services, tails logs, and cleans up on Ctrl+C.
#
# Usage:
#   ./start-all.sh              # Start all available services
#   ./start-all.sh --core-only  # Skip Community services & OCR
#   ./start-all.sh --with-ocr   # Also start Docker PaddleOCR (port 8000) if not running
#   ./start-all.sh --with-redis # Also start Docker Redis cache (port 6379)
#   ./start-all.sh --stop       # Stop any processes/containers started on known ports
#   ./start-all.sh --status     # Check health & port status of all services
# ==============================================================================

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIVATE_ENV_DIR="${MEDBRIEF_PRIVATE_DIR:-$HOME/medbrief-private}"
if [ ! -d "$PRIVATE_ENV_DIR" ] && [ -d "/home/jayant/medbrief-private" ]; then
  PRIVATE_ENV_DIR="/home/jayant/medbrief-private"
fi
LOG_DIR="$ROOT_DIR/.logs"
mkdir -p "$LOG_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

# Ensure Node 20+ / 24 is used (required for --env-file support)
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use 24 >/dev/null 2>&1 || true
elif [ -s "/home/jayant/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "/home/jayant/.nvm/nvm.sh"
  nvm use 24 >/dev/null 2>&1 || true
fi

if [ -x "/home/jayant/.nvm/versions/node/v24.14.0/bin/node" ]; then
  export PATH="/home/jayant/.nvm/versions/node/v24.14.0/bin:$PATH"
fi

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"

if [ -z "$NODE_BIN" ]; then
  echo -e "${RED}[ERROR] Node.js not found in PATH.${NC}"
  exit 1
fi

# Flags
CORE_ONLY=false
START_OCR_DOCKER=false
START_REDIS_DOCKER=false
SAFETY_MODE="bypass" # "bypass" (default, no Ollama needed) or "ollama"
ACTION="start"

for arg in "$@"; do
  case "$arg" in
    --core-only)
      CORE_ONLY=true
      ;;
    --with-ocr)
      START_OCR_DOCKER=true
      ;;
    --with-redis)
      START_REDIS_DOCKER=true
      ;;
    --ollama|--full-safety)
      SAFETY_MODE="ollama"
      ;;
    --stop)
      ACTION="stop"
      ;;
    --status)
      ACTION="status"
      ;;
    --help|-h)
      echo -e "${BOLD}MedBrief All-Servers Launcher${NC}"
      echo ""
      echo "Usage: ./start-all.sh [options]"
      echo ""
      echo "Options:"
      echo "  --core-only     Start only Backend API (4000), React Client (5173), and Whisper STT (8001)"
      echo "  --with-ocr      Also start PaddleOCR via Docker Compose on port 8000 if not already running"
      echo "  --with-redis    Also start Redis audio cache via Docker Compose on port 6379"
      echo "  --ollama        Run Community Safety Service in full Ollama mode instead of LLM bypass mode"
      echo "  --status        Show listening status and health checks for all services"
      echo "  --stop          Stop running MedBrief services on ports 4000, 4101, 4102, 5173, 8001"
      echo "  -h, --help      Show this help message"
      exit 0
      ;;
  esac
done

is_port_in_use() {
  local port="$1"
  ss -ltn 2>/dev/null | grep -qE ":${port}[[:space:]]"
}

check_status() {
  echo -e "\n${BOLD}=== MedBrief Service Status ===${NC}"
  printf "%-32s %-10s %-12s %s\n" "SERVICE" "PORT" "STATE" "HEALTH / NOTES"
  printf "%-32s %-10s %-12s %s\n" "-------" "----" "-----" "--------------"

  # 1. Public Node API (4000)
  if is_port_in_use 4000; then
    local api_health
    api_health="$(curl -s --max-time 2 http://localhost:4000/health || echo "unreachable")"
    printf "%-32s %-10s ${GREEN}%-12s${NC} %s\n" "Public Node API" "4000" "RUNNING" "$api_health"
  else
    printf "%-32s %-10s ${RED}%-12s${NC} %s\n" "Public Node API" "4000" "STOPPED" "-"
  fi

  # 2. React Dashboard (5173)
  if is_port_in_use 5173; then
    printf "%-32s %-10s ${GREEN}%-12s${NC} %s\n" "React Doctor Dashboard" "5173" "RUNNING" "http://localhost:5173"
  else
    printf "%-32s %-10s ${RED}%-12s${NC} %s\n" "React Doctor Dashboard" "5173" "STOPPED" "-"
  fi

  # 3. Whisper STT (8001)
  if is_port_in_use 8001; then
    local whisper_health
    whisper_health="$(curl -s --max-time 2 http://localhost:8001/health || echo "running")"
    printf "%-32s %-10s ${GREEN}%-12s${NC} %s\n" "Whisper STT Service" "8001" "RUNNING" "$whisper_health"
  else
    printf "%-32s %-10s ${RED}%-12s${NC} %s\n" "Whisper STT Service" "8001" "STOPPED" "-"
  fi

  # 4. Community Identity (4101)
  if is_port_in_use 4101; then
    printf "%-32s %-10s ${GREEN}%-12s${NC} %s\n" "Community Identity Service" "4101" "RUNNING" "127.0.0.1:4101"
  else
    printf "%-32s %-10s ${YELLOW}%-12s${NC} %s\n" "Community Identity Service" "4101" "STOPPED" "-"
  fi

  # 5. Community Safety (4102)
  if is_port_in_use 4102; then
    printf "%-32s %-10s ${GREEN}%-12s${NC} %s\n" "Community Safety Service" "4102" "RUNNING" "127.0.0.1:4102"
  else
    printf "%-32s %-10s ${YELLOW}%-12s${NC} %s\n" "Community Safety Service" "4102" "STOPPED" "-"
  fi

  # 6. OCR Service (8000)
  if is_port_in_use 8000; then
    local ocr_health
    ocr_health="$(curl -s --max-time 2 http://127.0.0.1:8000/health || echo "running")"
    printf "%-32s %-10s ${GREEN}%-12s${NC} %s\n" "PaddleOCR FastAPI" "8000" "RUNNING" "$ocr_health"
  else
    printf "%-32s %-10s ${YELLOW}%-12s${NC} %s\n" "PaddleOCR FastAPI" "8000" "STOPPED" "Use --with-ocr to start"
  fi

  # 7. Redis Cache (6379)
  if is_port_in_use 6379; then
    printf "%-32s %-10s ${GREEN}%-12s${NC} %s\n" "Redis Audio Cache" "6379" "RUNNING" "127.0.0.1:6379"
  else
    printf "%-32s %-10s ${YELLOW}%-12s${NC} %s\n" "Redis Audio Cache" "6379" "STOPPED" "Optional (--with-redis)"
  fi
  echo ""
}

stop_existing() {
  echo -e "${YELLOW}Stopping running MedBrief processes...${NC}"
  if [ -f "$LOG_DIR/pids.txt" ]; then
    while read -r pid; do
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    done < "$LOG_DIR/pids.txt"
    rm -f "$LOG_DIR/pids.txt"
  fi

  # Also clean up by port if still listening
  for port in 4000 4101 4102 5173 8001; do
    local pids
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo -e "  Stopping process on port ${port} (PID: ${pids})"
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
    fi
  done
  echo -e "${GREEN}Done.${NC}"
}

if [ "$ACTION" = "status" ]; then
  check_status
  exit 0
fi

if [ "$ACTION" = "stop" ]; then
  stop_existing
  exit 0
fi

# Track child PIDs for clean shutdown
declare -a PIDS=()
: > "$LOG_DIR/pids.txt"

cleanup() {
  echo -e "\n${YELLOW}Shutting down servers started by this script...${NC}"
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  rm -f "$LOG_DIR/pids.txt"
  echo -e "${GREEN}All foreground services stopped.${NC}"
  exit 0
}

trap cleanup SIGINT SIGTERM

start_bg() {
  local name="$1"
  local color="$2"
  local logfile="$3"
  shift 3

  : > "$logfile"
  (
    "$@" 2>&1 | while IFS= read -r line; do
      printf "${color}[%-16s]${NC} %s\n" "$name" "$line"
      printf "%s\n" "$line" >> "$logfile"
    done
  ) &
  local pid=$!
  PIDS+=("$pid")
  echo "$pid" >> "$LOG_DIR/pids.txt"
}

echo -e "${BOLD}==============================================================${NC}"
echo -e "${BOLD}  Starting MedBrief Local Development Servers                 ${NC}"
echo -e "${BOLD}  Node: $($NODE_BIN --version) ($NODE_BIN)${NC}"
echo -e "${BOLD}==============================================================${NC}"

# ------------------------------------------------------------------------------
# 1. Optional Docker Services (Redis & OCR)
# ------------------------------------------------------------------------------
if [ "$START_REDIS_DOCKER" = true ]; then
  if is_port_in_use 6379; then
    echo -e "${GREEN}[Redis]${NC} Port 6379 already listening."
  elif command -v docker >/dev/null 2>&1; then
    echo -e "${CYAN}[Redis]${NC} Starting Redis container via docker compose..."
    (cd "$ROOT_DIR/server" && docker compose -f docker-compose.redis.yml up -d) || \
      echo -e "${YELLOW}[Redis] Warning: Failed to start Redis container.${NC}"
  fi
fi

if [ "$START_OCR_DOCKER" = true ]; then
  if is_port_in_use 8000; then
    echo -e "${GREEN}[OCR]${NC} Port 8000 already listening."
  elif [ -x "$ROOT_DIR/PaddleOCRFastAPI/.venv/bin/python" ]; then
    echo -e "${CYAN}[OCR]${NC} Starting PaddleOCR from local .venv on port 8000..."
    start_bg "OCR:8000" "$CYAN" "$LOG_DIR/ocr.log" \
      bash -c "cd '$ROOT_DIR/PaddleOCRFastAPI' && exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1"
  elif command -v docker >/dev/null 2>&1; then
    echo -e "${CYAN}[OCR]${NC} Starting PaddleOCR container via docker compose on port 8000..."
    (cd "$ROOT_DIR" && docker compose -f PaddleOCRFastAPI/docker-compose.yml up -d) || \
      echo -e "${YELLOW}[OCR] Warning: Failed to start PaddleOCR container.${NC}"
  fi
elif [ -x "$ROOT_DIR/PaddleOCRFastAPI/.venv/bin/python" ] && ! is_port_in_use 8000 && [ "$CORE_ONLY" = false ]; then
  echo -e "${CYAN}[OCR]${NC} Starting PaddleOCR from local .venv on port 8000..."
  start_bg "OCR:8000" "$CYAN" "$LOG_DIR/ocr.log" \
    bash -c "cd '$ROOT_DIR/PaddleOCRFastAPI' && exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1"
fi

# ------------------------------------------------------------------------------
# 2. Community Services (Identity, Safety, Worker)
# ------------------------------------------------------------------------------
if [ "$CORE_ONLY" = false ]; then
  # Community Identity Service (Port 4101)
  if is_port_in_use 4101; then
    echo -e "${GREEN}[Identity:4101]${NC} Already running on port 4101."
  elif [ -f "$PRIVATE_ENV_DIR/identity.env" ]; then
    echo -e "${MAGENTA}[Identity:4101]${NC} Starting Community Identity Service..."
    start_bg "Identity:4101" "$MAGENTA" "$LOG_DIR/identity.log" \
      bash -c "cd '$ROOT_DIR/server' && exec '$NODE_BIN' --env-file='$PRIVATE_ENV_DIR/identity.env' src/community/identity-service.js"
  else
    echo -e "${YELLOW}[Identity:4101] Skipped ($PRIVATE_ENV_DIR/identity.env not found).${NC}"
  fi

  # Community Safety Service (Port 4102)
  if is_port_in_use 4102; then
    echo -e "${GREEN}[Safety:4102]${NC} Already running on port 4102."
  elif [ -f "$PRIVATE_ENV_DIR/saftey.env" ]; then
    if [ "$SAFETY_MODE" = "ollama" ]; then
      echo -e "${MAGENTA}[Safety:4102]${NC} Starting Community Safety Service (Ollama mode)..."
      start_bg "Safety:4102" "$MAGENTA" "$LOG_DIR/safety.log" \
        bash -c "cd '$ROOT_DIR/server' && COMMUNITY_LLM_BYPASS=false exec '$NODE_BIN' --env-file='$PRIVATE_ENV_DIR/saftey.env' src/community/safety-service.js"
    else
      echo -e "${MAGENTA}[Safety:4102]${NC} Starting Community Safety Service (LLM bypass development mode)..."
      start_bg "Safety:4102" "$MAGENTA" "$LOG_DIR/safety.log" \
        bash -c "cd '$ROOT_DIR/server' && NODE_ENV=development COMMUNITY_LLM_BYPASS=true exec '$NODE_BIN' --env-file='$PRIVATE_ENV_DIR/saftey.env' src/community/safety-service.js"
    fi
  else
    echo -e "${YELLOW}[Safety:4102] Skipped ($PRIVATE_ENV_DIR/saftey.env not found).${NC}"
  fi

  # Community Worker polling loop
  if [ -f "$PRIVATE_ENV_DIR/jobs.env" ]; then
    echo -e "${BLUE}[Worker]${NC} Starting Community Jobs Worker loop (every 10s)..."
    start_bg "CommunityWorker" "$BLUE" "$LOG_DIR/community-worker.log" \
      bash -c "cd '$ROOT_DIR/server' && while true; do '$NODE_BIN' --env-file='$PRIVATE_ENV_DIR/jobs.env' src/community/worker.js; sleep 10; done"
  else
    echo -e "${YELLOW}[Worker] Skipped ($PRIVATE_ENV_DIR/jobs.env not found).${NC}"
  fi
fi

# ------------------------------------------------------------------------------
# 3. Local Whisper STT Microservice (Port 8001)
# ------------------------------------------------------------------------------
if is_port_in_use 8001; then
  echo -e "${GREEN}[Whisper:8001]${NC} Already running on port 8001."
elif [ -x "$ROOT_DIR/whisper-service/run.sh" ]; then
  echo -e "${CYAN}[Whisper:8001]${NC} Starting Local Whisper STT Service..."
  start_bg "Whisper:8001" "$CYAN" "$LOG_DIR/whisper.log" \
    bash "$ROOT_DIR/whisper-service/run.sh"
else
  echo -e "${YELLOW}[Whisper:8001] Skipped (whisper-service/run.sh not found or not executable).${NC}"
fi

# ------------------------------------------------------------------------------
# 4. Public Node.js Backend API (Port 4000)
# ------------------------------------------------------------------------------
if is_port_in_use 4000; then
  echo -e "${GREEN}[API:4000]${NC} Already running on port 4000."
else
  echo -e "${GREEN}[API:4000]${NC} Starting Public Node API (server)..."
  start_bg "API:4000" "$GREEN" "$LOG_DIR/server.log" \
    bash -c "cd '$ROOT_DIR/server' && exec '$NPM_BIN' run dev"
fi

# ------------------------------------------------------------------------------
# 5. React Doctor Dashboard (Port 5173)
# ------------------------------------------------------------------------------
if is_port_in_use 5173; then
  echo -e "${GREEN}[Client:5173]${NC} Already running on port 5173."
else
  echo -e "${BLUE}[Client:5173]${NC} Starting React Doctor Dashboard (Vite)..."
  start_bg "Client:5173" "$BLUE" "$LOG_DIR/client.log" \
    bash -c "cd '$ROOT_DIR/client' && exec '$NPM_BIN' run dev"
fi

# Give services a moment to bind ports, then show status summary
sleep 3
check_status

if [ "${#PIDS[@]}" -eq 0 ]; then
  echo -e "${GREEN}All target services were already running.${NC}"
  exit 0
fi

echo -e "${BOLD}Logs are streaming below (and saved in ${LOG_DIR}/). Press Ctrl+C to stop all servers.${NC}\n"
wait

