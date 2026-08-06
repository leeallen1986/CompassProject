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
const CORE_PATH = fileURLToPath(
  new URL("./issue86-phase2a-preflight-core.mjs", import.meta.url),
);

const DISCOVERY_SQL = Object.freeze({
  ENGINE_IDENTITY:
    "SELECT VERSION() AS versionString, @@version_comment AS versionComment, SHA2(CURRENT_USER(), 256) AS currentUserSha256, SHA2(CONCAT_WS(CHAR(0), @@server_uuid, DATABASE(), @@port, CURRENT_USER()), 256) AS targetIdentitySha256",
  CURRENT_ROLE: "SELECT CURRENT_ROLE() AS currentRole",
  SHOW_GRANTS: "SHOW GRANTS",
  SHOW_CREATE_USER: "SHOW CREATE USER CURRENT_USER()",
  TLS_STATUS:
    "SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_cipher','Ssl_version')",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function oneValueRows(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label}_ROWS_INVALID`);
  return rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${label}_ROW_INVALID`);
    }
    const values = Object.values(row);
    if (values.length !== 1 || typeof values[0] !== "string") {
      throw new Error(`${label}_ROW_SHAPE_INVALID`);
    }
    return values[0].trim();
  });
}

function inspectTransport(connection) {
  const stream = connection?.connection?.stream;
  const certificate = stream?.getPeerCertificate?.();
  const fingerprint = String(certificate?.fingerprint256 ?? "")
    .replaceAll(":", "")
    .toLowerCase();
  return {
    encrypted: stream?.encrypted === true,
    authorized: stream?.authorized === true,
    authorizationErrorPresent: Boolean(stream?.authorizationError),
    protocol: stream?.getProtocol?.() ?? null,
    cipher: stream?.getCipher?.()?.name ?? null,
    peerCertificateSha256:
      /^[0-9a-f]{64}$/.test(fingerprint) ? fingerprint : null,
  };
}

function grantSummary(grants, canonicalHash) {
  const patterns = {
    hasSelect: /\bSELECT\b/i,
    hasInsert: /\bINSERT\b/i,
    hasUpdate: /\bUPDATE\b/i,
    hasDelete: /\bDELETE\b/i,
    hasCreate: /\bCREATE\b/i,
    hasAlter: /\bALTER\b/i,
    hasDrop: /\bDROP\b/i,
    hasIndex: /\bINDEX\b/i,
    hasTrigger: /\bTRIGGER\b/i,
    hasEvent: /\bEVENT\b/i,
    hasExecute: /\bEXECUTE\b/i,
    hasFile: /\bFILE\b/i,
    hasProcess: /\bPROCESS\b/i,
    hasSuper: /\bSUPER\b/i,
    hasReload: /\bRELOAD\b/i,
    hasShutdown: /\bSHUTDOWN\b/i,
    hasReplication: /\bREPLICATION\b/i,
    hasGrantOption: /\bGRANT OPTION\b/i,
    hasSystemUser: /\bSYSTEM_USER\b/i,
    hasConnectionAdmin: /\bCONNECTION_ADMIN\b/i,
  };
  const flags = Object.fromEntries(
    Object.entries(patterns).map(([key, pattern]) => [
      key,
      grants.some(grant => pattern.test(grant)),
    ]),
  );
  const nonSelectKeys = Object.keys(flags).filter(
    key => key !== "hasSelect" && flags[key] === true,
  );
  return {
    rowCount: grants.length,
    canonicalSha256: canonicalHash([...grants].sort()),
    ...flags,
    nonSelectPrivilegeFlags: nonSelectKeys,
    appearsSelectOnly: flags.hasSelect === true && nonSelectKeys.length === 0,
  };
}

function parseTlsStatus(rows) {
  if (!Array.isArray(rows)) throw new Error("TLS_STATUS_ROWS_INVALID");
  const result = {};
  for (const row of rows) {
    const name = row?.Variable_name ?? row?.variableName;
    const value = row?.Value ?? row?.value;
    if (
      !["Ssl_cipher", "Ssl_version"].includes(name) ||
      Object.hasOwn(result, name)
    ) {
      throw new Error("TLS_STATUS_SHAPE_INVALID");
    }
    result[name] = String(value ?? "");
  }
  if (!Object.hasOwn(result, "Ssl_cipher") || !Object.hasOwn(result, "Ssl_version")) {
    throw new Error("TLS_STATUS_INCOMPLETE");
  }
  return result;
}

class DiscoveryExecutor {
  constructor(connection) {
    this.connection = connection;
    this.statementIds = [];
  }

  async run(statementId) {
    const sql = DISCOVERY_SQL[statementId];
    if (!sql) throw new Error(`UNKNOWN_DISCOVERY_STATEMENT:${statementId}`);
    this.statementIds.push(statementId);
    const [rows] = await this.connection.query(sql);
    if (!Array.isArray(rows)) throw new Error(`DISCOVERY_RESULT_INVALID:${statementId}`);
    return rows;
  }
}

