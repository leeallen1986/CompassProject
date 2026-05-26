#!/bin/bash
# sync-to-cloud.sh — Push updated server code to the cloud pipeline computer
#
# Run this after any server-side code changes to keep the cloud computer in sync.
# Usage: bash scripts/sync-to-cloud.sh
#
# What it does:
#   1. Creates a tar of server/, drizzle/, shared/, scripts/, package.json, pnpm-lock.yaml, tsconfig.json
#   2. SCPs the tar to the cloud computer
#   3. Extracts it in /home/ubuntu/atlas-pipeline/ (preserves .env, logs/, pipeline-runner.ts, run-pipeline.sh)
#   4. Runs pnpm install --frozen-lockfile if pnpm-lock.yaml changed
#
# Prerequisites: sshpass installed (sudo apt-get install sshpass)

set -e

CLOUD_HOST="34.142.160.59"
CLOUD_USER="ubuntu"
CLOUD_PASS="6HWHwXmCmZMrEwQjNrkV7z"
CLOUD_DIR="/home/ubuntu/atlas-pipeline"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAR_FILE="/tmp/atlas-pipeline-sync-$(date +%Y%m%d-%H%M%S).tar.gz"

echo "[sync] Project dir: $PROJECT_DIR"
echo "[sync] Target: $CLOUD_USER@$CLOUD_HOST:$CLOUD_DIR"
echo "[sync] Creating tar..."

cd "$PROJECT_DIR"
tar czf "$TAR_FILE" \
  server/ \
  drizzle/ \
  shared/ \
  scripts/ \
  package.json \
  pnpm-lock.yaml \
  tsconfig.json \
  tsconfig.node.json \
  2>/dev/null || true

TAR_SIZE=$(du -sh "$TAR_FILE" | cut -f1)
echo "[sync] Tar created: $TAR_FILE ($TAR_SIZE)"

echo "[sync] Uploading to cloud computer..."
sshpass -p "$CLOUD_PASS" scp -o StrictHostKeyChecking=no "$TAR_FILE" "$CLOUD_USER@$CLOUD_HOST:/home/ubuntu/pipeline-sync.tar.gz"

echo "[sync] Extracting on cloud computer..."
sshpass -p "$CLOUD_PASS" ssh -o StrictHostKeyChecking=no "$CLOUD_USER@$CLOUD_HOST" "
  cd $CLOUD_DIR
  tar xzf /home/ubuntu/pipeline-sync.tar.gz
  echo '[sync] Extraction complete'
  
  # Check if pnpm-lock.yaml changed and reinstall if needed
  if ! diff -q pnpm-lock.yaml /home/ubuntu/pipeline-sync-lock-prev.yaml > /dev/null 2>&1; then
    echo '[sync] pnpm-lock.yaml changed — running pnpm install...'
    pnpm install --frozen-lockfile 2>&1 | tail -5
    cp pnpm-lock.yaml /home/ubuntu/pipeline-sync-lock-prev.yaml
  else
    echo '[sync] pnpm-lock.yaml unchanged — skipping install'
  fi
  
  rm -f /home/ubuntu/pipeline-sync.tar.gz
  echo '[sync] Done'
"

rm -f "$TAR_FILE"
echo "[sync] ✓ Cloud computer is now up to date"
