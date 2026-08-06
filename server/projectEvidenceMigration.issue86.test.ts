import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  root,
  "drizzle",
  "0091_issue86_buyer_route_evidence.sql",
);
const journalPath = path.join(root, "drizzle", "meta", "_journal.json");
const previousSnapshotPath = path.join(
  root,
  "drizzle",
  "meta",
  "0090_snapshot.json",
);
const currentSnapshotPath = path.join(
  root,
  "drizzle",
  "meta",
  "0091_snapshot.json",
);
const schemaPath = path.join(root, "drizzle", "schema.ts");

const migration = readFileSync(migrationPath, "utf8");
const schema = readFileSync(schemaPath, "utf8");
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
  entries: Array<{
    idx: number;
    version: string;
    tag: string;
    breakpoints: boolean;
  }>;
};
const previousSnapshot = JSON.parse(
  readFileSync(previousSnapshotPath, "utf8"),
) as {
  id: string;
  tables: Record<string, unknown>;
};
const currentSnapshot = JSON.parse(
  readFileSync(currentSnapshotPath, "utf8"),
) as {
  id: string;
  prevId: string;
  dialect: string;
  version: string;
  tables: Record<string, unknown>;
};

const expectedTables = [
  "projectEvidenceClaimSources",
  "projectEvidenceClaims",
  "projectEvidenceEvents",
  "projectEvidenceSources",
] as const;
const expectedIndexes = [
  "projectEvidenceClaimSources_claim_revoked_idx@projectEvidenceClaimSources(claimId,projectId,revokedAt)",
  "projectEvidenceClaimSources_project_claim_idx@projectEvidenceClaimSources(projectId,claimId)",
  "projectEvidenceClaimSources_source_revoked_idx@projectEvidenceClaimSources(sourceId,projectId,revokedAt)",
  "projectEvidenceClaims_contact_project_status_idx@projectEvidenceClaims(contactProjectId,status,validTo)",
  "projectEvidenceClaims_contact_status_idx@projectEvidenceClaims(contactId,status,validTo)",
  "projectEvidenceClaims_contractor_link_status_idx@projectEvidenceClaims(contractorProjectLinkId,status)",
  "projectEvidenceClaims_organisation_status_idx@projectEvidenceClaims(organisationId,status)",
  "projectEvidenceClaims_project_status_type_idx@projectEvidenceClaims(projectId,status,claimType,validTo)",
  "projectEvidenceClaims_supersedes_idx@projectEvidenceClaims(supersedesClaimId,projectId)",
  "projectEvidenceEvents_binding_created_idx@projectEvidenceEvents(claimSourceId,projectId,createdAt)",
  "projectEvidenceEvents_claim_created_idx@projectEvidenceEvents(claimId,projectId,createdAt)",
  "projectEvidenceEvents_project_created_idx@projectEvidenceEvents(projectId,createdAt)",
  "projectEvidenceEvents_source_created_idx@projectEvidenceEvents(sourceId,projectId,createdAt)",
  "projectEvidenceSources_content_hash_idx@projectEvidenceSources(contentHash)",
  "projectEvidenceSources_project_status_idx@projectEvidenceSources(projectId,status)",
  "projectEvidenceSources_status_checked_idx@projectEvidenceSources(status,lastCheckedAt,validTo)",
  "projectEvidenceSources_supersedes_idx@projectEvidenceSources(supersedesSourceId,projectId)",
  "projectEvidenceSources_type_status_idx@projectEvidenceSources(sourceType,status)",
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
const previousJournalHash =
  "66d15645799b1d20844691fd728d1bf21fed6b486bb04700f1a42976ab277866";

describe("Issue 86 Phase 2A migration contract", () => {
  it("is a forward-only, empty, additive migration", () => {
    const segments = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    const createTables: string[] = [];
    const indexes: string[] = [];
    const foreignKeys: string[] = [];
    const indexPositions: number[] = [];
    const foreignKeyPositions: number[] = [];

    for (const [position, statement] of segments.entries()) {
      expect(statement.match(/;/g)).toHaveLength(1);
      const table = statement.match(/^CREATE TABLE `([^\`]+)` \([\s\S]*\);$/);
      if (table) {
        createTables.push(table[1]);
        continue;
      }

      const index = statement.match(
        /^CREATE INDEX `([^\`]+)` ON `([^\`]+)` \(([^)]+)\);$/,
      );
      if (index) {
        const columns = index[3].replace(/[`\s]/g, "");
        indexes.push(`${index[1]}@${index[2]}(${columns})`);
        indexPositions.push(position);
        continue;
      }

      const foreignKey = statement.match(
        /^ALTER TABLE `([^\`]+)` ADD CONSTRAINT `([^\`]+)` FOREIGN KEY \(([^)]+)\) REFERENCES `([^\`]+)`\(([^)]+)\);$/,
      );
      if (foreignKey) {
        const childColumns = foreignKey[3].replace(/[`\s]/g, "");
        const parentColumns = foreignKey[5].replace(/[`\s]/g, "");
        foreignKeys.push(
          `${foreignKey[2]}@${foreignKey[1]}(${childColumns})->${foreignKey[4]}(${parentColumns})`,
        );
        foreignKeyPositions.push(position);
        continue;
      }

      throw new Error(
        `Unexpected statement in additive migration: ${statement.slice(0, 120)}`,
      );
    }

    expect(createTables).toEqual(expectedTables);
    expect(indexes.sort()).toEqual(expectedIndexes);
    expect(foreignKeys.sort()).toEqual(expectedForeignKeys);
    expect(Math.max(...indexPositions)).toBeLessThan(
      Math.min(...foreignKeyPositions),
    );
    expect(migration).not.toMatch(
      /\bREFERENCES\b[^;]*\bON (?:DELETE|UPDATE)\b/i,
    );
    expect(segments).toHaveLength(
      expectedTables.length +
        expectedIndexes.length +
        expectedForeignKeys.length,
    );
  });

  it("contains the exact claim, source, and binding boundaries", () => {
    expect(migration).toContain(
      "`claimType` enum('principal_organisation','project_organisation_participation','package_ownership','contact_employment','contact_project_participation','buyer_authority')",
    );
    expect(migration).toContain(
      "`supportScope` enum('principal_organisation','project_organisation_participation','package_ownership','contact_employment','contact_project_participation','buyer_authority','identity_only','contactability_only')",
    );
    expect(migration).toContain(
      "`stance` enum('supports','contradicts','context_only')",
    );
    expect(migration).toContain(
      "`status` enum('proposed','approved','rejected','revoked','superseded')",
    );
    expect(migration).toContain(
      "CONSTRAINT `projectEvidenceClaims_currentKey_unique` UNIQUE(`currentKey`)",
    );
    expect(migration).toContain(
      "CONSTRAINT `projectEvidenceClaimSources_binding_uidx` UNIQUE(`claimId`,`sourceId`,`supportScope`)",
    );
    expect(migration).toContain(
      "CONSTRAINT `projectEvidenceClaims_target_fingerprint_check`",
    );
    expect(migration).toContain(
      "CONSTRAINT `projectEvidenceSources_content_hash_check`",
    );
    expect(migration).not.toContain("supersedes_self_check");
    expect(migration).toContain(
      "REGEXP_LIKE(`projectEvidenceClaims`.`targetFingerprint`, '^[0-9a-f]{64}$', 'c')",
    );
    expect(migration).toContain(
      "REGEXP_LIKE(`projectEvidenceSources`.`contentHash`, '^[0-9a-f]{64}$', 'c')",
    );
    expect(migration).toContain(
      "CONSTRAINT `projectEvidenceClaims_subject_check`",
    );
    expect(migration).toContain(
      "CONSTRAINT `projectEvidenceClaimSources_non_promoting_check`",
    );
    expect(migration).toContain(
      "CONSTRAINT `projectEvidenceEvents_subject_check`",
    );
    expect(migration).toContain("CHAR_LENGTH(TRIM(");
    expect(migration).toContain(
      "`supportScope` NOT IN ('identity_only', 'contactability_only')",
    );
    expect(migration).toContain(
      "`eventType` IN ('source_submitted', 'source_approved', 'source_rejected', 'source_revoked', 'source_superseded')",
    );
    expect(migration).toContain(
      "`organisationName` IS NOT NULL AND CHAR_LENGTH(TRIM(",
    );
    expect(migration).toContain(
      "CONSTRAINT `projectEvidenceClaims_current_revision_check`",
    );
    expect(migration).toContain(
      "CONSTRAINT `projectEvidenceSources_lifecycle_check`",
    );
    expect(migration).toContain("CREATE TABLE `projectEvidenceEvents`");
  });

  it("keeps identity/contactability evidence non-promoting and claim types independent", () => {
    expect(schema).toContain('"identity_only"');
    expect(schema).toContain('"contactability_only"');
    expect(schema).toContain('"contact_employment"');
    expect(schema).toContain('"contact_project_participation"');
    expect(schema).toContain('"buyer_authority"');
    expect(schema).toContain("targetFingerprint");
    expect(schema).toContain("currentKey");
  });

  it("appends exactly migration 0091 to the journal", () => {
    const priorJournal = {
      ...journal,
      entries: journal.entries.slice(0, -1),
    };
    expect(
      createHash("sha256").update(JSON.stringify(priorJournal)).digest("hex"),
    ).toBe(previousJournalHash);
    expect(journal.entries).toHaveLength(92);

    const tail = journal.entries.slice(-2);
    expect(tail[0]).toMatchObject({
      idx: 90,
      version: "5",
      tag: "0090_full_potential_v1_commercial_model",
      breakpoints: true,
    });
    expect(tail[1]).toMatchObject({
      idx: 91,
      version: "5",
      tag: "0091_issue86_buyer_route_evidence",
      breakpoints: true,
    });
  });

  it("chains generated MySQL metadata from 0090 without rewriting it", () => {
    expect(currentSnapshot.dialect).toBe("mysql");
    expect(currentSnapshot.version).toBe("5");
    expect(currentSnapshot.prevId).toBe(previousSnapshot.id);
    expect(currentSnapshot.id).not.toBe(previousSnapshot.id);
    expect(Object.keys(currentSnapshot.tables)).toHaveLength(
      Object.keys(previousSnapshot.tables).length + expectedTables.length,
    );

    for (const [tableName, previousTable] of Object.entries(
      previousSnapshot.tables,
    )) {
      expect(currentSnapshot.tables[tableName]).toEqual(previousTable);
    }

    for (const table of expectedTables) {
      expect(currentSnapshot.tables).toHaveProperty(table);
      expect(previousSnapshot.tables).not.toHaveProperty(table);
    }
  });
});
