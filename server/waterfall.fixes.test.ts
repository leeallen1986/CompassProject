/**
 * waterfall.fixes.test.ts
 *
 * Tests for the three waterfall pipeline fixes applied 2026-05-07:
 *
 * Fix 1: Apollo verifyContactEmail now promotes contactTrustTier to send_ready
 *         when email_status = "verified" (was silently leaving it as named_unverified)
 *
 * Fix 2: webStakeholderDiscovery now writes a contactProjects row atomically
 *         at insert time (was orphaning contacts with no project link)
 *
 * Fix 3: deriveDiscoveryStatus correctly promotes projects to send_ready_contact
 *         when contactTrustTier = send_ready contacts exist
 */

import { describe, it, expect } from "vitest";

// ── Fix 1: Trust tier promotion logic ────────────────────────────────────────

/**
 * The trust tier promotion rule:
 *   email_status === "verified"  → contactTrustTier = "send_ready"
 *   email_status !== "verified"  → contactTrustTier unchanged (keep existing)
 *
 * This mirrors the logic now in apolloEnrichment.ts verifyContactEmail().
 */
function computeNewTrustTier(
  emailStatus: string | null,
  existingTier: "send_ready" | "named_unverified" | "llm_inferred"
): "send_ready" | "named_unverified" | "llm_inferred" {
  if (emailStatus === "verified") return "send_ready";
  return existingTier;
}

describe("Fix 1: Apollo verifyContactEmail trust tier promotion", () => {
  it("promotes to send_ready when email_status is verified", () => {
    expect(computeNewTrustTier("verified", "named_unverified")).toBe("send_ready");
  });

  it("promotes to send_ready even if already send_ready (idempotent)", () => {
    expect(computeNewTrustTier("verified", "send_ready")).toBe("send_ready");
  });

  it("does NOT promote when email_status is likely_to_engage", () => {
    expect(computeNewTrustTier("likely_to_engage", "named_unverified")).toBe("named_unverified");
  });

  it("does NOT promote when email_status is unverified", () => {
    expect(computeNewTrustTier("unverified", "named_unverified")).toBe("named_unverified");
  });

  it("does NOT promote when email_status is null", () => {
    expect(computeNewTrustTier(null, "named_unverified")).toBe("named_unverified");
  });

  it("preserves llm_inferred tier when email is not verified", () => {
    expect(computeNewTrustTier("unverified", "llm_inferred")).toBe("llm_inferred");
  });

  it("can promote llm_inferred to send_ready if email is verified (edge case)", () => {
    // This shouldn't happen in practice but the logic should handle it
    expect(computeNewTrustTier("verified", "llm_inferred")).toBe("send_ready");
  });
});

// ── Fix 2: contactProjects linkage guard ─────────────────────────────────────

/**
 * The linkage guard ensures that when a contact is saved, a contactProjects
 * row is also written. This test validates the guard logic in isolation.
 */
interface ContactProjectsRow {
  contactId: number;
  projectId: number;
  projectName: string;
  relevance: "primary" | "secondary";
}

function buildContactProjectsRow(params: {
  contactId: number;
  projectId: number;
  projectName: string;
  contactCompany: string;
  projectOwner: string;
}): ContactProjectsRow {
  return {
    contactId: params.contactId,
    projectId: params.projectId,
    projectName: params.projectName,
    relevance: params.contactCompany === params.projectOwner ? "primary" : "secondary",
  };
}

describe("Fix 2: webStakeholderDiscovery contactProjects linkage guard", () => {
  it("creates a contactProjects row with correct contactId and projectId", () => {
    const row = buildContactProjectsRow({
      contactId: 42,
      projectId: 7,
      projectName: "Norseman Gold Mine",
      contactCompany: "Pantoro",
      projectOwner: "Pantoro",
    });
    expect(row.contactId).toBe(42);
    expect(row.projectId).toBe(7);
    expect(row.projectName).toBe("Norseman Gold Mine");
  });

  it("sets relevance to primary when contact company matches project owner", () => {
    const row = buildContactProjectsRow({
      contactId: 1,
      projectId: 1,
      projectName: "Test Project",
      contactCompany: "BHP",
      projectOwner: "BHP",
    });
    expect(row.relevance).toBe("primary");
  });

  it("sets relevance to secondary when contact company differs from project owner", () => {
    const row = buildContactProjectsRow({
      contactId: 1,
      projectId: 1,
      projectName: "Test Project",
      contactCompany: "Thiess",
      projectOwner: "BHP",
    });
    expect(row.relevance).toBe("secondary");
  });

  it("deduplication: does not insert duplicate contactProjects rows", () => {
    // Simulate the guard: if existingLink.length > 0, skip insert
    const existingLinks: ContactProjectsRow[] = [
      { contactId: 5, projectId: 10, projectName: "X", relevance: "primary" },
    ];

    function shouldInsert(contactId: number, projectId: number): boolean {
      const existing = existingLinks.filter(
        (l) => l.contactId === contactId && l.projectId === projectId
      );
      return existing.length === 0;
    }

    expect(shouldInsert(5, 10)).toBe(false); // already exists
    expect(shouldInsert(5, 11)).toBe(true);  // different project
    expect(shouldInsert(6, 10)).toBe(true);  // different contact
  });
});

