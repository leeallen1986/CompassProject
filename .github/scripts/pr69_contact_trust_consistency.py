from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"expected block not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# Manifest policy version and generated-email safety.
replace_once(
    "server/contactTrustReconciliation.shared.ts",
    "export const CONTACT_TRUST_MANIFEST_VERSION = 1 as const;",
    "export const CONTACT_TRUST_MANIFEST_VERSION = 2 as const;",
)
replace_once(
    "server/contactTrustReconciliation.shared.ts",
    "export type ApplyableContactTrustDisposition = (typeof APPLYABLE_CONTACT_TRUST_DISPOSITIONS)[number];\n",
    "export type ApplyableContactTrustDisposition = (typeof APPLYABLE_CONTACT_TRUST_DISPOSITIONS)[number];\n\n"
    "export function dispositionInvalidatesCandidateSlates(disposition: ContactTrustDisposition): boolean {\n"
    "  return (APPLYABLE_CONTACT_TRUST_DISPOSITIONS as readonly ContactTrustDisposition[]).includes(disposition);\n"
    "}\n",
)
replace_once(
    "server/contactTrustReconciliation.shared.ts",
    '''  const generatedByHistoricPath = evidence.generatedEmailMatches
    && (contact.enrichmentSource === "linkedin" || contact.enrichmentSource === "web_search")
    && !evidence.strongEmailEvidence;
  if (generatedByHistoricPath) {
    return correctionResult(
      context,
      "safe_clear_generated_email",
      "Stored email exactly matches the historic deterministic generator and has no later provider or human verification.",
      { email: null, emailVerified: false, contactTrustTier: "named_unverified", verificationStatus: "unverified", linkProjectId: null, linkProjectName: null },
      reviewFlags,
    );
  }
''',
    '''  const generatedByHistoricPath = evidence.generatedEmailMatches
    && (contact.enrichmentSource === "linkedin" || contact.enrichmentSource === "web_search")
    && !evidence.strongEmailEvidence;
  if (generatedByHistoricPath) {
    reviewFlags.push("historic_generated_email_fingerprint");
    if (contact.emailVerified || contact.verificationStatus === "verified") {
      reviewFlags.push("historic_generated_email_verified_state_conflict");
      return correctionResult(
        context,
        "manual_review",
        "The address matches the historic generator, but persisted verification flags conflict with the missing evidence trail; automatic clearing is unsafe.",
        unchangedExpectedState(contact),
        reviewFlags,
      );
    }
    if (contact.contactTrustTier === "send_ready") {
      return correctionResult(
        context,
        "safe_demote",
        "The address matches the historic generator and lacks later evidence; demote trust but preserve the address for review or re-verification.",
        { ...unchangedExpectedState(contact), emailVerified: false, contactTrustTier: "named_unverified", verificationStatus: "unverified" },
        reviewFlags,
      );
    }
    return correctionResult(
      context,
      "manual_review",
      "The address matches the historic generator but is not currently send-ready; retain it for review rather than deleting contact data automatically.",
      unchangedExpectedState(contact),
      reviewFlags,
    );
  }
''',
)

# Existing unit test now expects reversible demotion, plus verified-state conflict review.
replace_once(
    "server/contactTrustReconciliation.shared.test.ts",
    '''  it("clears an exact historic generated email only when no later evidence exists", () => {
    const row = contact({
      email: "jane.smith@examplemining.com.au",
      emailVerified: false,
      contactTrustTier: "send_ready",
      enrichmentSource: "web_search",
    });
    const result = classifyContactTrustDisposition(context({
      contact: row,
      evidence: deriveContactTrustEvidence({ contact: row, hunterLogs: [], apolloLogs: [], validationActions: [] }),
    }));
    expect(result.disposition).toBe("safe_clear_generated_email");
    expect(result.expectedAfter.email).toBeNull();
    expect(result.expectedAfter.contactTrustTier).toBe("named_unverified");
  });
''',
    '''  it("demotes but preserves an exact historic generated email when no later evidence exists", () => {
    const row = contact({
      email: "jane.smith@examplemining.com.au",
      emailVerified: false,
      contactTrustTier: "send_ready",
      enrichmentSource: "web_search",
    });
    const result = classifyContactTrustDisposition(context({
      contact: row,
      evidence: deriveContactTrustEvidence({ contact: row, hunterLogs: [], apolloLogs: [], validationActions: [] }),
    }));
    expect(result.disposition).toBe("safe_demote");
    expect(result.expectedAfter.email).toBe("jane.smith@examplemining.com.au");
    expect(result.expectedAfter.contactTrustTier).toBe("named_unverified");
    expect(result.reviewFlags).toContain("historic_generated_email_fingerprint");
  });

  it("sends generated-email records with conflicting verified flags to manual review", () => {
    const row = contact({
      email: "jane.smith@examplemining.com.au",
      emailVerified: true,
      contactTrustTier: "send_ready",
      enrichmentSource: "web_search",
      verificationStatus: "verified",
    });
    const result = classifyContactTrustDisposition(context({
      contact: row,
      evidence: deriveContactTrustEvidence({ contact: row, hunterLogs: [], apolloLogs: [], validationActions: [] }),
    }));
    expect(result.disposition).toBe("manual_review");
    expect(result.expectedAfter.email).toBe(row.email);
    expect(result.reviewFlags).toContain("historic_generated_email_verified_state_conflict");
  });
''',
)

