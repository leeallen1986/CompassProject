#!/usr/bin/env node
import { createConnection } from "mysql2/promise";
import { readFileSync, realpathSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import {
  SCRIPT_PATH, PROJECT_ROOT, TIDB_CORE_PATH, READ_POLICY_PATH, V3_POLICY_PATH,
  CLI_EXIT_PATH, ORIGINAL_CORE_PATH, URL_POLICY_PATH, FILES,
  parseArgs, reserveOutput, writePack, lintExtraSql, Executor, getConnectionId, exactKeys,
  validateTls, capture, expectedTranscript, runtime, pins, TIDB_PROFILE,
  classifyTidbDatabaseState, parseProductionDatabaseUrl, sourceAttestation,
  assertNoSecrets, canonicalHash, sanitizeMessage,
} from "./issue86-phase2a-production-tidb-preflight-v3-support.mjs";
import { canonicalJson, hashBytes, expectedTidb0090Contract, validateTidbCapabilities } from "./issue86-phase2a-tidb-preflight-core.mjs";
import { lintTidbReadOnlySqlManifest } from "./issue86-phase2a-tidb-preflight-policy.mjs";
import { evaluateTidbV3Readiness, validateTidbAccountPolicy } from "./issue86-phase2a-tidb-preflight-v3-policy.mjs";
import { emitJsonResult } from "./issue86-phase2a-tidb-cli-exit-contract.mjs";

const now = () => new Date().toISOString();

export async function runTidbPreflightV3({
  outputDir,
  env = process.env,
  connectionFactory = createConnection,
}) {
  const startedAt = now();
  const readPolicy = lintTidbReadOnlySqlManifest();
  const v3SqlPolicy = lintExtraSql();
  if (!readPolicy.passed || !v3SqlPolicy.passed) {
    throw new Error(
      `TIDB_SQL_POLICY_FAILED:${[
        ...readPolicy.errors,
        ...v3SqlPolicy.errors,
      ].join(",")}`,
    );
  }
  const expected = pins(env);
  const source = sourceAttestation({
    projectRoot: PROJECT_ROOT,
    toolPath: SCRIPT_PATH,
    corePath: TIDB_CORE_PATH,
    expectedToolSha256: expected.tool,
    expectedCoreSha256: expected.tidbCore,
  });
  if (!source.passed) throw new Error(`TIDB_SOURCE_FAILED:${source.errors.join(",")}`);

  const actualReadPolicy = hashBytes(readFileSync(READ_POLICY_PATH));
  const actualV3Policy = hashBytes(readFileSync(V3_POLICY_PATH));
  const actualCliExit = hashBytes(readFileSync(CLI_EXIT_PATH));
  const actualOriginalCore = hashBytes(readFileSync(ORIGINAL_CORE_PATH));
  const actualUrlPolicy = hashBytes(readFileSync(URL_POLICY_PATH));
  if (actualReadPolicy !== expected.readPolicy) {
    throw new Error("TIDB_READ_POLICY_SHA_MISMATCH");
  }
  if (actualV3Policy !== expected.v3Policy) {
    throw new Error("TIDB_V3_POLICY_SHA_MISMATCH");
  }
  if (actualCliExit !== expected.cliExit) {
    throw new Error("TIDB_CLI_EXIT_SHA_MISMATCH");
  }
  if (actualOriginalCore !== expected.originalCore) {
    throw new Error("TIDB_ORIGINAL_CORE_SHA_MISMATCH");
  }
  if (actualUrlPolicy !== expected.urlPolicy) {
    throw new Error("TIDB_URL_POLICY_SHA_MISMATCH");
  }

  const runtimeEvidence = runtime();
  if (!runtimeEvidence.passed) throw new Error("TIDB_RUNTIME_MISMATCH");
  const { normalized, parsed } = parseProductionDatabaseUrl(env.DATABASE_URL);
  parsed.config.connectTimeout = 10000;
  reserveOutput(outputDir);

  let connection = null;
  let closed = false;
  let executor = null;
  let attempts = 0;
  let established = 0;
  let snapshotA = null;
  let snapshotB = null;
  let engine = null;
  let capabilities = null;
  let accountPolicy = null;
  let fatal = null;
  const connectionIds = [];
  const expected0090 = expectedTidb0090Contract(source.snapshot0090);
  const { snapshot0090: _snapshot, ...sourceWithoutSnapshot } = source;
  const secrets = {
    highRisk: parsed.secrets.highRisk,
    contextual: parsed.secrets.contextual,
  };

  try {
    attempts = 1;
    connection = await connectionFactory(parsed.config);
    established = 1;
    executor = new Executor(connection);
    connectionIds.push(await getConnectionId(executor));
    const tls = validateTls(
      connection,
      await executor.run("TLS_STATUS"),
      expected.peer,
    );
    if (!tls.verified) throw new Error("TIDB_TLS_NOT_VERIFIED");

    const identityRows = await executor.run("ENGINE_IDENTITY");
    if (identityRows.length !== 1) throw new Error("TIDB_ENGINE_COUNT");
    exactKeys(
      identityRows[0],
      [
        "versionString",
        "versionComment",
        "connectionId",
        "currentUserSha256",
        "targetIdentitySha256",
      ],
      "TIDB_ENGINE",
    );
    connectionIds.push(String(identityRows[0].connectionId));
    const engineExact =
      String(identityRows[0].versionString) === TIDB_PROFILE.exactVersion &&
      String(identityRows[0].versionComment) === TIDB_PROFILE.exactComment;

    const roleRows = await executor.run("CURRENT_ROLE");
    const grantRows = await executor.run("SHOW_GRANTS");
    const createUserRows = await executor.run("SHOW_CREATE_USER");
    capabilities = validateTidbCapabilities({
      globalVariableRows: await executor.run("GLOBAL_VARIABLES"),
      sessionVariableRows: await executor.run("SESSION_VARIABLES"),
      tableConstraintMetadataRows: await executor.run("TABLE_CONSTRAINTS_METADATA"),
      checkConstraintMetadataRows: await executor.run("CHECK_CONSTRAINTS_METADATA"),
      tidbCheckConstraintMetadataRows: await executor.run(
        "TIDB_CHECK_CONSTRAINTS_METADATA",
      ),
    });
    accountPolicy = validateTidbAccountPolicy({
      roleRows,
      grantRows,
      createUserRows,
      expectedRoleSha256: expected.role,
      expectedGrantSha256: expected.grants,
      expectedGrantRowCount: expected.grantRows,
      requireSecureTransportEnabled:
        capabilities.requireSecureTransportEnabled === true,
    });

    snapshotA = await capture(executor, expected0090);
    connectionIds.push(await getConnectionId(executor));
    snapshotB = await capture(executor, expected0090);
    connectionIds.push(await getConnectionId(executor));

    engine = {
      versionString: String(identityRows[0].versionString),
      versionComment: String(identityRows[0].versionComment),
      engineExact,
      currentUserSha256: String(identityRows[0].currentUserSha256),
      targetIdentitySha256: String(identityRows[0].targetIdentitySha256),
      accountIdentityMatched:
        String(identityRows[0].currentUserSha256) === expected.account,
      productionIdentityMatched:
        String(identityRows[0].targetIdentitySha256) === expected.identity,
      tls,
      accountPolicy,
      capabilities,
    };
  } catch (error) {
    fatal = sanitizeMessage(error?.message ?? "TIDB_PREFLIGHT_FAILED");
  } finally {
    if (connection) {
      try {
        await connection.end();
        closed = true;
      } catch (error) {
        fatal = fatal ?? sanitizeMessage(error?.message ?? "TIDB_CLOSE_FAILED");
      }
    }
  }

  const snapshotsEqual =
    snapshotA !== null &&
    snapshotB !== null &&
    canonicalHash(snapshotA) === canonicalHash(snapshotB);
  const connectionIdConsistent =
    connectionIds.length === 4 && new Set(connectionIds).size === 1;
  const transcriptExact =
    executor !== null &&
    canonicalJson(executor.ids()) === canonicalJson(expectedTranscript());
  const databaseState = snapshotB
    ? classifyTidbDatabaseState(snapshotB)
    : {
        databaseStateClassification: "BLOCKED_DATABASE_STATE_UNKNOWN",
        blocker: "BLOCKED_DATABASE_STATE_UNKNOWN",
      };
  const observedCensus = snapshotB?.checkCensus ?? null;
  const censusPinned =
    observedCensus !== null &&
    expected.censusSha256 !== null &&
    expected.censusCount !== null &&
    observedCensus.sha256 === expected.censusSha256 &&
    observedCensus.count === expected.censusCount;

  const facts = {
    sourceGatePassed: source.passed,
    runtimeProfilePassed: runtimeEvidence.passed,
    productionIdentityMatched: engine?.productionIdentityMatched === true,
    accountIdentityMatched: engine?.accountIdentityMatched === true,
    tlsVerified: engine?.tls?.verified === true,
    peerCertificatePinned: engine?.tls?.peerCertificatePinned === true,
    engineExact: engine?.engineExact === true,
    accountPolicyMatched: accountPolicy?.passed === true,
    transportPolicyEnforced:
      accountPolicy?.effectiveTransportRequired === true,
    oneConnectionOnly: attempts === 1 && established === 1,
    connectionIdConsistent,
    capabilitiesObserved: capabilities !== null,
    checkConstraintsEnabled: capabilities?.checksEnabled === true,
    foreignKeyFeatureEnabled: capabilities?.foreignKeyFeatureEnabled === true,
    globalForeignKeyChecksEnabled:
      capabilities?.globalForeignKeyChecksEnabled === true,
    sessionForeignKeyChecksEnabled:
      capabilities?.sessionForeignKeyChecksEnabled === true,
    noopFunctionsDisabled: capabilities?.noopFunctionsDisabled === true,
    metadataCapabilitiesExact:
      capabilities?.tableMetadataExact === true &&
      capabilities?.checkMetadataExact === true &&
      capabilities?.tidbCheckMetadataExact === true,
    checkCensusObserved: observedCensus?.observed === true,
    checkCensusPinned: censusPinned,
    journalSchemaExact:
      snapshotA?.journal?.schemaExact === true &&
      snapshotB?.journal?.schemaExact === true,
    predecessorFootprintExact:
      snapshotA?.predecessor?.exact === true &&
      snapshotB?.predecessor?.exact === true,
    snapshotsEqual,
    transcriptExact,
    connectionClosed: closed,
  };

  let verdict = evaluateTidbV3Readiness({ facts, databaseState });
  if (fatal) {
    verdict = {
      ...verdict,
      applyReadiness: "PREFLIGHT_INCOMPLETE",
      blockers: [...new Set([...verdict.blockers, fatal])],
    };
  }

  const sourceEvidence = {
    ...sourceWithoutSnapshot,
    runtime: runtimeEvidence,
    hashes: {
      tool: expected.tool,
      tidbCore: expected.tidbCore,
      readPolicy: {
        expected: expected.readPolicy,
        actual: actualReadPolicy,
        matched: actualReadPolicy === expected.readPolicy,
      },
      v3Policy: {
        expected: expected.v3Policy,
        actual: actualV3Policy,
        matched: actualV3Policy === expected.v3Policy,
      },
      cliExit: {
        expected: expected.cliExit,
        actual: actualCliExit,
        matched: actualCliExit === expected.cliExit,
      },
      originalCore: {
        expected: expected.originalCore,
        actual: actualOriginalCore,
        matched: actualOriginalCore === expected.originalCore,
      },
      urlPolicy: {
        expected: expected.urlPolicy,
        actual: actualUrlPolicy,
        matched: actualUrlPolicy === expected.urlPolicy,
      },
    },
    urlPolicy: normalized.policyEvidence,
    urlPolicySha256: normalized.policySha256,
    queryManifestSha256: v3SqlPolicy.sha256,
  };

  const readOnlyTranscript =
    transcriptExact &&
    executor !== null &&
    executor.transcript.every((row) => row.kind === "READ");
  const preflightWritesProvenZero =
    readOnlyTranscript &&
    accountPolicy?.passed === true &&
    closed &&
    connectionIdConsistent;

  const evidence = {
    source: sourceEvidence,
    engine: engine ?? { observed: false, capabilities, accountPolicy },
    journal: {
      databaseState,
      snapshotA: snapshotA?.journal ?? null,
      snapshotB: snapshotB?.journal ?? null,
    },
    schema: {
      checkConstraintCensus: observedCensus,
      expectedCheckConstraintCensus: {
        count: expected.censusCount,
        sha256: expected.censusSha256,
        pinned: censusPinned,
      },
      snapshotA: snapshotA
        ? { predecessor: snapshotA.predecessor, phase2a: snapshotA.phase2a }
        : null,
      snapshotB: snapshotB
        ? { predecessor: snapshotB.predecessor, phase2a: snapshotB.phase2a }
        : null,
      snapshotsEqual,
      snapshotASha256: snapshotA ? canonicalHash(snapshotA) : null,
      snapshotBSha256: snapshotB ? canonicalHash(snapshotB) : null,
    },
    zeroWrite: {
      connectionAttempts: attempts,
      connectionsEstablished: established,
      connectionClosed: closed,
      connectionIds,
      connectionIdConsistent,
      executedStatements: executor?.transcript ?? [],
      executorTranscriptExact: transcriptExact,
      databaseWritesByPreflightConnection: preflightWritesProvenZero ? 0 : null,
      globalProductionDatabaseWritesDuringWindow: "not_proven",
      migrationCommandsExecuted: 0,
    },
    final: {
      preflightType: "issue86_phase2a_tidb_read_only_v3",
      startedAt,
      completedAt: now(),
      exactEngineProfile: TIDB_PROFILE,
      facts,
      databaseState,
      checkConstraintCensus: observedCensus
        ? {
            count: observedCensus.count,
            sha256: observedCensus.sha256,
            empty: observedCensus.empty,
            safeForAutomaticEnablementAssessment:
              observedCensus.safeForAutomaticEnablementAssessment,
            pinned: censusPinned,
          }
        : null,
      ...verdict,
      applyAuthorized: false,
      migrationAppliedByThisPreflight: false,
      productionDatabaseWrites: preflightWritesProvenZero ? 0 : null,
    },
  };
  writePack(outputDir, evidence, secrets);
  return evidence.final;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const outputDir = parseArgs(argv);
    const final = await runTidbPreflightV3({ outputDir, env });
    return emitJsonResult(final);
  } catch (error) {
    const code = String(error?.message ?? "TIDB_PREFLIGHT_FAILED")
      .split(":")[0]
      .replace(/[^A-Z0-9_]/gi, "_")
      .slice(0, 128);
    writeSync(2, `tidbPreflightV3Failure=${code}\n`);
    return 1;
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(SCRIPT_PATH);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exit(await main());
}
