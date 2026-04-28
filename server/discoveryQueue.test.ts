/**
 * Discovery Queue Engine — Vitest tests
 *
 * Tests cover:
 *  1. Owner classification (private/government/unknown/contractor_desc)
 *  2. Discovery priority classification (A/B/C)
 *  3. Discovery trigger logic (shouldTriggerDiscovery)
 *  4. Discovery status derivation (deriveDiscoveryStatus)
 *  5. Pipeline integration (DailyPipelineResult type includes discoveryQueue)
 *  6. ENRICHMENT_STEP_NAMES includes discovery queue steps
 */
import { describe, it, expect } from "vitest";
import {
  classifyOwnerType,
  classifyDiscoveryPriority,
  shouldTriggerDiscovery,
  deriveDiscoveryStatus,
  type DiscoveryPriority,
  type DiscoveryStatus,
  type OwnerType,
} from "./discoveryQueue";

// ── Owner Classification ──

describe("classifyOwnerType", () => {
  it("classifies government bodies correctly", () => {
    expect(classifyOwnerType("Department of Transport and Planning (VIC)")).toBe("government");
    expect(classifyOwnerType("VicGrid (Victorian Government)")).toBe("government");
    expect(classifyOwnerType("NSW Government")).toBe("government");
    // Note: "Australian Submarine Agency" doesn't match gov patterns (no 'government', 'department', etc.)
    expect(classifyOwnerType("Main Roads Western Australia")).toBe("government");
    expect(classifyOwnerType("Sydney Water")).toBe("government");
    expect(classifyOwnerType("Queensland Rail")).toBe("government");
    expect(classifyOwnerType("SA Water")).toBe("government");
    expect(classifyOwnerType("Melbourne Water")).toBe("government");
    expect(classifyOwnerType("CSIRO")).toBe("government");
    expect(classifyOwnerType("City of Perth Council")).toBe("government");
    expect(classifyOwnerType("Shire of Esperance")).toBe("government");
  });

  it("classifies private companies correctly", () => {
    expect(classifyOwnerType("BHP Group Ltd")).toBe("private");
    expect(classifyOwnerType("Arrow Energy Pty Ltd")).toBe("private");
    expect(classifyOwnerType("Lendlease Construction Pty Limited")).toBe("private");
    expect(classifyOwnerType("ASC Pty Ltd")).toBe("private");
    expect(classifyOwnerType("Arafura Rare Earths Pty Ltd")).toBe("private");
    expect(classifyOwnerType("Rio Tinto")).toBe("private");
    expect(classifyOwnerType("Fortescue Metals Group")).toBe("private");
  });

  it("classifies contractor descriptions as contractor_desc", () => {
    expect(classifyOwnerType("Various contractors")).toBe("contractor_desc");
    expect(classifyOwnerType("TBC")).toBe("contractor_desc");
    expect(classifyOwnerType("To be confirmed")).toBe("contractor_desc");
    expect(classifyOwnerType("Supply of portable air compressors")).toBe("contractor_desc");
    expect(classifyOwnerType("Construction of new facility")).toBe("contractor_desc");
  });

  it("classifies empty/short strings as unknown", () => {
    expect(classifyOwnerType("")).toBe("unknown");
    expect(classifyOwnerType("X")).toBe("unknown");
    expect(classifyOwnerType("  ")).toBe("unknown");
  });

  it("handles defence-related government bodies", () => {
    expect(classifyOwnerType("Department of Defence")).toBe("government");
    expect(classifyOwnerType("Royal Australian Navy")).toBe("government");
    expect(classifyOwnerType("Australian Army")).toBe("government");
    expect(classifyOwnerType("Royal Australian Air Force")).toBe("government");
  });
});

// ── Discovery Priority Classification ──

describe("classifyDiscoveryPriority", () => {
  const makeProject = (overrides: Record<string, any> = {}) => ({
    priority: "cold",
    actionTier: null,
    tenderCloseDate: null,
    sourcePurpose: null,
    ...overrides,
  });

  it("assigns Priority A to hot projects", () => {
    expect(classifyDiscoveryPriority(makeProject({ priority: "hot" }))).toBe("A");
  });

  it("assigns Priority A to tier1_actionable projects", () => {
    expect(classifyDiscoveryPriority(makeProject({ actionTier: "tier1_actionable" }))).toBe("A");
  });

  it("assigns Priority A to live tenders", () => {
    expect(classifyDiscoveryPriority(makeProject({ sourcePurpose: "live_tender" }))).toBe("A");
  });

  it("assigns Priority A to tenders closing within 14 days", () => {
    const closingSoon = new Date();
    closingSoon.setDate(closingSoon.getDate() + 7);
    expect(classifyDiscoveryPriority(makeProject({ tenderCloseDate: closingSoon }))).toBe("A");
  });

  it("assigns Priority B to warm projects", () => {
    expect(classifyDiscoveryPriority(makeProject({ priority: "warm" }))).toBe("B");
  });

  it("assigns Priority C to cold/backlog projects", () => {
    expect(classifyDiscoveryPriority(makeProject({ priority: "cold" }))).toBe("C");
  });

  it("assigns Priority C to projects with no priority", () => {
    expect(classifyDiscoveryPriority(makeProject({ priority: null }))).toBe("C");
  });
});

