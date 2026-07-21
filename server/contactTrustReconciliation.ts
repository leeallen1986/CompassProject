import { and, eq, inArray } from "drizzle-orm";
import {
  apolloCreditLog,
  contactCandidateSlates,
  contactProjects,
  contacts,
  contactValidationActions,
  hunterVerificationLog,
  projects,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  buildContactTrustSlateInvalidationPlan,
  type ContactTrustSlateInvalidationPlan,
  type ContactTrustSlateRecord,
} from "./contactTrustSlateInvalidation";
import {
  CONTACT_TRUST_MANIFEST_VERSION,
  buildContactDuplicateIndex,
  buildManifestSummary,
  classifyContactTrustDisposition,
  deriveContactTrustEvidence,
  normaliseEmail,
  normaliseIdentityText,
  normaliseLinkedinUrl,
  selectApprovedManifestRows,
  sha256,
  verifySealedContactTrustManifest,
  type ContactTrustApolloLog,
  type ContactTrustContactSnapshot,
  type ContactTrustContext,
  type ContactTrustHunterLog,
  type ContactTrustManifestDraft,
  type ContactTrustManifestRow,
  type ContactTrustManifestSealed,
  type ContactTrustProjectReference,
  type ContactTrustSelectionOptions,
  type ContactTrustValidationAction,
  type DuplicateIdentityInput,
} from "./contactTrustReconciliation.shared";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type ContactRow = typeof contacts.$inferSelect;
type ContactProjectRow = typeof contactProjects.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type HunterRow = typeof hunterVerificationLog.$inferSelect;
type ApolloRow = typeof apolloCreditLog.$inferSelect;
type ValidationRow = typeof contactValidationActions.$inferSelect;

export interface ContactTrustDataset {
  contacts: ContactRow[];
  contactProjects: ContactProjectRow[];
  projects: ProjectRow[];
  hunterLogs: HunterRow[];
  apolloLogs: ApolloRow[];
  validationActions: ValidationRow[];
  databaseIdentity: string;
  databaseFingerprint: string;
}

export interface ContactTrustApplyOptions extends ContactTrustSelectionOptions {
  confirmHash: string;
}

export interface ContactTrustApplySnapshot {
  contactId: number;
  email: string | null;
  emailVerified: boolean;
  contactTrustTier: string;
  verificationStatus: string | null;
  linkedProjectIds: number[];
}

export interface ContactTrustSlateInvalidationSummary {
  matched: number;
  markedStale: number;
  alreadyStale: number;
  slateIds: number[];
  projectIds: number[];
}