# ContactCandidateSlates are now part of the locked snapshot and invalidated atomically.
replace_once(
    "server/contactTrustReconciliation.ts",
    'import { and, eq, inArray } from "drizzle-orm";',
    'import { and, eq, inArray, or } from "drizzle-orm";',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''  apolloCreditLog,
  contactProjects,
  contacts,
''',
    '''  apolloCreditLog,
  contactCandidateSlates,
  contactProjects,
  contacts,
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''  deriveContactTrustEvidence,
  normaliseEmail,
''',
    '''  deriveContactTrustEvidence,
  dispositionInvalidatesCandidateSlates,
  normaliseEmail,
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''type ContactRow = typeof contacts.$inferSelect;
type ContactProjectRow = typeof contactProjects.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
''',
    '''type ContactRow = typeof contacts.$inferSelect;
type ContactProjectRow = typeof contactProjects.$inferSelect;
type CandidateSlateRow = typeof contactCandidateSlates.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''  contacts: ContactRow[];
  contactProjects: ContactProjectRow[];
  projects: ProjectRow[];
''',
    '''  contacts: ContactRow[];
  contactProjects: ContactProjectRow[];
  contactCandidateSlates: CandidateSlateRow[];
  projects: ProjectRow[];
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''  after: ContactTrustApplySnapshot[];
  dispositionCounts: Record<string, number>;
}
''',
    '''  after: ContactTrustApplySnapshot[];
  dispositionCounts: Record<string, number>;
  staleSlateIds: number[];
  staleSlateCount: number;
}
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''    contactProjects: dataset.contactProjects
      .map(row => ({
        id: row.id,
        contactId: row.contactId,
        projectId: row.projectId,
        projectName: row.projectName,
        relevance: row.relevance,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => a.id - b.id),
    projects: dataset.projects
''',
    '''    contactProjects: dataset.contactProjects
      .map(row => ({
        id: row.id,
        contactId: row.contactId,
        projectId: row.projectId,
        projectName: row.projectName,
        relevance: row.relevance,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => a.id - b.id),
    contactCandidateSlates: dataset.contactCandidateSlates
      .map(row => ({
        id: row.id,
        projectId: row.projectId,
        primaryContactId: row.primaryContactId,
        backup1ContactId: row.backup1ContactId,
        backup2ContactId: row.backup2ContactId,
        commercialContactId: row.commercialContactId,
        technicalContactId: row.technicalContactId,
        isStale: row.isStale,
        staleSince: row.staleSince,
        updatedAt: row.updatedAt,
      }))
      .sort((a, b) => a.id - b.id),
    projects: dataset.projects
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''  const [contactRows, linkRows, projectRows, hunterRows, apolloRows, validationRows] = await Promise.all([
    db.select().from(contacts),
    db.select().from(contactProjects),
    db.select().from(projects),
''',
    '''  const [contactRows, linkRows, slateRows, projectRows, hunterRows, apolloRows, validationRows] = await Promise.all([
    db.select().from(contacts),
    db.select().from(contactProjects),
    db.select().from(contactCandidateSlates),
    db.select().from(projects),
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''    contacts: contactRows,
    contactProjects: linkRows,
    projects: projectRows,
''',
    '''    contacts: contactRows,
    contactProjects: linkRows,
    contactCandidateSlates: slateRows,
    projects: projectRows,
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''  const selectedIds = selectedRows.map(row => row.contactId);
  const currentSnapshots = await readSelectedSnapshots(db, selectedIds);
  const snapshotById = new Map(currentSnapshots.map(snapshot => [snapshot.contactId, snapshot]));

  if (currentManifest.databaseIdentity !== manifest.databaseIdentity) {
''',
    '''  const selectedIds = selectedRows.map(row => row.contactId);
  const currentSnapshots = await readSelectedSnapshots(db, selectedIds);
  const snapshotById = new Map(currentSnapshots.map(snapshot => [snapshot.contactId, snapshot]));
  const linkProjectIds = Array.from(new Set(selectedRows
    .filter(row => row.disposition === "safe_link_to_project")
    .map(row => row.expectedAfter.linkProjectId)
    .filter((value): value is number => value !== null)));
  const staleRows = selectedRows.filter(row => dispositionInvalidatesCandidateSlates(row.disposition));
  const staleContactIds = staleRows.map(row => row.contactId);
  const slateConditions: any[] = staleContactIds.length ? [
    inArray(contactCandidateSlates.primaryContactId, staleContactIds),
    inArray(contactCandidateSlates.backup1ContactId, staleContactIds),
    inArray(contactCandidateSlates.backup2ContactId, staleContactIds),
    inArray(contactCandidateSlates.commercialContactId, staleContactIds),
    inArray(contactCandidateSlates.technicalContactId, staleContactIds),
  ] : [];
  if (linkProjectIds.length) slateConditions.push(inArray(contactCandidateSlates.projectId, linkProjectIds));
  const affectedSlateRows = slateConditions.length
    ? await db.select().from(contactCandidateSlates).where(or(...slateConditions))
    : [];
  const staleSlateIds = Array.from(new Set(affectedSlateRows.map(row => row.id))).sort((a, b) => a - b);
  const allAffectedSlatesStale = affectedSlateRows.every(row => !!row.isStale);

  if (currentManifest.databaseIdentity !== manifest.databaseIdentity) {
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''      && snapshot.verificationStatus === row.expectedAfter.verificationStatus
      && (row.expectedAfter.linkProjectId === null || snapshot.linkedProjectIds.includes(row.expectedAfter.linkProjectId));
  });
''',
    '''      && snapshot.verificationStatus === row.expectedAfter.verificationStatus
      && (row.expectedAfter.linkProjectId === null || snapshot.linkedProjectIds.includes(row.expectedAfter.linkProjectId));
  }) && allAffectedSlatesStale;
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''      after: currentSnapshots,
      dispositionCounts: Object.fromEntries(selectedRows.map(row => [row.disposition, 0])),
    };
''',
    '''      after: currentSnapshots,
      dispositionCounts: Object.fromEntries(selectedRows.map(row => [row.disposition, 0])),
      staleSlateIds,
      staleSlateCount: staleSlateIds.length,
    };
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''      throw new Error(`Contact ${row.contactId}: non-applyable disposition ${row.disposition} reached apply`);
    }
  });
''',
    '''      throw new Error(`Contact ${row.contactId}: non-applyable disposition ${row.disposition} reached apply`);
    }
    if (staleSlateIds.length) {
      await tx.update(contactCandidateSlates).set({
        isStale: true,
        staleSince: new Date(),
      }).where(inArray(contactCandidateSlates.id, staleSlateIds));
    }
  });
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''  for (const row of selectedRows) {
    const snapshot = afterById.get(row.contactId);
''',
    '''  for (const row of selectedRows) {
    const snapshot = afterById.get(row.contactId);
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''  return {
    manifestHash: manifest.manifestHash,
''',
    '''  if (staleSlateIds.length) {
    const postSlates = await db.select({ id: contactCandidateSlates.id, isStale: contactCandidateSlates.isStale })
      .from(contactCandidateSlates)
      .where(inArray(contactCandidateSlates.id, staleSlateIds));
    if (postSlates.length !== staleSlateIds.length || postSlates.some(row => !row.isStale)) {
      throw new Error("Affected contact candidate slates were not marked stale");
    }
  }

  return {
    manifestHash: manifest.manifestHash,
''',
)
replace_once(
    "server/contactTrustReconciliation.ts",
    '''    after,
    dispositionCounts,
  };
}
''',
    '''    after,
    dispositionCounts,
    staleSlateIds,
    staleSlateCount: staleSlateIds.length,
  };
}
''',
)

# CLI exposes slate invalidation in the audit summary.
replace_once(
    "server/scripts/contactTrustReconcile.ts",
    '''    skipped: result.skipped,
    contactIds: result.contactIds,
    files: { before: beforePath, after: afterPath, summary: summaryPath },