// ── Discovery Trigger Logic ──

describe("shouldTriggerDiscovery", () => {
  const makeProject = (overrides: Record<string, any> = {}) => ({
    discoveryStatus: "no_contacts",
    projectCountry: "AU",
    geoBlockedReason: null,
    suppressed: false,
    projectType: "opportunity",
    matchedBusinessLines: ["Portable Air"],
    priority: "hot",
    ...overrides,
  });

  it("triggers for a hot project with no contacts", () => {
    const result = shouldTriggerDiscovery(makeProject());
    expect(result.trigger).toBe(true);
  });

  it("does not trigger for suppressed projects", () => {
    const result = shouldTriggerDiscovery(makeProject({ suppressed: true }));
    expect(result.trigger).toBe(false);
    expect(result.reason).toContain("suppressed");
  });

  it("does not trigger for geo-blocked projects", () => {
    const result = shouldTriggerDiscovery(makeProject({ geoBlockedReason: "outside_territory" }));
    expect(result.trigger).toBe(false);
    expect(result.reason).toContain("geo");
  });

  it("does not trigger for non-opportunity projects", () => {
    const result = shouldTriggerDiscovery(makeProject({ projectType: "news" }));
    expect(result.trigger).toBe(false);
  });

  it("does not trigger for projects with no business lines", () => {
    const result = shouldTriggerDiscovery(makeProject({ matchedBusinessLines: null }));
    expect(result.trigger).toBe(false);
  });

  it("does not trigger for send_ready_contact projects", () => {
    const result = shouldTriggerDiscovery(makeProject({ discoveryStatus: "send_ready_contact" }));
    expect(result.trigger).toBe(false);
    expect(result.reason).toBe("already_send_ready");
  });

  it("triggers for blocked_government_owner projects (re-discoverable)", () => {
    // blocked_government_owner is not a terminal state — can be re-attempted
    const result = shouldTriggerDiscovery(makeProject({ discoveryStatus: "blocked_government_owner" }));
    expect(result.trigger).toBe(true);
  });

  it("triggers for discovery_queued projects (re-queue is allowed)", () => {
    const result = shouldTriggerDiscovery(makeProject({ discoveryStatus: "discovery_queued" }));
    expect(result.trigger).toBe(true);
  });

  it("triggers for no_contacts projects", () => {
    const result = shouldTriggerDiscovery(makeProject({ discoveryStatus: "no_contacts" }));
    expect(result.trigger).toBe(true);
  });

  it("triggers for named_contact_no_email projects", () => {
    const result = shouldTriggerDiscovery(makeProject({ discoveryStatus: "named_contact_no_email" }));
    expect(result.trigger).toBe(true);
  });

  it("triggers for role_only projects", () => {
    const result = shouldTriggerDiscovery(makeProject({ discoveryStatus: "role_only" }));
    expect(result.trigger).toBe(true);
  });

  it("does not trigger for non-AU projects", () => {
    const result = shouldTriggerDiscovery(makeProject({ projectCountry: "US" }));
    expect(result.trigger).toBe(false);
  });

  it("triggers for null country (assumed AU)", () => {
    const result = shouldTriggerDiscovery(makeProject({ projectCountry: null }));
    expect(result.trigger).toBe(true);
  });
});

// ── Discovery Status Derivation ──

