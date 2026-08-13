# Cloud Computer Pipeline Setup

## Overview

The daily scraping and enrichment pipeline runs on a dedicated Ubuntu cloud computer via OS cron at **20:00 UTC daily**. The worker writes to the same TiDB database used by the web application.

This worker is a **separate production execution plane** from the Manus web deployment. A current web checkpoint does not prove that the cloud pipeline worker is running the same source.

---

## Architecture

```text
Cloud pipeline worker
  └── cron: 0 20 * * * /home/ubuntu/atlas-pipeline/run-pipeline.sh
        └── tsx pipeline-runner.ts cron
              └── runDailyPipeline("cron")
                    └── shared TiDB database

Web application
  └── operationsReliability.ts self-healing check
        └── checks whether a pipeline run already exists
```

The `triggeredBy=cron` value in `pipelineRuns` identifies the cloud-computer path, not the web `/api/scheduled/pipeline` route.

---

## Worker layout

```text
/home/ubuntu/atlas-pipeline/
  .env                    # production secrets; chmod 600; never commit
  pipeline-runner.ts      # standalone entry point
  run-pipeline.sh         # cron wrapper
  DEPLOYED_GIT_SHA        # immutable source attestation for the synced tree
  SHA256SUMS.release      # hashes for release-critical files
  logs/
  server/
  drizzle/
  shared/
  node_modules/
  package.json
  pnpm-lock.yaml
  tsconfig.json
```

---

## Security requirements

**Never place credentials, API keys, database URLs, SSH passwords or provider secrets in this repository or documentation.**

Required secrets belong only in approved secret stores or the worker `.env` file with restrictive permissions. Controller scripts must read SSH/authentication material from environment variables or an SSH agent, never from committed command lines.

If a secret is ever committed, removing it from the latest file is not sufficient because Git history retains it. Rotate the exposed secret and then clean history only through an approved security procedure.

---

## Release model

The cloud worker must be released from an **immutable approved GitHub SHA**. Do not copy an arbitrary Manus workspace or mutable working directory into production.

For every worker release, record:

- approved full GitHub SHA;
- release UTC timestamp;
- operator/task identity;
- SHA-256 of `server/dailyPipeline.ts`;
- SHA-256 of `server/contactEnrichment.ts`;
- SHA-256 of the Apollo/Hunter/Lusha writer files;
- SHA-256 of `server/routers/contactValidation.ts`;
- dependency-lock hash;
- pre-release worker source SHA/hash set;
- post-release worker source SHA/hash set.

The worker should persist the approved GitHub SHA locally as:

```text
/home/ubuntu/atlas-pipeline/DEPLOYED_GIT_SHA
```

and retain a release checksum file:

```text
/home/ubuntu/atlas-pipeline/SHA256SUMS.release
```

---

## Safe update procedure

### 1. Controller preflight

From a clean checkout of the approved release:

```bash
git status --short
git rev-parse HEAD
```

Require a clean tree and confirm that `HEAD` is the exact approved SHA.

Create the release archive from that checkout only:

```bash
tar czf /tmp/pipeline-release.tar.gz \
  server/ drizzle/ shared/ package.json pnpm-lock.yaml tsconfig.json
```

Generate local release hashes for the critical files before transfer.

### 2. Worker preflight

Using SSH credentials supplied out-of-band, inspect only:

```bash
crontab -l
cat /home/ubuntu/atlas-pipeline/DEPLOYED_GIT_SHA 2>/dev/null || true
sha256sum \
  /home/ubuntu/atlas-pipeline/server/dailyPipeline.ts \
  /home/ubuntu/atlas-pipeline/server/contactEnrichment.ts
```

Do not print `.env`, provider keys or credentials.

### 3. Backup code only

Create a timestamped backup of the worker code and wrapper files. Exclude `.env`, provider payloads and logs from exported evidence.

### 4. Transfer and extract

Copy `/tmp/pipeline-release.tar.gz` to the worker using SSH-agent/key-based authentication or another approved secret mechanism. Extract it into `/home/ubuntu/atlas-pipeline` while preserving `.env`, `pipeline-runner.ts`, `run-pipeline.sh` and `logs/`.

Install locked dependencies:

```bash
cd /home/ubuntu/atlas-pipeline
pnpm install --frozen-lockfile
```

### 5. Source attestation

After extraction, verify the cloud copies of all release-critical files match the local approved checkout byte-for-byte using SHA-256.

Write the exact approved GitHub SHA to `DEPLOYED_GIT_SHA` and the release-critical checksums to `SHA256SUMS.release` only after all comparisons pass.

### 6. Static validation only

Before the next scheduled run, perform validation that cannot call providers or mutate production data. Examples:

- TypeScript compilation where supported by the worker checkout;
- focused pure/unit tests;
- static confirmation that `Stale Trust-Tier Backfill` is present in `server/dailyPipeline.ts`;
- static confirmation that `runStaleTierBackfill()` enforces the canonical current-mailbox policy.

**Do not manually trigger the production pipeline as part of a source-sync validation.**

### 7. Natural-run validation

Take the controller baseline after the worker source is attested. Allow the next normal `20:00 UTC` cron run to execute. Then verify:

- `triggeredBy=cron`;
- run completed normally;
- transcript contains `Stale Trust-Tier Backfill`;
- transcript contains all expected current pipeline stages;
- no new invalid raw `send_ready` contacts appear;
- exact canaries remain safe;
- the post-run read-only fingerprint is stable.

---

## Drift detection

A worker release is considered **unattested** when any of the following is true:

- `DEPLOYED_GIT_SHA` is missing;
- the recorded SHA is not the approved controller SHA;
- a release-critical file hash differs from `SHA256SUMS.release`;
- a cron transcript lacks mandatory current pipeline stages;
- web and worker provenance are being conflated.

An unattested worker must not be used as proof that a GitHub code fix survived a natural pipeline.

---

## Monitoring

### Pipeline status

Use the application/operator view or a read-only database query to inspect recent `pipelineRuns` rows. Do not expose credentials in logs or screenshots.

### Worker logs

Inspect the worker's local daily pipeline and cron logs using authenticated SSH. Export only sanitized excerpts required for an incident.

---

## Troubleshooting

### Pipeline did not run

1. Confirm the cron entry exists.
2. Inspect sanitized cron output.
3. Inspect the daily worker log.
4. Check the latest `pipelineRuns` row.
5. Confirm the worker's `DEPLOYED_GIT_SHA` and release hashes.

### Pipeline transcript differs from GitHub

Treat this as worker source drift first. Compare the worker's release-critical hashes with the approved GitHub SHA before escalating to the web deployment platform.

### Manual reruns

Manual reruns are diagnostic/operational actions and are **not equivalent to a natural cron validation**. Use only under a separately authorised runbook.

---

## Historical note

The cloud worker was originally introduced to avoid long-running web-container restarts interrupting the pipeline. Because the worker uses a copied source tree, later server-side fixes must be explicitly released to that execution plane. This separation is now part of the production provenance model.