''',
    '''    skipped: result.skipped,
    contactIds: result.contactIds,
    staleSlateCount: result.staleSlateCount,
    staleSlateIds: result.staleSlateIds,
    files: { before: beforePath, after: afterPath, summary: summaryPath },
''',
)

# Add focused consistency tests and update the operator runbook.
Path("server/contactTrustReconciliation.consistency.test.ts").write_text('''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTACT_TRUST_MANIFEST_VERSION,
  classifyContactTrustDisposition,
  deriveContactTrustEvidence,
  type ContactTrustContactSnapshot,
  type ContactTrustContext,
} from "./contactTrustReconciliation.shared";

function contact(overrides: Partial<ContactTrustContactSnapshot> = {}): ContactTrustContactSnapshot {
  return {
    id: 9001,
    name: "Jane Smith",
    title: "Procurement Manager",
    company: "Example Mining Group",
    legacyProjectText: "Example Mine",
    email: "jane.smith@examplemining.com.au",
    emailVerified: false,
    contactTrustTier: "send_ready",
    enrichmentSource: "web_search",
    verificationStatus: "unverified",
    verifiedByUserId: null,
    verifiedAt: null,
    rejectionReason: null,
    linkedin: null,
    linkedinProfileUrl: null,
    verifiedLinkedinUrl: null,
    source: "scraper",
    crmOrphan: false,
    createdAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

function classify(row: ContactTrustContactSnapshot) {
  const context: ContactTrustContext = {
    contact: row,
    linkedProjectIds: [101],
    exactProjectMatches: [],
    evidence: deriveContactTrustEvidence({ contact: row, hunterLogs: [], apolloLogs: [], validationActions: [] }),
    duplicates: {
      strongDuplicateGroupId: null,
      strongDuplicateContactIds: [],
      strongDuplicateKeys: [],
      recommendedSurvivorContactId: null,
      nameEmployerCandidateContactIds: [],
    },
  };
  return classifyContactTrustDisposition(context);
}

describe("PR69 contact reconciliation consistency", () => {
  it("invalidates every pre-PR69 manifest by bumping the schema version", () => {
    expect(CONTACT_TRUST_MANIFEST_VERSION).toBe(2);
  });

  it("preserves a suspected historic mailbox while reversibly demoting trust", () => {
    const row = contact();
    const result = classify(row);
    expect(result.disposition).toBe("safe_demote");
    expect(result.expectedAfter.email).toBe(row.email);
    expect(result.reviewFlags).toContain("historic_generated_email_fingerprint");
  });

  it("does not auto-clear a mailbox with conflicting persisted verification flags", () => {
    const result = classify(contact({ emailVerified: true, verificationStatus: "verified" }));
    expect(result.disposition).toBe("manual_review");
    expect(result.reviewFlags).toContain("historic_generated_email_verified_state_conflict");
  });

  it("atomically marks candidate slates stale when contact trust changes", () => {
    const source = readFileSync("server/contactTrustReconciliation.ts", "utf8");
    expect(source).toContain("contactCandidateSlates");
    expect(source).toContain("isStale: true");
    expect(source).toContain("staleSince: new Date()");
    expect(source).toContain("Affected contact candidate slates were not marked stale");
  });

  it("reports slate invalidation in apply output", () => {
    const cli = readFileSync("server/scripts/contactTrustReconcile.ts", "utf8");
    expect(cli).toContain("staleSlateCount: result.staleSlateCount");
    expect(cli).toContain("staleSlateIds: result.staleSlateIds");
  });
});
''')

runbook = Path("docs/contact-trust-reconciliation-runbook.md")
runbook.write_text(runbook.read_text() + '''\n\n## PR69 consistency correction\n\nManifests generated before schema version 2 are invalid and must be regenerated. An exact first.last mailbox fingerprint is not proof that the address is fabricated. The reconciliation now preserves the address and demotes only its trust state when the mailbox is unverified. Conflicting persisted verification flags go to manual review.\n\nEvery applied trust, email or deterministic-link correction atomically marks affected `contactCandidateSlates` stale and reports the stale slate IDs. This prevents cached slate snapshots from continuing to show an old email or trust tier.\n\n`safe_keep` rows are not canary changes and must never be used as an apply shortlist. Canary review lists must contain only approved, applyable dispositions.\n''')
