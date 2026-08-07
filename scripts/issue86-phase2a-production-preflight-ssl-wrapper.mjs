#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const POLICY_PATH = fileURLToPath(
  new URL("./issue86-phase2a-database-url-policy.mjs", import.meta.url),
);
const RUNNER_PATH = fileURLToPath(
  new URL("./issue86-phase2a-production-preflight.mjs", import.meta.url),
);
const CORE_PATH = fileURLToPath(
  new URL("./issue86-phase2a-preflight-core.mjs", import.meta.url),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requirePinnedHash(env, name, actual, mismatchCode) {
  const expected = env?.[name];
  if (!/^[0-9a-f]{64}$/.test(expected ?? "")) {
    throw new Error(`${name}_MISSING_OR_INVALID`);
  }
  if (actual !== expected) throw new Error(mismatchCode);
  return { expected, actual, matched: true };
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
  normaliseDatabaseUrlImpl,
  wrapperBytes = readFileSync(SCRIPT_PATH),
  policyBytes = readFileSync(POLICY_PATH),
  runnerBytes = readFileSync(RUNNER_PATH),
  coreBytes = readFileSync(CORE_PATH),
}) {
  const wrapperSha256 = sha256(wrapperBytes);
  const policyModuleSha256 = sha256(policyBytes);
  const runnerSha256 = sha256(runnerBytes);
  const coreSha256 = sha256(coreBytes);
  const wrapperPin = requirePinnedHash(
    env,
    "ISSUE86_PREFLIGHT_EXPECTED_WRAPPER_SHA256",
    wrapperSha256,
    "PREFLIGHT_WRAPPER_SHA256_MISMATCH",
  );
  const policyPin = requirePinnedHash(
    env,
    "ISSUE86_PREFLIGHT_EXPECTED_URL_POLICY_SHA256",
    policyModuleSha256,
    "PREFLIGHT_URL_POLICY_SHA256_MISMATCH",
  );
  const runnerPin = requirePinnedHash(
    env,
    "ISSUE86_PREFLIGHT_EXPECTED_TOOL_SHA256",
    runnerSha256,
    "PREFLIGHT_RUNNER_SHA256_MISMATCH",
  );
  const corePin = requirePinnedHash(
    env,
    "ISSUE86_PREFLIGHT_EXPECTED_CORE_SHA256",
    coreSha256,
    "PREFLIGHT_CORE_SHA256_MISMATCH",
  );

  if (normaliseDatabaseUrlImpl === undefined) {
    const policy = await import("./issue86-phase2a-database-url-policy.mjs");
    normaliseDatabaseUrlImpl = policy.normaliseDatabaseUrlForPreflight;
  }
  if (typeof normaliseDatabaseUrlImpl !== "function") {
    throw new Error("URL_POLICY_IMPLEMENTATION_MISSING");
  }

  if (runPreflightImpl === undefined) {
    const runner = await import("./issue86-phase2a-production-preflight.mjs");
    runPreflightImpl = runner.runPreflight;
  }
  if (typeof runPreflightImpl !== "function") {
    throw new Error("RUN_PREFLIGHT_IMPLEMENTATION_MISSING");
  }

  const { outputDir } = parseWrapperCli(argv);
  const normalized = normaliseDatabaseUrlImpl(env?.DATABASE_URL);
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
      wrapperSha256,
      policyModuleSha256,
      runnerSha256,
      coreSha256,
      wrapperPin,
      policyPin,
      runnerPin,
      corePin,
      ...normalized.policyEvidence,
      policySha256: normalized.policySha256,
    },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const wrapped = await runWrappedPreflight({ argv, env });
    process.stdout.write(
      `databaseUrlQueryPolicy=ignore_exact_ssl_once\n` +
        `queryValuesUsedForConnectionConfiguration=false\n` +
        `wrapperSha256=${wrapped.wrapperAttestation.wrapperSha256}\n` +
        `policyModuleSha256=${wrapped.wrapperAttestation.policyModuleSha256}\n` +
        `runnerSha256=${wrapped.wrapperAttestation.runnerSha256}\n` +
        `coreSha256=${wrapped.wrapperAttestation.coreSha256}\n` +
        `allSourcePinsMatched=${[
          wrapped.wrapperAttestation.wrapperPin,
          wrapped.wrapperAttestation.policyPin,
          wrapped.wrapperAttestation.runnerPin,
          wrapped.wrapperAttestation.corePin,
        ].every(pin => pin.matched)}\n` +
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
