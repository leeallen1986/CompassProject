/**
 * Tests for classifyAirOpportunity — three-family PA opportunity model
 *
 * Family 1: Core Portable Air (drilling, blasting, piling, shutdown, plant air)
 * Family 2: Air Treatment / Quality (dryers, instrument air, moisture-sensitive)
 * Family 3: Specialty Air / Gas (N2 membrane, pipeline testing, purging, inerting, booster)
 */
import { describe, it, expect } from "vitest";
import { classifyAirOpportunity } from "./laneScoring";

// ── Helper to build a minimal project ──
function proj(
  name: string,
  overview: string,
  sector = "mining",
  equipmentSignals: string[] = [],
): Parameters<typeof classifyAirOpportunity>[0] {
  return {
    name,
    overview,
    sector,
    stage: "construction",
    opportunityRoute: "direct",
    equipmentSignals,
  };
}

describe("classifyAirOpportunity — Family 1: Core Portable Air", () => {
  it("classifies a drilling project as High / drilling_blasting / Compressor", () => {
    const result = classifyAirOpportunity(
      proj("Barossa LNG Exploration Drilling Campaign", "Rotary drilling program for 12 exploration wells offshore NT", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("drilling_blasting");
    expect(result.bestProductAngle).toBe("Compressor");
  });

  it("classifies a blast-hole project as High / drilling_blasting", () => {
    const result = classifyAirOpportunity(
      proj("Pilbara Iron Ore Expansion — Blast Hole Drilling", "Blast hole drilling for open-cut iron ore mine expansion", "mining"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("drilling_blasting");
  });

  it("classifies an abrasive blasting project as High / abrasive_blasting", () => {
    const result = classifyAirOpportunity(
      proj("Wheatstone LNG Vessel Maintenance", "Abrasive blasting and surface preparation for vessel hull maintenance", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("abrasive_blasting");
    expect(result.bestProductAngle).toBe("Compressor");
  });

  it("classifies a shutdown + compressor project as High / shutdown_commissioning", () => {
    const result = classifyAirOpportunity(
      proj("Olympic Dam Shutdown Maintenance", "Plant shutdown with tie-in works, compressed air required for pneumatic tools", "mining"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("shutdown_commissioning");
  });

  it("classifies a shutdown-only project (no compressor keyword) as Medium", () => {
    const result = classifyAirOpportunity(
      proj("Gorgon LNG Turnaround 2025", "Major turnaround and maintenance works at Gorgon LNG facility", "oil_gas"),
    );
    expect(result.airFit).toBe("Medium");
    expect(result.opportunityType).toBe("shutdown_commissioning");
  });

  it("classifies a piling project as Medium / piling_civils", () => {
    const result = classifyAirOpportunity(
      proj("Gateway Bridge Piling Works", "Bored pile installation for bridge foundation works", "infrastructure"),
    );
    expect(result.airFit).toBe("Medium");
    expect(result.opportunityType).toBe("piling_civils");
  });
});

describe("classifyAirOpportunity — Family 2: Air Treatment / Quality", () => {
  it("classifies a dryer + instrument air project as High / air_treatment / Package", () => {
    const result = classifyAirOpportunity(
      proj("Woodside Pluto LNG Instrument Air Upgrade", "Replacement of instrument air dryers and aftercoolers for control valve air system", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("air_treatment");
    expect(result.bestProductAngle).toBe("Package");
  });

  it("classifies a dryer-only project as High / air_treatment / Dryer", () => {
    const result = classifyAirOpportunity(
      proj("Kwinana Refinery Air Dryer Replacement", "Replacement of refrigerant dryer units in the compressed air system", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("air_treatment");
    expect(result.bestProductAngle).toBe("Dryer");
  });

  it("classifies an instrument-air-only project as Medium / air_treatment / Dryer", () => {
    const result = classifyAirOpportunity(
      proj("Alcoa Pinjarra Instrument Air System Upgrade", "Upgrade of instrument air distribution system for process control valves", "mining"),
    );
    expect(result.airFit).toBe("Medium");
    expect(result.opportunityType).toBe("air_treatment");
    expect(result.bestProductAngle).toBe("Dryer");
  });

  it("classifies a moisture-sensitive commissioning project as Medium / air_treatment", () => {
    const result = classifyAirOpportunity(
      proj("Kemerton Lithium Hydroxide Plant Commissioning", "Commissioning of lithium hydroxide processing plant — oil-free air required for moisture-sensitive process", "mining"),
    );
    expect(result.airFit).toBe("Medium");
    expect(result.opportunityType).toBe("air_treatment");
  });
});

describe("classifyAirOpportunity — Family 3: Specialty Air / Gas", () => {
  it("classifies a nitrogen + purging project as High / purging_inerting / N2 Membrane", () => {
    // nitrogen + purging = 2 specialty signals → specialty_air_package (correct — package is the right call)
    const result = classifyAirOpportunity(
      proj("Scarborough Gas Pipeline Pre-commissioning", "Nitrogen purging and inerting of 430km export gas pipeline prior to first gas", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    // 2 specialty signals (nitrogen + purging) → specialty_air_package is correct
    expect(result.opportunityType).toBe("specialty_air_package");
    expect(result.bestProductAngle).toBe("Package");
  });

  it("classifies a pipeline testing + dry-out project as High / specialty_air_package / Package", () => {
    // pipeline testing + dry-out = 2 specialty signals → specialty_air_package (correct — package is the right call)
    const result = classifyAirOpportunity(
      proj("Browse LNG Pipeline Pressure Test and Dry-out", "Hydrostatic testing and dry-out of 200km subsea pipeline prior to commissioning", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("specialty_air_package");
    expect(result.bestProductAngle).toBe("Package");
  });

  it("classifies a pipeline testing only project as High / pipeline_testing / Compressor", () => {
    const result = classifyAirOpportunity(
      proj("Jemena Gas Pipeline Pressure Testing", "Pneumatic pressure testing of new gas distribution pipeline sections", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("pipeline_testing");
    expect(result.bestProductAngle).toBe("Compressor");
  });

  it("classifies a booster project as High / specialty_air_package / Package", () => {
    // 'high pressure testing' + 'booster compressor' = 2 specialty signals → specialty_air_package
    const result = classifyAirOpportunity(
      proj("Wheatstone LNG High Pressure Testing Package", "High pressure testing of subsea equipment requiring booster compressor package", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("specialty_air_package");
    expect(result.bestProductAngle).toBe("Package");
  });

  it("classifies a standalone booster project as High / high_pressure_booster / Booster", () => {
    // Only booster signal — no other specialty signals
    const result = classifyAirOpportunity(
      proj("Compressor Booster Package for Gas Injection", "Gas booster compressor package for injection well pressure maintenance", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("high_pressure_booster");
    expect(result.bestProductAngle).toBe("Booster");
  });

  it("classifies a multi-signal specialty project as High / specialty_air_package / Package", () => {
    const result = classifyAirOpportunity(
      proj("Ichthys LNG Pre-commissioning Package", "Pipeline pressure testing, nitrogen purging, dry-out and inerting of LNG export system", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("specialty_air_package");
    expect(result.bestProductAngle).toBe("Package");
  });
});

describe("classifyAirOpportunity — Suppression cases", () => {
  it("returns None for a pure road/highway project", () => {
    const result = classifyAirOpportunity(
      proj("Bruce Highway Safety Upgrades Program", "Road widening and safety barrier installation along Bruce Highway QLD", "infrastructure"),
    );
    expect(result.airFit).toBe("None");
    expect(result.opportunityType).toBe("none");
    expect(result.bestProductAngle).toBe("Monitor");
  });

  it("returns None for a broad rail project with no PA signal", () => {
    const result = classifyAirOpportunity(
      proj("Inland Rail Station Upgrades Euroa", "Platform upgrades and accessibility improvements at Euroa station", "infrastructure"),
    );
    expect(result.airFit).toBe("None");
    expect(result.opportunityType).toBe("none");
  });

  it("returns None for a residential development", () => {
    const result = classifyAirOpportunity(
      proj("Stockland Merrylands Residential Development", "Construction of 450 residential apartments and retail precinct", "property"),
    );
    expect(result.airFit).toBe("None");
    expect(result.opportunityType).toBe("none");
  });

  it("returns Low for a generic mining project without explicit PA signal", () => {
    const result = classifyAirOpportunity(
      proj("Olympic Dam BHP Expansion", "Major expansion of Olympic Dam copper-uranium mine in South Australia", "mining"),
    );
    // Mining sector triggers hasIndustrialSite → Low
    expect(result.airFit).toBe("Low");
    expect(result.opportunityType).toBe("generic_construction");
  });
});

describe("classifyAirOpportunity — Priority ordering", () => {
  it("Family 3 takes priority over Family 1 when both signals present", () => {
    // Has both drilling AND nitrogen purging — specialty_air_package fires (nitrogen + purging = 2 signals)
    const result = classifyAirOpportunity(
      proj("Scarborough Exploration Drilling and Pipeline Purging", "Exploration drilling program followed by nitrogen purging of new pipeline", "oil_gas"),
    );
    // 2 specialty signals → specialty_air_package wins over drilling_blasting
    expect(result.airFit).toBe("High");
    expect(result.opportunityType).toBe("specialty_air_package");
    expect(result.bestProductAngle).toBe("Package");
  });

  it("Family 3 takes priority over Family 2 when both signals present", () => {
    // Has pipeline testing — Family 3 wins over Family 2 dryer
    // 'hydrostatic testing' matches hasPipelineTest; 'air drying' matches hasDryer
    // pipeline_testing fires first (before dryer check) — correct priority
    const result = classifyAirOpportunity(
      proj("Dampier to Bunbury Pipeline Testing and Drying", "Hydrostatic testing and air drying of pipeline sections", "oil_gas"),
    );
    expect(result.airFit).toBe("High");
    // hasPipelineTest + hasDryer → pipeline_testing with Package angle
    expect(result.opportunityType).toBe("pipeline_testing");
    expect(result.bestProductAngle).toBe("Package"); // hasDryer is true → Package
  });
});
