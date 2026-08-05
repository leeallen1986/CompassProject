import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectCardSource = readFileSync(new URL("./ProjectCard.tsx", import.meta.url), "utf8");
const projectDetailSource = readFileSync(new URL("../pages/ProjectDetail.tsx", import.meta.url), "utf8");

describe("ProjectCard Issue #86 trust display", () => {
  it("loads the authoritative buyer route only when expanded", () => {
    expect(projectCardSource).toContain("trpc.projectLifecycle.buyerRoute.useQuery");
    expect(projectCardSource).toMatch(/enabled:\s*open/);
    expect(projectCardSource).toContain("<ProjectBuyerRoute dossier={buyerRouteQuery.data}");
  });

  it("does not use free-text contact association", () => {
    expect(projectCardSource).toContain("selectExactProjectContacts(project.id, allContacts");
    expect(projectCardSource).not.toContain("hasKeywordOverlap");
    expect(projectCardSource).not.toContain("projectNameLower.includes");
    expect(projectCardSource).toContain("No fallback contact matching was used");
  });

  it("keeps outreach behind the PR #88 authoritative eligibility helper", () => {
    expect(projectCardSource).toContain("isProjectOutreachEligible(contact, project.id)");
    expect(projectCardSource).toContain("outreachEligibleProjectIds: reportContact?.outreachEligibleProjectIds ?? []");
    expect(projectCardSource).not.toContain("effectivelySendReady ? [project.id]");
  });

  it("shows evidence-complete contact fields without buyer-authority overclaim", () => {
    for (const label of ["Email", "Contact source", "Last checked", "Project link", "Inferred rationale"]) {
      expect(projectCardSource).toContain(label);
    }
    expect(projectCardSource).toContain("High Role Relevance");
    expect(projectCardSource).not.toContain("Key Decision Maker");
  });

  it("supports an expanded deep-link detail experience", () => {
    expect(projectCardSource).toContain("defaultOpen = false");
    expect(projectCardSource).toContain("aria-expanded={open}");
    expect(projectDetailSource).toMatch(/<ProjectCard[\s\S]*defaultOpen/);
  });
});
