# Dedicated Worker Control-Channel Runbook

## Purpose

This runbook separates **worker/application health** from the interactive operator channel used to inspect the dedicated cloud worker.

A disconnected terminal or Manus control session is **not** evidence that the Ubuntu worker stopped, that a validation command failed, or that a pipeline writer is still active. Conversely, a responsive terminal is not proof that a production pipeline is healthy.

The production pipeline and cron continue independently of the interactive control channel.

## Issue #122 operating rule

Longer deployment validation must not depend on one uninterrupted interactive session. Use the tracked validation-job controller:

```bash
node /home/ubuntu/atlas-pipeline/scripts/worker-validation-job.mjs ...
```

It supports only fixed offline/static validation profiles. It cannot accept arbitrary shell commands and it never invokes the production pipeline or recovery path.

State is persisted under:

```text
/home/ubuntu/atlas-pipeline/logs/worker-validation/
```

Each job has durable metadata, PID identity, bounded output, final exit code and release-provenance evidence.

## What a control-channel disconnect means

Treat a disconnect as **control-plane uncertainty only** until persisted evidence proves otherwise.

Do not infer any of the following from a detached terminal alone:

- worker reboot;
- pipeline crash;
- validation failure;
- validation completion;
- database writer ownership;
- cron failure.

Do not restart the worker merely to regain terminal access.

## Safe validation profiles

List the available fixed profiles:

```bash
cd /home/ubuntu/atlas-pipeline
node scripts/worker-validation-job.mjs profiles
```

Current profiles:

- `control-probe` — harmless short detached process used to prove reconnect/resume behavior;
- `shell-syntax` — `bash -n run-pipeline.sh`;
- `issue104-tests` — focused runtime/recovery regression tests;
- `typecheck` — worker-only TypeScript using `tsconfig.worker.json`;
- `deployment-static` — shell syntax, focused reliability tests and worker-only TypeScript in sequence.

The dedicated-worker controller intentionally does **not** offer a whole-application `build` profile. The immutable worker release does not contain or attest the full `client/` tree, so Vite/client build validation belongs in GitHub exact-head CI rather than on the worker.

`tsconfig.worker.json` includes only the worker/server TypeScript scope (`server/**/*`, `shared/**/*`, `pipeline-runner.ts`) and explicitly excludes `client/`. The worker TypeScript config is itself part of the immutable release manifest.

No profile runs `run-pipeline.sh`, `pipeline-runner.ts`, `runDailyPipeline`, recovery, provider calls, enrichment, migrations or database remediation.

## Full-source release validation versus worker-local validation

These are separate gates:

- **GitHub CI / full source** runs the normal `pnpm check` and `pnpm build`, including client TypeScript and the Vite web build.
- **Dedicated worker / deployed release** validates only files that are part of the immutable worker release tree.

A worker-local deployment gate must never depend on stale or unattested files outside `SHA256SUMS.release`.

## Starting a detached validation

Example:

```bash
cd /home/ubuntu/atlas-pipeline
node scripts/worker-validation-job.mjs start typecheck
```

The command creates durable job state first and then starts the validator as a detached Node process with ignored terminal stdio. The validator therefore does not depend on the initiating SSH/Manus session remaining attached.

The response includes a `jobId`. If the control session disconnects before the response is visible, use `latest` from a new session.

## Reconnecting after a disconnect

From any later fresh session:

```bash
cd /home/ubuntu/atlas-pipeline
node scripts/worker-validation-job.mjs status latest
```

Possible states:

- `starting` — durable job exists and the detached runner has not yet published PID identity;
- `running` — PID exists and its Linux `/proc` start-time identity still matches;
- `completed_success` — durable `result.json` exists with exit code `0`;
- `completed_failed` — durable `result.json` exists with a non-zero exit code;
- `incomplete` — no final result exists and the recorded PID identity is not live.

`incomplete` is fail-closed. Do not silently launch another deployment validation until it is inspected.

## Viewing bounded output

```bash
node scripts/worker-validation-job.mjs tail latest 80
```

At most 200 lines are returned by the command. Each validation step also has an internal byte ceiling so a verbose compiler/test failure cannot create an unbounded operator log.

Validation logs contain only command output and bounded operational markers. The controller does not read or print `.env`, API keys, provider responses or database credentials.

## Ambiguous/incomplete job handling

If status reports `incomplete`:

1. confirm `processIdentityLive=false` in the status output;
2. independently check that no validation process with the recorded PID/start identity exists;
3. do not kill unrelated PIDs;
4. only then acknowledge the incomplete validation state:

```bash
node scripts/worker-validation-job.mjs ack-incomplete <job-id>
```

Acknowledgement removes only the validation controller's active-job marker. It does not restart the worker, kill a process, alter cron or touch application/database state.

## Release provenance gate

All production validation profiles except `control-probe` require both:

```text
DEPLOYED_GIT_SHA
SHA256SUMS.release
```

The controller records at start:

- approved deployed Git SHA;
- SHA-256 of the installed release manifest;
- SHA-256 of the validation controller itself.

At completion it re-reads the release SHA and manifest hash. If either changed during validation, an otherwise green job is failed closed with a provenance error.

A successful validation is therefore tied to one stable worker release, rather than merely to one terminal session.

## Deployment gate after validation

A cron or other production scheduling mutation may proceed only when all of the following are independently true:

1. the desired validation job is `completed_success`;
2. `provenanceStable=true`;
3. `provenanceMatchesStart=true` at the fresh status check;
4. the worker/database quiet-window preflight is still green;
5. no natural pipeline writer has started since the validation began;
6. there is enough time to make and verify the scheduling change safely.

A disconnected terminal never waives these gates.

## Recommended Issue #104/#126 deployment validation

For a worker release, prefer:

```bash
node scripts/worker-validation-job.mjs start deployment-static
```

If only the worker TypeScript gate is needed, use:

```bash
node scripts/worker-validation-job.mjs start typecheck
```

If the initiating session disconnects, do not restart the command. Reconnect and inspect `status latest` first.

Do not use worker-local validation as a substitute for the full GitHub CI TypeScript and production-build gates.

## Control-plane acceptance probe

To prove that disconnect/reconnect is safe without touching production application state:

```bash
node scripts/worker-validation-job.mjs start control-probe
```

A second session can inspect the same job while it is running or after it finishes. This profile does not require release provenance because it is purely an operator-channel test and does not validate application source.

## Failure classification

Use these categories in deployment reports:

- `worker_runtime_failure` — persisted worker/application evidence proves the worker or validation command failed;
- `control_channel_failure` — terminal/session detached while worker state remains unknown or later proves healthy;
- `validation_failed` — detached validation completed with non-zero exit code;
- `validation_incomplete` — PID identity is no longer live but no durable completion result exists;
- `provenance_changed` — source/release marker changed while validation was running;
- `validation_passed` — completed exit `0` with stable provenance.

Do not report `worker_runtime_failure` solely because an interactive session disconnected.

## Production safety boundaries

The validation controller is not a deployment executor. It does not:

- edit crontab;
- deploy source;
- restart services;
- start the production pipeline;
- start recovery;
- call LLM/provider endpoints;
- migrate or remediate the database;
- expose `.env` values.

Cron installation, source deployment and production execution remain separately authorised controller actions.
