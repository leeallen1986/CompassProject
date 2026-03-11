import { describe, expect, it } from "vitest";
import {
  ALL_SOURCES,
  getSourcesByRole,
  getSourceSummary,
  type SourceRole,
} from "./sourceConfig";

describe("sourceConfig", () => {
  it("defines at least 10 sources", () => {
    expect(ALL_SOURCES.length).toBeGreaterThanOrEqual(10);
  });

  it("every source has required fields", () => {
    for (const src of ALL_SOURCES) {
      expect(src.id).toBeTruthy();
      expect(src.name).toBeTruthy();
      expect(["primary_discovery", "secondary_confirmation", "enrichment"]).toContain(src.role);
      expect(typeof src.active).toBe("boolean");
      expect(src.frequency).toBeTruthy();
    }
  });

  it("has at least one source in each role", () => {
    const roles: SourceRole[] = ["primary_discovery", "secondary_confirmation", "enrichment"];
    for (const role of roles) {
      const sources = getSourcesByRole(role);
      expect(sources.length).toBeGreaterThan(0);
    }
  });

  it("getSourcesByRole filters correctly", () => {
    const primary = getSourcesByRole("primary_discovery");
    expect(primary.every(s => s.role === "primary_discovery")).toBe(true);

    const enrichment = getSourcesByRole("enrichment");
    expect(enrichment.every(s => s.role === "enrichment")).toBe(true);
  });

  it("getSourceSummary returns correct counts", () => {
    const summary = getSourceSummary();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.primaryDiscovery + summary.secondaryConfirmation + summary.enrichment).toBe(
      summary.total
    );
  });

  it("categorises RSS feeds as primary discovery", () => {
    const rss = ALL_SOURCES.find(s => s.id === "rss_feeds");
    expect(rss).toBeDefined();
    expect(rss!.role).toBe("primary_discovery");
  });

  it("categorises AusTender as primary discovery", () => {
    const at = ALL_SOURCES.find(s => s.id === "austender");
    expect(at).toBeDefined();
    expect(at!.role).toBe("primary_discovery");
  });

  it("categorises ASX monitoring as primary discovery", () => {
    const asx = ALL_SOURCES.find(s => s.id === "asx_monitoring");
    expect(asx).toBeDefined();
    expect(asx!.role).toBe("primary_discovery");
  });

  it("categorises Projectory as enrichment role", () => {
    const proj = ALL_SOURCES.find(s => s.id === "projectory");
    expect(proj).toBeDefined();
    expect(proj!.role).toBe("enrichment");
  });

  it("categorises ICN as secondary confirmation", () => {
    const icn = ALL_SOURCES.find(s => s.id === "icn_gateway");
    expect(icn).toBeDefined();
    expect(icn!.role).toBe("secondary_confirmation");
  });

  it("no duplicate source IDs", () => {
    const ids = ALL_SOURCES.map(s => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
