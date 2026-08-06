import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routers = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const templates = readFileSync(new URL("./outreachTemplates.ts", import.meta.url), "utf8");
const outreachEmail = readFileSync(new URL("./outreachEmail.ts", import.meta.url), "utf8");
const thisWeek = readFileSync(new URL("./thisWeekService.ts", import.meta.url), "utf8");
const thisWeekClient = readFileSync(
  new URL("../client/src/pages/ThisWeek.tsx", import.meta.url),
  "utf8",
);
const emailDigest = readFileSync(new URL("./emailDigest.ts", import.meta.url), "utf8");
const telemetry = readFileSync(
  new URL("./outreachDraftTelemetry.ts", import.meta.url),
  "utf8",
);

describe("Issue #86 fail-closed integration", () => {
  it("uses the exact outreach projection for This Week contact selection", () => {
    expect(thisWeek).toContain("getAllContactsWithOutreachEligibility()");
    expect(thisWeek).toContain("contactsExactlyLinkedToProject(allContacts, p.id)");
    expect(thisWeek).toContain("contactsAreExactProjectLinks: true");
    expect(thisWeek).not.toContain("const allContacts = await getAllContacts();");
    expect(thisWeek).not.toContain("c.project.toLowerCase().includes(p.name.toLowerCase()");
    expect(thisWeek).not.toContain("inScopeProjectNames");
    expect(thisWeek).toContain("isContactOutreachEligibleForProject(c, p.id)");
    expect(thisWeek).toContain('action: "validate_contacts"');
    expect(thisWeek).toContain("Validate ${contactSelection.fallbackContacts.length} exact-linked contact");
    expect(thisWeek).toContain('type: "contact_validation"');
    expect(thisWeek).toContain("do not run duplicate stakeholder discovery");
  });

  it("derives action-ready counts from the authoritative contact CTA", () => {
    expect(thisWeek).toContain("topProjects.filter(isThisWeekActionReady)");
    expect(thisWeekClient).toContain("Likely route (inference):");
    expect(thisWeekClient).toContain(
      "Recorded contact context · employment unverified",
    );
  });

  it("keeps outreach telemetry free of recipient and project text", () => {
    const start = routers.indexOf("recordOutreachDraftTelemetry({");
    expect(start).toBeGreaterThan(-1);
    const routeTelemetryBlock = routers.slice(
      start,
      routers.indexOf("});", start) + 3,
    );
    expect(routeTelemetryBlock).toContain("projectId: ctx85.projectId");
    expect(routeTelemetryBlock).toContain("contactId: ctx85.contactId");

    const writerStart = telemetry.indexOf("await writer(");
    const writerBlock = telemetry.slice(
      writerStart,
      telemetry.indexOf(");", writerStart) + 2,
    );
    expect(writerStart).toBeGreaterThan(-1);
    expect(writerBlock).toContain("projectId: input.projectId");
    expect(writerBlock).toContain("contactId: input.contactId");
    expect(writerBlock).not.toMatch(/contactName|projectName|contactEmail|subject|body/);
  });

  it("does not discard usable drafts when diagnostics writes fail", () => {
    expect(telemetry).toContain("[Outreach] draft telemetry unavailable");
    expect(templates).toContain("[OutreachTemplate] usage metric unavailable");
  });

  it("requires nonblank subject and body before save, EML or mailto", () => {
    expect(routers.match(/subject: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(512\)/g))
      .toHaveLength(3);
    expect(routers.match(/body: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(100_000\)/g))
      .toHaveLength(3);
  });

  it("keeps AI-success prompts confirmation-first and evidence disciplined", () => {
    expect(outreachEmail).toContain(
      "RECORDED CONTACT CONTEXT (IDENTITY/MAILBOX CONTEXT ONLY)",
    );
    expect(outreachEmail).toContain("confirmation-first");
    expect(outreachEmail).toContain(
      "FINAL EVIDENCE OVERRIDE (HIGHEST PRIORITY)",
    );
    expect(outreachEmail).not.toContain(
      "You MUST weave at least 2 of their KPIs or pain points",
    );
    expect(templates).toContain("CURRENT EMPLOYMENT/TITLE UNVERIFIED");
    expect(templates).toContain("never assert current employment");
    expect(templates).not.toContain("NEW CONTACT DETAILS");
  });

  it("keeps This Week stakeholder and digest claims fail closed", () => {
    expect(thisWeek).toContain('email: sendReady ? c.email?.trim() || null : null');
    expect(thisWeek).toContain('projectLinkState: "exact_persisted"');
    expect(thisWeek).toContain("isExplicitlyNotCrmOrphan(c.crmOrphan)");
    expect(thisWeek).toContain("isExplicitlyNotCrmOrphan(contact.crmOrphan)");
    expect(emailDigest).toContain("⚠️ VALIDATE FIRST");
    expect(emailDigest).toContain("Exact persisted project link");
    expect(emailDigest).toContain("Recorded context:");
    expect(emailDigest).toContain("employment not independently verified");
    expect(emailDigest).toContain("getAllContactsWithOutreachEligibility");
    expect(emailDigest).toContain("exactDigestContactsForProject");
    expect(emailDigest).not.toContain("getAllContacts()");
    expect(emailDigest).not.toContain("c.project.toLowerCase().includes");
    expect(emailDigest).toContain("Recorded contractor/package entries (participation unverified)");
    expect(thisWeek).toContain("Recorded contractor/package entries (participation unverified)");
    expect(emailDigest).toContain("if (s.email) section += ` | Email: ${s.email}`");
    expect(emailDigest).not.toContain("🔑 KEY");
  });
});
