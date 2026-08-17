# Cloud Computer Pipeline Setup

## Overview

The daily intelligence pipeline runs on a dedicated Ubuntu cloud worker. The worker is a separate production execution plane from the Manus web application and writes to the same TiDB database.

Issue #104 v2 makes the **actual worker launch path part of the immutable GitHub release**. `run-pipeline.sh` and `pipeline-runner.ts` must no longer be treated as worker-only operational files.

## Architecture

```text
Dedicated worker
  ├── cron 20:00 UTC
  │     └── run-pipeline.sh cron
  │           └── tracked pipeline-runner.ts
  │                 └── runDailyPipeline("cron")
  │
  └── guarded recovery checks 20:30 / 21:30 / 22:30 UTC
        └── run-pipeline.sh recover
              └── tracked pipeline-runner.ts
                    └── workerRecoveryGuard
                          └── lightweight recovery pipeline (at most once/window)

Manus web application
  └── Operations Reliability V2
        ├── observes persisted run health
        ├── reports stale writers
        └── does NOT execute production recovery by default
```

The normal worker is the only full automatic production writer. Recovery checks run only in the bounded evening window. Each check exits without mutation while a writer is running or after a recovery has already been attempted. The one-window marker allows at most one actual recovery execution.

## Required cron

```cron
0 20 * * * /home/ubuntu/atlas-pipeline/run-pipeline.sh cron >> /home/ubuntu/atlas-pipeline/logs/cron.log 2>&1
30 20-22 * * * /home/ubuntu/atlas-pipeline/run-pipeline.sh recover >> /home/ubuntu/atlas-pipeline/logs/cron.log 2>&1
```

The recovery expression produces guarded checks at 20:30, 21:30 and 22:30 UTC. This matters on Wednesday/Saturday when Contractor Engine can legitimately keep the natural worker busy beyond 20:30. The first check must not consume the retry marker merely because the natural writer is still active; a later check may recover only if that writer subsequently reaches a failed state or if the expected run never existed.

Do not add a second independent full-pipeline schedule or recovery checks more frequent than hourly.

## Worker layout

```text
/home/ubuntu/atlas-pipeline/
  .env                    # protected production secrets; chmod 600; never commit
  pipeline-runner.ts      # GIT-TRACKED supervised entry point
  run-pipeline.sh         # GIT-TRACKED cron wrapper; executable
  DEPLOYED_GIT_SHA        # approved immutable GitHub source SHA
  SHA256SUMS.release      # release manifest
  logs/
    cron.log
    pipeline-launcher.log # bounded pre-row and supervisor diagnostics
  server/
  drizzle/
  shared/
  node_modules/
  package.json
  pnpm-lock.yaml
  tsconfig.json
```

## Why the launcher must be tracked

Before Issue #104 v2, the release archive intentionally excluded `pipeline-runner.ts` and `run-pipeline.sh`, while cron depended on those two files. A worker could therefore report an approved `DEPLOYED_GIT_SHA` even though the actual cron entrypoint was missing, stale or different from the approved GitHub source.

That model is no longer acceptable. A release is not attested unless both launcher files match the approved source, including the executable Git mode of `run-pipeline.sh`.

## Execution safety

### Full natural run

`run-pipeline.sh cron` starts the tracked runner with an OS process boundary slightly wider than the application 180-minute budget. The runner:

1. writes a bounded launcher record before importing application pipeline code;
2. blocks when any persisted pipeline writer is already running;
3. supervises the owned `cron` row;
4. writes process-liveness heartbeats that explicitly do **not** claim step completion;
5. enforces a 15-minute wall-clock boundary while the owned run remains in `Apollo Gap-Fill`;
6. on SIGTERM, interrupt, application rejection or unresolved persisted status, finalises only the row created by that owned process and exits;
7. exits explicitly after final persisted truth so database/event-loop handles cannot keep cron alive;
8. never changes `durationMs` when the exact process stop time is not application-proven.

A supervisor heartbeat is ownership/liveness evidence only. It must not be interpreted as proof that a business step completed.

### Guarded recovery

`run-pipeline.sh recover` is not a second full run. It checks the expected 20:00 UTC window and the existing `ops.v2.selfHealingWindow` marker.

Recovery executes only when:

- no pipeline writer is currently running;
- the expected run is missing or failed;
- a recovery has not already been attempted for that window.

When a natural writer is still running, the guard exits without setting the retry marker. This lets the later hourly recovery checks observe the same window safely.

The recovery profile intentionally contains only the critical discovery/truth chain:

- RSS Harvest;
- AI Extraction;
- Tier Classification;
- Staleness Check;
- Source Monitoring Snapshot.

It deliberately excludes:

- contact enrichment;
- Web Stakeholder Discovery;
- Apollo Gap-Fill;
- discovery queue work;
- Contractor Engine;
- second-pass contact search;
- other non-critical enrichment.

This prevents self-healing from repeating the expensive workload that caused the original web-plane stall.

### Web reliability observer

The Manus web application remains responsible for visibility and stale-writer alerts. Automatic web execution is disabled by default. The legacy web retry path exists only behind the explicit compatibility switch:

```text
ENABLE_WEB_SELF_HEALING=true
```

Do not set that variable in normal production while the dedicated worker recovery cron is enabled.

## Security requirements

Never place credentials, API keys, database URLs, SSH passwords or provider secrets in the repository, launcher logs or deployment reports.

