#!/bin/bash
# run-queue-pgkill.sh
# Runs discovery queue batches with process-group kill to handle tsx subprocess trees.
# Uses `setsid` to put each batch in its own process group, then kills the whole group on timeout.

set -e
cd /home/ubuntu/atlas-copco-intelligence

MAX_ROUNDS=50
BATCH_TIMEOUT=300   # 5 minutes per batch of 10 projects
LOG=/tmp/queue-pgkill.log

STATS_SCRIPT="const m=require('mysql2/promise');require('dotenv').config();(async()=>{const db=await m.createConnection(process.env.DATABASE_URL);const [r]=await db.execute('UPDATE projects SET discoveryStatus=\"discovery_queued\",lastDiscoveryAt=NULL WHERE discoveryStatus=\"discovery_running\"');const [[c]]=await db.execute('SELECT SUM(contactTrustTier=\"send_ready\") as sr FROM contacts WHERE crmOrphan=0 OR crmOrphan IS NULL');const [[p]]=await db.execute('SELECT SUM(discoveryStatus=\"discovery_queued\") as q FROM projects');console.log(c.sr+' '+p.q);await db.end();process.exit(0);})();"

get_stats() {
  node -e "$STATS_SCRIPT" 2>/dev/null | tail -1
}

echo "=== PGKILL QUEUE RUNNER START $(date) ===" | tee -a "$LOG"

for i in $(seq 1 $MAX_ROUNDS); do
  STATS=$(get_stats)
  SR=$(echo "$STATS" | awk '{print $1}')
  QUEUED=$(echo "$STATS" | awk '{print $2}')
  
  echo "[Round $i] send_ready=$SR queued=$QUEUED $(date)" | tee -a "$LOG"
  
  if [ -z "$QUEUED" ] || [ "$QUEUED" -le 0 ] 2>/dev/null; then
    echo "[Round $i] Queue empty or error — done!" | tee -a "$LOG"
    break
  fi
  
  echo "[Round $i] Starting batch (timeout=${BATCH_TIMEOUT}s)..." | tee -a "$LOG"
  
  # Run in a new process group so we can kill the whole tree
  setsid npx tsx server/scripts/runQueueUntilEmpty.ts >> "$LOG" 2>&1 &
  BATCH_PID=$!
  BATCH_PGID=$(ps -o pgid= -p $BATCH_PID 2>/dev/null | tr -d ' ')
  
  # Wait up to BATCH_TIMEOUT seconds, then kill the whole process group
  ELAPSED=0
  while kill -0 $BATCH_PID 2>/dev/null; do
    sleep 10
    ELAPSED=$((ELAPSED + 10))
    if [ $ELAPSED -ge $BATCH_TIMEOUT ]; then
      echo "[Round $i] TIMEOUT after ${BATCH_TIMEOUT}s — killing process group $BATCH_PGID" | tee -a "$LOG"
      kill -9 -$BATCH_PGID 2>/dev/null || true
      break
    fi
  done
  
  # Reset any stuck projects
  node -e "$STATS_SCRIPT" 2>/dev/null > /dev/null
  
  echo "[Round $i] Batch done. Sleeping 5s..." | tee -a "$LOG"
  sleep 5
done

FINAL=$(get_stats)
echo "=== FINAL: send_ready=$(echo $FINAL | awk '{print $1}') queued=$(echo $FINAL | awk '{print $2}') $(date) ===" | tee -a "$LOG"
