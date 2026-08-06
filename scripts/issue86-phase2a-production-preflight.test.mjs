import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  MUTATION_COUNTER_NAMES,
  SQL_STATEMENTS,
  assertNoSecrets,
  buildExpected0090Contract,
  canonicalJson,
  classifyEngine,
  classifyJournalAndPhase2a,
  compareMutationCounters,
  evaluateReadiness,
  lintSqlManifest,
  parseDatabaseUrl,
  parseMutationCounters,
  validate0090Footprint,
  validateJournalSchema,
  verifySourceBundle,
} from "./issue86-phase2a-preflight-core.mjs";
import {
  runPreflight,
  validateGrantProfile,
} from "./issue86-phase2a-production-preflight.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const TOOL_PATH = join(SCRIPT_DIR, "issue86-phase2a-production-preflight.mjs");
const CORE_PATH = join(SCRIPT_DIR, "issue86-phase2a-preflight-core.mjs");
const SNAPSHOT_PATH = join(PROJECT_ROOT, "drizzle/meta/0090_snapshot.json");

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "issue86-preflight-"));
}

function statusRows(value = "0") {
  return MUTATION_COUNTER_NAMES.map((name) => ({
    Variable_name: name,
    Value: value,
  }));
}

const row0090 = {
  id: "91",
  hash: "8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2",
  createdAt: "1784077724863",
};

function readyFacts() {
  return {
    sourceGatePassed: true,
    runtimeProfilePassed: true,
    productionIdentityMatched: true,
    accountIdentityMatched: true,
    caPinned: true,
    peerCertificatePinned: true,
    tlsVerified: true,
    grantProfileMatched: true,
    oneConnectionOnly: true,
    readOnlySnapshotsEstablished: true,
    oracleMySql84ExactProfileMatched: true,
    rehearsedEngineVersionMatched: true,
    capabilitiesPassed: true,
    journalSchemaExact: true,
    predecessorFootprintExact: true,
    snapshotsEqual: true,
    connectionIdConsistent: true,
    rollbacksSucceeded: true,
    executorTranscriptExact: true,
    zeroWriteConfirmed: true,
    connectionClosedSuccessfully: true,
    databaseStateClassification: "READY_DATABASE_STATE",
  };
}

describe("source and SQL gates", () => {
  test("attests exact committed migration bytes, runtime files, journal and snapshot", () => {
    const result = verifySourceBundle({
      projectRoot: PROJECT_ROOT,
      toolPath: TOOL_PATH,
      corePath: CORE_PATH,
      expectedToolSha256: digest(TOOL_PATH),
      expectedCoreSha256: digest(CORE_PATH),
    });
    assert.equal(result.passed, true, result.errors.join(","));
    assert.equal(result.migration0090.byteSize, 5362);
    assert.equal(
      result.migration0090.sha256,
      "8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2",
    );
    assert.equal(result.migration0090.finalByteHex, "3b");
    assert.equal(result.migration0091.byteSize, 23270);
    assert.equal(result.inventory.segmentCount, 29);
    assert.equal(result.inventory.checkCount, 35);
  });

  test("rejects a runtime hash mismatch before any connection can be supplied", () => {
    const result = verifySourceBundle({
      projectRoot: PROJECT_ROOT,
      toolPath: TOOL_PATH,
      corePath: CORE_PATH,
      expectedToolSha256: "0".repeat(64),
      expectedCoreSha256: digest(CORE_PATH),
    });
    assert.equal(result.passed, false);
    assert.ok(result.errors.includes("RUNTIME_TOOL_SHA256_MISMATCH"));
  });

  test("detects high-risk secrets after JSON escaping", () => {
    for (const secret of [
      'ab"cd12',
      "ab\\cd12",
      "ab\ncd12",
      "pässword-2026",
      "ab%22cd12",
    ]) {
      assert.throws(
        () => assertNoSecrets({ detail: `prefix:${secret}:suffix` }, {
          highRisk: [secret],
        }),
        /EVIDENCE_SECRET_SCAN_FAILED/,
      );
    }
  });

  test("manifest is fixed, parameterless, query-only, and side-effect free", () => {
    const result = lintSqlManifest();
    assert.equal(result.passed, true, result.errors.join(","));
    assert.ok(result.statementCount > 20);
    for (const statement of Object.values(SQL_STATEMENTS)) {
      assert.equal(statement.method, "query");
      assert.equal(statement.sql.includes(";"), false);
    }
    assert.equal(
      SQL_STATEMENTS.COUNTERS.sql.includes("ORDER BY"),
      false,
      "SHOW STATUS must not use unsupported ORDER BY",
    );
  });
});