Secrets belong only in the approved worker `.env` or managed web secret store. The worker `.env` must remain mode `600`.

Launcher diagnostics may contain only bounded operational fields such as:

- UTC timestamp;
- process ID;
- release SHA;
- mode (`cron` or `recover`);
- run ID;
- current step;
- bounded failure category;
- exit code.

They must never contain environment values, provider payloads, article content or contact data.

## Immutable release model

Every worker release must originate from an approved GitHub SHA.

The Git-tracked release includes at minimum:

```text
pipeline-runner.ts
run-pipeline.sh
server/
drizzle/
shared/
package.json
pnpm-lock.yaml
tsconfig.json
```

The release manifest must include SHA-256 for:

- `pipeline-runner.ts`;
- `run-pipeline.sh`;
- `server/dailyPipeline.ts`;
- `server/pipelineExecutionSupervisor.ts`;
- `server/pipelineRecovery.ts`;
- `server/workerRecoveryGuard.ts`;
- `server/operationsReliabilityV2.ts`;
- contact-trust writer files already covered by the production release discipline;
- `pnpm-lock.yaml`.

The manifest must also attest Git file modes, including `run-pipeline.sh=100755`, so source provenance covers executable semantics as well as file content.

The worker must persist the approved SHA in:

```text
/home/ubuntu/atlas-pipeline/DEPLOYED_GIT_SHA
```

and the tracked-file checksum manifest in:

```text
/home/ubuntu/atlas-pipeline/SHA256SUMS.release
```

## Safe update procedure

### 1. Controller source attestation

From a clean checkout of the approved release, require:

```bash
git status --short
git rev-parse HEAD
```

The tree must be clean and `HEAD` must be the exact approved SHA.

### 2. Quiet-window preflight

Before changing worker source, confirm read-only:

- production `pipelineRuns.status=running` count is zero;
- no worker pipeline/node/tsx process is active;
- the next natural 20:00 UTC run is sufficiently far away;
- the current cron and `.env` fingerprints are recorded without displaying secret content.

### 3. Backup

Create a timestamped rollback archive of worker source and launcher files. The protected `.env` may remain in the worker-only rollback archive but must never be exported into chat or an artifact report.

### 4. Exact source sync

Synchronise the approved Git-tracked source into `/home/ubuntu/atlas-pipeline`.

Preserve only non-Git operational state:

- `.env`;
- logs;
- backups;
- `node_modules` when the release does not change dependencies;
- `DEPLOYED_GIT_SHA` until post-sync verification;
- prior release manifests until replacement is verified.

**Do not preserve old copies of `pipeline-runner.ts` or `run-pipeline.sh`.** They must be replaced by the approved GitHub versions.

Require `run-pipeline.sh` to remain executable after sync.

### 5. Source attestation

Compare every tracked worker file against the approved clean source. Require zero differing and zero missing files before writing the new `DEPLOYED_GIT_SHA` and `SHA256SUMS.release`.

The release manifest must include both launcher hashes and the executable Git mode.

### 6. Offline validation

Use existing dependencies only unless the approved release changes the lockfile. Run focused tests, TypeScript (including the root `pipeline-runner.ts`), shell syntax and other static validation. Do not manually start the production pipeline as a deployment test.

### 7. Cron installation

Install exactly the two approved cron entries shown above. Record the resulting crontab SHA-256. Do not add more frequent recovery checks.

### 8. Natural-run acceptance

Allow the next normal 20:00 UTC cron to execute. Verify from persisted evidence and bounded launcher logs:

- shell invocation occurred;
- tracked runner booted;
- `triggeredBy=cron` row appeared;
- no concurrent writer existed;
- Gemini extraction accounting is truthful;
- Apollo did not exceed its supervised wall-clock boundary, or the owned run was failed closed without an orphan;
- the runner exited after final persisted truth;
- final production state is quiet.

For the 20:30 / 21:30 / 22:30 guarded checks, verify each observed outcome. Across the entire expected window there must be at most one actual `self-healing-retry` execution. Valid outcomes include:

- `recovery_not_needed` after a healthy natural run;
- `recovery_blocked_running` while the natural writer is legitimately active;
- a later `recovery_completed` / `recovery_failed` after the natural run reaches a failed state;
- `recovery_already_attempted` after one prior recovery for the same window.

## Drift detection

The worker release is unattested if any of the following is true:

- `DEPLOYED_GIT_SHA` is missing or wrong;
- `pipeline-runner.ts` differs from the approved SHA;
- `run-pipeline.sh` differs from the approved SHA;
- the wrapper is not executable;
- any release-manifest hash or Git mode differs;
- cron does not contain exactly the approved natural and guarded recovery entries;
- more than one recovery execution appears for a single expected window;
- a recovery row appears without the one-window guard;
- web and worker provenance are conflated.

## Troubleshooting a missing natural row

Use `logs/pipeline-launcher.log` before guessing about the database or cron service.

Expected bounded stages include:

- `shell_invoked`;
- `runner_start`;
- `runner_boot`;
- `daily_pipeline_import_start`;
- `daily_pipeline_import_ok`;
- `pipeline_finished` or a bounded failure event.

This distinguishes shell launch, working-directory failure, missing entrypoint, import failure and application execution failure even when no `pipelineRuns` row was created.

## Manual reruns

Manual production runs are not deployment validation and are not equivalent to a natural cron proof. They require a separate explicit operational authorisation.
