#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const ROOT = resolve(process.env.COMPASS_WORKER_ROOT || DEFAULT_ROOT);
const STATE_ROOT = join(ROOT, "logs", "worker-validation");
const ACTIVE_FILE = join(STATE_ROOT, "ACTIVE_JOB");
const LATEST_FILE = join(STATE_ROOT, "LATEST_JOB");
const START_LOCK = join(STATE_ROOT, ".start-lock");
const STEP_LOG_MAX_BYTES = 512 * 1024;
const STATUS_START_GRACE_MS = 10_000;
const KILL_GRACE_MS = 30_000;

const ISSUE104_TESTS = [
  "server/pipelineExecutionSupervisor.test.ts",
  "server/workerRecoveryGuard.test.ts",
  "server/operationsReliabilityV2.issue104.test.ts",
  "server/operationsReliabilityV2.issue115.test.ts",
  "server/pipelineWorkerRelease.issue104.test.ts",
  "server/selfHealingRetryTruth.test.ts",
  "server/pipelineRunReliability.test.ts",
  "server/pipelineRuntimePolicy.test.ts",
  "server/pipelineRuntimeIntegration.test.ts",
];

const WORKER_TYPECHECK_ARGS = ["exec", "tsc", "--noEmit", "-p", "tsconfig.worker.json"];

const PROFILE_DEFINITIONS = {
  "control-probe": {
    requiresProvenance: false,
    steps: [
      {
        name: "control-probe",
        command: process.execPath,
        args: [
          "-e",
          "setTimeout(() => { console.log('control-probe-ok'); }, 2000);",
        ],
        timeoutMs: 10_000,
      },
    ],
  },
  "shell-syntax": {
    requiresProvenance: true,
    steps: [
      {
        name: "shell-syntax",
        command: "bash",
        args: ["-n", "run-pipeline.sh"],
        timeoutMs: 60_000,
      },
    ],
  },
  "issue104-tests": {
    requiresProvenance: true,
    steps: [
      {
        name: "issue104-tests",
        command: "pnpm",
        args: ["exec", "vitest", "run", ...ISSUE104_TESTS],
        timeoutMs: 15 * 60_000,
      },
    ],
  },
  typecheck: {
    requiresProvenance: true,
    steps: [
      {
        name: "typecheck",
        command: "pnpm",
        args: WORKER_TYPECHECK_ARGS,
        timeoutMs: 20 * 60_000,
      },
    ],
  },
  "deployment-static": {
    requiresProvenance: true,
    steps: [
      {
        name: "shell-syntax",
        command: "bash",
        args: ["-n", "run-pipeline.sh"],
        timeoutMs: 60_000,
      },
      {
        name: "issue104-tests",
        command: "pnpm",
        args: ["exec", "vitest", "run", ...ISSUE104_TESTS],
        timeoutMs: 15 * 60_000,
      },
    ],
  },
};

function nowIso() {
  return new Date().toISOString();
}

function ensureStateRoot() {
  mkdirSync(STATE_ROOT, { recursive: true, mode: 0o700 });
  try {
    const mode = statSync(STATE_ROOT).mode & 0o777;
    if (mode !== 0o700) {
      // chmod is intentionally avoided here; deployment controls directory mode.
      // State files are still created under umask-like explicit 0600 semantics.
    }
  } catch {
    // A later filesystem operation will surface a concrete failure.
  }
}

function writePrivate(path, content) {
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
}

function atomicWrite(path, content) {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writePrivate(temp, content);
  renameSync(temp, path);
}

function readTrimmed(path) {
  if (!existsSync(path)) return null;
  const value = readFileSync(path, "utf8").trim();
  return value || null;
}

