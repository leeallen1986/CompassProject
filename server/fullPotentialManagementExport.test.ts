import { describe, expect, it } from "vitest";
import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicEvidenceRecord } from "../shared/fullPotentialPublicEvidence";
import { buildFullPotentialSeptemberManagementView } from "../shared/fullPotentialManagementView";
import { assessFullPotentialManagementReadiness } from "../shared/fullPotentialManagementReadiness";
import {
  buildFullPotentialManagementExportBundle,
  buildFullPotentialManagementMarkdown,
} from "../shared/fullPotentialManagementExport";

const SYNTHETIC_ASP = 1_000;

function countingRecord(
  overrides: Partial<FullPotentialPublicEvidenceRecord> = {},
): FullPotentialPublicEvidenceRecord {
  return {
    recordKey: "rental:example:core",
    commercialPoolKey: "buyer:example:rental-core",
    buyerAccountKey: "example-rental-au",
    buyerName: "Example Rental",
    buyerSegment: "rental_hire",
    application: "rental fleet replacement",
    productFamily: "other",
    productCell: "rental_portable_air_blended",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    scenarios: {
      low: {
        estimatedFleetUnits: 10,
        replacementSharePct: 30,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 100,
      },
      base: {
        estimatedFleetUnits: 20,
        replacementSharePct: 50,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 100,
      },
      high: {
        estimatedFleetUnits: 30,
        replacementSharePct: 60,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 100,
      },
    },
    evidenceGrade: "B",
    sourceName: "Example public source",
    sourceUrl: "https://example.com/public-source",
    observedAt: "2026-08-21",
    publicObservation: "The public catalogue shows a multi-band compressor range.",
    inference: "A transparent band is used without asserting an exact fleet count.",
    modelBand: "P2",
    addressabilityStatus: "addressable_now",
    qualificationGates: [],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    ...overrides,
  };
}

function buildFixture() {
  const conditional = countingRecord({
    recordKey: "mining:example:ts2",
    commercialPoolKey: "buyer:example-miner:ts2",
    buyerAccountKey: "example-miner-au",
    buyerName: "Example Miner",
    buyerSegment: "mining_direct",
    application: "surface mine-spec relocatable electric air",
    productFamily: "e_air",
    productCell: "TS2_surface_mining",
    valueClass: "regional_long_tail",
    scenarioBasis: "adoption_positions",
    scenarios: {
      low: { adoptionPositions: 1, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 50 },
      base: { adoptionPositions: 2, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 60 },
      high: { adoptionPositions: 3, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 70 },
    },
    evidenceGrade: "C",
    modelBand: "TS2-ADOPTION",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: ["Confirm local package compliance before approval."],
  });
  const overlay = countingRecord({
    recordKey: "overlay:rental:temporary-electric",
    commercialPoolKey: "buyer:example:rental-core",
    countingTreatment: "application_overlay_non_counting",
    scenarios: null,
    productFamily: "e_air",
    productCell: "TS2_temporary_industrial_overlay",
    application: "temporary electric air for industrial continuity",
    publicObservation: "Public rental material shows temporary electric air for production continuity.",
    inference: "This remains an application overlay on the Rental buyer pool.",
  });
  const view = buildFullPotentialSeptemberManagementView(
    [countingRecord(), conditional, overlay],
    [{
      buyerSegment: "rental_hire",
      currentRevenueAud: 2_000,
      periodLabel: "rolling 12 months",
      sourceReference: "aggregate-rental-ledger-test",
    }],
  );
  const readiness = assessFullPotentialManagementReadiness(view, {
    expectedCurrentRevenueSegments: ["rental_hire", "mining_direct"],
    planningStatus: "provisional",
    localisationCostStatus: "tbc",
    accountReconciliationStatus: "partial",
    liveDeploymentRequired: false,
  });
  return { view, readiness };
}

describe("Full Potential management export", () => {
  it("renders a meeting-ready Markdown brief with declared gaps", () => {
    const { view, readiness } = buildFixture();
    const markdown = buildFullPotentialManagementMarkdown(view, readiness, {
      title: "Test Full Potential",
      asOfLabel: "21 Aug 2026",
      meetingDateLabel: "3 Sep 2026",
    });

    expect(markdown).toContain("# Test Full Potential");
    expect(markdown).toContain("READY WITH DECLARED GAPS");
    expect(markdown).toContain("Named Evidenced Core");
    expect(markdown).toContain("Regional Long Tail");
    expect(markdown).toContain("Current revenue");
    expect(markdown).toContain("Pending");
    expect(markdown).toContain("Only buyer-counting records carry monetary Full Potential.");
    expect(markdown).toContain("Reconciled: **Yes**");
    expect(markdown).toContain("Estimated market potential is derived from public evidence");
  });

  it("exports reconciled CSV tables with aggregate revenue provenance", () => {
    const { view, readiness } = buildFixture();
    const bundle = buildFullPotentialManagementExportBundle(view, readiness);

    expect(bundle.csv.headline).toContain("named_evidenced_core");
    expect(bundle.csv.buyerSegments).toContain("aggregate-rental-ledger-test");
    expect(bundle.csv.buyerSegments).toContain("rolling 12 months");
    expect(bundle.csv.productCells).toContain("TS2_temporary_industrial_overlay");
    expect(bundle.csv.dataGaps).toContain("aggregate_current_revenue_pending");
    expect(bundle.csv.dataGaps).toContain("canonical_account_reconciliation_incomplete");
    expect(bundle.csv.buyerSegments.endsWith("\n")).toBe(true);
  });

  it("escapes Markdown and CSV-sensitive text", () => {
    const record = countingRecord({
      buyerName: "Example | Rental",
      sourceName: "Example, public source",
      inference: "A transparent band is used, without asserting an exact fleet count.",
    });
    const view = buildFullPotentialSeptemberManagementView([record]);
    const readiness = assessFullPotentialManagementReadiness(view, {
      expectedCurrentRevenueSegments: [],
      planningStatus: "reviewed",
      localisationCostStatus: "estimated",
      accountReconciliationStatus: "complete",
    });
    const bundle = buildFullPotentialManagementExportBundle(view, readiness);

    expect(bundle.markdown).not.toContain("Example | Rental");
    expect(bundle.csv.headline.split("\n")[0]).toBe(
      "key,label,low_aud,base_aud,high_aud,record_count,status",
    );
  });

  it("does not invent missing current revenue", () => {
    const view = buildFullPotentialSeptemberManagementView([countingRecord()]);
    const readiness = assessFullPotentialManagementReadiness(view, {
      expectedCurrentRevenueSegments: ["rental_hire"],
      planningStatus: "provisional",
      localisationCostStatus: "tbc",
      accountReconciliationStatus: "partial",
    });
    const bundle = buildFullPotentialManagementExportBundle(view, readiness);

    expect(bundle.markdown).toContain("Pending");
    const rentalLine = bundle.csv.buyerSegments
      .split("\n")
      .find(line => line.startsWith("rental_hire,"));
    expect(rentalLine).toBeDefined();
    expect(rentalLine).not.toContain(",0,Pending");
  });
});
