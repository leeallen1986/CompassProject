import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("candidate-slate trust boundary source consistency", () => {
  it("keeps getSlate read-only", () => {
    const router = source("server/routers/contactValidation.ts");
    const block = router.slice(router.indexOf("getSlate:"), router.indexOf("regenerateSlate:"));
    expect(block).not.toContain("generateCandidateSlate(");
    expect(block).not.toContain("saveCandidateSlate(");
    expect(block).not.toContain(".insert(");
    expect(block).not.toContain(".update(");
    expect(block).not.toContain(".delete(");
  });

  it("uses transactional validation writes and full slate invalidation", () => {
    const router = source("server/routers/contactValidation.ts");
    expect(router).toContain("db.transaction(async tx");
    expect(router).toContain("invalidateAffectedSlatesInTransaction");
    const invalidation = source("server/contactSlateTrustDb.ts");
    expect(invalidation).toContain("contactProjects.projectId");
    expect(invalidation).toContain("alreadyStaleSlateIds");
    expect(invalidation).toContain("Affected candidate slates were not atomically invalidated");
  });

  it("validates persisted slates inside the replacement transaction", () => {
    const waterfall = source("server/contactWaterfall.ts");
    expect(waterfall).toContain("db.transaction(async tx");
    expect(waterfall).toContain("validateStoredCandidateSlate(");
    expect(waterfall).toContain("Candidate slate contains a duplicate contact assignment");
  });

  it("makes Hunter promotions complete and slate-aware", () => {
    const hunter = source("server/hunterVerification.ts");
    expect(hunter).toContain('verificationStatus: "verified"');
    expect(hunter).toContain("invalidateAffectedSlatesInTransaction");
    expect(hunter).not.toContain("where(eq(hunterVerificationLog.contactId, contactId))");
  });

  it("ships an audit CLI with no apply mode and the required artifacts", () => {
    const cli = source("server/scripts/contactSlateTrustAudit.ts");
    expect(cli).toContain("contact-slate-trust-audit.json");
    expect(cli).toContain("contact-slate-trust-audit.csv");
    expect(cli).toContain("contact-slate-trust-summary.json");
    expect(cli).toContain("--apply");
    expect(cli).toContain("is not supported; this audit is read-only");
  });
});
