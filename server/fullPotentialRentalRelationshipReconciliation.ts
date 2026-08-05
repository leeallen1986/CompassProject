import { createHash } from "node:crypto";

export const RENTAL_RELATIONSHIP_SCHEMA_VERSION = 1 as const;
export const RENTAL_RELATIONSHIP_CHILD_IDS = [328, 334] as const;
export const RENTAL_RELATIONSHIP_PARENT_IDS = [269, 415] as const;

/**
 * The existing Full Potential schema has a service/context relationship value
 * but no separate strategic_context enum. The manifest preserves the business
 * meaning explicitly while persisting the existing schema-safe value.
 */
export const RENTAL_RELATIONSHIP_PERSISTED_TYPE = "service_unit" as const;
export const RENTAL_RELATIONSHIP_SEMANTIC = "strategic_context" as const;

export interface RentalRelationshipAccount extends Record<string, unknown> {
  id: number;
}

export interface RentalWorkspaceProjection {
  totalRentalRows: number;
  totalRentalAccounts: number;
  nonCountingContextRecords: number;
  attachedContextRecords: number;
  unattachedContextRecords: number;
  tierA: number;
  pushNow: number;
  routeDistribution: Record<string, number>;
  accountIds: number[];
}

export interface RentalRelationshipManifestRow {
  accountId: 328 | 334;
  canonicalName: string;
  parentAccountId: 269 | 415;
  parentCanonicalName: string;
  relationshipSemantic: typeof RENTAL_RELATIONSHIP_SEMANTIC;
  reason: string;
  before: {
    parentAccountId: null;
    mergedIntoAccountId: null;
    relationshipType: "standalone";
    recordStatus: "active";
    countsTowardPotential: true;
    sourceRowHash: string;
    immutableRowHash: string;
  };
  after: {
    parentAccountId: 269 | 415;
    mergedIntoAccountId: null;
    relationshipType: typeof RENTAL_RELATIONSHIP_PERSISTED_TYPE;
    recordStatus: "active";
    countsTowardPotential: false;
  };
  approved: boolean;
}

export interface RentalRelationshipManifest {
  schemaVersion: typeof RENTAL_RELATIONSHIP_SCHEMA_VERSION;
  mode: "draft" | "sealed";
  generatedAt: string;
  sealedAt: string | null;
  sourceGitHubSha: string | null;
  databaseIdentity: string;
  databaseFingerprint: string;
  sourceAccountCount: number;
  rowCount: 2;
  approvedRows: number;
  automaticWriteAllowed: false;
  rows: RentalRelationshipManifestRow[];
  workspaceBefore: RentalWorkspaceProjection;
  workspaceExpectedAfter: RentalWorkspaceProjection;
  manifestHash: string | null;
}

const EXPECTED_IDENTITIES: Record<number, string> = {
  269: "Coates Hire",
  328: "Coates Hire National Fleet",
  415: "Onsite Rental Group",
  334: "Onsite Rental Strategic Channel",
};

const ALLOWED_MUTATION_FIELDS = new Set([
  "parentAccountId",
  "relationshipType",
  "countsTowardPotential",
  "updatedAt",
]);

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value ?? null;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: unknown): string {
  const input = typeof value === "string" ? value : stableStringify(value);
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function sourceRowSnapshot(account: RentalRelationshipAccount): Record<string, unknown> {
  return {
    id: account.id,
    stableKey: normalize(account.stableKey),
    canonicalName: clean(account.canonicalName),
    displayName: clean(account.displayName) || null,
    rowClass: clean(account.rowClass) || null,
    parentAccountId: nullableId(account.parentAccountId),
    mergedIntoAccountId: nullableId(account.mergedIntoAccountId),
    relationshipType: clean(account.relationshipType),
    recordStatus: clean(account.recordStatus),
    countsTowardPotential: boolValue(account.countsTowardPotential),
    country: clean(account.country).toUpperCase(),
    state: clean(account.state) || null,
    region: clean(account.region) || null,
    routeToMarket: clean(account.routeToMarket) || null,
    ownerName: clean(account.ownerName) || null,
    priorityTier: clean(account.priorityTier) || null,
    platformPushDecision: clean(account.platformPushDecision) || null,
  };
}

export function sourceRowHash(account: RentalRelationshipAccount): string {
  return sha256(sourceRowSnapshot(account));
}

export function immutableRowHash(account: RentalRelationshipAccount): string {
  const immutable = Object.fromEntries(
    Object.entries(account)
      .filter(([key]) => !ALLOWED_MUTATION_FIELDS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalize(value)]),
  );
  return sha256(immutable);
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(`${label} mismatch: expected=${stableStringify(expected)} actual=${stableStringify(actual)}`);
  }
}

