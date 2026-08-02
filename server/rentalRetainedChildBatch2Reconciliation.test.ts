import { describe, expect, it } from "vitest";
import {
  applyRentalRetainedChildBatch2Manifest,
  buildRentalRetainedChildBatch2ManifestRows,
  generateRentalRetainedChildBatch2Manifest,
} from "./rentalRetainedChildBatch2Reconciliation";
import {
  RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS,
  RENTAL_RETAINED_CHILD_BATCH2_RETIRED,
  RENTAL_RETAINED_CHILD_BATCH2_RETIREMENT_REASON,
  sealRentalRetainedChildBatch2Manifest,
  verifySealedRentalRetainedChildBatch2Manifest,
} from "./rentalRetainedChildBatch2Reconciliation.shared";

describe("rejected PR79 retained-child batch 2 V3 retirement", () => {
  it("records the rejected historical account set without exposing a usable spec", () => {
    expect(RENTAL_RETAINED_CHILD_BATCH2_RETIRED).toBe(true);
    expect(RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS).toEqual([278, 332, 352]);
    expect(RENTAL_RETAINED_CHILD_BATCH2_RETIREMENT_REASON).toContain(
      "account 272 is United Rentals, not Kennards Hire",
    );
  });

  it("blocks direct manifest-row generation", () => {
    expect(() => buildRentalRetainedChildBatch2ManifestRows([])).toThrow(
      "PR #79 V3 is retired",
    );
  });

  it("blocks asynchronous V3 manifest generation before database access", async () => {
    await expect(generateRentalRetainedChildBatch2Manifest()).rejects.toThrow(
      "PR #79 V3 is retired",
    );
  });

  it("blocks sealing any V3 draft", () => {
    expect(() => sealRentalRetainedChildBatch2Manifest({} as any)).toThrow(
      "PR #79 V3 is retired",
    );
  });

  it("never verifies a V3 sealed manifest", () => {
    expect(verifySealedRentalRetainedChildBatch2Manifest({} as any)).toBe(false);
  });

  it("blocks direct apply imports before database access", async () => {
    await expect(applyRentalRetainedChildBatch2Manifest(
      {} as any,
      "0".repeat(64),
    )).rejects.toThrow("PR #79 V3 is retired");
  });
});
