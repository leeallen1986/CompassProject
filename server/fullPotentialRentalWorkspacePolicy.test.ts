import { describe, expect, it } from "vitest";
import {
  buildRentalWorkspaceSelection,
  isActiveRentalCountingRecord,
  isAustralianRentalWorkspaceRow,
  RENTAL_WORKSPACE_SCOPE_COUNTRY,
} from "./fullPotentialRentalWorkspacePolicy";

function account(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    canonicalName: `Rental ${id}`,
    displayName: null,
    country: "AU",
    segment: "Rental Hire",
    subsegment: "Equipment Rental",
    countsTowardPotential: true,
    relationshipType: "standalone",
    recordStatus: "active",
    parentAccountId: null,
    mergedIntoAccountId: null,
    ...overrides,
  };
}

const isRental = (row: Record<string, unknown> & { id: number }) =>
  String(row.segment || "").includes("Rental") || String(row.canonicalName || "").includes("Hire");

describe("Rental workspace canonical counting policy", () => {
  it("keeps only active Australian counting records in the top-level queue", () => {
    expect(RENTAL_WORKSPACE_SCOPE_COUNTRY).toBe("AU");
    expect(isActiveRentalCountingRecord(account(1), isRental)).toBe(true);
    expect(isActiveRentalCountingRecord(account(2, { countsTowardPotential: false }), isRental)).toBe(false);
    expect(isActiveRentalCountingRecord(account(3, { recordStatus: "merged" }), isRental)).toBe(false);
    expect(isActiveRentalCountingRecord(account(4, { relationshipType: "duplicate" }), isRental)).toBe(false);
    expect(isActiveRentalCountingRecord(account(5, { mergedIntoAccountId: 1 }), isRental)).toBe(false);
    expect(isActiveRentalCountingRecord(account(6, { country: "NZ" }), isRental)).toBe(false);
  });

  it("separates non-Australian Rental rows without deleting or reclassifying them", () => {
    const australia = account(1, { canonicalName: "Australian Hire" });
    const newZealand = account(2, { canonicalName: "Hirepool", country: "NZ", state: "NZ" });
    const selection = buildRentalWorkspaceSelection([australia, newZealand], isRental);

    expect(isAustralianRentalWorkspaceRow(australia)).toBe(true);
    expect(isAustralianRentalWorkspaceRow(newZealand)).toBe(false);
    expect(selection.scopeCountry).toBe("AU");
    expect(selection.allRentalRows.map(row => row.id)).toEqual([1, 2]);
    expect(selection.rentalRows.map(row => row.id)).toEqual([1]);
    expect(selection.nonScopeRentalRows.map(row => row.id)).toEqual([2]);
    expect(selection.countingAccounts.map(row => row.id)).toEqual([1]);
  });

  it("attaches non-counting context and duplicate rows to the nearest counting ancestor", () => {
    const selection = buildRentalWorkspaceSelection([
      account(1, { canonicalName: "Coates Hire" }),
      account(2, {
        canonicalName: "Coates National Fleet",
        countsTowardPotential: false,
        relationshipType: "strategic_context",
        parentAccountId: 1,
      }),
      account(3, {
        canonicalName: "Coates Duplicate",
        countsTowardPotential: false,
        relationshipType: "duplicate",
        recordStatus: "merged",
        mergedIntoAccountId: 1,
      }),
    ], isRental);

    expect(selection.rentalRows).toHaveLength(3);
    expect(selection.countingAccounts.map(row => row.id)).toEqual([1]);
    expect(selection.contextRecords.map(row => row.id)).toEqual([2, 3]);
    expect(selection.contextByCountingAccountId.get(1)?.map(row => row.id)).toEqual([2, 3]);
    expect(selection.unattachedContextRecords).toEqual([]);
  });

  it("does not silently attach cycles, missing targets or free-floating context rows", () => {
    const selection = buildRentalWorkspaceSelection([
      account(1),
      account(2, { countsTowardPotential: false, parentAccountId: 999 }),
      account(3, { countsTowardPotential: false, parentAccountId: 4 }),
      account(4, { countsTowardPotential: false, parentAccountId: 3 }),
      account(5, { countsTowardPotential: false }),
    ], isRental);

    expect(selection.countingAccounts.map(row => row.id)).toEqual([1]);
    expect(selection.contextByCountingAccountId.size).toBe(0);
    expect(selection.unattachedContextRecords.map(row => row.id)).toEqual([2, 3, 4, 5]);
  });

  it("does not collapse a separately counting child buying authority", () => {
    const selection = buildRentalWorkspaceSelection([
      account(1, { canonicalName: "Parent Hire" }),
      account(2, {
        canonicalName: "Separate Division Hire",
        parentAccountId: 1,
        relationshipType: "division",
        countsTowardPotential: true,
      }),
    ], isRental);

    expect(selection.countingAccounts.map(row => row.id)).toEqual([1, 2]);
    expect(selection.contextRecords).toEqual([]);
  });
});