export function validateSourceTopology(accounts: RentalRelationshipAccount[]): void {
  const map = new Map(accounts.map(account => [account.id, account]));
  for (const id of [269, 328, 415, 334]) {
    const account = map.get(id);
    if (!account) throw new Error(`Required Rental relationship account ${id} is missing.`);
    assertEqual(`account ${id} canonicalName`, clean(account.canonicalName), EXPECTED_IDENTITIES[id]);
    assertEqual(`account ${id} country`, clean(account.country).toUpperCase(), "AU");
    assertEqual(`account ${id} recordStatus`, clean(account.recordStatus), "active");
    assertEqual(`account ${id} mergedIntoAccountId`, nullableId(account.mergedIntoAccountId), null);
  }

  for (const childId of RENTAL_RELATIONSHIP_CHILD_IDS) {
    const child = map.get(childId)!;
    assertEqual(`account ${childId} parentAccountId`, nullableId(child.parentAccountId), null);
    assertEqual(`account ${childId} relationshipType`, clean(child.relationshipType), "standalone");
    assertEqual(`account ${childId} countsTowardPotential`, boolValue(child.countsTowardPotential), true);
  }

  for (const parentId of RENTAL_RELATIONSHIP_PARENT_IDS) {
    const parent = map.get(parentId)!;
    assertEqual(`parent ${parentId} countsTowardPotential`, boolValue(parent.countsTowardPotential), true);
  }
}

export function projectRelationshipCanary(accounts: RentalRelationshipAccount[]): RentalRelationshipAccount[] {
  return accounts.map(account => {
    if (account.id === 328) {
      return { ...account, parentAccountId: 269, relationshipType: RENTAL_RELATIONSHIP_PERSISTED_TYPE, countsTowardPotential: false };
    }
    if (account.id === 334) {
      return { ...account, parentAccountId: 415, relationshipType: RENTAL_RELATIONSHIP_PERSISTED_TYPE, countsTowardPotential: false };
    }
    return { ...account };
  });
}

export function validateExpectedWorkspaceDelta(
  before: RentalWorkspaceProjection,
  after: RentalWorkspaceProjection,
): void {
  assertEqual("totalRentalRows", after.totalRentalRows, before.totalRentalRows);
  assertEqual("totalRentalAccounts", after.totalRentalAccounts, before.totalRentalAccounts - 2);
  assertEqual("nonCountingContextRecords", after.nonCountingContextRecords, before.nonCountingContextRecords + 2);
  assertEqual("attachedContextRecords", after.attachedContextRecords, before.attachedContextRecords + 2);
  assertEqual("unattachedContextRecords", after.unattachedContextRecords, before.unattachedContextRecords);
  assertEqual("tierA", after.tierA, before.tierA - 2);
  assertEqual("pushNow", after.pushNow, before.pushNow);
  assertEqual("direct_ape", after.routeDistribution.direct_ape ?? 0, (before.routeDistribution.direct_ape ?? 0) - 1);
  assertEqual("cea", after.routeDistribution.cea ?? 0, (before.routeDistribution.cea ?? 0) - 1);
  assertEqual("manual_review", after.routeDistribution.manual_review ?? 0, before.routeDistribution.manual_review ?? 0);
  if (after.accountIds.includes(328) || after.accountIds.includes(334)) {
    throw new Error("Projected context rows remain in the top-level Rental queue.");
  }
  if (!after.accountIds.includes(269) || !after.accountIds.includes(415)) {
    throw new Error("Projected commercial parent is missing from the Rental queue.");
  }
}