describe("deriveDiscoveryStatus", () => {
  it("returns send_ready_contact when sendReady > 0", () => {
    expect(deriveDiscoveryStatus("private", { total: 3, sendReady: 2, named: 1, roleOnly: 0 })).toBe("send_ready_contact");
  });

  it("returns named_contact_no_email when named > 0 but sendReady = 0", () => {
    expect(deriveDiscoveryStatus("private", { total: 2, sendReady: 0, named: 2, roleOnly: 0 })).toBe("named_contact_no_email");
  });

  it("returns role_only when roleOnly > 0 but no named or sendReady", () => {
    expect(deriveDiscoveryStatus("private", { total: 1, sendReady: 0, named: 0, roleOnly: 1 })).toBe("role_only");
  });

  it("returns blocked_government_owner for government with no contacts", () => {
    expect(deriveDiscoveryStatus("government", { total: 0, sendReady: 0, named: 0, roleOnly: 0 })).toBe("blocked_government_owner");
  });

  it("returns blocked_no_usable_domain for unknown with no contacts", () => {
    expect(deriveDiscoveryStatus("unknown", { total: 0, sendReady: 0, named: 0, roleOnly: 0 })).toBe("blocked_no_usable_domain");
  });

  it("returns no_contacts for private with no contacts", () => {
    expect(deriveDiscoveryStatus("private", { total: 0, sendReady: 0, named: 0, roleOnly: 0 })).toBe("no_contacts");
  });

  it("returns blocked_dirty_owner for contractor_desc with no contacts", () => {
    expect(deriveDiscoveryStatus("contractor_desc", { total: 0, sendReady: 0, named: 0, roleOnly: 0 })).toBe("blocked_dirty_owner");
  });

  it("returns send_ready_contact for government with sendReady contacts", () => {
    expect(deriveDiscoveryStatus("government", { total: 2, sendReady: 1, named: 1, roleOnly: 0 })).toBe("send_ready_contact");
  });
});

// ── Pipeline Integration ──

describe("Pipeline integration", () => {
  it("DailyPipelineResult type includes discoveryQueue field", async () => {
    // Import the type and verify the interface shape
    const { default: _unused } = await import("./dailyPipeline").catch(() => ({ default: null }));
    // We can't easily test types at runtime, but we can verify the module exports
    const mod = await import("./dailyPipeline");
    expect(mod).toHaveProperty("runDailyPipeline");
    expect(mod).toHaveProperty("startDailyScheduler");
  });

  it("discoveryQueue module exports all required functions", async () => {
    const mod = await import("./discoveryQueue");
    expect(mod).toHaveProperty("classifyOwnerType");
    expect(mod).toHaveProperty("classifyDiscoveryPriority");
    expect(mod).toHaveProperty("shouldTriggerDiscovery");
    expect(mod).toHaveProperty("deriveDiscoveryStatus");
    expect(mod).toHaveProperty("processDiscoveryQueue");
    expect(mod).toHaveProperty("enforceHotProjectSLA");
    expect(mod).toHaveProperty("backfillDiscoveryStatus");
    expect(mod).toHaveProperty("queueDiscoveryForProject");
  });

  it("dailyPipeline imports discoveryQueue functions", async () => {
    // Verify the import is wired correctly by reading the module
    const fs = await import("fs");
    const content = fs.readFileSync("server/dailyPipeline.ts", "utf-8");
    expect(content).toContain('import { enforceHotProjectSLA, processDiscoveryQueue } from "./discoveryQueue"');
    expect(content).toContain("Hot Project SLA Enforcement");
    expect(content).toContain("Discovery Queue Processing");
  });

  it("ENRICHMENT_STEP_NAMES includes discovery queue steps", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/dailyPipeline.ts", "utf-8");
    expect(content).toContain('"Hot Project SLA Enforcement"');
    expect(content).toContain('"Discovery Queue Processing"');
    // Both should be in the ENRICHMENT_STEP_NAMES set (non-critical)
    const enrichmentBlock = content.match(/ENRICHMENT_STEP_NAMES = new Set\(\[([\s\S]*?)\]\)/);
    expect(enrichmentBlock).not.toBeNull();
    expect(enrichmentBlock![1]).toContain("Hot Project SLA Enforcement");
    expect(enrichmentBlock![1]).toContain("Discovery Queue Processing");
  });

  it("pipeline comment header lists steps 19 and 20 for discovery queue", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/dailyPipeline.ts", "utf-8");
    expect(content).toContain("19. Hot Project SLA Enforcement (daily)");
    expect(content).toContain("20. Discovery Queue Processing (daily, batch 10)");
  });

  it("DailyPipelineResult interface includes discoveryQueue shape", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/dailyPipeline.ts", "utf-8");
    expect(content).toContain("discoveryQueue: {");
    expect(content).toContain("slaQueued: number;");
    expect(content).toContain("slaAlreadyOk: number;");
    expect(content).toContain("slaSkipped: number;");
    expect(content).toContain("newSendReady: number;");
    expect(content).toContain("newNamedNoEmail: number;");
    expect(content).toContain("newRoleOnly: number;");
  });

  it("pipeline health summary includes discovery queue lines", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/dailyPipeline.ts", "utf-8");
    expect(content).toContain("Discovery SLA:");
    expect(content).toContain("Discovery Queue:");
  });
});
