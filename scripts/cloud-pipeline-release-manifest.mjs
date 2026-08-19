#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const CRITICAL_FILES = [
  "pipeline-runner.ts",
  "run-pipeline.sh",
  "scripts/cloud-pipeline-release-manifest.mjs",
  "scripts/worker-validation-job.mjs",
  "docs/CLOUD-PIPELINE-SETUP.md",
  "docs/WORKER-CONTROL-CHANNEL.md",
  "server/dailyPipeline.ts",
  "server/pipelineExecutionSupervisor.ts",
  "server/pipelineRecovery.ts",
  "server/workerRecoveryGuard.ts",
  "server/operationsReliabilityV2.ts",
  "server/contractorEngineSubprocess.ts",
  "server/contractorEngineWorker.ts",
  "server/contractorEngineIncremental.ts",
  "server/contractorEngineIncrementalPolicy.ts",
  "server/contactEnrichment.ts",
  "server/apolloEnrichment.ts",
  "server/hunterVerification.ts",
  "server/lushaEnrichment.ts",
  "server/routers/contactValidation.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "tsconfig.worker.json",
];
const TREE_ROOTS = ["server", "drizzle", "shared"];
const TREE_TOP_LEVEL = [
  "pipeline-runner.ts",
  "run-pipeline.sh",
  "scripts/cloud-pipeline-release-manifest.mjs",
  "scripts/worker-validation-job.mjs",
  "docs/CLOUD-PIPELINE-SETUP.md",
  "docs/WORKER-CONTROL-CHANNEL.md",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "tsconfig.worker.json",
];

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256File(path) {
  return sha256Buffer(readFileSync(resolve(ROOT, path)));
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function gitMode(path) {
  const staged = git(["ls-files", "--stage", "--", path]);
  if (!staged) throw new Error(`Tracked release file missing from Git index: ${path}`);
  return staged.split(/\s+/)[0];
}

function walk(path) {
  const abs = resolve(ROOT, path);
  const stat = statSync(abs);
  if (stat.isFile()) return [path];
  return readdirSync(abs)
    .sort()
    .flatMap(name => walk(relative(ROOT, resolve(abs, name))));
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const expectedSha = argValue("--expected-sha");
const output = argValue("--output");
const allowDirty = process.argv.includes("--allow-dirty");

const gitSha = git(["rev-parse", "HEAD"]);
const dirty = git(["status", "--porcelain"]);

if (expectedSha && gitSha !== expectedSha) {
  console.error(`Release SHA mismatch: HEAD=${gitSha}, expected=${expectedSha}`);
  process.exit(2);
}

if (dirty && !allowDirty) {
  console.error("Refusing to attest a dirty working tree. Commit/stash changes or pass --allow-dirty for a non-production diagnostic only.");
  process.exit(3);
}

const critical = Object.fromEntries(CRITICAL_FILES.map(path => [path, sha256File(path)]));
const treeFiles = [
  ...TREE_ROOTS.flatMap(walk),
  ...TREE_TOP_LEVEL,
].sort();
const fileModes = Object.fromEntries(treeFiles.map(path => [path, gitMode(path)]));

const treeDescriptor = treeFiles
  .map(path => `${path}\0${fileModes[path]}\0${sha256File(path)}`)
  .join("\n");

const manifest = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  gitSha,
  cleanWorkingTree: dirty.length === 0,
  releaseTreeSha256: sha256Buffer(Buffer.from(treeDescriptor, "utf8")),
  criticalFiles: critical,
  fileModes,
  treeFileCount: treeFiles.length,
};

const json = `${JSON.stringify(manifest, null, 2)}\n`;
if (output) {
  writeFileSync(resolve(ROOT, output), json, "utf8");
} else {
  process.stdout.write(json);
}
