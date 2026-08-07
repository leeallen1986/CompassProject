#!/usr/bin/env node
import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exitCodeForReadiness } from "./issue86-phase2a-tidb-preflight-v3-policy.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export function emitJsonResult(value) {
  writeSync(1, `${JSON.stringify(value, null, 2)}\n`);
  return exitCodeForReadiness(value?.applyReadiness);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  const readiness = String(process.argv[2] ?? "");
  process.exit(emitJsonResult({ applyReadiness: readiness }));
}