function safeJsonRead(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function sha256File(path) {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function releaseProvenance() {
  const rawSha = readTrimmed(join(ROOT, "DEPLOYED_GIT_SHA"));
  const releaseSha = rawSha && /^[a-f0-9]{40}$/.test(rawSha) ? rawSha : null;
  return {
    releaseSha,
    releaseManifestSha256: sha256File(join(ROOT, "SHA256SUMS.release")),
  };
}

function scriptSha256() {
  return sha256File(SCRIPT_PATH);
}

function validateJobId(value) {
  if (!value || !/^[A-Za-z0-9._-]{1,160}$/.test(value)) {
    throw new Error("Invalid validation job id");
  }
  return value;
}

function jobDir(jobId) {
  return join(STATE_ROOT, validateJobId(jobId));
}

function readProcStartTicks(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = raw.lastIndexOf(")");
    if (close < 0) return null;
    const fieldsFromState = raw.slice(close + 2).trim().split(/\s+/);
    return fieldsFromState[19] || null; // Linux /proc stat field 22: starttime.
  } catch {
    return null;
  }
}

function processIdentityMatches(pid, expectedTicks) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !expectedTicks) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return readProcStartTicks(pid) === expectedTicks;
}

function resolveJobId(value = "latest") {
  ensureStateRoot();
  if (!value || value === "latest") {
    const latest = readTrimmed(LATEST_FILE);
    if (!latest) throw new Error("No validation job has been recorded");
    return validateJobId(latest);
  }
  return validateJobId(value);
}

function deriveState(jobId) {
  const dir = jobDir(jobId);
  if (!existsSync(dir)) throw new Error(`Validation job not found: ${jobId}`);

  const result = safeJsonRead(join(dir, "result.json"));
  if (result && Number.isInteger(result.exitCode)) {
    return {
      state: result.exitCode === 0 ? "completed_success" : "completed_failed",
      result,
      live: false,
    };
  }

  const pidRaw = readTrimmed(join(dir, "pid"));
  const pid = pidRaw && /^\d+$/.test(pidRaw) ? Number(pidRaw) : null;
  const ticks = readTrimmed(join(dir, "proc_start_ticks"));
  if (pid && ticks && processIdentityMatches(pid, ticks)) {
    return { state: "running", result: null, live: true };
  }

  const meta = safeJsonRead(join(dir, "meta.json"));
  const createdAt = meta?.createdAt ? Date.parse(meta.createdAt) : Number.NaN;
  if (!pid && Number.isFinite(createdAt) && Date.now() - createdAt < STATUS_START_GRACE_MS) {
    return { state: "starting", result: null, live: false };
  }

  return { state: "incomplete", result: null, live: false };
}

function appendLog(dir, text) {
  appendFileSync(join(dir, "output.log"), text, { encoding: "utf8", mode: 0o600 });
}

function killProcessGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Process may already be gone.
    }
  }
}

function captureBoundedOutput(dir, stepName) {
  let remaining = STEP_LOG_MAX_BYTES;
  let truncated = false;

  return chunk => {
    if (remaining <= 0) {
      if (!truncated) {
        appendLog(dir, `\n[validation] step=${stepName} output_truncated_at_bytes=${STEP_LOG_MAX_BYTES}\n`);
        truncated = true;
      }
      return;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (buffer.length <= remaining) {
      appendFileSync(join(dir, "output.log"), buffer, { mode: 0o600 });
      remaining -= buffer.length;
      return;
    }

    appendFileSync(join(dir, "output.log"), buffer.subarray(0, remaining), { mode: 0o600 });
    remaining = 0;
    if (!truncated) {
      appendLog(dir, `\n[validation] step=${stepName} output_truncated_at_bytes=${STEP_LOG_MAX_BYTES}\n`);
      truncated = true;
    }
  };
}

async function runStep(dir, definition) {
  const startedAt = Date.now();
  appendLog(
    dir,
    `[validation] ts=${nowIso()} step=${definition.name} event=start timeout_ms=${definition.timeoutMs}\n`,
  );

  return await new Promise(resolveStep => {
    let child;
    let spawnError = null;
    let timedOut = false;
    let killTimer = null;
    const capture = captureBoundedOutput(dir, definition.name);

    try {
      child = spawn(definition.command, definition.args, {
        cwd: ROOT,
        env: process.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      spawnError = error;
    }

    if (!child) {
      const durationMs = Date.now() - startedAt;
      appendLog(
        dir,
        `[validation] ts=${nowIso()} step=${definition.name} event=spawn_failed duration_ms=${durationMs}\n`,
      );
      resolveStep({
        name: definition.name,
        exitCode: 127,
        durationMs,
        timedOut: false,
        spawnFailed: true,
      });
      return;
    }

    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", error => {
      spawnError = error;
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => killProcessGroup(child.pid, "SIGKILL"), KILL_GRACE_MS);
    }, definition.timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      const durationMs = Date.now() - startedAt;
      const exitCode = timedOut
        ? 124
        : spawnError
          ? 127
          : Number.isInteger(code)
            ? code
            : signal
              ? 125
              : 126;
      appendLog(
        dir,
        `[validation] ts=${nowIso()} step=${definition.name} event=end exit_code=${exitCode} timed_out=${timedOut ? 1 : 0} duration_ms=${durationMs}\n`,
      );
      resolveStep({
        name: definition.name,
        exitCode,
        durationMs,
        timedOut,
        spawnFailed: Boolean(spawnError),
      });
    });
  });
}