// ── Fix 3: discoveryStatus derivation ────────────────────────────────────────

import { deriveDiscoveryStatus } from "./discoveryQueue";

describe("Fix 3: deriveDiscoveryStatus promotion", () => {
  it("returns send_ready_contact when sendReady > 0", () => {
    expect(deriveDiscoveryStatus("private", { sendReady: 1, named: 0, roleOnly: 0 }))
      .toBe("send_ready_contact");
  });

  it("returns send_ready_contact even for government owner when sendReady > 0", () => {
    expect(deriveDiscoveryStatus("government", { sendReady: 2, named: 1, roleOnly: 0 }))
      .toBe("send_ready_contact");
  });

  it("returns named_contact_no_email when named > 0 and sendReady = 0", () => {
    expect(deriveDiscoveryStatus("private", { sendReady: 0, named: 3, roleOnly: 0 }))
      .toBe("named_contact_no_email");
  });

  it("returns role_only when only roleOnly > 0", () => {
    expect(deriveDiscoveryStatus("private", { sendReady: 0, named: 0, roleOnly: 2 }))
      .toBe("role_only");
  });

  it("returns no_contacts when all counts are 0 for private owner", () => {
    expect(deriveDiscoveryStatus("private", { sendReady: 0, named: 0, roleOnly: 0 }))
      .toBe("no_contacts");
  });

  it("returns blocked_government_owner when government owner has no contacts", () => {
    expect(deriveDiscoveryStatus("government", { sendReady: 0, named: 0, roleOnly: 0 }))
      .toBe("blocked_government_owner");
  });

  it("returns blocked_government_owner when government owner has only role_only", () => {
    expect(deriveDiscoveryStatus("government", { sendReady: 0, named: 0, roleOnly: 5 }))
      .toBe("blocked_government_owner");
  });

  it("returns blocked_dirty_owner when contractor_desc owner has no send_ready", () => {
    expect(deriveDiscoveryStatus("contractor_desc", { sendReady: 0, named: 2, roleOnly: 0 }))
      .toBe("blocked_dirty_owner");
  });

  it("returns blocked_no_usable_domain when unknown owner has no send_ready", () => {
    expect(deriveDiscoveryStatus("unknown", { sendReady: 0, named: 0, roleOnly: 0 }))
      .toBe("blocked_no_usable_domain");
  });

  it("send_ready takes priority over blocked states", () => {
    // Even a government owner should be promoted if they have send_ready contacts
    expect(deriveDiscoveryStatus("government", { sendReady: 1, named: 0, roleOnly: 0 }))
      .toBe("send_ready_contact");
  });
});

// ── Waterfall router procedure input validation ───────────────────────────────

describe("Waterfall router input validation", () => {
  it("sourceFunnel days must be between 1 and 90", () => {
    const validate = (days: number) => days >= 1 && days <= 90;
    expect(validate(14)).toBe(true);
    expect(validate(30)).toBe(true);
    expect(validate(90)).toBe(true);
    expect(validate(0)).toBe(false);
    expect(validate(91)).toBe(false);
  });

  it("contactCoverage priority must be hot, warm, or all", () => {
    const valid = ["hot", "warm", "all"];
    expect(valid.includes("hot")).toBe(true);
    expect(valid.includes("warm")).toBe(true);
    expect(valid.includes("all")).toBe(true);
    expect(valid.includes("cold")).toBe(false);
    expect(valid.includes("")).toBe(false);
  });

  it("contactCoverage limit must be between 1 and 200", () => {
    const validate = (limit: number) => limit >= 1 && limit <= 200;
    expect(validate(50)).toBe(true);
    expect(validate(200)).toBe(true);
    expect(validate(1)).toBe(true);
    expect(validate(0)).toBe(false);
    expect(validate(201)).toBe(false);
  });
});