export async function runProductionDiscovery({
  env = process.env,
  connectionFactory,
  core,
}) {
  if (core === undefined) {
    core = await import("./issue86-phase2a-preflight-core.mjs");
  }
  const { canonicalHash, classifyEngine, parseDatabaseUrl } = core;
  if (
    typeof canonicalHash !== "function" ||
    typeof classifyEngine !== "function" ||
    typeof parseDatabaseUrl !== "function"
  ) {
    throw new Error("DISCOVERY_CORE_IMPLEMENTATION_INVALID");
  }

  if (connectionFactory === undefined) {
    const module = await import("mysql2/promise");
    connectionFactory = module.createConnection;
  }
  if (typeof connectionFactory !== "function") {
    throw new Error("DISCOVERY_CONNECTION_FACTORY_INVALID");
  }

  const normalized = normaliseDatabaseUrlForPreflight(env.DATABASE_URL);
  const parsed = parseDatabaseUrl(normalized.sanitizedDatabaseUrl);
  const config = {
    ...parsed.config,
    connectTimeout: 10000,
  };

  let connection = null;
  let connectionClosed = false;
  const result = {
    discoveryType: "issue86_phase2a_read_only",
    connectionAttempts: 0,
    connectionsEstablished: 0,
    connectionClosed: false,
    databaseWrites: 0,
    migrationCommands: 0,
    urlPolicy: normalized.policyEvidence,
    urlPolicySha256: normalized.policySha256,
    queryManifestSha256: canonicalHash(DISCOVERY_SQL),
    sourceAttestation: {
      discoveryScriptSha256: sha256(readFileSync(SCRIPT_PATH)),
      policyModuleSha256: sha256(readFileSync(POLICY_PATH)),
      coreModuleSha256: sha256(readFileSync(CORE_PATH)),
    },
  };

  try {
    result.connectionAttempts = 1;
    connection = await connectionFactory(config);
    result.connectionsEstablished = 1;
    const executor = new DiscoveryExecutor(connection);
    result.transport = inspectTransport(connection);
    if (
      result.transport.encrypted !== true ||
      result.transport.authorized !== true ||
      result.transport.authorizationErrorPresent !== false ||
      !result.transport.peerCertificateSha256
    ) {
      throw new Error("DISCOVERY_TLS_NOT_VERIFIED");
    }

    const identityRows = await executor.run("ENGINE_IDENTITY");
    if (identityRows.length !== 1) throw new Error("ENGINE_IDENTITY_ROW_COUNT");
    const identity = identityRows[0];
    result.engine = classifyEngine(
      identity.versionString,
      identity.versionComment,
    );
    result.currentUserSha256 = String(identity.currentUserSha256 ?? "");
    result.targetIdentitySha256 = String(identity.targetIdentitySha256 ?? "");
    if (!/^[0-9a-f]{64}$/.test(result.currentUserSha256)) {
      throw new Error("CURRENT_USER_HASH_INVALID");
    }
    if (!/^[0-9a-f]{64}$/.test(result.targetIdentitySha256)) {
      throw new Error("TARGET_IDENTITY_HASH_INVALID");
    }

    const roleRows = await executor.run("CURRENT_ROLE");
    if (roleRows.length !== 1 || Object.keys(roleRows[0] ?? {}).length !== 1) {
      throw new Error("CURRENT_ROLE_SHAPE_INVALID");
    }
    const currentRole = String(roleRows[0].currentRole ?? "");
    result.currentRole = {
      none: currentRole === "NONE",
      canonicalSha256: canonicalHash(currentRole),
    };

    const grants = oneValueRows(
      await executor.run("SHOW_GRANTS"),
      "SHOW_GRANTS",
    );
    result.grants = grantSummary(grants, canonicalHash);

    try {
      const createStatements = oneValueRows(
        await executor.run("SHOW_CREATE_USER"),
        "SHOW_CREATE_USER",
      );
      result.accountDefinition = {
        accessible: true,
        rowCount: createStatements.length,
        canonicalSha256:
          createStatements.length === 1
            ? canonicalHash(createStatements[0])
            : null,
        requireSslOrX509:
          createStatements.length === 1 &&
          /\bREQUIRE (?:SSL|X509)\b/i.test(createStatements[0]) &&
          !/\bREQUIRE NONE\b/i.test(createStatements[0]),
      };
    } catch {
      result.accountDefinition = {
        accessible: false,
        rowCount: null,
        canonicalSha256: null,
        requireSslOrX509: null,
      };
    }

    result.mysqlTlsStatus = parseTlsStatus(
      await executor.run("TLS_STATUS"),
    );
    result.executedStatementIds = executor.statementIds;
  } finally {
    if (connection) {
      await connection.end();
      connectionClosed = true;
    }
  }

  result.connectionClosed = connectionClosed;
  if (!connectionClosed) throw new Error("DISCOVERY_CONNECTION_NOT_CLOSED");
  return result;
}

export async function main() {
  try {
    const result = await runProductionDiscovery({});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = String(error?.message ?? "DISCOVERY_FAILED")
      .split(":")[0]
      .replace(/[^A-Z0-9_]/g, "_")
      .slice(0, 128);
    process.stderr.write(`productionDiscoveryFailure=${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
