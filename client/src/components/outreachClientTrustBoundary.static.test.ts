import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectCard = readFileSync(
  path.join(import.meta.dirname, "ProjectCard.tsx"),
  "utf8",
);
const modal = readFileSync(
  path.join(import.meta.dirname, "OutreachEmailModal.tsx"),
  "utf8",
);
const home = readFileSync(
  path.resolve(import.meta.dirname, "../pages/Home.tsx"),
  "utf8",
);
const aiProjectSearch = readFileSync(
  path.join(import.meta.dirname, "AIProjectSearch.tsx"),
  "utf8",
);

describe("Issue #85 client trust-boundary wiring", () => {
  it("gates ProjectCard actions through exact server-projected eligibility", () => {
    expect(projectCard).toContain("isProjectOutreachEligible(contact, project.id)");
    expect(projectCard).toContain("activeOutreachContact");
    expect(projectCard).not.toMatch(/\bid\s*:\s*0\b/);
  });

  it("keeps transient enrichment results out of the composer", () => {
    expect(projectCard).not.toContain("setEnrichedOutreachContact");
    expect(projectCard).not.toContain("enrichedOutreachContact");
  });

  it("does not merge Home contact identities by name", () => {
    expect(home).toContain("Identities are never merged by name");
    expect(home).toContain("rowKey:");
    expect(home).not.toContain("groupedByName");
  });

  it("re-resolves Home composer IDs from current report rows", () => {
    expect(home).toContain("resolveExactHomeOutreachSelection(");
    expect(home).toContain("setOutreachSelection({ contactId:");
    expect(home).not.toMatch(/\bid\s*:\s*0\b/);
  });

  it("never constructs a recipient mailto URI in the client", () => {
    expect(modal).not.toContain("mailto:");
    expect(modal).not.toContain("contact.email");
    expect(modal).toContain("window.open(data.mailtoUri");
    expect(modal).toContain("prepareOpenInEmail");
  });

  it("sends only persisted IDs to generation and template personalisation", () => {
    expect(modal).toContain("contactId: contact.id");
    expect(modal).toContain("projectId: project.id");
    expect(modal).not.toContain("contactName:");
    expect(modal).not.toContain("contactEmail:");
    expect(modal).not.toContain("projectName:");
  });

  it("invalidates callbacks on close and ignores superseded drafts", () => {
    expect(modal).toContain("activeContextRef.current = null");
    expect(modal).toContain("draftRequestRef.current === requestId");
    expect(modal).toContain("++draftRequestRef.current");
  });

  it("keeps AI search outreach on exact persisted links and eligibility", () => {
    expect(aiProjectSearch).toContain("isProjectOutreachEligible(contact, projectId)");
    expect(aiProjectSearch).toContain("Array.isArray(c.linkedProjectIds)");
    expect(aiProjectSearch).toContain("activeOutreachContact");
    expect(aiProjectSearch).not.toContain("const nameLC");
    expect(aiProjectSearch).not.toContain("cp.includes(");
    expect(aiProjectSearch).not.toContain("email: activeOutreachContact.email");
  });
});
