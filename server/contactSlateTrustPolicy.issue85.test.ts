import { describe, expect, it } from "vitest";
import {
  evaluateSlateEligibility,
  hasSendReadyEnrichmentSource,
  isExplicitlyNotCrmOrphan,
} from "./contactSlateTrustPolicy";

describe("Issue #85 CRM-orphan fail-closed policy", () => {
  it.each([
    [false, true],
    [0, true],
    [true, false],
    [1, false],
    [null, false],
    [undefined, false],
  ] as const)("classifies %s as explicitly non-orphan=%s", (value, expected) => {
    expect(isExplicitlyNotCrmOrphan(value)).toBe(expected);
  });

  it.each([true, 1, null, undefined] as const)(
    "excludes unknown or orphan crmOrphan=%s",
    crmOrphan => {
      expect(evaluateSlateEligibility({
        contactTrustTier: "send_ready",
        rejectionReason: null,
        crmOrphan,
      }, true)).toMatchObject({
        eligible: false,
        reasons: ["crm_orphan"],
      });
    },
  );

  it("allows only explicit non-LLM enrichment sources for send-ready use", () => {
    expect(hasSendReadyEnrichmentSource("linkedin")).toBe(true);
    expect(hasSendReadyEnrichmentSource("manual")).toBe(true);
    expect(hasSendReadyEnrichmentSource("llm")).toBe(false);
    expect(hasSendReadyEnrichmentSource(null)).toBe(false);
  });
});
