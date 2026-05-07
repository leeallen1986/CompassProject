#!/bin/bash
# run-queue-shell.sh
# Runs the discovery queue in fresh tsx processes, one batch at a time.
# Each batch gets a hard 12-minute wall-clock timeout to prevent CLOSE-WAIT hangs.
# Runs until the queue is empty or max_rounds is reached.

set -e
cd /home/ubuntu/atlas-copco-intelligence

MAX_ROUNDS=30
BATCH_TIMEOUT=720   # 12 minutes per batch
LOG=/tmp/queue-shell.log
STATS_SCRIPT="const m=require('mysql2/promise');require('dotenv').config();(async()=>{const db=await m.createConnection(process.env.DATABASE_URL);const [r]=await db.execute('UPDATE projects SET discoveryStatus=\"discovery_queued\",lastDiscoveryAt=NULL WHERE discoveryStatus=\"discovery_running\"');const [[c]]=await db.execute('SELECT SUM(contactTrustTier=\"send_ready\") as sr FROM contacts WHERE crmOrphan=0 OR crmOrphan IS NULL');const [[p]]=await db.execute('SELECT SUM(discoveryStatus=\"discovery_queued\") as q FROM projects');console.log(c.sr+' '+p.q);await db.end();process.exit(0);})();"

echo "=== SHELL QUEUE RUNNER START $(date) ===" | tee -a "$LOG"

for i in $(seq 1 $MAX_ROUNDS); do
  # Get current stats
  STATS=$(node -e "$STATS_SCRIPT" 2>/dev/null | tail -1)
  SR=$(echo "$STATS" | awk '{print $1}')
  QUEUED=$(echo "$STATS" | awk '{print $2}')
  
  echo "[Round $i] send_ready=$SR queued=$QUEUED $(date)" | tee -a "$LOG"
  
  if [ "$QUEUED" -le 0 ] 2>/dev/null; then
    echo "[Round $i] Queue empty — done!" | tee -a "$LOG"
    break
  fi
  
  echo "[Round $i] Starting fresh tsx batch (timeout=${BATCH_TIMEOUT}s)..." | tee -a "$LOG"
  
  # Run a single batch in a fresh process with hard timeout
  timeout $BATCH_TIMEOUT npx tsx server/scripts/runQueueUntilEmpty.ts >> "$LOG" 2>&1 || {
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
      echo "[Round $i] TIMEOUT — killing and resetting stuck projects" | tee -a "$LOG"
    else
      echo "[Round $i] Process exited with code $EXIT_CODE" | tee -a "$LOG"
    fi
    # Reset any stuck running projects
    node -e "$STATS_SCRIPT" 2>/dev/null > /dev/null
  }
  
  echo "[Round $i] Batch complete. Sleeping 5s before next round..." | tee -a "$LOG"
  sleep 5
done

# Final stats
FINAL=$(node -e "$STATS_SCRIPT" 2>/dev/null | tail -1)
echo "=== FINAL: send_ready=$(echo $FINAL | awk '{print $1}') queued=$(echo $FINAL | awk '{print $2}') $(date) ===" | tee -a "$LOG"
