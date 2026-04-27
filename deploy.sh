#!/bin/bash
# ============================================================
# Tools API — Build & Deploy to Synology NAS
#
# Thin wrapper — all logic lives in deploy/lib.sh
#
# Usage:
#   npm run deploy              # full deploy
#   npm run deploy -- --dry-run # validate without deploying
#   npm run deploy -- --skip-pull
#   npm run deploy -- --no-cache
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="tools-service"
DISPLAY_NAME="🔧 Tools API"

source "${SCRIPT_DIR}/../deploy/lib.sh"
