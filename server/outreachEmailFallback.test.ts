import { describe, expect, it } from "vitest";
import { buildDeterministicOutreachEmail } from "./outreachEmailFallback";
import type { OutreachInput } from "./outreachEmail";

const INPUT: OutreachInput = {
  contactName: "Casey Buyer",
  contactTitle: "Procurement Manager",
  contactCompany: "Build Co",
  contactEmail: "casey@example.com",
  contactRoleBucket: "procurement",
  projectName: "Northern Water Upgrade",
  projectLocation: "Western Australia",
  projectValue: "$100m",
  projectSector: "infrastructure",
  projectStage: "planning",
  projectOverview: "Untrusted prose must not be copied into fallback output.",
  equipmentSignals: ["Unverified 42% saving claim"],
  opportunityRoute: "Direct CAPEX",
  matchedBusinessLines: ["Portable Air"],
  senderName: "Alex",
  tone: "consultative",
};

describe("buildDeterministicOutreachEmail", () => {
  it("uses only bounded canonical context and returns an explicit fallback mode", () => {
    const result = buildDeterministicOutreachEmail(INPUT, "quota_exhausted");
    expect(result.subject).toBe("Northern Water Upgrade — project contact check");
    expect(result.body).toContain("Hi Casey,");
    expect(result.body).not.toContain("Portable Air");
    expect(result.body).toContain("understand the project's equipment requirements");
    expect(result.body).not.toContain("Given your role");
    expect(result.body).not.toContain("role as Procurement Manager at Build Co");
    expect(result.body).toContain("confirm whether this project is relevant to your current responsibilities");
    expect(result.generationMode).toBe("deterministic_template");
    expect(result.aiUnavailableReason).toBe("quota_exhausted");
  });

  it("does not copy untrusted overview, equipment claims, value or stage", () => {
    const result = buildDeterministicOutreachEmail(INPUT, "circuit_open");
    expect(result.body).not.toContain("42%");
    expect(result.body).not.toContain("$100m");
    expect(result.body).not.toContain("planning");
    expect(result.body).not.toContain("Untrusted prose");
  });

  it("does not invent a product focus when none is persisted", () => {
    const result = buildDeterministicOutreachEmail({
      ...INPUT,
      matchedBusinessLines: [],
      collateralName: undefined,
    }, "timeout");
    expect(result.body).toContain("understand the project's equipment requirements");
    expect(result.body).not.toContain("compressor");
    expect(result.body).not.toContain("saving");
  });

  it("uses an explicitly selected collateral name without using derived lane matches", () => {
    const result = buildDeterministicOutreachEmail({
      ...INPUT,
      collateralName: "XAS 88 product guide",
    }, "quota_exhausted");
    expect(result.body).toContain("XAS 88 product guide");
    expect(result.body).not.toContain("Portable Air");
    expect(result.body).toContain("if it proves relevant");
  });
});
