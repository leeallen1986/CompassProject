#!/usr/bin/env node
import { createConnection } from "mysql2/promise";
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoSecrets,
  parseDatabaseUrl,
  sanitizeMessage,
} from "./issue86-phase2a-preflight-core.mjs";
import {
  RECURRING_PROJECT_REQUIRED_COLUMNS,
  RECURRING_PROJECT_SNAPSHOT_SQL,
  assertRequiredProjectColumns,
  assertRecurringSnapshotBounds,
  assertSelectOnlyGrantProfile,
  assertSnapshotSqlManifest,
  buildRecurringProjectSnapshotDocument,
  canonicalJson,
  canonicalSha256,
  sha256,
} from "../server/recurringProjectSnapshotSafety.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const SNAPSHOT_FILENAME = "recurring-project-snapshot.json";
const MANIFEST_FILENAME = "recurring-project-snapshot-manifest.json";

function parsePositiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(value ?? "")) {
    throw new Error(`${label}_INVALID`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label}_INVALID`);
  return parsed;
}

function parseCli(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("SNAPSHOT_CLI_USAGE_INVALID");
    }
    if (values.has(key)) throw new Error(`SNAPSHOT_CLI_DUPLICATE:${key}`);
    values.set(key, value);
  }
  const allowed = new Set([
    "--output-dir",
    "--source-sha",
    "--from-id",
    "--to-id",
    "--max-rows",
    "--database-url-env",
  ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`SNAPSHOT_CLI_OPTION_REJECTED:${key}`);
  }
  const outputDirValue = values.get("--output-dir");
  const sourceSha = values.get("--source-sha");
  if (!outputDirValue || !sourceSha || !/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error(
      "SNAPSHOT_CLI_USAGE: --output-dir <new-dir> --source-sha <40-hex> --from-id <n> --to-id <n> --max-rows <n> [--database-url-env <name>]",
    );
  }
  const databaseUrlEnv = values.get("--database-url-env") ?? "DATABASE_URL";
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(databaseUrlEnv)) {
    throw new Error("SNAPSHOT_DATABASE_URL_ENV_INVALID");
  }
  const bounds = assertRecurringSnapshotBounds({
    fromProjectId: parsePositiveInteger(values.get("--from-id"), "SNAPSHOT_FROM_ID"),
    toProjectId: parsePositiveInteger(values.get("--to-id"), "SNAPSHOT_TO_ID"),
    maximumRows: parsePositiveInteger(
      values.get("--max-rows"),
      "SNAPSHOT_MAX_ROWS",
    ),
  });
  return {
    outputDir: resolve(outputDirValue),
    sourceSha,
    databaseUrlEnv,
    bounds,
  };
}

function validateOutputLocation(outputDir) {
  const fromRepository = relative(PROJECT_ROOT, outputDir);
  if (
    fromRepository === "" ||
    (fromRepository !== ".." && !fromRepository.startsWith(`..${sep}`))
  ) {
    throw new Error("SNAPSHOT_OUTPUT_INSIDE_REPOSITORY_REJECTED");
  }
  try {
    lstatSync(outputDir);
    throw new Error("SNAPSHOT_OUTPUT_ALREADY_EXISTS");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = dirname(outputDir);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error("SNAPSHOT_OUTPUT_PARENT_INVALID");
  }
  if (realpathSync(parent) !== parent) {
    throw new Error("SNAPSHOT_OUTPUT_PARENT_NOT_CANONICAL");
  }
}

function reserveOutputDirectory(outputDir) {
  mkdirSync(outputDir, { mode: 0o700 });
  const stat = lstatSync(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("SNAPSHOT_OUTPUT_DIRECTORY_INSECURE");
  }
}

function writeAtomic(outputDir, filename, text) {
  const finalPath = join(outputDir, filename);
  const temporaryPath = join(outputDir, `.${filename}.tmp-${process.pid}`);
  const bytes = Buffer.from(text, "utf8");
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const fd = openSync(
    temporaryPath,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      noFollow,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new Error("SNAPSHOT_OUTPUT_FILE_INSECURE");
    }
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, finalPath);
  return { filename, byteSize: bytes.length, sha256: sha256(bytes) };
}

function exactColumns(row, columns, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${label}_ROW_INVALID`);
  }
  const actual = Object.keys(row).sort();
  const expected = [...columns].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label}_COLUMN_SHAPE_MISMATCH`);
  }
}

function resultRows(result, statementId) {
  const rows = result?.[0];
  if (!Array.isArray(rows)) throw new Error(`SNAPSHOT_RESULT_INVALID:${statementId}`);
  return rows;
}

class LockedSnapshotExecutor {
  constructor(connection) {
    this.connection = connection;
    this.transcript = [];
  }

  async run(statementId, values = []) {
    const statement = RECURRING_PROJECT_SNAPSHOT_SQL[statementId];
    if (!statement) throw new Error(`SNAPSHOT_STATEMENT_UNKNOWN:${statementId}`);
    const result = await this.connection.query(statement.sql, values);
    const rows = resultRows(result, statementId);
    this.transcript.push({
      sequence: this.transcript.length + 1,
      statementId,
      method: statement.method,
      sqlSha256: sha256(statement.sql),
      boundValueCount: values.length,
      rowCount: rows.length,
    });
    return rows;
  }
}

function parseCount(value, label) {
  const text = String(value ?? "");
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`${label}_INVALID`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label}_INVALID`);
  return parsed;
}

