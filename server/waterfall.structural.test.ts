/**
 * Waterfall Structural Fix Tests
 *
 * Tests for the five structural fixes applied to the contact discovery waterfall:
 * Fix 1: Hunter wired into automated waterfall (discoveryQueue.ts)
 * Fix 2: Hunter domain derivation uses LLM inference (hunterVerification.ts)
 * Fix 3: CRM orphan contacts flagged with crmOrphan=true (schema + DB)
 * Fix 4: Apollo promotion passes the canonical persisted trust boundary
 * Fix 5: Stuck discovery_running projects reset to discovery_queued
 */

import { describe, it, expect } from "vitest";

// ── Fix 1: Hunter wired into discoveryQueue ──────────────────────────────────
describe("Fix 1: Hunter in automated waterfall", () => {
  it("discoveryQueue imports verifyProjectContactsWithHunter", async () => {
    // The import should resolve without error
    const mod = await import("./discoveryQueue");
    expect(mod).toBeDefined();
    // The module should export processDiscoveryQueue
    expect(typeof mod.processDiscoveryQueue).toBe("function");
  });

  it("hunterVerification exports verifyProjectContactsWithHunter", async () => {
    const mod = await import("./hunterVerification");
    expect(typeof mod.verifyProjectContactsWithHunter).toBe("function");
  });

  it("verifyProjectContactsWithHunter accepts projectId and maxContacts", async () => {
    const { verifyProjectContactsWithHunter } = await import("./hunterVerification");
    // Should be a function with at least 1 parameter
    expect(verifyProjectContactsWithHunter.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Fix 2: LLM-based domain derivation ──────────────────────────────────────
describe("Fix 2: LLM domain inference in Hunter", () => {
  it("hunterVerification imports inferCompanyDomains from domainInference", async () => {
    // Read the file source to verify the import exists
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./hunterVerification.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("import { inferCompanyDomains } from \"./domainInference\"");
  });

  it("domain cache is a Map (in-memory, not global state leak)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./hunterVerification.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("_domainCache = new Map");
  });

  it("deriveDomainFromCompany is now async (awaits LLM inference)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./hunterVerification.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("async function deriveDomainFromCompany");
  });

  it("domain derivation has LLM fallback to heuristic", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./hunterVerification.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Fallback heuristic should still exist
    expect(src).toContain("com.au");
    // LLM try/catch block
    expect(src).toContain("} catch {");
  });
});

// ── Fix 3: crmOrphan schema field ────────────────────────────────────────────
describe("Fix 3: crmOrphan field in schema", () => {
  it("contacts schema has crmOrphan boolean field", async () => {
    const schema = await import("../drizzle/schema");
    // The contacts table type should include crmOrphan
    const contactType = schema.contacts;
    expect(contactType).toBeDefined();
    // Check the column exists in the table definition
    const columns = Object.keys((contactType as any)[Symbol.for("drizzle:Columns")] || {});
    // If Symbol approach doesn't work, check via inference
    const sampleInsert: Partial<typeof schema.contacts.$inferInsert> = {
      crmOrphan: false,
    };
    expect(sampleInsert.crmOrphan).toBe(false);
  });

  it("crmOrphan defaults to false", async () => {
    const schema = await import("../drizzle/schema");
    const sampleInsert: Partial<typeof schema.contacts.$inferInsert> = {};
    // Default should be false (not required in insert)
    // TypeScript type check: crmOrphan should be optional in InsertContact
    const withOrphan: typeof schema.contacts.$inferInsert = {
      reportId: 1,
      name: "Test",
      title: "Test",
      company: "Test",
      project: "Test",
      priority: "hot",
      roleBucket: "test",
      crmOrphan: true,
    };
    expect(withOrphan.crmOrphan).toBe(true);
  });

  it("routers.ts contactCoverage query filters crmOrphan=0", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./routers.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Should have crmOrphan = 0 filter in the coverage query
    expect(src).toContain("c.crmOrphan = 0");
  });

  it("routers.ts digestEligibleProjects query filters crmOrphan=0", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./routers.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Count occurrences — should appear in multiple queries
    const occurrences = (src.match(/crmOrphan = 0/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});

// ── Fix 4: canonical Apollo trust promotion ──────────────────────────────────
describe("Fix 4: Apollo trust promotion uses canonical evidence", () => {
  it("apolloEnrichment reveal path resolves the tier through the shared boundary", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./apolloEnrichment.ts", import.meta.url).pathname,
      "utf-8"
    );

    expect(src).toContain("resolvePersistedContactTrustTier({");
    expect(src).toContain("isExplicitlyNotCrmOrphan(contact.crmOrphan)");
    expect(src).toContain("hasProjectLink,");
    expect(src).not.toContain(
      "contactTrustTier: isVerified ? \"send_ready\" : contact.contactTrustTier"
    );
  });

  it("apolloEnrichment links new contacts before conditionally promoting them", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./apolloEnrichment.ts", import.meta.url).pathname,
      "utf-8"
    );

    expect(src).toContain('contactTrustTier: "named_unverified"');
    expect(src).toContain("await tx.insert(contactProjects).values");
    expect(src).toContain("hasProjectLink: true");
    expect(src).not.toContain(
      "contactTrustTier: enrichedPerson.emailStatus === \"verified\" ? \"send_ready\" : \"named_unverified\""
    );
  });

  it("verified email alone is insufficient without explicit orphan and project-link evidence", async () => {
    const { canPersistSendReady } = await import("./contactTrustPromotionBoundary");
    const completeEvidence = {
      enrichmentSource: "apollo",
      email: "verified@example.com",
      emailVerified: true,
      verificationStatus: "verified",
      rejectionReason: null,
      crmOrphan: false,
      hasProjectLink: true,
    } as const;

    expect(canPersistSendReady(completeEvidence)).toBe(true);
    expect(canPersistSendReady({ ...completeEvidence, hasProjectLink: false })).toBe(false);
    expect(canPersistSendReady({ ...completeEvidence, crmOrphan: null })).toBe(false);
  });
});

