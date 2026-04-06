#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${HOME}/.pi/agent/extensions"
TARGET_PATH="${TARGET_DIR}/agents-reread.ts"

mkdir -p "$TARGET_DIR"
ln -sfn "${REPO_DIR}/agents-reread.ts" "$TARGET_PATH"

echo "Linked ${TARGET_PATH} -> ${REPO_DIR}/agents-reread.ts"
