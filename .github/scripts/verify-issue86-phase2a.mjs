import mysql from "mysql2/promise";

const tableColumns = {
  projectEvidenceClaimSources: [
    "id",
    "linkKey",
    "projectId",
    "claimId",
    "sourceId",
    "supportScope",
    "stance",
    "supportStrength",
    "isPrimary",
    "evidenceSummary",
    "sourceLocator",
    "createdBy",
    "createdByName",
    "createdAt",
    "revokedBy",
    "revokedByName",
    "revokedAt",
    "revocationReason",
  ],
  projectEvidenceClaims: [
    "id",
    "claimKey",
    "version",
    "currentKey",
    "targetFingerprint",
    "projectId",
    "claimType",
    "contactId",
    "contactProjectId",
    "contractorProjectLinkId",
    "organisationId",
    "organisationName",
    "organisationRole",
    "packageName",
    "packageScope",
    "claimedTitle",
    "buyerFunction",
    "assertedValue",
    "assertionMethod",
    "confidenceLevel",
    "confidenceScore",
    "status",
    "validFrom",
    "validTo",
    "assertedAt",
    "lastCheckedAt",
    "supersedesClaimId",
    "createdBy",
    "createdByName",
    "reviewedBy",
    "reviewedByName",
    "reviewedAt",
    "reviewNote",
    "createdAt",
    "updatedAt",
  ],
  projectEvidenceEvents: [
    "id",
    "eventKey",
    "projectId",
    "claimId",
    "sourceId",
    "claimSourceId",
    "eventType",
    "actorUserId",
    "actorName",
    "previousStatus",
    "nextStatus",
    "expectedRevision",
    "nextRevision",
    "reason",
    "createdAt",
  ],
  projectEvidenceSources: [
    "id",
    "sourceKey",
    "openDedupeKey",
    "projectId",
    "sourceType",
    "sourceName",
    "sourceUrl",
    "sourceHost",
    "sourceReference",
    "publisher",
    "documentTitle",
    "sourcePublishedAt",
    "observedAt",
    "retrievedAt",
    "lastCheckedAt",
    "validFrom",
    "validTo",
    "contentHash",
    "confidenceLevel",
    "privacyClass",
    "containsPersonalData",
    "status",
    "revision",
    "supersedesSourceId",
    "capturedBy",
    "capturedByName",
    "reviewedBy",
    "reviewedByName",
    "reviewedAt",
    "reviewNote",
    "revokedBy",
    "revokedByName",
    "revokedAt",
    "revocationReason",
    "createdAt",
    "updatedAt",
  ],
};

const requiredIndexes = {
  projectEvidenceClaimSources: [
    "PRIMARY",
    "projectEvidenceClaimSources_linkKey_unique",
    "projectEvidenceClaimSources_binding_uidx",
    "projectEvidenceClaimSources_id_project_uidx",
    "projectEvidenceClaimSources_project_claim_idx",
    "projectEvidenceClaimSources_claim_revoked_idx",
    "projectEvidenceClaimSources_source_revoked_idx",
  ],
  projectEvidenceClaims: [
    "PRIMARY",
    "projectEvidenceClaims_currentKey_unique",
    "projectEvidenceClaims_claim_version_uidx",
    "projectEvidenceClaims_id_project_uidx",
    "projectEvidenceClaims_project_status_type_idx",
    "projectEvidenceClaims_contact_status_idx",
    "projectEvidenceClaims_contact_project_status_idx",
    "projectEvidenceClaims_contractor_link_status_idx",
    "projectEvidenceClaims_organisation_status_idx",
    "projectEvidenceClaims_supersedes_idx",
  ],
  projectEvidenceEvents: [
    "PRIMARY",
    "projectEvidenceEvents_eventKey_unique",
    "projectEvidenceEvents_project_created_idx",
    "projectEvidenceEvents_claim_created_idx",
    "projectEvidenceEvents_source_created_idx",
    "projectEvidenceEvents_binding_created_idx",
  ],
  projectEvidenceSources: [
    "PRIMARY",
    "projectEvidenceSources_sourceKey_unique",
    "projectEvidenceSources_openDedupeKey_unique",
    "projectEvidenceSources_id_project_uidx",
    "projectEvidenceSources_project_status_idx",
    "projectEvidenceSources_status_checked_idx",
    "projectEvidenceSources_type_status_idx",
    "projectEvidenceSources_content_hash_idx",
    "projectEvidenceSources_supersedes_idx",
  ],
};

