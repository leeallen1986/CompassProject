#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const CRITICAL_FILES = [
  "server/dailyPipeline.ts",
  "server/contactEnrichment.ts",
  "server/apolloEnrichment.ts",
  "server/hunterVerification.ts",
  "server/lushaEnrichment.ts",
  "server/routers/contactValidation.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
];
const TREE_ROOTS = ["server", "drizzle", "shared"];
const TREE_TOP_LEVEL = ["package.json", "pnpm-lock.yaml", "tsconfig.json"];

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256File(path) {
  return sha256Buffer(readFileSync(resolve(ROOT, path)));
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
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

const treeDescriptor = treeFiles
  .map(path => `${path}\0${sha256File(path)}`)
  .join("\n");

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  gitSha,
  cleanWorkingTree: dirty.length === 0,
  releaseTreeSha256: sha256Buffer(Buffer.from(treeDescriptor, "utf8")),
  criticalFiles: critical,
  treeFileCount: treeFiles.length,
};

const json = `${JSON.stringify(manifest, null, 2)}\n`;
if (output) {
  writeFileSync(resolve(ROOT, output), json, "utf8");
} else {
  process.stdout.write(json);
}