export interface ContactTrustApplyResult {
  manifestHash: string;
  databaseFingerprintBefore: string;
  alreadyApplied: boolean;
  selected: number;
  applied: number;
  skipped: number;
  contactIds: number[];
  before: ContactTrustApplySnapshot[];
  after: ContactTrustApplySnapshot[];
  dispositionCounts: Record<string, number>;
  slateInvalidation: ContactTrustSlateInvalidationSummary;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function exactProjectNameKey(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function currentDatabaseIdentity(): string {
  const raw = process.env.DATABASE_URL || "";
  try {
    const parsed = new URL(raw);
    return sha256({ protocol: parsed.protocol, hostname: parsed.hostname, port: parsed.port, pathname: parsed.pathname });
  } catch {
    return sha256({ database: "unconfigured" });
  }
}

function toContactSnapshot(row: ContactRow): ContactTrustContactSnapshot {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    company: row.company,
    legacyProjectText: row.project,
    email: row.email,
    emailVerified: !!row.emailVerified,
    contactTrustTier: row.contactTrustTier || "named_unverified",
    enrichmentSource: row.enrichmentSource,
    verificationStatus: row.verificationStatus,
    verifiedByUserId: row.verifiedByUserId,
    verifiedAt: iso(row.verifiedAt),
    rejectionReason: row.rejectionReason,
    linkedin: row.linkedin,
    linkedinProfileUrl: row.linkedinProfileUrl,
    verifiedLinkedinUrl: row.verifiedLinkedinUrl,
    source: row.source,
    crmOrphan: !!row.crmOrphan,
    createdAt: row.createdAt.toISOString(),
  };
}

function toHunterLog(row: HunterRow): ContactTrustHunterLog {
  return {
    id: row.id,
    contactId: row.contactId,
    hunterStatus: row.hunterStatus,
    hunterConfidence: row.hunterConfidence,
    emailFound: row.emailFound,
    queryInput: row.queryInput || null,
    contactUpdated: !!row.contactUpdated,
    tierPromoted: !!row.tierPromoted,
    createdAt: row.createdAt.toISOString(),
  };
}

function toApolloLog(row: ApolloRow): ContactTrustApolloLog {
  return {
    id: row.id,
    contactId: row.contactId,
    action: row.action,
    apolloPersonId: row.apolloPersonId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toValidationAction(row: ValidationRow): ContactTrustValidationAction {
  return {
    id: row.id,
    contactId: row.contactId,
    action: row.action,
    userId: row.userId,
    hunterVerified: !!row.hunterVerified,
    hunterConfidence: row.hunterConfidence,
    hunterStatus: row.hunterStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

function toProjectReference(row: ProjectRow): ContactTrustProjectReference {
  return {
    id: row.id,
    name: row.name,
    lifecycleStatus: row.lifecycleStatus,
    suppressed: row.suppressed,
    mergedIntoId: row.mergedIntoId,
  };
}

function relevantFingerprintData(dataset: Omit<ContactTrustDataset, "databaseFingerprint" | "databaseIdentity">) {
  return {
    contacts: dataset.contacts
      .map(row => ({
        id: row.id,
        name: row.name,
        title: row.title,
        company: row.company,
        project: row.project,
        email: row.email,
        emailVerified: row.emailVerified,
        contactTrustTier: row.contactTrustTier,
        enrichmentSource: row.enrichmentSource,
        verificationStatus: row.verificationStatus,
        verifiedByUserId: row.verifiedByUserId,
        verifiedAt: row.verifiedAt,
        rejectionReason: row.rejectionReason,
        linkedin: row.linkedin,
        linkedinProfileUrl: row.linkedinProfileUrl,
        verifiedLinkedinUrl: row.verifiedLinkedinUrl,
        source: row.source,
        crmOrphan: row.crmOrphan,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => a.id - b.id),
    contactProjects: dataset.contactProjects
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
      .map(row => ({
        id: row.id,
        name: row.name,
        lifecycleStatus: row.lifecycleStatus,
        suppressed: row.suppressed,
        mergedIntoId: row.mergedIntoId,
      }))
      .sort((a, b) => a.id - b.id),
    hunterLogs: dataset.hunterLogs
      .map(row => ({
        id: row.id,
        contactId: row.contactId,
        hunterStatus: row.hunterStatus,
        hunterConfidence: row.hunterConfidence,
        emailFound: row.emailFound,
        queryInput: row.queryInput,
        contactUpdated: row.contactUpdated,
        tierPromoted: row.tierPromoted,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => a.id - b.id),
    apolloLogs: dataset.apolloLogs
      .map(row => ({
        id: row.id,
        contactId: row.contactId,
        action: row.action,
        apolloPersonId: row.apolloPersonId,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => a.id - b.id),
    validationActions: dataset.validationActions
      .map(row => ({
        id: row.id,
        contactId: row.contactId,
        action: row.action,
        userId: row.userId,
        hunterVerified: row.hunterVerified,
        hunterConfidence: row.hunterConfidence,
        hunterStatus: row.hunterStatus,
        createdAt: row.createdAt,
      }))
      .sort((a, b) => a.id - b.id),
  };
}

export async function loadContactTrustDataset(dbOverride?: Db): Promise<ContactTrustDataset> {
  const db = dbOverride || await getDb();
  if (!db) throw new Error("Database unavailable");

  const [contactRows, linkRows, projectRows, hunterRows, apolloRows, validationRows] = await Promise.all([
    db.select().from(contacts),
    db.select().from(contactProjects),
    db.select().from(projects),
    db.select().from(hunterVerificationLog),
    db.select().from(apolloCreditLog),
    db.select().from(contactValidationActions),
  ]);

  const raw = {
    contacts: contactRows,
    contactProjects: linkRows,
    projects: projectRows,
    hunterLogs: hunterRows,
    apolloLogs: apolloRows,
    validationActions: validationRows,
  };

  return {
    ...raw,
    databaseIdentity: currentDatabaseIdentity(),
    databaseFingerprint: sha256(relevantFingerprintData(raw)),
  };
}

function groupByContactId<T extends { contactId: number | null }>(rows: readonly T[]): Map<number, T[]> {
  const result = new Map<number, T[]>();
  for (const row of rows) {
    if (row.contactId === null) continue;
    const current = result.get(row.contactId) || [];
    current.push(row);
    result.set(row.contactId, current);
  }
  return result;
}

export function buildContactTrustRows(dataset: ContactTrustDataset): ContactTrustManifestRow[] {
  const linksByContact = groupByContactId(dataset.contactProjects);
  const hunterByContact = groupByContactId(dataset.hunterLogs);
  const apolloByContact = groupByContactId(dataset.apolloLogs);
  const validationByContact = groupByContactId(dataset.validationActions);

  const projectsByExactName = new Map<string, ProjectRow[]>();
  for (const project of dataset.projects) {
    const key = exactProjectNameKey(project.name);
    const rows = projectsByExactName.get(key) || [];
    rows.push(project);
    projectsByExactName.set(key, rows);
  }

  const snapshots = new Map<number, ContactTrustContactSnapshot>();
  const evidence = new Map<number, ReturnType<typeof deriveContactTrustEvidence>>();
  const linkIds = new Map<number, number[]>();

  for (const contact of dataset.contacts) {
    const snapshot = toContactSnapshot(contact);
    snapshots.set(contact.id, snapshot);
    const contactLinks = linksByContact.get(contact.id) || [];
    linkIds.set(contact.id, Array.from(new Set(contactLinks.map(link => link.projectId))).sort((a, b) => a - b));
    evidence.set(contact.id, deriveContactTrustEvidence({
      contact: snapshot,
      hunterLogs: (hunterByContact.get(contact.id) || []).map(toHunterLog),
      apolloLogs: (apolloByContact.get(contact.id) || []).map(toApolloLog),
      validationActions: (validationByContact.get(contact.id) || []).map(toValidationAction),
    }));
  }

  const duplicateInputs: DuplicateIdentityInput[] = dataset.contacts.map(contact => {
    const snapshot = snapshots.get(contact.id)!;
    const contactEvidence = evidence.get(contact.id)!;
    const qualityScore = (contactEvidence.humanEmailVerified ? 100 : 0)
      + (contactEvidence.hunterValidForCurrentEmail ? 80 : 0)
      + (contactEvidence.apolloVerifiedState ? 80 : 0)
      + (snapshot.emailVerified ? 30 : 0)
      + (snapshot.contactTrustTier === "send_ready" ? 20 : 0)
      + Math.min(20, linkIds.get(contact.id)?.length || 0);
    return {
      contactId: contact.id,
      normalisedName: normaliseIdentityText(contact.name),
      normalisedEmployer: normaliseIdentityText(contact.company),
      verifiedEmail: contact.emailVerified ? normaliseEmail(contact.email) : null,
      linkedinUrl: normaliseLinkedinUrl(contact.verifiedLinkedinUrl || contact.linkedinProfileUrl || contact.linkedin),
      apolloPersonIds: contactEvidence.apolloPersonIds,
      qualityScore,
    };
  });

  const duplicateIndex = buildContactDuplicateIndex(duplicateInputs);

  return dataset.contacts
    .map(contact => {
      const snapshot = snapshots.get(contact.id)!;
      const exactMatches = (projectsByExactName.get(exactProjectNameKey(snapshot.legacyProjectText)) || [])
        .filter(project => project.mergedIntoId === null);
      const context: ContactTrustContext = {
        contact: snapshot,
        linkedProjectIds: linkIds.get(contact.id) || [],
        exactProjectMatches: exactMatches.map(toProjectReference),
        evidence: evidence.get(contact.id)!,
        duplicates: duplicateIndex.get(contact.id)!,
      };
      return classifyContactTrustDisposition(context);
    })
    .sort((a, b) => a.contactId - b.contactId);
}

export async function generateContactTrustManifest(dbOverride?: Db): Promise<ContactTrustManifestDraft> {
  const dataset = await loadContactTrustDataset(dbOverride);
  const rows = buildContactTrustRows(dataset);
  return {
    schemaVersion: CONTACT_TRUST_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    databaseIdentity: dataset.databaseIdentity,
    databaseFingerprint: dataset.databaseFingerprint,
    sealed: false,
    summary: buildManifestSummary(rows),
    rows,
  };
}

function snapshotFromCurrent(contact: ContactRow, linkedProjectIds: number[]): ContactTrustApplySnapshot {
  return {
    contactId: contact.id,
    email: contact.email,
    emailVerified: !!contact.emailVerified,
    contactTrustTier: contact.contactTrustTier || "named_unverified",
    verificationStatus: contact.verificationStatus,
    linkedProjectIds: [...linkedProjectIds].sort((a, b) => a - b),
  };
}

function stateMatchesExpected(
  contact: ContactRow,
  linkedProjectIds: readonly number[],
  row: ContactTrustManifestRow,
): boolean {
  const expected = row.expectedAfter;
  const fieldsMatch = contact.email === expected.email
    && !!contact.emailVerified === expected.emailVerified
    && (contact.contactTrustTier || "named_unverified") === expected.contactTrustTier
    && contact.verificationStatus === expected.verificationStatus;
  const linkMatches = expected.linkProjectId === null || linkedProjectIds.includes(expected.linkProjectId);
  return fieldsMatch && linkMatches;
}

async function readSelectedSnapshots(db: Db, contactIds: number[]): Promise<ContactTrustApplySnapshot[]> {
  if (contactIds.length === 0) return [];
  const [contactRowsRaw, linkRowsRaw] = await Promise.all([
    db.select().from(contacts).where(inArray(contacts.id, contactIds)),
    db.select().from(contactProjects).where(inArray(contactProjects.contactId, contactIds)),
  ]);
  const contactRows = contactRowsRaw as ContactRow[];
  const linkRows = linkRowsRaw as ContactProjectRow[];
  const linksByContact = groupByContactId<ContactProjectRow>(linkRows);
  return contactRows
    .map(contact => snapshotFromCurrent(
      contact,
      Array.from(new Set((linksByContact.get(contact.id) || []).map(link => link.projectId))),
    ))
    .sort((a, b) => a.contactId - b.contactId);
}

async function readSlateInvalidationPlan(
  db: Db,
  selectedRows: readonly ContactTrustManifestRow[],
): Promise<ContactTrustSlateInvalidationPlan> {
  const slateRows = await db.select().from(contactCandidateSlates);
  return buildContactTrustSlateInvalidationPlan(
    slateRows as ContactTrustSlateRecord[],
    selectedRows,
  );
}

function toSlateInvalidationSummary(
  plan: ContactTrustSlateInvalidationPlan,
  markedStale: number,
): ContactTrustSlateInvalidationSummary {
  return {
    matched: plan.matchedSlateIds.length,
    markedStale,
    alreadyStale: plan.alreadyStaleSlateIds.length,
    slateIds: plan.matchedSlateIds,
    projectIds: plan.matchedProjectIds,
  };
}

async function assertMatchedSlatesAreStale(db: Db, slateIds: readonly number[]): Promise<void> {
  if (slateIds.length === 0) return;
  const rows = await db
    .select({ id: contactCandidateSlates.id, isStale: contactCandidateSlates.isStale })
    .from(contactCandidateSlates)
    .where(inArray(contactCandidateSlates.id, [...slateIds]));
  const staleById = new Map(rows.map(row => [row.id, !!row.isStale]));
  const nonStale = slateIds.filter(id => staleById.get(id) !== true);
  if (nonStale.length > 0) {
    throw new Error(`Candidate slates did not become stale: ${nonStale.join(", ")}`);
  }
}

export async function applyContactTrustManifest(
  manifest: ContactTrustManifestSealed,
  options: ContactTrustApplyOptions,
  dbOverride?: Db,
): Promise<ContactTrustApplyResult> {
  if (!verifySealedContactTrustManifest(manifest)) {
    throw new Error("Manifest hash verification failed");
  }
  if (options.confirmHash !== manifest.manifestHash) {
    throw new Error("--confirm-hash does not match the sealed manifest hash");
  }

  const selectedRows = selectApprovedManifestRows(manifest, options);
  if (selectedRows.length === 0) throw new Error("No approved applyable rows matched the supplied canary filters");

  const db = dbOverride || await getDb();
  if (!db) throw new Error("Database unavailable");

  const currentManifest = await generateContactTrustManifest(db);
  const currentRows = new Map(currentManifest.rows.map(row => [row.contactId, row]));
  const selectedIds = selectedRows.map(row => row.contactId);
  const currentSnapshots = await readSelectedSnapshots(db, selectedIds);
  const snapshotById = new Map(currentSnapshots.map(snapshot => [snapshot.contactId, snapshot]));
  const slatePlan = await readSlateInvalidationPlan(db, selectedRows);

  if (currentManifest.databaseIdentity !== manifest.databaseIdentity) {
    throw new Error("Manifest belongs to a different database");
  }

  const alreadyApplied = selectedRows.every(row => {
    const snapshot = snapshotById.get(row.contactId);
    if (!snapshot) return false;
    return snapshot.email === row.expectedAfter.email
      && snapshot.emailVerified === row.expectedAfter.emailVerified
      && snapshot.contactTrustTier === row.expectedAfter.contactTrustTier
      && snapshot.verificationStatus === row.expectedAfter.verificationStatus
      && (row.expectedAfter.linkProjectId === null || snapshot.linkedProjectIds.includes(row.expectedAfter.linkProjectId));
  }) && slatePlan.freshSlateIds.length === 0;

  if (alreadyApplied) {
    return {
      manifestHash: manifest.manifestHash,
      databaseFingerprintBefore: currentManifest.databaseFingerprint,
      alreadyApplied: true,
      selected: selectedRows.length,
      applied: 0,
      skipped: selectedRows.length,
      contactIds: selectedIds,
      before: currentSnapshots,
      after: currentSnapshots,
      dispositionCounts: Object.fromEntries(selectedRows.map(row => [row.disposition, 0])),
      slateInvalidation: toSlateInvalidationSummary(slatePlan, 0),
    };
  }

  if (currentManifest.databaseFingerprint !== manifest.databaseFingerprint) {
    throw new Error("Database snapshot differs from the sealed manifest; regenerate and review a new manifest");
  }

  for (const row of selectedRows) {
    const current = currentRows.get(row.contactId);
    if (!current || current.recordHash !== row.recordHash) {
      throw new Error(`Contact ${row.contactId} changed after manifest generation`);
    }
  }

  const before = currentSnapshots;
  const dispositionCounts: Record<string, number> = {};

  await db.transaction(async (tx: any) => {
    for (const row of selectedRows) {
      dispositionCounts[row.disposition] = (dispositionCounts[row.disposition] || 0) + 1;
      if (row.disposition === "safe_link_to_project") {
        const projectId = row.expectedAfter.linkProjectId;
        const projectName = row.expectedAfter.linkProjectName;
        if (!projectId || !projectName) throw new Error(`Contact ${row.contactId}: safe link disposition is missing project details`);
        const existing = await tx
          .select({ id: contactProjects.id })
          .from(contactProjects)
          .where(and(eq(contactProjects.contactId, row.contactId), eq(contactProjects.projectId, projectId)))
          .limit(1);
        if (existing.length === 0) {
          await tx.insert(contactProjects).values({
            contactId: row.contactId,
            projectId,
            projectName,
            relevance: "primary",
          });
        }
        continue;
      }

      if (
        row.disposition === "safe_demote"
        || row.disposition === "safe_promote"
        || row.disposition === "safe_clear_generated_email"
      ) {
        await tx.update(contacts).set({
          email: row.expectedAfter.email,
          emailVerified: row.expectedAfter.emailVerified,
          contactTrustTier: row.expectedAfter.contactTrustTier,
          verificationStatus: row.expectedAfter.verificationStatus as ContactRow["verificationStatus"],
        }).where(eq(contacts.id, row.contactId));
        continue;
      }

      throw new Error(`Contact ${row.contactId}: non-applyable disposition ${row.disposition} reached apply`);
    }

    if (slatePlan.freshSlateIds.length > 0) {
      const staleAt = new Date();
      await tx.update(contactCandidateSlates).set({
        isStale: true,
        staleSince: staleAt,
      }).where(inArray(contactCandidateSlates.id, slatePlan.freshSlateIds));
    }
  });

  await assertMatchedSlatesAreStale(db, slatePlan.matchedSlateIds);
  const after = await readSelectedSnapshots(db, selectedIds);
  const afterById = new Map(after.map(snapshot => [snapshot.contactId, snapshot]));
  for (const row of selectedRows) {
    const snapshot = afterById.get(row.contactId);
    if (!snapshot) throw new Error(`Contact ${row.contactId} missing after apply`);
    const currentContact = await db.select().from(contacts).where(eq(contacts.id, row.contactId)).limit(1);
    const currentLinks = snapshot.linkedProjectIds;
    if (!currentContact[0] || !stateMatchesExpected(currentContact[0], currentLinks, row)) {
      throw new Error(`Contact ${row.contactId} did not reach its expected post-apply state`);
    }
  }

  return {
    manifestHash: manifest.manifestHash,
    databaseFingerprintBefore: currentManifest.databaseFingerprint,
    alreadyApplied: false,
    selected: selectedRows.length,
    applied: selectedRows.length,
    skipped: 0,
    contactIds: selectedIds,
    before,
    after,
    dispositionCounts,
    slateInvalidation: toSlateInvalidationSummary(slatePlan, slatePlan.freshSlateIds.length),
  };
}

export function applySnapshotsToCsv(rows: readonly ContactTrustApplySnapshot[]): string {
  const header = "contactId,email,emailVerified,contactTrustTier,verificationStatus,linkedProjectIds";
  const body = rows.map(row => [
    row.contactId,
    row.email ? `"${row.email.replace(/"/g, '""')}"` : "",
    row.emailVerified,
    row.contactTrustTier,
    row.verificationStatus || "",
    `"${row.linkedProjectIds.join(";")}"`,
  ].join(","));
  return `${header}\n${body.join("\n")}\n`;
}