describe("URL, engine and counter policy", () => {
  test("builds an allowlisted mysql2 config without uri or URL options", () => {
    const parsed = parseDatabaseUrl(
      "mysql://preflight:secret@db.example:3306/compass",
    );
    assert.equal(parsed.config.host, "db.example");
    assert.equal(parsed.config.user, "preflight");
    assert.equal(parsed.config.database, "compass");
    assert.equal(parsed.config.multipleStatements, false);
    assert.equal(parsed.config.namedPlaceholders, false);
    assert.equal(parsed.config.flags, "-LOCAL_FILES");
    assert.equal("uri" in parsed.config, false);
  });

  for (const raw of [
    "",
    "postgres://u:p@h/db",
    "mysql://u:p@h/db?multipleStatements=true",
    "mysql://u:p@h/db#fragment",
    "mysql://u:p@h/a/b",
    "mysql://u@h/db",
    "mysql://:p@h/db",
  ]) {
    test(`rejects unsafe DATABASE_URL: ${raw || "<empty>"}`, () => {
      assert.throws(() => parseDatabaseUrl(raw));
    });
  }

  test("accepts only the anchored Oracle MySQL 8.4 profile", () => {
    assert.equal(
      classifyEngine("8.4.2", "MySQL Community Server - GPL")
        .oracleMySql84ExactProfileMatched,
      true,
    );
    for (const [version, comment] of [
      ["8.4.2-extra", "MySQL Community Server - GPL"],
      ["8.0.40", "MySQL Community Server - GPL"],
      ["9.0.0", "MySQL Community Server - GPL"],
      ["8.4.2-TiDB", "TiDB Server"],
      ["8.4.2", "Percona Server"],
      ["8.4.2", "Aurora"],
    ]) {
      assert.equal(
        classifyEngine(version, comment).oracleMySql84ExactProfileMatched,
        false,
      );
    }
  });

  test("empty, missing, duplicate and malformed mutation counters fail closed", () => {
    assert.throws(() => parseMutationCounters([]));
    assert.throws(() => parseMutationCounters(statusRows().slice(1)));
    assert.throws(() =>
      parseMutationCounters([
        ...statusRows(),
        { Variable_name: MUTATION_COUNTER_NAMES[0], Value: "0" },
      ]),
    );
    assert.throws(() =>
      parseMutationCounters(
        statusRows().map((row, index) =>
          index === 0 ? { ...row, Value: "01" } : row,
        ),
      ),
    );
  });

  test("all-zero exact counters prove only a zero delta", () => {
    const before = parseMutationCounters(statusRows("0"));
    const after = parseMutationCounters(statusRows("0"));
    const result = compareMutationCounters(before, after);
    assert.equal(result.allZero, true);

    const changed = parseMutationCounters(
      statusRows("0").map((row, index) =>
        index === 3 ? { ...row, Value: "1" } : row,
      ),
    );
    assert.equal(compareMutationCounters(before, changed).allZero, false);
  });
});

