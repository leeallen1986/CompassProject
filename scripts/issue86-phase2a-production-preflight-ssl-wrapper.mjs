#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseDatabaseUrlForPreflight } from "./issue86-phase2a-database-url-policy.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const POLICY_PATH = fileURLToPath(
  new URL("./issue86-phase2a-database-url-policy.mjs", import.meta.url),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseWrapperCli(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length !== 2 ||
    argv[0] !== "--output-dir" ||
    typeof argv[1] !== "string" ||
    argv[1].length === 0 ||
    argv[1].startsWith("-")
  ) {
    throw new Error(
      "CLI_USAGE: expected exactly --output-dir <new-directory>",
    );
  }
  return { outputDir: resolve(argv[1]) };
}

export async function runWrappedPreflight({
  argv,
  env,
  runPreflightImpl,
  wrapperBytes = readFileSync(SCRIPT_PATH),
  policyBytes = readFileSync(POLICY_PATH),
}) {
  if (typeof runPreflightImpl !== "function") {
    throw new Error("RUN_PREFLIGHT_IMPLEMENTATION_MISSING");
  }

  const { outputDir } = parseWrapperCli(argv);
  const normalized = normaliseDatabaseUrlForPreflight(env?.DATABASE_URL);
  const delegatedEnv = {
    ...env,
    DATABASE_URL: normalized.sanitizedDatabaseUrl,
  };

  const result = await runPreflightImpl({
    outputDir,
    env: delegatedEnv,
  });

  return {
    result,
    wrapperAttestation: {
      wrapperSha256: sha256(wrapperBytes),
      policyModuleSha256: sha256(policyBytes),
      ...normalized.policyEvidence,
      policySha256: normalized.policySha256,
    },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const { runPreflight } = await import(
      "./issue86-phase2a-production-preflight.mjs"
    );
    const wrapped = await runWrappedPreflight({
      argv,
      env,
      runPreflightImpl: runPreflight,
    });
    process.stdout.write(
      `databaseUrlQueryPolicy=ignore_exact_ssl_once\n` +
        `queryValuesUsedForConnectionConfiguration=false\n` +
        `wrapperSha256=${wrapped.wrapperAttestation.wrapperSha256}\n` +
        `policyModuleSha256=${wrapped.wrapperAttestation.policyModuleSha256}\n` +
        `policySha256=${wrapped.wrapperAttestation.policySha256}\n` +
        `applyReadiness=${wrapped.result.final.applyReadiness}\n` +
        `applyAuthorized=false\n` +
        `migrationAppliedByThisPreflight=false\n` +
        `outputDir=${wrapped.result.outputDir}\n`,
    );
    process.exitCode = wrapped.result.exitCode;
  } catch (error) {
    const code = String(error?.message ?? "PREFLIGHT_WRAPPER_FAILED")
      .split(":")[0]
      .replace(/[^A-Z0-9_]/g, "_")
      .slice(0, 128);
    process.stderr.write(`preflightWrapperFailure=${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