function requireProfile(profileName) {
  const definition = PROFILE_DEFINITIONS[profileName];
  if (!definition) {
    throw new Error(
      `Unknown validation profile: ${profileName}. Allowed: ${Object.keys(PROFILE_DEFINITIONS).join(", ")}`,
    );
  }
  return definition;
}

function acquireStartLock() {
  ensureStateRoot();
  try {
    mkdirSync(START_LOCK, { mode: 0o700 });
  } catch {
    throw new Error("Another validation start operation is in progress");
  }
  return () => rmSync(START_LOCK, { recursive: true, force: true });
}

function activeJobGuard() {
  const active = readTrimmed(ACTIVE_FILE);
  if (!active) return;
  const activeId = validateJobId(active);
  const state = deriveState(activeId).state;
  if (state === "completed_success" || state === "completed_failed") {
    rmSync(ACTIVE_FILE, { force: true });
    return;
  }
  if (state === "running" || state === "starting") {
    const error = new Error(`Validation job already active: ${activeId} (${state})`);
    error.exitCode = 75;
    throw error;
  }
  const error = new Error(
    `Previous validation job is incomplete: ${activeId}. Inspect it and use ack-incomplete only after proving its PID identity is not live.`,
  );
  error.exitCode = 76;
  throw error;
}

