# Cloud Computer Pipeline Setup

## Overview

The daily scraping and enrichment pipeline runs on a dedicated cloud computer at **34.142.160.59** (Ubuntu 24.04 LTS, 2 vCPU, 955 MB RAM). This avoids the SIGTERM interruptions that occurred on Cloud Run when the WebDev dev server restarted during file edits.

---

## Architecture

```
Cloud Computer (34.142.160.59)
  └── cron: 0 20 * * * /home/ubuntu/atlas-pipeline/run-pipeline.sh
        └── tsx pipeline-runner.ts cron
              └── runDailyPipeline("cron")
                    └── writes to TiDB Cloud (shared DB)

WebDev (compasspt.manus.space)
  └── operationsReliability.ts: self-healing check at 20:10 UTC
        └── wasRunStartedToday() → true (cloud computer already ran)
              └── SKIP (no duplicate run)
```

The cloud computer writes a `pipelineRuns` row to the shared TiDB database at 20:00 UTC. The WebDev self-healing timer at 20:10 UTC detects this row and skips its own run. Both paths share the same idempotency guard.

---

## Cloud Computer Details

| Field | Value |
|---|---|
| IP | 34.142.160.59 |
| User | ubuntu |
| OS | Ubuntu 24.04 LTS |
| CPU | 2 vCPU |
| RAM | 955 MB |
| Node.js | v22.22.2 |
| pnpm | 10.4.1 |
| tsx | v4.22.3 |
| Pipeline dir | /home/ubuntu/atlas-pipeline/ |
| Cron schedule | `0 20 * * *` (20:00 UTC daily) |
| Log dir | /home/ubuntu/atlas-pipeline/logs/ |
| Log retention | 14 days |

---

## File Structure on Cloud Computer

```
/home/ubuntu/atlas-pipeline/
  .env                    ← Environment variables (chmod 600)
  pipeline-runner.ts      ← TypeScript entry point (calls runDailyPipeline)
  run-pipeline.sh         ← Cron shell wrapper (logs to logs/pipeline-YYYY-MM-DD.log)
  logs/
    pipeline-YYYY-MM-DD.log  ← Per-day pipeline output
    cron.log                 ← Cron stdout/stderr
  server/                 ← Extracted from WebDev project tar
  drizzle/                ← Schema and migrations
  node_modules/           ← 936 packages installed via pnpm
  package.json
  tsconfig.json
```

---

## Cron Job

```bash
# Installed via: (crontab -l; echo "...") | crontab -
0 20 * * * /home/ubuntu/atlas-pipeline/run-pipeline.sh >> /home/ubuntu/atlas-pipeline/logs/cron.log 2>&1
```

Verify with:
```bash
sshpass -p '<password>' ssh ubuntu@34.142.160.59 'crontab -l'
```

---

## Updating the Pipeline Code

When server-side code changes are made in WebDev, re-sync to the cloud computer:

```bash
# From the WebDev sandbox
cd /home/ubuntu/atlas-copco-intelligence

# Create a fresh tar of the server code
tar czf /tmp/pipeline-update.tar.gz \
  server/ drizzle/ shared/ package.json pnpm-lock.yaml tsconfig.json

# Transfer to cloud computer
sshpass -p '6HWHwXmCmZMrEwQjNrkV7z' scp -o StrictHostKeyChecking=no \
  /tmp/pipeline-update.tar.gz ubuntu@34.142.160.59:/home/ubuntu/

# Extract on cloud computer (preserves .env, pipeline-runner.ts, run-pipeline.sh, logs/)
sshpass -p '6HWHwXmCmZMrEwQjNrkV7z' ssh -o StrictHostKeyChecking=no ubuntu@34.142.160.59 \
  'cd /home/ubuntu/atlas-pipeline && tar xzf /home/ubuntu/pipeline-update.tar.gz && pnpm install --frozen-lockfile 2>&1 | tail -5'
```

---

## Environment Variables

All secrets are stored in `/home/ubuntu/atlas-pipeline/.env` (chmod 600). The file contains:

- `DATABASE_URL` — TiDB Cloud connection string (same as WebDev)
- `APOLLO_API_KEY` — Apollo.io API key (zDjTBDrJnnd0m2hgjIjeVg)
- `HUNTER_API_KEY` — Hunter.io API key
- `RESEND_API_KEY` — Resend email API key
- `LUSHA_API_KEY` — Lusha API key
- `PROJECTORY_EMAIL` / `PROJECTORY_PASSWORD` — Projectory credentials
- `APP_SITE_URL` — https://compasspt.manus.space (for email links)
- `BUILT_IN_FORGE_API_KEY` / `BUILT_IN_FORGE_API_URL` — Manus LLM API

---

## Monitoring

### Check last run status
```sql
SELECT id, status, triggered_by, started_at, completed_at,
       TIMESTAMPDIFF(MINUTE, started_at, completed_at) AS duration_min
FROM pipeline_runs
ORDER BY started_at DESC
LIMIT 5;
```

### Check today's log
```bash
sshpass -p '6HWHwXmCmZMrEwQjNrkV7z' ssh ubuntu@34.142.160.59 \
  'tail -50 /home/ubuntu/atlas-pipeline/logs/pipeline-$(date +%Y-%m-%d).log'
```

### Check cron log
```bash
sshpass -p '6HWHwXmCmZMrEwQjNrkV7z' ssh ubuntu@34.142.160.59 \
  'tail -20 /home/ubuntu/atlas-pipeline/logs/cron.log'
```

---

## Troubleshooting

### Pipeline didn't run
1. Check cron is installed: `crontab -l`
2. Check cron log: `tail -20 /home/ubuntu/atlas-pipeline/logs/cron.log`
3. Check today's pipeline log: `tail -100 /home/ubuntu/atlas-pipeline/logs/pipeline-$(date +%Y-%m-%d).log`
4. Check DB for run status: `SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 3`

### Pipeline failed mid-run
- The `pipelineRuns` table will show `status='failed'` with error details
- The WebDev self-healing timer (20:10 UTC) will attempt a retry if no completed run exists
- Admin panel → Pipeline tab shows current status

### Re-run pipeline manually
```bash
sshpass -p '6HWHwXmCmZMrEwQjNrkV7z' ssh ubuntu@34.142.160.59 \
  'cd /home/ubuntu/atlas-pipeline && ./run-pipeline.sh'
```

Or from the WebDev Admin panel → Pipeline → "Run Pipeline Now".

---

## Migration History

| Date | Action |
|---|---|
| 2026-05-27 | Initial setup: Node.js 22 + pnpm 11 + tsx installed |
| 2026-05-27 | Project code transferred (7MB tar, 936 packages) |
| 2026-05-27 | Cron job installed: `0 20 * * *` |
| 2026-05-27 | Smoke test passed: DB connected, pipeline started (run ID 1320002) |

---

## Previous Pipeline Failures (Why We Migrated)

The WebDev Cloud Run container was running the pipeline via `tsx watch server/_core/index.ts`. When any server file was edited during development, `tsx watch` restarted the server process, sending SIGTERM to the in-flight pipeline. This caused:

- Pipeline runs stuck in `status='running'` until next startup cleanup
- Partial enrichment passes (Apollo/Hunter calls made but not logged)
- Digest freshness gate failures (pipeline appeared stale)

The cloud computer runs `tsx pipeline-runner.ts` as a one-shot process with no file watching, eliminating this failure mode entirely.