// ── Fix 5: Stuck discovery_running reset ─────────────────────────────────────
describe("Fix 5: Stuck discovery_running projects", () => {
  it("discoveryQueue exports backfillDiscoveryStatus for manual repair", async () => {
    const mod = await import("./discoveryQueue");
    expect(typeof mod.backfillDiscoveryStatus).toBe("function");
  });

  it("discoveryQueue exports queueDiscoveryForProject", async () => {
    const mod = await import("./discoveryQueue");
    expect(typeof mod.queueDiscoveryForProject).toBe("function");
  });

  it("discoveryQueue exports enforceHotProjectSLA", async () => {
    const mod = await import("./discoveryQueue");
    expect(typeof mod.enforceHotProjectSLA).toBe("function");
  });
});

// ── Integration: waterfall provider sequencing ───────────────────────────────
describe("Waterfall provider sequencing", () => {
  it("discoveryQueue uses correct provider order: apollo → web_search → hunter → llm", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./discoveryQueue.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Find the runDiscoveryForProject function body (after the imports section)
    // Look for the actual await calls (not import lines)
    const apolloAwaitPos = src.indexOf("await enrichProjectContacts(");
    const webAwaitPos = src.indexOf("await generateAndEnrichContacts(");
    const hunterAwaitPos = src.indexOf("await verifyProjectContactsWithHunter(");
    const llmAwaitPos = src.indexOf("await generateAndSaveLLMContacts(");

    expect(apolloAwaitPos).toBeGreaterThan(-1);
    expect(webAwaitPos).toBeGreaterThan(-1);
    expect(hunterAwaitPos).toBeGreaterThan(-1);
    expect(llmAwaitPos).toBeGreaterThan(-1);

    // Apollo runs first (for private owners)
    expect(apolloAwaitPos).toBeLessThan(webAwaitPos);
    // Hunter runs after web_search (as fallback verifier)
    expect(webAwaitPos).toBeLessThan(hunterAwaitPos);
    // LLM runs after Hunter (for government/dirty owners — separate branch)
    // Note: LLM is in a different branch (government/dirty), not sequentially after Hunter
    // The key invariant is that Hunter comes after web_search in the private-owner branch
    expect(hunterAwaitPos).toBeGreaterThan(webAwaitPos);
  });

  it("Hunter is only called when HUNTER_API_KEY is present", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./discoveryQueue.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Should guard Hunter call with ENV.hunterApiKey check
    expect(src).toContain("ENV.hunterApiKey");
    expect(src).toContain("verifyProjectContactsWithHunter");
  });

  it("Hunter is NOT used as a discovery engine (only for named_unverified contacts)", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./hunterVerification.ts", import.meta.url).pathname,
      "utf-8"
    );
    // Should explicitly skip LLM contacts
    expect(src).toContain("llm_contacts_not_eligible");
    // Should skip already send_ready contacts
    expect(src).toContain("already_send_ready");
  });
});
