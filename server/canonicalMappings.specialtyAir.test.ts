import { describe, expect, it } from "vitest";
import {
  getPrimaryDimension,
  resolveBusinessLines,
  resolveUserProfile,
} from "./canonicalMappings";

describe("Specialty Air profile mapping", () => {
  it("maps Specialty Air to the existing Nitrogen and Booster scoring dimensions", () => {
    expect(resolveBusinessLines(["Specialty Air"])).toEqual(["Nitrogen", "Booster"]);
  });

  it("supports the profile label case-insensitively", () => {
    expect(resolveBusinessLines("specialty air")).toEqual(["Nitrogen", "Booster"]);
  });

  it("keeps Portable Air as the primary lane when Specialty Air is secondary", () => {
    const configured = ["Portable Air", "Specialty Air"];
    expect(resolveBusinessLines(configured)).toEqual(["Portable Air", "Nitrogen", "Booster"]);
    expect(getPrimaryDimension(configured)).toBe("Portable Air");
  });

  it("resolves Paul and Dan style profiles without adding Pump, PAL, BESS or Generators", () => {
    const resolved = resolveUserProfile({
      territories: ["QLD", "NSW"],
      assignedBusinessLines: ["Portable Air", "Specialty Air"],
    });

    expect(resolved.scoringDimensions).toEqual(["Portable Air", "Nitrogen", "Booster"]);
    expect(resolved.primaryDimension).toBe("Portable Air");
    expect(resolved.scoringDimensions).not.toContain("Pump/Dewatering");
    expect(resolved.scoringDimensions).not.toContain("PAL");
    expect(resolved.scoringDimensions).not.toContain("BESS");
    expect(resolved.scoringDimensions).not.toContain("Generators");
  });

  it("does not change the broad PT Capital Sales expansion", () => {
    expect(resolveBusinessLines(["Portable Air", "PT Capital Sales", "Specialty Air"]))
      .toEqual([
        "Portable Air",
        "PAL",
        "BESS",
        "Pump/Dewatering",
        "Generators",
        "Nitrogen",
        "Booster",
      ]);
  });
});