describe("central readiness and journal classification", () => {
  test("READY is constructed only when all gates are true and blockers are empty", () => {
    const result = evaluateReadiness(readyFacts());
    assert.equal(result.ready, true);
    assert.equal(result.blockers.length, 0);
    assert.equal(
      result.applyReadiness,
      "READY_FOR_SEPARATE_APPLY_AUTHORIZATION",
    );
    assert.equal(result.applyAuthorized, false);
    assert.equal(result.migrationAppliedByThisPreflight, false);
  });

  for (const key of Object.keys(readyFacts()).filter(
    (key) => key !== "databaseStateClassification",
  )) {
    test(`gate ${key} cannot fail open`, () => {
      const facts = readyFacts();
      facts[key] = false;
      const result = evaluateReadiness(facts);
      assert.equal(result.ready, false);
      assert.notEqual(
        result.applyReadiness,
        "READY_FOR_SEPARATE_APPLY_AUTHORIZATION",
      );
      assert.ok(result.blockers.length > 0);
    });
  }

  test("a pre-existing blocker can never be overwritten by a ready DB state", () => {
    const result = evaluateReadiness(readyFacts(), [
      "READ_ONLY_TRANSACTION_NOT_CONFIRMED",
    ]);
    assert.equal(result.ready, false);
    assert.ok(
      result.blockers.includes("READ_ONLY_TRANSACTION_NOT_CONFIRMED"),
    );
  });

  test("exact 0090 latest plus absent 0091 is the only ready DB state", () => {
    const result = classifyJournalAndPhase2a({
      relevantRows: [row0090],
      relevantCount: "1",
      latestRows: [row0090],
      phase2aTables: [],
      phase2aResidue: [],
    });
    assert.equal(result.databaseStateClassification, "READY_DATABASE_STATE");
    assert.equal(result.migration0090ExactAndLatest, true);
    assert.equal(result.migration0091JournalEntryAbsent, true);
  });

  test("known one-LF predecessor variant remains specifically blocked", () => {
    const lf = {
      id: "91",
      hash: "85ef1c42f3e252b837fcd6df2ce350f8c9af84b5854f934410a0c7b18a677d0f",
      createdAt: "1784077724863",
    };
    const result = classifyJournalAndPhase2a({
      relevantRows: [lf],
      relevantCount: "1",
      latestRows: [lf],
      phase2aTables: [],
      phase2aResidue: [],
    });
    assert.equal(
      result.databaseStateClassification,
      "BLOCKED_PREDECESSOR_HASH_VARIANT_REQUIRES_CONTROLLER_REVIEW",
    );
  });

  test("one-LF predecessor hash at a wrong timestamp cannot coexist with READY", () => {
    const lfWrongTimestamp = {
      id: "90",
      hash: "85ef1c42f3e252b837fcd6df2ce350f8c9af84b5854f934410a0c7b18a677d0f",
      createdAt: "1780000000000",
    };
    const result = classifyJournalAndPhase2a({
      relevantRows: [lfWrongTimestamp, row0090],
      relevantCount: "2",
      latestRows: [row0090, lfWrongTimestamp],
      phase2aTables: [],
      phase2aResidue: [],
    });
    assert.equal(
      result.databaseStateClassification,
      "BLOCKED_PREDECESSOR_DIVERGENCE",
    );
    assert.equal(result.migration0090ExactAndLatest, true);
    assert.equal(
      result.predecessorHashClassification,
      "exact_committed_source_bytes",
    );
  });

  test("partial or case-colliding Phase 2A footprint blocks", () => {
    const result = classifyJournalAndPhase2a({
      relevantRows: [row0090],
      relevantCount: "1",
      latestRows: [row0090],
      phase2aTables: [
        {
          tableName: "PROJECTEVIDENCESOURCES",
          tableType: "BASE TABLE",
          engine: "InnoDB",
        },
      ],
      phase2aResidue: [],
    });
    assert.equal(
      result.databaseStateClassification,
      "BLOCKED_PARTIAL_OR_CASE_COLLIDING_SCHEMA",
    );
  });

  test("noncanonical journal decimals and truncated results fail closed", () => {
    assert.throws(() =>
      classifyJournalAndPhase2a({
        relevantRows: [{ ...row0090, id: "01" }],
        relevantCount: "1",
        latestRows: [row0090],
        phase2aTables: [],
        phase2aResidue: [],
      }),
    );
    const result = classifyJournalAndPhase2a({
      relevantRows: [row0090],
      relevantCount: "1001",
      latestRows: [row0090],
      phase2aTables: [],
      phase2aResidue: [],
    });
    assert.equal(
      result.databaseStateClassification,
      "BLOCKED_JOURNAL_RESULT_TRUNCATED",
    );
  });
});

