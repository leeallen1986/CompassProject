import { describe, expect, it } from "vitest";
import { scoreAndRankProjects, type UserProfileData, type FeedbackData } from "./personalization";
import type { ProjectData } from "@/components/ProjectCard";

function makeProject(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    id: 1,
    reportId: 1,
    projectKey: "test-project",
    name: "Test Mining Project",
    location: "Pilbara, WA",
    value: "$500M",
    owner: "BHP",
    priority: "hot",
    capexGrade: "A",
    opportunityRoute: "Direct CAPEX",
    sector: "mining",
    isNew: false,
    stage: "Construction",
    overview: "Test overview",
    equipmentSignals: ["Compressors"],
    contractors: [{ name: "Contractor A", status: "confirmed" }],
    opportunityNote: "Direct sale",
    sources: [{ label: "ASX", url: "https://example.com" }],
    timeline: "24 months",
    completion: "2028",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("scoreAndRankProjects", () => {
  it("returns projects unchanged when no profile is provided", () => {
    const projects = [makeProject({ id: 1 }), makeProject({ id: 2 })];
    const result = scoreAndRankProjects(projects, null, []);
    expect(result).toHaveLength(2);
    expect(result[0].relevanceScore).toBeUndefined();
  });

  it("boosts score for territory match", () => {
    const projects = [
      makeProject({ id: 1, location: "Pilbara, WA" }),
      makeProject({ id: 2, location: "Hunter Valley, NSW" }),
    ];
    const profile: UserProfileData = { territories: ["WA"] };
    const result = scoreAndRankProjects(projects, profile, []);

    const waProject = result.find(p => p.id === 1)!;
    const nswProject = result.find(p => p.id === 2)!;
    expect(waProject.relevanceScore!).toBeGreaterThan(nswProject.relevanceScore!);
    expect(waProject.relevanceReasons).toContain("Territory match");
  });

  it("boosts score for industry match", () => {
    const projects = [
      makeProject({ id: 1, sector: "mining" }),
      makeProject({ id: 2, sector: "defence" }),
    ];
    const profile: UserProfileData = { industries: ["mining_exploration"] };
    const result = scoreAndRankProjects(projects, profile, []);

    const miningProject = result.find(p => p.id === 1)!;
    const defenceProject = result.find(p => p.id === 2)!;
    expect(miningProject.relevanceScore!).toBeGreaterThan(defenceProject.relevanceScore!);
    expect(miningProject.relevanceReasons).toContain("Industry match");
  });

  it("boosts score for offer category match", () => {
    const projects = [
      makeProject({ id: 1, opportunityRoute: "Direct CAPEX" }),
      makeProject({ id: 2, opportunityRoute: "OPEX/Monitor" }),
    ];
    const profile: UserProfileData = { offerCategories: ["equipment"] };
    const result = scoreAndRankProjects(projects, profile, []);

    const directProject = result.find(p => p.id === 1)!;
    const opexProject = result.find(p => p.id === 2)!;
    expect(directProject.relevanceScore!).toBeGreaterThan(opexProject.relevanceScore!);
    expect(directProject.relevanceReasons).toContain("Offer category match");
  });

  it("boosts score for key accounts", () => {
    const projects = [
      makeProject({ id: 1, owner: "BHP" }),
      makeProject({ id: 2, owner: "Unknown Corp" }),
    ];
    const profile: UserProfileData = { keyAccounts: ["BHP"] };
    const result = scoreAndRankProjects(projects, profile, []);

    const bhpProject = result.find(p => p.id === 1)!;
    const otherProject = result.find(p => p.id === 2)!;
    expect(bhpProject.relevanceScore!).toBeGreaterThan(otherProject.relevanceScore!);
    expect(bhpProject.relevanceReasons).toContain("Key account");
  });

  it("sets score to 0 for excluded accounts", () => {
    const projects = [
      makeProject({ id: 1, owner: "Competitor Corp" }),
      makeProject({ id: 2, owner: "BHP" }),
    ];
    const profile: UserProfileData = { excludeAccounts: ["Competitor Corp"] };
    const result = scoreAndRankProjects(projects, profile, []);

    const excludedProject = result.find(p => p.id === 1)!;
    expect(excludedProject.relevanceScore).toBe(0);
    expect(excludedProject.relevanceReasons).toContain("Excluded account");
  });

  it("applies feedback learning — thumbs up boosts score", () => {
    const projects = [
      makeProject({ id: 1 }),
      makeProject({ id: 2 }),
    ];
    const feedback: FeedbackData[] = [
      { projectId: 1, vote: "up", reason: "great_fit" },
    ];
    const profile: UserProfileData = {};
    const result = scoreAndRankProjects(projects, profile, feedback);

    const upvotedProject = result.find(p => p.id === 1)!;
    const neutralProject = result.find(p => p.id === 2)!;
    expect(upvotedProject.relevanceScore!).toBeGreaterThan(neutralProject.relevanceScore!);
    expect(upvotedProject.relevanceReasons).toContain("You liked this");
  });

  it("applies feedback learning — thumbs down reduces score", () => {
    const projects = [
      makeProject({ id: 1 }),
      makeProject({ id: 2 }),
    ];
    const feedback: FeedbackData[] = [
      { projectId: 1, vote: "down", reason: "wrong_region" },
    ];
    const profile: UserProfileData = {};
    const result = scoreAndRankProjects(projects, profile, feedback);

    const downvotedProject = result.find(p => p.id === 1)!;
    const neutralProject = result.find(p => p.id === 2)!;
    expect(downvotedProject.relevanceScore!).toBeLessThan(neutralProject.relevanceScore!);
    expect(downvotedProject.relevanceReasons).toContain("You dismissed this");
  });

  it("sorts projects by relevance score descending", () => {
    const projects = [
      makeProject({ id: 1, location: "Hunter Valley, NSW", sector: "defence" }),
      makeProject({ id: 2, location: "Pilbara, WA", sector: "mining" }),
      makeProject({ id: 3, location: "Darwin, NT", sector: "mining" }),
    ];
    const profile: UserProfileData = {
      territories: ["WA", "NT"],
      industries: ["mining_exploration"],
    };
    const result = scoreAndRankProjects(projects, profile, []);

    // WA mining and NT mining should rank above NSW defence
    expect(result[0].id).not.toBe(1);
    expect(result[result.length - 1].id).toBe(1);
  });

  it("combines multiple scoring dimensions", () => {
    const projects = [
      makeProject({
        id: 1,
        location: "Pilbara, WA",
        sector: "mining",
        opportunityRoute: "Direct CAPEX",
        owner: "BHP",
      }),
      makeProject({
        id: 2,
        location: "Sydney, NSW",
        sector: "defence",
        opportunityRoute: "OPEX/Monitor",
        owner: "Unknown",
      }),
    ];
    const profile: UserProfileData = {
      territories: ["WA"],
      industries: ["mining_exploration"],
      offerCategories: ["equipment"],
      keyAccounts: ["BHP"],
    };
    const result = scoreAndRankProjects(projects, profile, []);

    const bestMatch = result[0];
    expect(bestMatch.id).toBe(1);
    expect(bestMatch.relevanceScore!).toBeGreaterThanOrEqual(80);
    expect(bestMatch.relevanceReasons).toContain("Territory match");
    expect(bestMatch.relevanceReasons).toContain("Industry match");
    expect(bestMatch.relevanceReasons).toContain("Offer category match");
    expect(bestMatch.relevanceReasons).toContain("Key account");
  });

  it("clamps score between 0 and 100", () => {
    const projects = [
      makeProject({
        id: 1,
        location: "Pilbara, WA",
        sector: "mining",
        opportunityRoute: "Direct CAPEX",
        owner: "BHP",
        contractors: [{ name: "BHP", status: "confirmed" }],
      }),
    ];
    const profile: UserProfileData = {
      territories: ["WA"],
      industries: ["mining_exploration"],
      offerCategories: ["equipment"],
      customerTypes: ["principal_contractor"],
      keyAccounts: ["BHP"],
    };
    const feedback: FeedbackData[] = [
      { projectId: 1, vote: "up", reason: "great_fit" },
    ];
    const result = scoreAndRankProjects(projects, profile, feedback);
    expect(result[0].relevanceScore!).toBeLessThanOrEqual(100);
    expect(result[0].relevanceScore!).toBeGreaterThanOrEqual(0);
  });

  // ── Business Line scoring tests ──

  it("boosts score for business line match", () => {
    const blMap = { "Portable Air": 1, "Pump (Flow)": 2, "PAL": 3 };
    const projects = [
      makeProject({ id: 1, matchedBusinessLines: [1] }),     // Portable Air
      makeProject({ id: 2, matchedBusinessLines: [2] }),     // Pump
      makeProject({ id: 3, matchedBusinessLines: [3] }),     // PAL
    ];
    const profile: UserProfileData = {
      assignedBusinessLines: ["Pump (Flow)"],
    };
    const result = scoreAndRankProjects(projects, profile, [], blMap);

    const pumpProject = result.find(p => p.id === 2)!;
    const airProject = result.find(p => p.id === 1)!;
    expect(pumpProject.relevanceScore!).toBeGreaterThan(airProject.relevanceScore!);
    expect(pumpProject.relevanceReasons).toContain("Business line match");
  });

  it("differentiates Josh (Pump) vs Ryan (Portable Air)", () => {
    const blMap = { "Portable Air": 1, "Pump (Flow)": 2, "PAL": 3, "BESS": 4 };
    const projects = [
      makeProject({ id: 1, name: "Water Treatment Plant", matchedBusinessLines: [2] }),
      makeProject({ id: 2, name: "Mine Site Compressors", matchedBusinessLines: [1] }),
      makeProject({ id: 3, name: "Battery Storage", matchedBusinessLines: [4] }),
    ];

    const joshProfile: UserProfileData = { assignedBusinessLines: ["Pump (Flow)"] };
    const ryanProfile: UserProfileData = { assignedBusinessLines: ["Portable Air"] };

    const joshResult = scoreAndRankProjects(projects, joshProfile, [], blMap);
    const ryanResult = scoreAndRankProjects(projects, ryanProfile, [], blMap);

    // Josh should see Water Treatment (Pump) ranked higher
    expect(joshResult[0].id).toBe(1);
    // Ryan should see Mine Site Compressors (Portable Air) ranked higher
    expect(ryanResult[0].id).toBe(2);
  });

  it("gives extra boost for multiple BL matches", () => {
    const blMap = { "PAL": 1, "BESS": 2, "Pump (Flow)": 3 };
    const projects = [
      makeProject({ id: 1, matchedBusinessLines: [1, 2] }),  // PAL + BESS
      makeProject({ id: 2, matchedBusinessLines: [1] }),     // PAL only
    ];
    const profile: UserProfileData = {
      assignedBusinessLines: ["PAL", "BESS"],
    };
    const result = scoreAndRankProjects(projects, profile, [], blMap);

    const dualMatch = result.find(p => p.id === 1)!;
    const singleMatch = result.find(p => p.id === 2)!;
    expect(dualMatch.relevanceScore!).toBeGreaterThan(singleMatch.relevanceScore!);
  });

  it("applies slight penalty when project BLs don't match user BLs", () => {
    const blMap = { "Portable Air": 1, "Pump (Flow)": 2 };
    const projects = [
      makeProject({ id: 1, matchedBusinessLines: [1] }),     // Portable Air
      makeProject({ id: 2, matchedBusinessLines: null }),    // No BL data
    ];
    const profile: UserProfileData = {
      assignedBusinessLines: ["Pump (Flow)"],
    };
    const result = scoreAndRankProjects(projects, profile, [], blMap);

    const mismatchProject = result.find(p => p.id === 1)!;
    const unscoredProject = result.find(p => p.id === 2)!;
    // Mismatched project gets -5 penalty, unscored gets no penalty
    expect(mismatchProject.relevanceScore!).toBeLessThan(unscoredProject.relevanceScore!);
  });

  it("works without BL map (backward compatible)", () => {
    const projects = [makeProject({ id: 1, matchedBusinessLines: [1, 2] })];
    const profile: UserProfileData = {
      assignedBusinessLines: ["Pump (Flow)"],
    };
    // No blMap passed — should not crash, BL scoring just skipped
    const result = scoreAndRankProjects(projects, profile, []);
    expect(result).toHaveLength(1);
    expect(result[0].relevanceReasons).not.toContain("Business line match");
  });
});
