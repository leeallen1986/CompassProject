export type RentalWorkspaceAccountLike = Record<string, unknown> & { id: number };

export const RENTAL_WORKSPACE_SCOPE_COUNTRY = "AU";

export interface RentalWorkspaceContextRecord {
  id: number;
  canonicalName: string;
  displayName: string | null;
  rowClass: string | null;
  relationshipType: string | null;
  recordStatus: string | null;
  countsTowardPotential: boolean;
  parentAccountId: number | null;
  mergedIntoAccountId: number | null;
}

export interface RentalWorkspaceSelection {
  scopeCountry: string;
  allRentalRows: RentalWorkspaceAccountLike[];
  nonScopeRentalRows: RentalWorkspaceAccountLike[];
  rentalRows: RentalWorkspaceAccountLike[];
  countingAccounts: RentalWorkspaceAccountLike[];
  contextRecords: RentalWorkspaceAccountLike[];
  contextByCountingAccountId: Map<number, RentalWorkspaceAccountLike[]>;
  unattachedContextRecords: RentalWorkspaceAccountLike[];
}

const NON_ACTIVE_STATUSES = new Set(["merged", "parked", "excluded"]);

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedCountry(value: unknown): string {
  return clean(value).toUpperCase();
}

function nullableId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function countsTowardPotential(account: RentalWorkspaceAccountLike): boolean {
  return account.countsTowardPotential !== false && account.countsTowardPotential !== 0;
}

export function isAustralianRentalWorkspaceRow(
  account: RentalWorkspaceAccountLike,
): boolean {
  return normalizedCountry(account.country) === RENTAL_WORKSPACE_SCOPE_COUNTRY;
}

/**
 * A top-level Australian Rental Hire workspace row must still count toward Full
 * Potential. Context, merged, parked, excluded, duplicate and non-Australian
 * records remain queryable in the database but cannot inflate the sales queue
 * or financial totals.
 */
export function isActiveRentalCountingRecord(
  account: RentalWorkspaceAccountLike,
  isRentalHireAccount: (account: RentalWorkspaceAccountLike) => boolean,
): boolean {
  if (!isRentalHireAccount(account)) return false;
  if (!isAustralianRentalWorkspaceRow(account)) return false;
  if (!countsTowardPotential(account)) return false;
  if (NON_ACTIVE_STATUSES.has(clean(account.recordStatus))) return false;
  if (clean(account.relationshipType) === "duplicate") return false;
  if (nullableId(account.mergedIntoAccountId) !== null) return false;
  return true;
}

export function toRentalWorkspaceContextRecord(
  account: RentalWorkspaceAccountLike,
): RentalWorkspaceContextRecord {
  return {
    id: account.id,
    canonicalName: clean(account.canonicalName),
    displayName: clean(account.displayName) || null,
    rowClass: clean(account.rowClass) || null,
    relationshipType: clean(account.relationshipType) || null,
    recordStatus: clean(account.recordStatus) || null,
    countsTowardPotential: countsTowardPotential(account),
    parentAccountId: nullableId(account.parentAccountId),
    mergedIntoAccountId: nullableId(account.mergedIntoAccountId),
  };
}

function nextRelationshipId(account: RentalWorkspaceAccountLike): number | null {
  return nullableId(account.mergedIntoAccountId) ?? nullableId(account.parentAccountId);
}

/**
 * Resolve a non-counting record to the nearest active counting ancestor. The
 * function deliberately refuses cycles, missing targets, cross-scope targets
 * and free-floating context rows; those remain in `unattachedContextRecords`
 * for audit rather than being silently hidden beneath an arbitrary account.
 */
function resolveCountingAncestor(
  account: RentalWorkspaceAccountLike,
  accountMap: ReadonlyMap<number, RentalWorkspaceAccountLike>,
  activeCountingIds: ReadonlySet<number>,
): number | null {
  const visited = new Set<number>([account.id]);
  let current: RentalWorkspaceAccountLike | undefined = account;

  while (current) {
    const nextId = nextRelationshipId(current);
    if (nextId === null || visited.has(nextId)) return null;
    if (activeCountingIds.has(nextId)) return nextId;
    visited.add(nextId);
    current = accountMap.get(nextId);
  }

  return null;
}

export function buildRentalWorkspaceSelection(
  accounts: RentalWorkspaceAccountLike[],
  isRentalHireAccount: (account: RentalWorkspaceAccountLike) => boolean,
): RentalWorkspaceSelection {
  const allRentalRows = accounts.filter(isRentalHireAccount);
  const rentalRows = allRentalRows.filter(isAustralianRentalWorkspaceRow);
  const nonScopeRentalRows = allRentalRows.filter(account => !isAustralianRentalWorkspaceRow(account));
  const countingAccounts = rentalRows.filter(account =>
    isActiveRentalCountingRecord(account, isRentalHireAccount),
  );
  const activeCountingIds = new Set(countingAccounts.map(account => account.id));
  const accountMap = new Map(rentalRows.map(account => [account.id, account]));
  const contextRecords = rentalRows.filter(account => !activeCountingIds.has(account.id));
  const contextByCountingAccountId = new Map<number, RentalWorkspaceAccountLike[]>();
  const unattachedContextRecords: RentalWorkspaceAccountLike[] = [];

  for (const context of contextRecords) {
    const ancestorId = resolveCountingAncestor(context, accountMap, activeCountingIds);
    if (ancestorId === null) {
      unattachedContextRecords.push(context);
      continue;
    }
    const rows = contextByCountingAccountId.get(ancestorId) ?? [];
    rows.push(context);
    contextByCountingAccountId.set(ancestorId, rows);
  }

  for (const rows of contextByCountingAccountId.values()) {
    rows.sort((left, right) => left.id - right.id);
  }

  return {
    scopeCountry: RENTAL_WORKSPACE_SCOPE_COUNTRY,
    allRentalRows,
    nonScopeRentalRows,
    rentalRows,
    countingAccounts,
    contextRecords,
    contextByCountingAccountId,
    unattachedContextRecords: unattachedContextRecords.sort((left, right) => left.id - right.id),
  };
}