describe("0090 physical manifest", () => {
  test("derives the exact committed 0090 tables and real enum sentinels", () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    const expected = buildExpected0090Contract(snapshot);
    assert.equal(expected.tables.length, 6);
    const relationship = expected.columns.find(
      (row) =>
        row.tableName === "fullPotentialAccounts" &&
        row.columnName === "relationshipType",
    );
    const recordStatus = expected.columns.find(
      (row) =>
        row.tableName === "fullPotentialAccounts" &&
        row.columnName === "recordStatus",
    );
    assert.equal(
      relationship.columnType,
      "enum('standalone','parent','division','branch','site','service_unit','strategic_context','duplicate')",
    );
    assert.equal(
      recordStatus.columnType,
      "enum('active','under_review','merged','parked','excluded')",
    );
  });

  test("accepts the canonical manifest and rejects one-column drift", () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    const expected = buildExpected0090Contract(snapshot);
    const observation = {
      tables: structuredClone(expected.tables),
      columns: structuredClone(expected.columns),
      indexes: structuredClone(expected.indexes),
      constraints: structuredClone(expected.constraints),
      keys: structuredClone(expected.keys),
      referential: [],
      checks: [],
    };
    assert.equal(validate0090Footprint(observation, expected).exact, true);
    observation.columns[0].columnType = "varchar(1)";
    assert.equal(validate0090Footprint(observation, expected).exact, false);
  });
});

function journalSchemaRows() {
  return {
    tables: [
      {
        tableName: "__drizzle_migrations",
        tableType: "BASE TABLE",
        engine: "InnoDB",
      },
    ],
    columns: [
      {
        columnName: "id",
        dataType: "bigint",
        columnType: "bigint unsigned",
        isNullable: "NO",
        columnKey: "PRI",
        extra: "auto_increment",
        ordinalPosition: 1,
      },
      {
        columnName: "hash",
        dataType: "text",
        columnType: "text",
        isNullable: "NO",
        columnKey: "",
        extra: "",
        ordinalPosition: 2,
      },
      {
        columnName: "created_at",
        dataType: "bigint",
        columnType: "bigint",
        isNullable: "YES",
        columnKey: "",
        extra: "",
        ordinalPosition: 3,
      },
    ],
    indexes: [
      {
        indexName: "PRIMARY",
        nonUnique: 0,
        seqInIndex: 1,
        columnName: "id",
        subPart: null,
        indexType: "BTREE",
      },
    ],
    constraints: [
      {
        constraintName: "PRIMARY",
        constraintType: "PRIMARY KEY",
        enforced: "YES",
      },
    ],
    triggers: [],
  };
}