function makeJobId(profile) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${profile}-${process.pid}-${random}`;
}

function startJob(profileName) {
  const definition = requireProfile(profileName);
  const release = releaseProvenance();
  if (definition.requiresProvenance && (!release.releaseSha || !release.releaseManifestSha256)) {
    const error = new Error(
      "Attested worker provenance is required: DEPLOYED_GIT_SHA and SHA256SUMS.release must both be present and valid.",
    );
    error.exitCode = 77;
    throw error;
  }

  const releaseLock = acquireStartLock();
  try {
    activeJobGuard();
    const jobId = makeJobId(profileName);
    const dir = jobDir(jobId);
    mkdirSync(dir, { recursive: false, mode: 0o700 });
    const meta = {
      version: 1,
      jobId,
      profile: profileName,
      createdAt: nowIso(),
      releaseShaStart: release.releaseSha,
      releaseManifestSha256Start: release.releaseManifestSha256,
      validationScriptSha256: scriptSha256(),
    };
    atomicWrite(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    atomicWrite(ACTIVE_FILE, `${jobId}\n`);
    atomicWrite(LATEST_FILE, `${jobId}\n`);

    const child = spawn(process.execPath, [SCRIPT_PATH, "_run", jobId, profileName], {
      cwd: ROOT,
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    atomicWrite(join(dir, "launcher_pid"), `${child.pid ?? "unknown"}\n`);

    process.stdout.write(`${JSON.stringify({
      jobId,
      profile: profileName,
      state: "started",
      statusHint: `node scripts/worker-validation-job.mjs status ${jobId}`,
      latestHint: "node scripts/worker-validation-job.mjs status latest",
    })}\n`);
  } finally {
    releaseLock();
  }
}

async function runInternal(jobId, profileName) {
  const definition = requireProfile(profileName);
  const dir = jobDir(jobId);
  const meta = safeJsonRead(join(dir, "meta.json"));
  if (!meta || meta.jobId !== jobId || meta.profile !== profileName) {
    throw new Error("Validation job metadata does not match internal runner arguments");
  }

  atomicWrite(join(dir, "pid"), `${process.pid}\n`);
  const ticks = readProcStartTicks(process.pid);
  if (ticks) atomicWrite(join(dir, "proc_start_ticks"), `${ticks}\n`);
  atomicWrite(join(dir, "started_at"), `${nowIso()}\n`);
  appendLog(dir, `[validation] ts=${nowIso()} job=${jobId} profile=${profileName} event=runner_start\n`);

  const steps = [];
  let exitCode = 0;
  for (const step of definition.steps) {
    const result = await runStep(dir, step);
    steps.push(result);
    if (result.exitCode !== 0) {
      exitCode = result.exitCode;
      break;
    }
  }

  const endRelease = releaseProvenance();
  const provenanceStable =
    meta.releaseShaStart === endRelease.releaseSha &&
    meta.releaseManifestSha256Start === endRelease.releaseManifestSha256;

  if (definition.requiresProvenance && !provenanceStable && exitCode === 0) {
    exitCode = 78;
    appendLog(
      dir,
      `[validation] ts=${nowIso()} event=provenance_changed_during_validation\n`,
    );
  }

  const result = {
    version: 1,
    jobId,
    profile: profileName,
    completedAt: nowIso(),
    exitCode,
    state: exitCode === 0 ? "completed_success" : "completed_failed",
    provenanceStable,
    releaseShaStart: meta.releaseShaStart ?? null,
    releaseShaEnd: endRelease.releaseSha,
    releaseManifestSha256Start: meta.releaseManifestSha256Start ?? null,
    releaseManifestSha256End: endRelease.releaseManifestSha256,
    steps,
  };

  atomicWrite(join(dir, "completed_at"), `${result.completedAt}\n`);
  atomicWrite(join(dir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  atomicWrite(join(dir, "exit_code"), `${exitCode}\n`);
  appendLog(
    dir,
    `[validation] ts=${nowIso()} job=${jobId} event=runner_end exit_code=${exitCode} provenance_stable=${provenanceStable ? 1 : 0}\n`,
  );

  if (readTrimmed(ACTIVE_FILE) === jobId) rmSync(ACTIVE_FILE, { force: true });
  process.exitCode = exitCode;
}

function statusJob(requestedId) {
  const jobId = resolveJobId(requestedId);
  const dir = jobDir(jobId);
  const meta = safeJsonRead(join(dir, "meta.json"));
  const derived = deriveState(jobId);
  const pidRaw = readTrimmed(join(dir, "pid"));
  const pid = pidRaw && /^\d+$/.test(pidRaw) ? Number(pidRaw) : null;
  const ticks = readTrimmed(join(dir, "proc_start_ticks"));
  const currentRelease = releaseProvenance();
  const provenanceMatchesStart = meta
    ? meta.releaseShaStart === currentRelease.releaseSha &&
      meta.releaseManifestSha256Start === currentRelease.releaseManifestSha256
    : null;

  process.stdout.write(`${JSON.stringify({
    jobId,
    profile: meta?.profile ?? null,
    state: derived.state,
    pid,
    processIdentityLive: Boolean(pid && ticks && processIdentityMatches(pid, ticks)),
    createdAt: meta?.createdAt ?? null,
    startedAt: readTrimmed(join(dir, "started_at")),
    completedAt: derived.result?.completedAt ?? readTrimmed(join(dir, "completed_at")),
    exitCode: derived.result?.exitCode ?? null,
    provenanceStable: derived.result?.provenanceStable ?? null,
    provenanceMatchesStart,
    releaseShaStart: meta?.releaseShaStart ?? null,
    releaseShaCurrent: currentRelease.releaseSha,
    releaseManifestSha256Start: meta?.releaseManifestSha256Start ?? null,
    releaseManifestSha256Current: currentRelease.releaseManifestSha256,
    logPath: join(dir, "output.log"),
    incompleteRequiresAcknowledgement: derived.state === "incomplete",
  }, null, 2)}\n`);
}

function tailJob(requestedId, requestedLines) {
  const jobId = resolveJobId(requestedId);
  const dir = jobDir(jobId);
  const logPath = join(dir, "output.log");
  if (!existsSync(logPath)) return;
  const parsed = Number.parseInt(requestedLines || "80", 10);
  const lines = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 200)) : 80;
  const content = readFileSync(logPath, "utf8").split(/\r?\n/);
  process.stdout.write(`${content.slice(-lines).join("\n")}\n`);
}

function listJobs() {
  ensureStateRoot();
  const rows = readdirSync(STATE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => entry.name)
    .filter(name => /^[A-Za-z0-9._-]{1,160}$/.test(name))
    .sort()
    .slice(-20)
    .map(jobId => {
      const meta = safeJsonRead(join(jobDir(jobId), "meta.json"));
      const state = deriveState(jobId).state;
      return { jobId, profile: meta?.profile ?? null, state, createdAt: meta?.createdAt ?? null };
    });
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
}

function acknowledgeIncomplete(requestedId) {
  const jobId = resolveJobId(requestedId);
  const dir = jobDir(jobId);
  const derived = deriveState(jobId);
  if (derived.state !== "incomplete") {
    throw new Error(`Job ${jobId} is ${derived.state}, not incomplete`);
  }
  atomicWrite(
    join(dir, "acknowledged.json"),
    `${JSON.stringify({ jobId, acknowledgedAt: nowIso(), reason: "operator_confirmed_not_live" }, null, 2)}\n`,
  );
  if (readTrimmed(ACTIVE_FILE) === jobId) rmSync(ACTIVE_FILE, { force: true });
  process.stdout.write(`${JSON.stringify({ jobId, state: "incomplete_acknowledged" })}\n`);
}

function printProfiles() {
  process.stdout.write(`${JSON.stringify(Object.entries(PROFILE_DEFINITIONS).map(([name, value]) => ({
    name,
    requiresProvenance: value.requiresProvenance,
    steps: value.steps.map(step => ({ name: step.name, timeoutMs: step.timeoutMs })),
  })), null, 2)}\n`);
}

function printHelp() {
  process.stdout.write(`Worker validation job controller\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  node scripts/worker-validation-job.mjs start <profile>\n`);
  process.stdout.write(`  node scripts/worker-validation-job.mjs status [job-id|latest]\n`);
  process.stdout.write(`  node scripts/worker-validation-job.mjs tail [job-id|latest] [lines<=200]\n`);
  process.stdout.write(`  node scripts/worker-validation-job.mjs list\n`);
  process.stdout.write(`  node scripts/worker-validation-job.mjs profiles\n`);
  process.stdout.write(`  node scripts/worker-validation-job.mjs ack-incomplete <job-id>\n\n`);
  process.stdout.write(`Only fixed offline/static validation profiles are accepted. Arbitrary commands are not supported.\n`);
}

async function main() {
  ensureStateRoot();
  const [command = "help", arg1, arg2] = process.argv.slice(2);
  if (command === "start") return startJob(arg1);
  if (command === "status") return statusJob(arg1 || "latest");
  if (command === "tail") return tailJob(arg1 || "latest", arg2);
  if (command === "list") return listJobs();
  if (command === "profiles") return printProfiles();
  if (command === "ack-incomplete") return acknowledgeIncomplete(arg1);
  if (command === "_run") return await runInternal(validateJobId(arg1), arg2);
  return printHelp();
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[worker-validation] ${message}\n`);
  process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
});