const expectedForeignKeyIndexColumns = {
  projectEvidenceClaimSources: {
    projectEvidenceClaimSources_claim_revoked_idx: [
      "claimId",
      "projectId",
      "revokedAt",
    ],
    projectEvidenceClaimSources_source_revoked_idx: [
      "sourceId",
      "projectId",
      "revokedAt",
    ],
  },
  projectEvidenceClaims: {
    projectEvidenceClaims_supersedes_idx: ["supersedesClaimId", "projectId"],
  },
  projectEvidenceEvents: {
    projectEvidenceEvents_claim_created_idx: [
      "claimId",
      "projectId",
      "createdAt",
    ],
    projectEvidenceEvents_source_created_idx: [
      "sourceId",
      "projectId",
      "createdAt",
    ],
    projectEvidenceEvents_binding_created_idx: [
      "claimSourceId",
      "projectId",
      "createdAt",
    ],
  },
  projectEvidenceSources: {
    projectEvidenceSources_supersedes_idx: ["supersedesSourceId", "projectId"],
  },
};

const expectedChecks = [
  "projectEvidenceClaimSources_key_locator_check@projectEvidenceClaimSources",
  "projectEvidenceClaimSources_non_promoting_check@projectEvidenceClaimSources",
  "projectEvidenceClaimSources_primary_check@projectEvidenceClaimSources",
  "projectEvidenceClaimSources_positive_ids_check@projectEvidenceClaimSources",
  "projectEvidenceClaimSources_revocation_check@projectEvidenceClaimSources",
  "projectEvidenceClaimSources_stance_strength_check@projectEvidenceClaimSources",
  "projectEvidenceClaimSources_summary_check@projectEvidenceClaimSources",
  "projectEvidenceClaims_active_review_check@projectEvidenceClaims",
  "projectEvidenceClaims_asserted_value_check@projectEvidenceClaims",
  "projectEvidenceClaims_confidence_score_check@projectEvidenceClaims",
  "projectEvidenceClaims_current_revision_check@projectEvidenceClaims",
  "projectEvidenceClaims_key_check@projectEvidenceClaims",
  "projectEvidenceClaims_optional_text_check@projectEvidenceClaims",
  "projectEvidenceClaims_positive_ids_check@projectEvidenceClaims",
  "projectEvidenceClaims_subject_check@projectEvidenceClaims",
  "projectEvidenceClaims_target_fingerprint_check@projectEvidenceClaims",
  "projectEvidenceClaims_validity_check@projectEvidenceClaims",
  "projectEvidenceClaims_version_check@projectEvidenceClaims",
  "projectEvidenceEvents_positive_ids_check@projectEvidenceEvents",
  "projectEvidenceEvents_key_check@projectEvidenceEvents",
  "projectEvidenceEvents_reason_check@projectEvidenceEvents",
  "projectEvidenceEvents_revision_check@projectEvidenceEvents",
  "projectEvidenceEvents_subject_check@projectEvidenceEvents",
  "projectEvidenceSources_approval_check@projectEvidenceSources",
  "projectEvidenceSources_content_hash_check@projectEvidenceSources",
  "projectEvidenceSources_decision_reason_check@projectEvidenceSources",
  "projectEvidenceSources_key_check@projectEvidenceSources",
  "projectEvidenceSources_lifecycle_check@projectEvidenceSources",
  "projectEvidenceSources_locator_check@projectEvidenceSources",
  "projectEvidenceSources_positive_ids_check@projectEvidenceSources",
  "projectEvidenceSources_revision_check@projectEvidenceSources",
  "projectEvidenceSources_revocation_check@projectEvidenceSources",
  "projectEvidenceSources_text_check@projectEvidenceSources",
  "projectEvidenceSources_url_host_check@projectEvidenceSources",
  "projectEvidenceSources_validity_check@projectEvidenceSources",
].sort();