function readyProtocol() {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const expected = buildExpected0090Contract(snapshot);
  const journal = journalSchemaRows();
  const metadata = [
    ["JOURNAL_TABLES", journal.tables],
    ["JOURNAL_COLUMNS", journal.columns],
    ["JOURNAL_INDEXES", journal.indexes],
    ["JOURNAL_CONSTRAINTS", journal.constraints],
    ["JOURNAL_TRIGGERS", journal.triggers],
    ["JOURNAL_RELEVANT_COUNT", [{ rowCount: "1" }]],
    ["JOURNAL_RELEVANT", [row0090]],
    ["JOURNAL_LATEST", [row0090]],
    ["PREDECESSOR_TABLES", expected.tables],
    ["PREDECESSOR_COLUMNS", expected.columns],
    ["PREDECESSOR_INDEXES", expected.indexes],
    ["PREDECESSOR_CONSTRAINTS", expected.constraints],
    ["PREDECESSOR_KEYS", expected.keys],
    ["PREDECESSOR_REFERENTIAL", []],
    ["PREDECESSOR_CHECKS", []],
    ["PHASE2A_TABLES", []],
    ["PHASE2A_RESIDUE", []],
  ];
  const controls = (id) => [id, { affectedRows: 0 }];
  return [
    ["COUNTERS", statusRows()],
    ["CONNECTION_ID", [{ connectionId: "77" }]],
    [
      "TLS_STATUS",
      [
        { Variable_name: "Ssl_cipher", Value: "TLS_AES_256_GCM_SHA384" },
        { Variable_name: "Ssl_version", Value: "TLSv1.3" },
      ],
    ],
    [
      "ENGINE_IDENTITY",
      [
        {
          versionString: "8.4.2",
          versionComment: "MySQL Community Server - GPL",
          connectionId: "77",
          currentUserSha256: "b".repeat(64),
          targetIdentitySha256: "a".repeat(64),
        },
      ],
    ],
    ["CURRENT_ROLE", [{ currentRole: "NONE" }]],
    [
      "SHOW_GRANTS",
      [
        {
          "Grants for preflight@%":
            "GRANT USAGE ON *.* TO \`preflight\`@\`%\` REQUIRE SSL",
        },
        {
          "Grants for preflight@%":
            "GRANT SELECT ON \`compass_test\`.* TO \`preflight\`@\`%\`",
        },
      ],
    ],
    controls("SET_ISOLATION"),
    controls("SET_READ_ONLY"),
    controls("START_SNAPSHOT"),
    ["SHOW_WARNINGS", []],
    [
      "CONFIRM_SESSION",
      [
        {
          transactionReadOnly: "1",
          transactionIsolation: "REPEATABLE-READ",
          connectionId: "77",
        },
      ],
    ],
    [
      "ORACLE_CAPABILITIES",
      [
        {
          versionVariable: "8.4.2",
          versionComment: "MySQL Community Server - GPL",
          versionCompileOs: "Linux",
          versionCompileMachine: "x86_64",
          serverLicense: "GPL",
          lowerCaseTableNames: "0",
          defaultStorageEngine: "InnoDB",
          sessionForeignKeyChecks: "1",
          globalForeignKeyChecks: "1",
          sessionSqlMode: "STRICT_TRANS_TABLES",
          serverCharacterSet: "utf8mb4",
          serverCollation: "utf8mb4_0900_ai_ci",
        },
      ],
    ],
    [
      "TABLE_CONSTRAINTS_METADATA",
      [
        { columnName: "CONSTRAINT_SCHEMA" },
        { columnName: "CONSTRAINT_NAME" },
        { columnName: "TABLE_SCHEMA" },
        { columnName: "TABLE_NAME" },
        { columnName: "CONSTRAINT_TYPE" },
        { columnName: "ENFORCED" },
      ],
    ],
    [
      "CHECK_CONSTRAINTS_METADATA",
      [
        { columnName: "CONSTRAINT_CATALOG" },
        { columnName: "CONSTRAINT_SCHEMA" },
        { columnName: "CONSTRAINT_NAME" },
        { columnName: "CHECK_CLAUSE" },
      ],
    ],
    [
      "REGEXP_CAPABILITY",
      [
        {
          lowercaseAccepted: "1",
          uppercaseAccepted: "0",
          shortAccepted: "0",
        },
      ],
    ],
    ...metadata,
    controls("ROLLBACK"),
    ["CONNECTION_ID", [{ connectionId: "77" }]],
    controls("START_SNAPSHOT"),
    ["SHOW_WARNINGS", []],
    [
      "CONFIRM_SESSION",
      [
        {
          transactionReadOnly: "1",
          transactionIsolation: "REPEATABLE-READ",
          connectionId: "77",
        },
      ],
    ],
    ...metadata,
    controls("ROLLBACK"),
    ["COUNTERS", statusRows()],
    ["CONNECTION_ID", [{ connectionId: "77" }]],
  ];
}

function strictConnection(steps, outputDir) {
  let index = 0;
  let ended = false;
  const connection = {
    connection: {
      stream: {
        encrypted: true,
        authorized: true,
        authorizationError: null,
        getProtocol: () => "TLSv1.3",
        getCipher: () => ({ name: "TLS_AES_256_GCM_SHA384" }),
        getPeerCertificate: () => ({
          fingerprint256:
            "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA",
        }),
      },
    },
    async query(sql) {
      assert.equal(ended, false, "query after end");
      const step = steps[index++];
      assert.ok(step, `unexpected query at index ${index - 1}`);
      assert.equal(
        sql,
        SQL_STATEMENTS[step[0]].sql,
        `SQL mismatch for ${step[0]}`,
      );
      return [step[1], []];
    },
    async end() {
      assert.equal(index, steps.length, "unconsumed strict transcript steps");
      assert.equal(ended, false, "duplicate end");
      assert.equal(
        (() => {
          try {
            readFileSync(join(outputDir, "issue86-phase2a-preflight-final.json"));
            return true;
          } catch {
            return false;
          }
        })(),
        false,
        "evidence was written before connection closure",
      );
      ended = true;
    },
  };
  return connection;
}

