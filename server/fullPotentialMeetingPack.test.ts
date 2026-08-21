import { describe, expect, it } from "vitest";
import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type {
  FullPotentialPublicObservationRecord,
  FullPotentialRestrictedScenarioRecord,
} from "../shared/fullPotentialPublicDraftPack";
import {
  buildFullPotentialMeetingPack,
  verifyFullPotentialMeetingPack,
} from "./fullPotentialMeetingPack";

const SYNTHETIC_ASP = 1_000;

function observation(
  overrides: Partial<FullPotentialPublicObservationRecord> = {},
): FullPotentialPublicObservationRecord {
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

function planning(
  overrides: Partial<FullPotentialRestrictedScenarioRecord> = {},
): FullPotentialRestrictedScenarioRecord {
  return {
    recordKey: "rental:example:core",
    planningValueSetRef: "rental-planning-test-v1",
    planningValueBasis: "blended_portfolio",
    localisationUpliftStatus: "not_applicable",
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
    ...overrides,
  };
}

function input() {
  return {
    publicObservations: [observation()],
    restrictedPlanning: [planning()],
    currentRevenueInputs: [],
    readiness: {
      expectedCurrentRevenueSegments: ["rental_hire"],
      planningStatus: "provisional" as const,
      localisationCostStatus: "tbc" as const,
      accountReconciliationStatus: "partial" as const,
      liveDeploymentRequired: false,
    },
    exportOptions: {
      title: "Test Full Potential",
      asOfLabel: "21 Aug 2026",
      meetingDateLabel: "3 Sep 2026",
    },
    generatedAt: "2026-08-21T13:00:00.000Z",
    sourcePackRef: "fp-test-pack-v1",
  };
}

describe("Full Potential offline meeting pack", () => {
  it("builds deterministic hashed management outputs without side effects", () => {
    const first = buildFullPotentialMeetingPack(input());
    const second = buildFullPotentialMeetingPack(input());

    expect(first.manifest.manifestSha256).toBe(second.manifest.manifestSha256);
    expect(first.manifest).toMatchObject({
      version: 1,
      sourcePackRef: "fp-test-pack-v1",
      meetingStatus: "ready_with_declared_gaps",
      publicObservationCount: 1,
      restrictedPlanningCount: 1,
      countingRecordCount: 1,
      nonCountingRecordCount: 0,
      invariants: {
        databaseConnections: 0,
        databaseWrites: 0,
        crmWrites: 0,
        pipelineInvocations: 0,
        providerCalls: 0,
        liveDeploymentRequired: false,
      },
    });
    expect(first.exportBundle.markdown).toContain("# Test Full Potential");
    expect(first.exportBundle.markdown).toContain("READY WITH DECLARED GAPS");
    expect(first.exportBundle.csv.headline).toContain("named_evidenced_core");
    expect(() => verifyFullPotentialMeetingPack(first)).not.toThrow();
  });

  it("detects tampered outputs and manifests", () => {
    const pack = buildFullPotentialMeetingPack(input());
    const changedMarkdown = structuredClone(pack);
    changedMarkdown.exportBundle.markdown += "\nchanged";
    expect(() => verifyFullPotentialMeetingPack(changedMarkdown))
      .toThrow("output hash mismatch");

    const changedManifest = structuredClone(pack);
    changedManifest.manifest.sourcePackRef = "changed-ref";
    expect(() => verifyFullPotentialMeetingPack(changedManifest))
      .toThrow("manifest SHA-256 mismatch");
  });

  it("rejects live-deployment dependency and non-opaque source refs", () => {
    expect(() => buildFullPotentialMeetingPack({
      ...input(),
      readiness: {
        ...input().readiness,
        liveDeploymentRequired: true,
      },
    })).toThrow("must not require a live production deployment");

    expect(() => buildFullPotentialMeetingPack({
      ...input(),
      sourcePackRef: "contains a space",
    })).toThrow("opaque non-sensitive reference");
  });

  it("keeps missing current revenue declared rather than inventing zero", () => {
    const pack = buildFullPotentialMeetingPack(input());
    expect(pack.readiness.missingCurrentRevenueSegments).toEqual(["rental_hire"]);
    expect(pack.view.buyerSegments[0].currentRevenueAud).toBeNull();
    expect(pack.exportBundle.markdown).toContain("Pending");
  });
});