function localInsecureOverride(config) {
  if (process.env.RECURRING_SNAPSHOT_ALLOW_INSECURE_LOCALHOST !== "1") {
    return config;
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(config.host)) {
    throw new Error("SNAPSHOT_INSECURE_OVERRIDE_NON_LOCALHOST_REJECTED");
  }
  const copy = { ...config };
  delete copy.ssl;
  return copy;
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  validateOutputLocation(cli.outputDir);
  const sqlManifest = assertSnapshotSqlManifest();
  const rawDatabaseUrl = process.env[cli.databaseUrlEnv];
  const parsedDatabase = parseDatabaseUrl(rawDatabaseUrl);
  const secrets = { highRisk: parsedDatabase.secrets.highRisk, contextual: [] };
  const connectionConfig = localInsecureOverride({
    ...parsedDatabase.config,
    connectTimeout: 20_000,
  });

  let connection;
  let outputReserved = false;
  try {
    connection = await createConnection(connectionConfig);
    const executor = new LockedSnapshotExecutor(connection);

    const engineRows = await executor.run("ENGINE_IDENTITY");
    if (engineRows.length !== 1) throw new Error("SNAPSHOT_ENGINE_ROW_COUNT");
    exactColumns(
      engineRows[0],
      [
        "engineVersion",
        "engineComment",
        "currentUserSha256",
        "targetIdentitySha256",
      ],
      "SNAPSHOT_ENGINE",
    );

    const grantRows = await executor.run("SHOW_GRANTS");
    const grantProfile = assertSelectOnlyGrantProfile(
      grantRows,
      parsedDatabase.config.database,
    );

    const columnRows = await executor.run(
      "REQUIRED_COLUMNS",
      [...RECURRING_PROJECT_REQUIRED_COLUMNS],
    );
    assertRequiredProjectColumns(columnRows);

    const countRows = await executor.run("RANGE_COUNT", [
      cli.bounds.fromProjectId,
      cli.bounds.toProjectId,
    ]);
    if (countRows.length !== 1) throw new Error("SNAPSHOT_RANGE_COUNT_ROW_COUNT");
    exactColumns(
      countRows[0],
      ["rowCount", "minimumProjectId", "maximumProjectId"],
      "SNAPSHOT_RANGE_COUNT",
    );
    const rowCount = parseCount(countRows[0].rowCount, "SNAPSHOT_ROW_COUNT");
    if (rowCount > cli.bounds.maximumRows) {
      throw new Error(
        `SNAPSHOT_ROW_COUNT_EXCEEDS_MAXIMUM:${rowCount}:${cli.bounds.maximumRows}`,
      );
    }

    const projectRows = await executor.run("PROJECT_ROWS", [
      cli.bounds.fromProjectId,
      cli.bounds.toProjectId,
      cli.bounds.maximumRows + 1,
    ]);
    if (projectRows.length !== rowCount) {
      throw new Error("SNAPSHOT_COUNT_AND_PROJECT_ROWS_DIVERGED");
    }
    if (projectRows.length > cli.bounds.maximumRows) {
      throw new Error("SNAPSHOT_RESULT_EXCEEDS_MAXIMUM_ROWS");
    }

    const snapshot = buildRecurringProjectSnapshotDocument({
      sourceSha: cli.sourceSha,
      bounds: cli.bounds,
      rows: projectRows,
    });
    const snapshotSha256 = canonicalSha256(snapshot);
    const minimumProjectId =
      snapshot.projects.length > 0 ? snapshot.projects[0].id : null;
    const maximumProjectId =
      snapshot.projects.length > 0
        ? snapshot.projects[snapshot.projects.length - 1].id
        : null;
    const engine = engineRows[0];
    for (const field of [
      "currentUserSha256",
      "targetIdentitySha256",
    ]) {
      if (!/^[0-9a-f]{64}$/.test(String(engine[field] ?? ""))) {
        throw new Error(`SNAPSHOT_ENGINE_HASH_INVALID:${field}`);
      }
    }

    const manifest = {
      version: 1,
      mode: "read_only_project_snapshot_manifest",
      sourceSha: snapshot.sourceSha,
      snapshotRef: snapshot.snapshotRef,
      generatedAt: new Date().toISOString(),
      queryManifestSha256: sqlManifest.queryManifestSha256,
      snapshotSha256,
      projectCount: snapshot.projects.length,
      minimumProjectId,
      maximumProjectId,
      rowBounds: snapshot.rowBounds,
      database: {
        engineVersion: String(engine.engineVersion ?? ""),
        engineComment: String(engine.engineComment ?? ""),
        currentUserSha256: String(engine.currentUserSha256),
        targetIdentitySha256: String(engine.targetIdentitySha256),
        grantProfileSha256: grantProfile.grantProfileSha256,
        grantProfile: "select_only",
      },
      executor: {
        connectionCount: 1,
        statementCount: executor.transcript.length,
        transcriptSha256: canonicalSha256(executor.transcript),
      },
      safety: {
        databaseWriteStatementsExecuted: 0,
        projectMutations: 0,
        projectMerges: 0,
        projectDeletions: 0,
        recurringProgrammesCreated: 0,
        recurringOccurrencesCreated: 0,
        projectActionsCreated: 0,
        fullPotentialActionsCreated: 0,
        fullPotentialMonetaryMutations: 0,
        crmC4cMutations: 0,
        providerCalls: 0,
        pipelineInvocations: 0,
      },
    };

    assertNoSecrets(snapshot, secrets);
    assertNoSecrets(manifest, secrets);
    reserveOutputDirectory(cli.outputDir);
    outputReserved = true;
    const snapshotMeta = writeAtomic(
      cli.outputDir,
      SNAPSHOT_FILENAME,
      canonicalJson(snapshot),
    );
    const manifestMeta = writeAtomic(
      cli.outputDir,
      MANIFEST_FILENAME,
      canonicalJson(manifest),
    );
    const dirFd = openSync(cli.outputDir, fsConstants.O_RDONLY);
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
    process.stdout.write(
      canonicalJson({
        status: "PASS",
        sourceSha: cli.sourceSha,
        snapshotRef: snapshot.snapshotRef,
        projectCount: snapshot.projects.length,
        snapshotSha256,
        outputFiles: [snapshotMeta, manifestMeta],
        grantProfile: "select_only",
        databaseWriteStatementsExecuted: 0,
      }),
    );
  } catch (error) {
    if (outputReserved) rmSync(cli.outputDir, { recursive: true, force: true });
    throw new Error(
      sanitizeMessage(error instanceof Error ? error.message : error, {
        highRisk: parsedDatabase.secrets.highRisk,
        contextual: [],
      }),
    );
  } finally {
    if (connection) await connection.end();
  }
}

main().catch(error => {
  process.stderr.write(
    canonicalJson({
      status: "BLOCKED",
      error: String(error instanceof Error ? error.message : error).slice(0, 512),
    }),
  );
  process.exitCode = 1;
});