describe("journal and grant exactness", () => {
  test("journal contract rejects column, index, constraint and trigger drift", () => {
    const base = journalSchemaRows();
    assert.equal(validateJournalSchema(base).exact, true);
    for (const mutate of [
      (value) => { value.columns[0].columnType = "bigint"; },
      (value) => { value.indexes.push({ ...value.indexes[0], indexName: "extra" }); },
      (value) => { value.constraints[0].constraintType = "UNIQUE"; },
      (value) => { value.triggers.push({ triggerName: "x", eventManipulation: "INSERT", actionTiming: "BEFORE" }); },
    ]) {
      const changed = structuredClone(base);
      mutate(changed);
      assert.equal(validateJournalSchema(changed).exact, false);
    }
  });

  test("grant contract requires exact USAGE REQUIRE SSL plus database SELECT", () => {
    const grantRows = [
      { grant: "GRANT USAGE ON *.* TO `preflight`@`%` REQUIRE SSL" },
      { grant: "GRANT SELECT ON `compass_test`.* TO `preflight`@`%`" },
    ];
    assert.equal(
      validateGrantProfile(grantRows, "NONE", "compass_test").matched,
      true,
    );
    const noSsl = structuredClone(grantRows);
    noSsl[0].grant = "GRANT USAGE ON *.* TO `preflight`@`%`";
    assert.equal(
      validateGrantProfile(noSsl, "NONE", "compass_test").matched,
      false,
    );
    assert.equal(
      validateGrantProfile([...grantRows, grantRows[1]], "NONE", "compass_test")
        .matched,
      false,
    );
    assert.equal(
      validateGrantProfile(grantRows, "`role`@`%`", "compass_test").matched,
      false,
    );
  });
});

describe("strict end-to-end fake protocol", () => {
  test("READY path consumes exact query-only sequence, closes, then writes evidence", async () => {
    const root = tempDir();
    const outputDir = join(root, "evidence");
    const caPath = join(root, "ca.pem");
    writeFileSync(
      caPath,
      "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n",
      { mode: 0o600 },
    );
    chmodSync(root, 0o700);
    process.env.ISSUE86_PREFLIGHT_EXPECTED_NODE_VERSION = process.version;
    const env = {
      DATABASE_URL:
        "mysql://preflight:secret-password@db.example:3306/compass_test",
      ISSUE86_PREFLIGHT_CA_FILE: caPath,
      ISSUE86_PREFLIGHT_EXPECTED_CA_SHA256: digest(caPath),
      ISSUE86_PREFLIGHT_EXPECTED_PEER_CERT_SHA256: "a".repeat(64),
      ISSUE86_PREFLIGHT_EXPECTED_NODE_VERSION: process.version,
      ISSUE86_PREFLIGHT_EXPECTED_TOOL_SHA256: digest(TOOL_PATH),
      ISSUE86_PREFLIGHT_EXPECTED_CORE_SHA256: digest(CORE_PATH),
      ISSUE86_PREFLIGHT_EXPECTED_DB_IDENTITY_SHA256: "a".repeat(64),
      ISSUE86_PREFLIGHT_EXPECTED_DB_ACCOUNT_SHA256: "b".repeat(64),
      ISSUE86_PREFLIGHT_EXPECTED_MYSQL_VERSION: "8.4.2",
    };
    const steps = readyProtocol();
    let factoryCalls = 0;
    try {
      const result = await runPreflight({
        outputDir,
        env,
        connectionFactory: async (config) => {
          factoryCalls += 1;
          assert.equal("uri" in config, false);
          assert.equal(config.multipleStatements, false);
          assert.equal(config.flags, "-LOCAL_FILES");
          assert.equal(config.ssl.rejectUnauthorized, true);
          return strictConnection(steps, outputDir);
        },
      });
      assert.equal(result.exitCode, 0);
      assert.equal(
        result.final.applyReadiness,
        "READY_FOR_SEPARATE_APPLY_AUTHORIZATION",
      );
      assert.equal(result.final.applyAuthorized, false);
      assert.equal(result.final.migrationAppliedByThisPreflight, false);
      assert.equal(factoryCalls, 1);
      const final = readFileSync(
        join(outputDir, "issue86-phase2a-preflight-final.json"),
        "utf8",
      );
      assert.equal(final.includes("secret-password"), false);
      assert.equal(final.includes("db.example"), false);
      assert.equal(final.includes("compass_test"), false);
      const files = readdirSync(outputDir).sort();
      assert.ok(files.includes("issue86-phase2a-preflight-COMPLETE.json"));
      assert.equal(files.length, 8);
      for (const filename of files) {
        const content = readFileSync(join(outputDir, filename), "utf8");
        assert.equal(content.includes("secret-password"), false);
        assert.equal(content.includes("db.example"), false);
        assert.equal(content.includes("compass_test"), false);
      }
    } finally {
      delete process.env.ISSUE86_PREFLIGHT_EXPECTED_NODE_VERSION;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
