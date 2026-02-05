#!/bin/bash
# Setup script for better-sqlite3 native module
# This script ensures better-sqlite3 is properly built by:
# 1. Installing setuptools for Python 3.13 (provides distutils)
# 2. Rebuilding the native module with node-gyp
#
# Usage:
#   bash scripts/setup-native-modules.sh
#   Or from any package directory: ../../scripts/setup-native-modules.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up better-sqlite3 native module...${NC}"

# Find project root (script is in scripts/ at project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Project root: $PROJECT_ROOT"
echo ""

# Find the better-sqlite3 package directory (check workspace packages)
BETTER_SQLITE3_DIR=$(find "$PROJECT_ROOT" -path "*/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3" -type d | head -1)

if [ -z "$BETTER_SQLITE3_DIR" ]; then
  echo -e "${YELLOW}better-sqlite3 not found in node_modules. Run: pnpm add better-sqlite3${NC}"
  exit 1
fi

echo "Found better-sqlite3 at: $BETTER_SQLITE3_DIR"
echo ""

# Check if better-sqlite3 works (must check from data-prep package)
if cd "$PROJECT_ROOT/data-prep" && node -e "require('better-sqlite3')" 2>/dev/null; then
  echo -e "${GREEN}✓ better-sqlite3 is working!${NC}"
  exit 0
fi

echo -e "${YELLOW}better-sqlite3 native module needs rebuilding...${NC}"
echo ""

# Python 3.13 location (Homebrew on macOS arm64)
PYTHON="/opt/homebrew/bin/python3.13"

if [ ! -f "$PYTHON" ]; then
  echo -e "${RED}Error: Python 3.13 not found at $PYTHON${NC}"
  echo "Install Python 3.13 via Homebrew:"
  echo "  brew install python@3.13"
  exit 1
fi

echo "Using Python: $PYTHON"

# Check if setuptools is available for this Python version
if ! "$PYTHON" -c "import setuptools" 2>/dev/null; then
  echo -e "${YELLOW}Installing setuptools for Python 3.13...${NC}"
  "$PYTHON" -m pip install --break-system-packages setuptools
fi

# Rebuild the native module from the better-sqlite3 directory
echo -e "${YELLOW}Rebuilding better-sqlite3 native module...${NC}"
cd "$BETTER_SQLITE3_DIR"

PYTHON="$PYTHON" npm run rebuild 2>&1 || {
  # Fallback: use npx node-gyp directly
  PYTHON="$PYTHON" npx node-gyp rebuild --release
}

# Go back to project root
cd "$PROJECT_ROOT"

# Verify it works (must check from data-prep package)
if cd "$PROJECT_ROOT/data-prep" && node -e "require('better-sqlite3')" 2>/dev/null; then
  echo ""
  echo -e "${GREEN}✓ better-sqlite3 is now working!${NC}"
else
  echo ""
  echo -e "${RED}✗ better-sqlite3 rebuild failed${NC}"
  exit 1
fi
