import { fullPotentialAccounts } from "../drizzle/schema";
import { getDb } from "./db";
import {
  RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS,
  retiredRentalRetainedChildBatch2Error,
  type RentalRetainedChildBatch2ApplySnapshot,
  type RentalRetainedChildBatch2ManifestDraft,
  type RentalRetainedChildBatch2ManifestRow,
  type RentalRetainedChildBatch2ManifestSealed,
  type RentalRetainedChildBatch2WorkspaceSummary,
} from "./rentalRetainedChildBatch2Reconciliation.shared";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type AccountRow = typeof fullPotentialAccounts.$inferSelect;

export interface RentalRetainedChildBatch2ApplyResult {
  manifestHash: string;
  databaseFingerprintBefore: string;
  activePipelineRunsBefore: number;
  alreadyApplied: boolean;
  selected: number;
  applied: number;
  skipped: number;
  accountIds: number[];
  before: RentalRetainedChildBatch2ApplySnapshot[];
  after: RentalRetainedChildBatch2ApplySnapshot[];
  workspaceBefore: RentalRetainedChildBatch2WorkspaceSummary;
  workspaceAfter: RentalRetainedChildBatch2WorkspaceSummary;
  pr78ContinuityFailuresBefore: string[];
  pr78ContinuityFailuresAfter: string[];
  batch2DispositionsAfter: Record<string, string>;
  postApplyWorkspaceFailures: string[];
}

/**
 * PR #79 V3 is a rejected historical contract. No supported code path may
 * generate a new V3 manifest.
 */
export function buildRentalRetainedChildBatch2ManifestRows(
  _accounts: readonly AccountRow[],
): RentalRetainedChildBatch2ManifestRow[] {
  throw retiredRentalRetainedChildBatch2Error();
}

export async function generateRentalRetainedChildBatch2Manifest(
  _dbOverride?: Db,
): Promise<RentalRetainedChildBatch2ManifestDraft> {
  throw retiredRentalRetainedChildBatch2Error();
}

/**
 * The rejected V3 apply is disabled even when called by direct module import.
 * Use the corrected V4 controller utility for account IDs [278,352].
 */
export async function applyRentalRetainedChildBatch2Manifest(
  _manifest: RentalRetainedChildBatch2ManifestSealed,
  _confirmHash: string,
  _dbOverride?: Db,
): Promise<RentalRetainedChildBatch2ApplyResult> {
  void RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS;
  throw retiredRentalRetainedChildBatch2Error();
}
