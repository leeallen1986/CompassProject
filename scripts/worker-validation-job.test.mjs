import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "worker-validation-job.mjs");
const ROOT = mkdtempSync(join(tmpdir(), "compass-worker-validation-"));
const ENV = { ...process.env, COMPASS_WORKER_ROOT: ROOT };

function invoke(args, expected = 0) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: ENV,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(
    result.status,
    expected,
    `command ${args.join(" ")} expected ${expected}, got ${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`,
  );
  return result;
}

function parseJson(result) {
  return JSON.parse(result.stdout);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

try {
  const profiles = parseJson(invoke(["profiles"]));
  assert.ok(profiles.some(profile => profile.name === "typecheck"));
  assert.ok(profiles.some(profile => profile.name === "deployment-static"));
  assert.ok(profiles.some(profile => profile.name === "control-probe"));
  assert.ok(!profiles.some(profile => profile.name === "build"), "worker controller must not offer a whole-app build profile");

  const deploymentStatic = profiles.find(profile => profile.name === "deployment-static");
  assert.deepEqual(
    deploymentStatic.steps.map(step => step.name),
    ["shell-syntax", "issue104-tests"],
    "deployment-static must stay cheap and deterministic; compile/build correctness belongs to exact-head CI",
  );

  const typecheck = profiles.find(profile => profile.name === "typecheck");
  assert.deepEqual(
    typecheck.steps.map(step => step.name),
    ["typecheck"],
    "worker-only TypeScript remains available as an explicitly requested diagnostic",
  );

  const controllerSource = readFileSync(SCRIPT, "utf8");
  assert.match(controllerSource, /tsconfig\.worker\.json/);
  assert.doesNotMatch(controllerSource, /args:\s*\["build"\]/);
  assert.doesNotMatch(controllerSource, /name:\s*"production-build"/);

  const invalid = spawnSync(process.execPath, [SCRIPT, "start", "bash -c echo unsafe"], {
    env: ENV,
    encoding: "utf8",
  });
  assert.notEqual(invalid.status, 0, "arbitrary commands must be rejected");

  const started = parseJson(invoke(["start", "control-probe"]));
  assert.equal(started.profile, "control-probe");
  assert.match(started.jobId, /^[A-Za-z0-9._-]+$/);

  const immediate = parseJson(invoke(["status", "latest"]));
  assert.equal(immediate.jobId, started.jobId);
  assert.ok(["starting", "running", "completed_success"].includes(immediate.state));

  let completed = immediate;
  for (let attempt = 0; attempt < 40 && completed.state !== "completed_success"; attempt++) {
    sleep(250);
    completed = parseJson(invoke(["status", started.jobId]));
  }
  assert.equal(completed.state, "completed_success");
  assert.equal(completed.exitCode, 0);
  assert.equal(completed.processIdentityLive, false);

  const log = invoke(["tail", started.jobId, "80"]).stdout;
  assert.match(log, /control-probe-ok/);
  assert.match(log, /event=runner_end exit_code=0/);

  const stateRoot = join(ROOT, "logs", "worker-validation");
  const fakeJob = "20990101T000000Z-fake-1-test";
  const fakeDir = join(stateRoot, fakeJob);
  mkdirSync(fakeDir, { recursive: true });
  writeFileSync(
    join(fakeDir, "meta.json"),
    `${JSON.stringify({ version: 1, jobId: fakeJob, profile: "control-probe", createdAt: "2000-01-01T00:00:00.000Z" })}\n`,
  );
  writeFileSync(join(fakeDir, "pid"), "999999999\n");
  writeFileSync(join(fakeDir, "proc_start_ticks"), "1\n");
  writeFileSync(join(stateRoot, "ACTIVE_JOB"), `${fakeJob}\n`);
  writeFileSync(join(stateRoot, "LATEST_JOB"), `${fakeJob}\n`);

  const incomplete = parseJson(invoke(["status", fakeJob]));
  assert.equal(incomplete.state, "incomplete");
  assert.equal(incomplete.incompleteRequiresAcknowledgement, true);

  const blockedStart = spawnSync(process.execPath, [SCRIPT, "start", "control-probe"], {
    env: ENV,
    encoding: "utf8",
  });
  assert.equal(blockedStart.status, 76, "ambiguous prior validation must fail closed");

  const acknowledged = parseJson(invoke(["ack-incomplete", fakeJob]));
  assert.equal(acknowledged.state, "incomplete_acknowledged");

  const restarted = parseJson(invoke(["start", "control-probe"]));
  assert.notEqual(restarted.jobId, fakeJob);

  let restartedDone = parseJson(invoke(["status", restarted.jobId]));
  for (let attempt = 0; attempt < 40 && restartedDone.state !== "completed_success"; attempt++) {
    sleep(250);
    restartedDone = parseJson(invoke(["status", restarted.jobId]));
  }
  assert.equal(restartedDone.state, "completed_success");

  process.stdout.write("Issue #122/#126 worker validation job tests passed.\n");
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
