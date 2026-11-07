#!/usr/bin/env bash
# ==============================================================================
# Health-On (MedBrief) Automated Setup Script for Linux & macOS
#
# Sets up dependencies, copies template environment files, creates Python
# virtual environments, installs npm packages, and prepares the workspace.
# ==============================================================================

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Text styles
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "\n${BOLD}${CYAN}================================================================${NC}"
echo -e "${BOLD}${CYAN}        Health-On (MedBrief) Auto-Setup (Linux / macOS)        ${NC}"
echo -e "${BOLD}${CYAN}================================================================${NC}\n"

# ------------------------------------------------------------------------------
# 1. Environment & Prerequisite Checks
# ------------------------------------------------------------------------------
echo -e "${BOLD}[1/6] Checking system prerequisites...${NC}"

# Check and source NVM if available
if [ -z "${NODE_BIN:-}" ]; then
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1091
    source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm use 24 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
  elif [ -s "/home/jayant/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    source "/home/jayant/.nvm/nvm.sh"
    nvm use 24 >/dev/null 2>&1 || true
  fi
fi

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
PYTHON_BIN="$(command -v python3 || command -v python || true)"
GIT_BIN="$(command -v git || true)"
DOCKER_BIN="$(command -v docker || true)"
FLUTTER_BIN="$(command -v flutter || true)"

if [ -z "$NODE_BIN" ]; then
  echo -e "${RED}[ERROR] Node.js is not installed or not in PATH.${NC}"
  echo -e "Please install Node.js 20+ (recommended: v24). Using nvm:"
  echo -e "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  echo -e "  nvm install 24 && nvm use 24"
  exit 1
fi

NODE_VERSION="$("$NODE_BIN" -v | sed 's/v//')"
NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d'.' -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo -e "${YELLOW}[WARNING] Node.js v${NODE_VERSION} detected. Version >= 20.12.0 or 24 is required for native --env-file support.${NC}"
else
  echo -e "  ${GREEN}✓${NC} Node.js v${NODE_VERSION} detected (${NODE_BIN})"
fi

if [ -z "$NPM_BIN" ]; then
  echo -e "${RED}[ERROR] npm is not installed.${NC}"
  exit 1
else
  echo -e "  ${GREEN}✓${NC} npm v$("$NPM_BIN" -v) detected"
fi

if [ -z "$PYTHON_BIN" ]; then
  echo -e "${YELLOW}[WARNING] Python 3 not found. Local OCR and Whisper microservices will be skipped.${NC}"
else
  PY_VER="$("$PYTHON_BIN" --version 2>&1 | awk '{print $2}')"
  echo -e "  ${GREEN}✓${NC} Python ${PY_VER} detected (${PYTHON_BIN})"
fi

if [ -n "$DOCKER_BIN" ]; then
  echo -e "  ${GREEN}✓${NC} Docker detected (${DOCKER_BIN})"
else
  echo -e "  ${YELLOW}ℹ${NC} Docker not found (optional, for Redis cache and containerized OCR)"
fi

if [ -n "$FLUTTER_BIN" ]; then
  echo -e "  ${GREEN}✓${NC} Flutter SDK detected (${FLUTTER_BIN})"
else
  echo -e "  ${YELLOW}ℹ${NC} Flutter not found (optional, only needed for mobile patient app development)"
fi

# ------------------------------------------------------------------------------
# 2. Configure Environment Files (.env)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[2/6] Configuring environment files...${NC}"

# server/.env
if [ ! -f "server/.env" ]; then
  if [ -f "server/.env.example" ]; then
    cp "server/.env.example" "server/.env"
    echo -e "  ${GREEN}✓${NC} Created server/.env from template"
  fi
else
  echo -e "  ${BLUE}ℹ${NC} server/.env already exists (preserved)"
fi

# client/.env
if [ ! -f "client/.env" ]; then
  if [ -f "client/.env.example" ]; then
    cp "client/.env.example" "client/.env"
    echo -e "  ${GREEN}✓${NC} Created client/.env from template"
  fi
else
  echo -e "  ${BLUE}ℹ${NC} client/.env already exists (preserved)"
fi

# mobile/config.json
if [ ! -f "mobile/config.json" ]; then
  if [ -f "mobile/config.example.json" ]; then
    cp "mobile/config.example.json" "mobile/config.json"
    echo -e "  ${GREEN}✓${NC} Created mobile/config.json from template"
  fi
else
  echo -e "  ${BLUE}ℹ${NC} mobile/config.json already exists (preserved)"
fi

# ------------------------------------------------------------------------------
# 3. Install Node.js Backend & Frontend Packages
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[3/6] Installing Node.js dependencies...${NC}"

echo -e "${CYAN}--> Installing Backend dependencies (server/)...${NC}"
(cd "$ROOT_DIR/server" && "$NPM_BIN" install --no-audit --prefer-offline 2>&1 | tail -n 5)
echo -e "  ${GREEN}✓${NC} Backend dependencies installed"

echo -e "${CYAN}--> Installing Frontend dependencies (client/)...${NC}"
(cd "$ROOT_DIR/client" && "$NPM_BIN" install --no-audit --prefer-offline 2>&1 | tail -n 5)
echo -e "  ${GREEN}✓${NC} Frontend dependencies installed"

# ------------------------------------------------------------------------------
# 4. Storage Envelope Encryption Key Generation
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[4/6] Checking storage envelope encryption keys...${NC}"
if grep -q 'STORAGE_ENCRYPTION_RSA_PUBLIC_KEY=""' "server/.env" 2>/dev/null || \
   ! grep -q 'STORAGE_ENCRYPTION_RSA_PUBLIC_KEY' "server/.env" 2>/dev/null; then
  echo -e "  ${CYAN}--> Generating 2048-bit RSA keypair for storage envelope encryption...${NC}"
  KEY_OUTPUT="$("$NODE_BIN" "$ROOT_DIR/server/scripts/generateEncryptionKeys.js" --bits 2048 2>&1)"
  PUB_KEY="$(echo "$KEY_OUTPUT" | grep 'STORAGE_ENCRYPTION_RSA_PUBLIC_KEY=' | cut -d'=' -f2- | tr -d '"')"
  PRIV_KEY="$(echo "$KEY_OUTPUT" | grep 'STORAGE_ENCRYPTION_RSA_PRIVATE_KEY=' | cut -d'=' -f2- | tr -d '"')"

  if [ -n "$PUB_KEY" ] && [ -n "$PRIV_KEY" ]; then
    # Append or replace in server/.env
    sed -i.bak '/STORAGE_ENCRYPTION_RSA_PUBLIC_KEY/d' "$ROOT_DIR/server/.env"
    sed -i.bak '/STORAGE_ENCRYPTION_RSA_PRIVATE_KEY/d' "$ROOT_DIR/server/.env"
    rm -f "$ROOT_DIR/server/.env.bak"

    echo "STORAGE_ENCRYPTION_KEY_ID=\"v1\"" >> "$ROOT_DIR/server/.env"
    echo "STORAGE_ENCRYPTION_RSA_PUBLIC_KEY=\"$PUB_KEY\"" >> "$ROOT_DIR/server/.env"
    echo "STORAGE_ENCRYPTION_RSA_PRIVATE_KEY=\"$PRIV_KEY\"" >> "$ROOT_DIR/server/.env"
    echo -e "  ${GREEN}✓${NC} Storage encryption keys generated and saved to server/.env"
  fi
else
  echo -e "  ${GREEN}✓${NC} Storage encryption keys already present in server/.env"
fi

# ------------------------------------------------------------------------------
# 5. Python Microservices (PaddleOCR & Faster-Whisper)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[5/6] Setting up Python microservices...${NC}"

if [ -n "$PYTHON_BIN" ]; then
  # OCR Service
  if [ -d "$ROOT_DIR/PaddleOCRFastAPI" ]; then
    echo -e "${CYAN}--> Setting up PaddleOCRFastAPI virtualenv...${NC}"
    if [ ! -d "$ROOT_DIR/PaddleOCRFastAPI/.venv" ] && [ ! -d "$ROOT_DIR/PaddleOCRFastAPI/venv" ]; then
      "$PYTHON_BIN" -m venv "$ROOT_DIR/PaddleOCRFastAPI/.venv"
      "$ROOT_DIR/PaddleOCRFastAPI/.venv/bin/pip" install --upgrade pip >/dev/null 2>&1 || true
      if [ -f "$ROOT_DIR/PaddleOCRFastAPI/requirements.txt" ]; then
        echo -e "    Installing PaddleOCR dependencies (this may take a few minutes)..."
        "$ROOT_DIR/PaddleOCRFastAPI/.venv/bin/pip" install -r "$ROOT_DIR/PaddleOCRFastAPI/requirements.txt" 2>&1 | tail -n 3 || \
          echo -e "    ${YELLOW}Warning: OCR pip install completed with warnings. Docker can be used as an alternative.${NC}"
      fi
    else
      echo -e "  ${BLUE}ℹ${NC} PaddleOCR virtual environment already exists"
    fi
  fi

  # Whisper STT Service
  if [ -d "$ROOT_DIR/whisper-service" ]; then
    echo -e "${CYAN}--> Setting up Whisper STT virtualenv...${NC}"
    if [ ! -d "$ROOT_DIR/whisper-service/venv" ]; then
      "$PYTHON_BIN" -m venv "$ROOT_DIR/whisper-service/venv"
      "$ROOT_DIR/whisper-service/venv/bin/pip" install --upgrade pip >/dev/null 2>&1 || true
      if [ -f "$ROOT_DIR/whisper-service/requirements.txt" ]; then
        echo -e "    Installing Whisper STT dependencies..."
        "$ROOT_DIR/whisper-service/venv/bin/pip" install -r "$ROOT_DIR/whisper-service/requirements.txt" 2>&1 | tail -n 3 || \
          echo -e "    ${YELLOW}Warning: Whisper pip install completed with warnings.${NC}"
      fi
    else
      echo -e "  ${BLUE}ℹ${NC} Whisper virtual environment already exists"
    fi
  fi
else
  echo -e "  ${YELLOW}Skipping Python virtual environments (Python 3 not detected)${NC}"
fi

# Mobile dependencies
if [ -n "$FLUTTER_BIN" ] && [ -d "$ROOT_DIR/mobile" ]; then
  echo -e "\n${CYAN}--> Fetching Flutter dependencies for Mobile app...${NC}"
  (cd "$ROOT_DIR/mobile" && "$FLUTTER_BIN" pub get 2>&1 | tail -n 3)
  echo -e "  ${GREEN}✓${NC} Flutter packages retrieved"
fi

# ------------------------------------------------------------------------------
# 6. Final Permissions & Next Steps
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[6/6] Finalizing permissions and setup...${NC}"
chmod +x "$ROOT_DIR/start-all.sh" "$ROOT_DIR/setup.sh" 2>/dev/null || true
if [ -f "$ROOT_DIR/whisper-service/run.sh" ]; then
  chmod +x "$ROOT_DIR/whisper-service/run.sh" 2>/dev/null || true
fi

echo -e "\n${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}${GREEN}                   Setup Complete! Ready to Run!                ${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}\n"

echo -e "${BOLD}Important Next Steps:${NC}"
echo -e "1. Open ${CYAN}server/.env${NC} and fill in your Supabase credentials:"
echo -e "     - ${BOLD}SUPABASE_URL${NC}"
echo -e "     - ${BOLD}SUPABASE_ANON_KEY${NC}"
echo -e "     - ${BOLD}SUPABASE_SERVICE_ROLE_KEY${NC}"
echo -e "     - ${BOLD}GEMINI_API_KEY${NC} (optional for offline rule fallback)"
echo -e ""
echo -e "2. Apply Supabase SQL migrations from ${CYAN}supabase/migrations/${NC} in your Supabase SQL Editor."
echo -e ""
echo -e "3. Launch all services with a single command:"
echo -e "     ${BOLD}${GREEN}./start-all.sh${NC}"
echo -e ""
echo -e "   Or launch core services only (Backend + React Dashboard):"
echo -e "     ${BOLD}./start-all.sh --core-only${NC}"
echo -e ""
echo -e "4. Access your local applications:"
echo -e "     - Clinician Dashboard:  ${CYAN}http://localhost:5173${NC}"
echo -e "     - Backend REST API:     ${CYAN}http://localhost:4000${NC}"
echo -e "     - OCR Microservice:     ${CYAN}http://localhost:8000/docs${NC}"
echo -e "     - Whisper STT Service:  ${CYAN}http://localhost:8001/health${NC}"
echo -e ""