const expectedForeignKeys = [
  "projectEvidenceClaimSources_claim_project_fk@projectEvidenceClaimSources(claimId,projectId)->projectEvidenceClaims(id,projectId)",
  "projectEvidenceClaimSources_source_project_fk@projectEvidenceClaimSources(sourceId,projectId)->projectEvidenceSources(id,projectId)",
  "projectEvidenceClaims_supersedes_project_fk@projectEvidenceClaims(supersedesClaimId,projectId)->projectEvidenceClaims(id,projectId)",
  "projectEvidenceEvents_binding_project_fk@projectEvidenceEvents(claimSourceId,projectId)->projectEvidenceClaimSources(id,projectId)",
  "projectEvidenceEvents_claim_project_fk@projectEvidenceEvents(claimId,projectId)->projectEvidenceClaims(id,projectId)",
  "projectEvidenceEvents_source_project_fk@projectEvidenceEvents(sourceId,projectId)->projectEvidenceSources(id,projectId)",
  "projectEvidenceSources_supersedes_project_fk@projectEvidenceSources(supersedesSourceId,projectId)->projectEvidenceSources(id,projectId)",
].sort();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const expectedTables = Object.keys(tableColumns).sort();
const placeholders = expectedTables.map(() => "?").join(", ");
const db = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [tables] = await db.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES " +
      "WHERE TABLE_SCHEMA = DATABASE() " +
      "AND TABLE_NAME IN (" +
      placeholders +
      ")",
    expectedTables,
  );
  const actualTables = tables.map((row) => row.name).sort();
  assert(
    JSON.stringify(actualTables) === JSON.stringify(expectedTables),
    "Unexpected Phase 2A tables: " + JSON.stringify(actualTables),
  );

  const quote = String.fromCharCode(96);
  for (const table of expectedTables) {
    const [rows] = await db.query(
      "SELECT COUNT(*) AS rowCount FROM " + quote + table + quote,
    );
    assert(Number(rows[0].rowCount) === 0, table + " did not start empty");
  }

  const [columns] = await db.query(
    "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, " +
      "IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault " +
      "FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() " +
      "AND TABLE_NAME IN (" +
      placeholders +
      ") " +
      "ORDER BY TABLE_NAME, ORDINAL_POSITION",
    expectedTables,
  );
  for (const table of expectedTables) {
    const actual = columns
      .filter((row) => row.tableName === table)
      .map((row) => row.columnName);
    assert(
      JSON.stringify(actual) === JSON.stringify(tableColumns[table]),
      "Unexpected columns for " + table + ": " + JSON.stringify(actual),
    );
  }

  const columnByKey = new Map(
    columns.map((row) => [row.tableName + "." + row.columnName, row]),
  );
  const expectColumn = (key, nullable, defaultValue) => {
    const row = columnByKey.get(key);
    assert(row, "Missing column contract: " + key);
    assert(row.isNullable === nullable, "Wrong nullability for " + key);
    assert(
      String(row.columnDefault) === String(defaultValue),
      "Wrong default for " + key + ": " + String(row.columnDefault),
    );
  };
  expectColumn("projectEvidenceSources.privacyClass", "NO", "restricted");
  expectColumn("projectEvidenceSources.containsPersonalData", "NO", "1");
  expectColumn("projectEvidenceSources.status", "NO", "proposed");
  expectColumn("projectEvidenceSources.revision", "NO", "1");
  expectColumn("projectEvidenceClaims.version", "NO", "1");
  expectColumn("projectEvidenceClaims.currentKey", "YES", "null");
  expectColumn("projectEvidenceClaims.assertionMethod", "NO", "manual");
  expectColumn("projectEvidenceClaims.status", "NO", "draft");
  expectColumn("projectEvidenceClaimSources.evidenceSummary", "NO", "null");
  expectColumn("projectEvidenceEvents.eventType", "NO", "null");

  const expectConstraintRejected = async (constraintNames, operation) => {
    const allowedConstraints = Array.isArray(constraintNames)
      ? constraintNames
      : [constraintNames];
    const label = allowedConstraints.join(" or ");
    await db.beginTransaction();
    let failure = null;
    try {
      await operation();
    } catch (error) {
      failure = error;
    } finally {
      await db.rollback();
    }
    assert(failure, "Expected constraint rejection: " + label);
    assert(
      failure.code === "ER_CHECK_CONSTRAINT_VIOLATED" ||
        Number(failure.errno) === 3819,
      "Unexpected rejection for " + label + ": " + failure.message,
    );
    assert(
      allowedConstraints.some((name) => String(failure.message).includes(name)),
      "Wrong constraint rejected test row for " + label,
    );
  };

  const insertValidClaim = async (suffix) => {
    const [result] = await db.query(
      "INSERT INTO projectEvidenceClaims " +
        "(claimKey, currentKey, targetFingerprint, projectId, claimType, " +
        "organisationName, assertedValue, assertedAt, lastCheckedAt, createdBy) " +
        "VALUES (?, ?, ?, 1, 'principal_organisation', 'Example Principal', " +
        "'Example Principal', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)",
      ["ci:claim:" + suffix, "ci:claim:" + suffix, "a".repeat(64)],
    );
    return Number(result.insertId);
  };

  const insertValidSource = async (suffix) => {
    const [result] = await db.query(
      "INSERT INTO projectEvidenceSources " +
        "(sourceKey, openDedupeKey, projectId, sourceType, sourceName, " +
        "sourceUrl, sourceHost, documentTitle, retrievedAt, lastCheckedAt, capturedBy) " +
        "VALUES (?, ?, 1, 'public_web', 'Example source', " +
        "'https://example.com/evidence', 'example.com', 'Example document', " +
        "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)",
      ["ci:source:" + suffix, "ci:source:" + suffix],
    );
    return Number(result.insertId);
  };

  await expectConstraintRejected(
    [
      "projectEvidenceSources_locator_check",
      "projectEvidenceSources_url_host_check",
    ],
    () =>
      db.query(
        "INSERT INTO projectEvidenceSources " +
          "(sourceKey, openDedupeKey, projectId, sourceType, sourceName, " +
          "sourceUrl, sourceHost, documentTitle, retrievedAt, lastCheckedAt, capturedBy) " +
          "VALUES ('ci:blank-source', 'ci:blank-source', 1, 'public_web', " +
          "'Example source', '   ', '   ', 'Example document', " +
          "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)",
      ),
  );

  await expectConstraintRejected(
    [
      "projectEvidenceClaims_optional_text_check",
      "projectEvidenceClaims_subject_check",
    ],
    () =>
      db.query(
        "INSERT INTO projectEvidenceClaims " +
          "(claimKey, currentKey, targetFingerprint, projectId, claimType, " +
          "organisationName, assertedValue, assertedAt, lastCheckedAt, createdBy) " +
          "VALUES ('ci:blank-claim', 'ci:blank-claim', ?, 1, " +
          "'principal_organisation', '   ', 'Example assertion', " +
          "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)",
        ["b".repeat(64)],
      ),
  );

  await expectConstraintRejected(
    "projectEvidenceClaimSources_non_promoting_check",
    async () => {
      const claimId = await insertValidClaim("non-promoting");
      const sourceId = await insertValidSource("non-promoting");
      await db.query(
        "INSERT INTO projectEvidenceClaimSources " +
          "(linkKey, projectId, claimId, sourceId, supportScope, stance, " +
          "supportStrength, isPrimary, evidenceSummary, createdBy) " +
          "VALUES ('ci:binding:non-promoting', 1, ?, ?, 'identity_only', " +
          "'supports', 'direct', true, 'Identity context only', 1)",
        [claimId, sourceId],
      );
    },
  );

  await expectConstraintRejected(
    "projectEvidenceEvents_subject_check",
    async () => {
      const claimId = await insertValidClaim("wrong-event-subject");
      await db.query(
        "INSERT INTO projectEvidenceEvents " +
          "(eventKey, projectId, claimId, eventType, actorUserId) " +
          "VALUES ('ci:event:wrong-subject', 1, ?, 'source_approved', 1)",
        [claimId],
      );
    },
  );

  for (const table of expectedTables) {
    const [rows] = await db.query(
      "SELECT COUNT(*) AS rowCount FROM " + quote + table + quote,
    );
    assert(Number(rows[0].rowCount) === 0, table + " retained CI probe rows");
  }

  const [indexRows] = await db.query(
    "SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, " +
      "COLUMN_NAME AS columnName, SEQ_IN_INDEX AS seqInIndex " +
      "FROM information_schema.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() " +
      "AND TABLE_NAME IN (" +
      placeholders +
      ")",
    expectedTables,
  );
  for (const table of expectedTables) {
    const actual = [
      ...new Set(
        indexRows
          .filter((row) => row.tableName === table)
          .map((row) => row.indexName),
      ),
    ].sort();
    const expected = [...requiredIndexes[table]].sort();
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      "Unexpected indexes on " + table + ": " + JSON.stringify(actual),
    );

    for (const [indexName, expectedColumns] of Object.entries(
      expectedForeignKeyIndexColumns[table],
    )) {
      const actualColumns = indexRows
        .filter((row) => row.tableName === table && row.indexName === indexName)
        .sort((a, b) => Number(a.seqInIndex) - Number(b.seqInIndex))
        .map((row) => row.columnName);
      assert(
        JSON.stringify(actualColumns) === JSON.stringify(expectedColumns),
        "Wrong index columns for " +
          table +
          "." +
          indexName +
          ": " +
          JSON.stringify(actualColumns),
      );
    }
  }

  const [checkRows] = await db.query(
    "SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName " +
      "FROM information_schema.TABLE_CONSTRAINTS " +
      "WHERE CONSTRAINT_SCHEMA = DATABASE() " +
      "AND CONSTRAINT_TYPE = 'CHECK' " +
      "AND TABLE_NAME IN (" +
      placeholders +
      ")",
    expectedTables,
  );
  const actualChecks = checkRows
    .map((row) => row.constraintName + "@" + row.tableName)
    .sort();
  assert(
    JSON.stringify(actualChecks) === JSON.stringify(expectedChecks),
    "Unexpected check constraints: " + JSON.stringify(actualChecks),
  );

  const [foreignKeyRows] = await db.query(
    "SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, " +
      "COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS referencedTableName, " +
      "REFERENCED_COLUMN_NAME AS referencedColumnName, " +
      "ORDINAL_POSITION AS ordinalPosition " +
      "FROM information_schema.KEY_COLUMN_USAGE " +
      "WHERE CONSTRAINT_SCHEMA = DATABASE() " +
      "AND REFERENCED_TABLE_SCHEMA = DATABASE() " +
      "AND TABLE_NAME IN (" +
      placeholders +
      ")",
    expectedTables,
  );
  const foreignKeysByName = new Map();
  for (const row of foreignKeyRows) {
    const key =
      row.constraintName + "@" + row.tableName + "->" + row.referencedTableName;
    const entry = foreignKeysByName.get(key) ?? [];
    entry.push(row);
    foreignKeysByName.set(key, entry);
  }
  const actualForeignKeys = [...foreignKeysByName.entries()]
    .map(([key, rows]) => {
      const ordered = rows.sort(
        (a, b) => Number(a.ordinalPosition) - Number(b.ordinalPosition),
      );
      const [constraintAndTable, referencedTable] = key.split("->");
      return (
        constraintAndTable +
        "(" +
        ordered.map((row) => row.columnName).join(",") +
        ")->" +
        referencedTable +
        "(" +
        ordered.map((row) => row.referencedColumnName).join(",") +
        ")"
      );
    })
    .sort();
  assert(
    JSON.stringify(actualForeignKeys) === JSON.stringify(expectedForeignKeys),
    "Unexpected foreign keys: " + JSON.stringify(actualForeignKeys),
  );
} finally {
  await db.end();
}