function row(
  child: RentalRelationshipAccount,
  parent: RentalRelationshipAccount,
  reason: string,
): RentalRelationshipManifestRow {
  return {
    accountId: child.id as 328 | 334,
    canonicalName: clean(child.canonicalName),
    parentAccountId: parent.id as 269 | 415,
    parentCanonicalName: clean(parent.canonicalName),
    relationshipSemantic: RENTAL_RELATIONSHIP_SEMANTIC,
    reason,
    before: {
      parentAccountId: null,
      mergedIntoAccountId: null,
      relationshipType: "standalone",
      recordStatus: "active",
      countsTowardPotential: true,
      sourceRowHash: sourceRowHash(child),
      immutableRowHash: immutableRowHash(child),
    },
    after: {
      parentAccountId: parent.id as 269 | 415,
      mergedIntoAccountId: null,
      relationshipType: RENTAL_RELATIONSHIP_PERSISTED_TYPE,
      recordStatus: "active",
      countsTowardPotential: false,
    },
    approved: false,
  };
}

export function buildDraftManifest(input: {
  accounts: RentalRelationshipAccount[];
  sourceAccountCount: number;
  databaseIdentity: string;
  databaseFingerprint: string;
  sourceGitHubSha?: string | null;
  workspaceBefore: RentalWorkspaceProjection;
  workspaceExpectedAfter: RentalWorkspaceProjection;
  generatedAt?: Date;
}): RentalRelationshipManifest {
  validateSourceTopology(input.accounts);
  validateExpectedWorkspaceDelta(input.workspaceBefore, input.workspaceExpectedAfter);
  const map = new Map(input.accounts.map(account => [account.id, account]));
  return {
    schemaVersion: RENTAL_RELATIONSHIP_SCHEMA_VERSION,
    mode: "draft",
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    sealedAt: null,
    sourceGitHubSha: input.sourceGitHubSha ?? null,
    databaseIdentity: input.databaseIdentity,
    databaseFingerprint: input.databaseFingerprint,
    sourceAccountCount: input.sourceAccountCount,
    rowCount: 2,
    approvedRows: 0,
    automaticWriteAllowed: false,
    rows: [
      row(map.get(328)!, map.get(269)!, "Retain Coates national-fleet planning as non-counting strategic context beneath the Coates national key account."),
      row(map.get(334)!, map.get(415)!, "Retain Onsite strategic-channel planning as non-counting context beneath the commercial Onsite Rental Group account."),
    ],
    workspaceBefore: input.workspaceBefore,
    workspaceExpectedAfter: input.workspaceExpectedAfter,
    manifestHash: null,
  };
}

function hashPayload(manifest: RentalRelationshipManifest): unknown {
  return { ...manifest, manifestHash: null };
}

export function computeManifestHash(manifest: RentalRelationshipManifest): string {
  return sha256(hashPayload(manifest));
}

export function sealManifest(
  draft: RentalRelationshipManifest,
  sealedAt = new Date(),
): RentalRelationshipManifest {
  if (draft.schemaVersion !== RENTAL_RELATIONSHIP_SCHEMA_VERSION || draft.mode !== "draft") {
    throw new Error("Only a schema-v1 draft Rental relationship manifest can be sealed.");
  }
  if (draft.rowCount !== 2 || draft.rows.length !== 2) {
    throw new Error("The first Rental relationship canary must contain exactly two rows.");
  }
  const ids = draft.rows.map(item => item.accountId).sort((left, right) => left - right);
  assertEqual("manifest account IDs", ids, [328, 334]);
  if (!draft.rows.every(item => item.approved === true)) {
    throw new Error("Both canary rows must be explicitly approved before sealing.");
  }
  const sealed: RentalRelationshipManifest = {
    ...draft,
    mode: "sealed",
    sealedAt: sealedAt.toISOString(),
    approvedRows: 2,
    automaticWriteAllowed: false,
    manifestHash: null,
  };
  sealed.manifestHash = computeManifestHash(sealed);
  return sealed;
}

export function verifySealedManifest(manifest: RentalRelationshipManifest): boolean {
  return manifest.schemaVersion === RENTAL_RELATIONSHIP_SCHEMA_VERSION
    && manifest.mode === "sealed"
    && Boolean(manifest.sealedAt)
    && manifest.rowCount === 2
    && manifest.approvedRows === 2
    && manifest.automaticWriteAllowed === false
    && manifest.rows.length === 2
    && manifest.rows.every(item => item.approved === true)
    && typeof manifest.manifestHash === "string"
    && manifest.manifestHash === computeManifestHash(manifest);
}
