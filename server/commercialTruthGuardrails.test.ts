import { describe, expect, it } from "vitest";
import {
  hasConfiguredTerritoryInput,
  projectMatchesResolvedTerritories,
  scopeProjectsToResolvedTerritories,
  territoryCodesFromValue,
} from "./commercialTruthGuardrails";
import { portableAirOpportunityGate } from "./laneScoring";

describe("commercial truth territory scope", () => {
  it("uses projectState as the authority instead of contradictory location text", () => {
    expect(projectMatchesResolvedTerritories({ projectState: "NSW", location: "Pilbara, WA" }, ["WA"]))
      .toBe(false);
    expect(projectMatchesResolvedTerritories({ projectState: "WA", location: "Sydney, NSW" }, ["WA"]))
      .toBe(true);
  });

  it("uses location only when projectState is missing or unparseable", () => {
    expect(projectMatchesResolvedTerritories({ projectState: null, location: "Karratha, Western Australia" }, ["WA"]))
      .toBe(true);
    expect(projectMatchesResolvedTerritories({ projectState: "unknown", location: "Newcastle, NSW" }, ["WA"]))
      .toBe(false);
  });

  it("recognises offshore scope without treating it as every Australian territory", () => {
    expect(territoryCodesFromValue("BW Opal FPSO, Offshore Australia")).toContain("OFFSHORE_AU");
    expect(projectMatchesResolvedTerritories({ projectState: "OFFSHORE_AU", location: "Offshore Australia" }, ["WA", "OFFSHORE_AU"]))
      .toBe(true);
    expect(projectMatchesResolvedTerritories({ projectState: "NSW", location: "Offshore support office, Sydney" }, ["WA", "OFFSHORE_AU"]))
      .toBe(false);
  });

  it("fails closed when the user profile scope is unresolved", () => {
    const projects = [
      { id: 1, projectState: "WA", location: "Pilbara, WA" },
      { id: 2, projectState: "NSW", location: "Sydney, NSW" },
    ];
    expect(scopeProjectsToResolvedTerritories(projects, ["WA"], false)).toEqual([]);
    expect(scopeProjectsToResolvedTerritories(projects, ["WA"], true).map(project => project.id)).toEqual([1]);
    expect(hasConfiguredTerritoryInput(null)).toBe(false);
    expect(hasConfiguredTerritoryInput("[]")).toBe(false);
    expect(hasConfiguredTerritoryInput('["WA"]')).toBe(true);
  });
});

describe("Portable Air accommodation guardrail", () => {
  const base = {
    sector: "infrastructure",
    stage: "construction",
    opportunityRoute: "Fleet CAPEX",
    owner: "Property Developer",
  };

  it("suppresses student accommodation despite generic AI equipment guesses", () => {
    const result = portableAirOpportunityGate({
      ...base,
      name: "Student Accommodation Development",
      overview: "New university student housing development.",
      equipmentSignals: ["portable air compressors", "construction equipment"],
    }, 90);

    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.suppressionLevel).toBe("suppress");
      expect(result.reason).toContain("accommodation");
    }
  });

  it("allows a separately evidenced compressed-air work package", () => {
    const result = portableAirOpportunityGate({
      ...base,
      name: "Student Accommodation Development — Compressed Air Package",
      overview: "Tender includes a specified 900 CFM portable compressor package for piling works.",
      equipmentSignals: [],
    }, 90);

    expect(result.pass).toBe(true);
  });
});
