import {
  assertFullPotentialPublicEvidenceRecord,
  toFullPotentialModelAssumptions,
  type FullPotentialPublicEvidenceRecord,
} from "./fullPotentialPublicEvidence";

export const FP_PRIVATE_PLANNING_VALUE_BASES = [
  "machine_only",
  "locally_deployable_package",
  "blended_portfolio",
] as const;

export const FP_LOCALISATION_UPLIFT_STATUSES = [
  "not_applicable",
  "included",
  "excluded_tbc",
] as const;

export type FullPotentialPrivatePlanningValueBasis =
  typeof FP_PRIVATE_PLANNING_VALUE_BASES[number];
export type FullPotentialLocalisationUpliftStatus =
  typeof FP_LOCALISATION_UPLIFT_STATUSES[number];

/**
 * Restricted planning metadata attached to a monetary public-evidence record.
 *
 * The actual Low/Base/High values are supplied in an authorised admin-only
 * assumption pack. This envelope adds traceability without hard-coding current
 * commercial price ladders in public source control.
 */
export interface FullPotentialPrivatePlanningEnvelope {
  record: FullPotentialPublicEvidenceRecord;
  /** Opaque internal reference only, for example `electric-planning-2026-08-v1`. */
  planningValueSetRef: string;
  planningValueBasis: FullPotentialPrivatePlanningValueBasis;
  localisationUpliftStatus: FullPotentialLocalisationUpliftStatus;
}

const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function assertFullPotentialPrivatePlanningEnvelope(
  envelope: FullPotentialPrivatePlanningEnvelope,
): void {
  assertFullPotentialPublicEvidenceRecord(envelope.record);

  if (envelope.record.countingTreatment !== "buyer_counting") {
    throw new Error("Private planning envelopes may be attached only to buyer_counting records");
  }

  if (!OPAQUE_REFERENCE_PATTERN.test(envelope.planningValueSetRef)) {
    throw new Error(
      "planningValueSetRef must be an opaque non-sensitive reference without spaces or currency values",
    );
  }

  if (
    envelope.planningValueBasis === "machine_only"
    && envelope.localisationUpliftStatus === "included"
  ) {
    throw new Error("machine_only planning values cannot claim localisation uplift is included");
  }

  if (
    envelope.planningValueBasis === "locally_deployable_package"
    && envelope.localisationUpliftStatus === "excluded_tbc"
  ) {
    throw new Error(
      "locally_deployable_package values cannot exclude an unresolved localisation uplift",
    );
  }
}

/**
 * Bridge restricted planning provenance into the existing model assumptions.
 * The function never contains or derives a current commercial price ladder.
 */
export function toFullPotentialPrivatePlanningAssumptions(
  envelope: FullPotentialPrivatePlanningEnvelope,
): Record<string, unknown> {
  assertFullPotentialPrivatePlanningEnvelope(envelope);
  return {
    ...toFullPotentialModelAssumptions(envelope.record),
    planningValueSetRef: envelope.planningValueSetRef,
    planningValueBasis: envelope.planningValueBasis,
    localisationUpliftStatus: envelope.localisationUpliftStatus,
  };
}
