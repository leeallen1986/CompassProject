/**
 * Tests for portable_air_blasting_signal
 *
 * Spec (Pasted_content_48.txt):
 * - Signal fires ONLY for Ryan Pemberton, Daniel Zec, Leo Williams
 * - Signal fires ONLY in the Portable Air lane
 * - Phrase library: ABRASIVE BLASTING / COATINGS (not drill-and-blast mining)
 *   Direct: abrasive blasting, sandblasting, grit blasting, blast and paint,
 *           blasting and painting, industrial blasting, surface preparation,
 *           protective coating removal, coating remediation, coating replacement,
 *           steel blasting, tank blasting, blast/coat package,
 *           abrasive blast and coat, industrial painting and blasting
 *   Related (need context): protective coatings, corrosion remediation,
 *           corrosion maintenance, asset integrity works, shutdown maintenance,
 *           turnaround maintenance, steelwork remediation, tank refurbishment,
 *           reservoir refurbishment, pipeline remediation, jetty remediation,
 *           berth remediation, structural steel remediation, paint removal,
 *           industrial coating works
 * - Context required: asset/site OR work-package OR portable-air likelihood bucket
 * - Boost: +10 pts (direct + context), +5 pts (related + context)
 * - Reason code: portable_air_blasting_signal_10 or portable_air_blasting_signal_5
 * - Non-blasting PA reps: NO boost
 * - Pump/Flow reps: NO boost even on blasting projects
 */

import { describe, it, expect } from "vitest";
import { computePerUserFinalScore } from "./laneScoring";

// ── Helpers ──

function makeBlastingProject(overrides: Partial<{
  name: string;
  overview: string;
  equipmentSignals: string[];
  sector: string;
  location: string;
}> = {}) {
  return {
    id: 99001,
    name: overrides.name ?? "Kwinana Refinery Shutdown — Abrasive Blasting and Painting",
    location: overrides.location ?? "WA",
    value: "$15M",
    owner: "Viva Energy",
    priority: "hot" as const,
    sector: overrides.sector ?? "oil_gas",
    opportunityRoute: "direct",
    isNew: false,
    stage: "construction",
    overview: overrides.overview ?? "Refinery shutdown maintenance package including abrasive blasting and painting of structural steel. Compressor fleet required for site air.",
    equipmentSignals: overrides.equipmentSignals ?? ["compressor"],
    contractors: null,
  };
}

function makePortableAirProfile(repName: string) {
  return {
    territories: ["WA"],
    assignedBusinessLines: ["Portable Air"],
    sectorFocus: ["oil_gas"],
    stageTiming: null,
    keyAccounts: null,
    buyerRoles: null,
    salesMotion: null as null,
    repName,
  };
}

function makePumpProfile(repName: string) {
  return {
    territories: ["WA"],
    assignedBusinessLines: ["Pump/Flow"],
    sectorFocus: ["oil_gas"],
    stageTiming: null,
    keyAccounts: null,
    buyerRoles: null,
    salesMotion: null as null,
    repName,
  };
}

const BLASTING_REPS = ["Ryan Pemberton", "Daniel Zec", "Leo Williams"];
const NON_BLASTING_PA_REPS = ["Brett Hansen", "Sarah Mitchell", "Tom Wilson"];

// ── Tests ──

describe("portable_air_blasting_signal", () => {
  describe("fires for authorised Portable Air reps on abrasive blasting projects", () => {
    for (const repName of BLASTING_REPS) {
      it(`fires for ${repName}`, () => {
        const project = makeBlastingProject();
        const profile = makePortableAirProfile(repName);
        const result = computePerUserFinalScore(project, profile, [], [], null);

        // Reason code should contain the blasting signal (either _10 or _5 variant)
        const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
        expect(hasBlastingCode).toBe(true);

        // Score should be higher than a non-blasting rep on the same project
        const baseResult = computePerUserFinalScore(project, makePortableAirProfile("Brett Hansen"), [], [], null);
        expect(result.finalScore).toBeGreaterThan(baseResult.finalScore);
      });
    }
  });

  describe("does NOT fire for non-blasting Portable Air reps", () => {
    for (const repName of NON_BLASTING_PA_REPS) {
      it(`does not fire for ${repName}`, () => {
        const project = makeBlastingProject();
        const profile = makePortableAirProfile(repName);
        const result = computePerUserFinalScore(project, profile, [], [], null);

        const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
        expect(hasBlastingCode).toBe(false);
      });
    }
  });

  describe("does NOT fire for Pump/Flow reps even on abrasive blasting projects", () => {
    for (const repName of BLASTING_REPS) {
      it(`does not fire for pump rep ${repName}`, () => {
        const project = makeBlastingProject();
        const profile = makePumpProfile(repName);
        const result = computePerUserFinalScore(project, profile, [], [], null);

        const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
        expect(hasBlastingCode).toBe(false);
      });
    }
  });

  describe("direct phrase library coverage (all require context)", () => {
    // All direct phrases paired with a context bucket word (refinery = context bucket A)
    const directPhrases = [
      "abrasive blasting",
      "sandblasting",
      "grit blasting",
      "blast and paint",
      "blasting and painting",
      "industrial blasting",
      "surface preparation",
      "protective coating removal",
      "coating remediation",
      "coating replacement",
      "steel blasting",
      "tank blasting",
      "blast/coat package",
      "abrasive blast and coat",
      "industrial painting and blasting",
    ];

    for (const phrase of directPhrases) {
      it(`detects direct phrase "${phrase}" with refinery context`, () => {
        const project = makeBlastingProject({
          name: "Refinery Maintenance Package",
          overview: `Refinery shutdown work involving ${phrase} on structural steel. Compressor fleet required.`,
          equipmentSignals: [],
        });
        const profile = makePortableAirProfile("Ryan Pemberton");
        const result = computePerUserFinalScore(project, profile, [], [], null);

        const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
        expect(hasBlastingCode).toBe(true);
      });
    }
  });

  describe("related phrase library coverage (require context bucket)", () => {
    // Related phrases paired with shutdown context (bucket B)
    const relatedPhrases = [
      "protective coatings",
      "corrosion remediation",
      "corrosion maintenance",
      "asset integrity works",
      "shutdown maintenance",
      "turnaround maintenance",
      "steelwork remediation",
      "tank refurbishment",
      "reservoir refurbishment",
      "pipeline remediation",
      "jetty remediation",
      "berth remediation",
      "structural steel remediation",
      "paint removal",
      "industrial coating works",
    ];

    for (const phrase of relatedPhrases) {
      it(`detects related phrase "${phrase}" with shutdown context`, () => {
        const project = makeBlastingProject({
          name: "Port Berth Maintenance",
          overview: `Shutdown maintenance package at the berth. Scope includes ${phrase}. Portable air and compressor fleet required.`,
          equipmentSignals: [],
        });
        const profile = makePortableAirProfile("Ryan Pemberton");
        const result = computePerUserFinalScore(project, profile, [], [], null);

        const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
        expect(hasBlastingCode).toBe(true);
      });
    }
  });

  describe("does NOT fire on generic painting/coatings without compressor context", () => {
    it("does not fire on office repainting project", () => {
      const project = {
        id: 99010,
        name: "Perth CBD Office Tower Repainting",
        location: "WA",
        value: "$500K",
        owner: "Brookfield",
        priority: "cold" as const,
        sector: "infrastructure",
        opportunityRoute: "direct",
        isNew: false,
        stage: "tender",
        overview: "Commercial office tower exterior repainting and protective coatings. Interior decorative coating works.",
        equipmentSignals: [],
        contractors: null,
      };
      const profile = makePortableAirProfile("Ryan Pemberton");
      const result = computePerUserFinalScore(project, profile, [], [], null);

      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(false);
    });

    it("does not fire on landscaping / decorative coating project", () => {
      const project = {
        id: 99011,
        name: "Riverside Park Landscaping and Decorative Coating",
        location: "WA",
        value: "$2M",
        owner: "City of Perth",
        priority: "cold" as const,
        sector: "infrastructure",
        opportunityRoute: "direct",
        isNew: false,
        stage: "tender",
        overview: "Public landscaping project with decorative coating works on park furniture and fencing. Paint removal of existing surfaces.",
        equipmentSignals: [],
        contractors: null,
      };
      const profile = makePortableAirProfile("Ryan Pemberton");
      const result = computePerUserFinalScore(project, profile, [], [], null);

      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(false);
    });

    it("does not fire on generic building painting tender without industrial context", () => {
      const project = {
        id: 99012,
        name: "Residential Apartment Complex Painting",
        location: "WA",
        value: "$800K",
        owner: "Mirvac",
        priority: "cold" as const,
        sector: "infrastructure",
        opportunityRoute: "direct",
        isNew: false,
        stage: "tender",
        overview: "Residential apartment complex exterior painting and coating replacement. Surface preparation of facade.",
        equipmentSignals: [],
        contractors: null,
      };
      const profile = makePortableAirProfile("Ryan Pemberton");
      const result = computePerUserFinalScore(project, profile, [], [], null);

      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(false);
    });
  });

  describe("example catch set — 3 projects that SHOULD be caught", () => {
    it("catches refinery shutdown blasting on structural steel", () => {
      const project = {
        id: 99020,
        name: "Kwinana Refinery Shutdown — Structural Steel Remediation",
        location: "WA",
        value: "$8M",
        owner: "Viva Energy",
        priority: "hot" as const,
        sector: "oil_gas",
        opportunityRoute: "direct",
        isNew: false,
        stage: "construction",
        overview: "Refinery shutdown maintenance package. Scope includes industrial blasting and painting of structural steel, tank blasting, and corrosion remediation. Compressor fleet and site air required.",
        equipmentSignals: ["compressor"],
        contractors: null,
      };
      const profile = makePortableAirProfile("Ryan Pemberton");
      const result = computePerUserFinalScore(project, profile, [], [], null);
      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(true);
    });

    it("catches tank remediation with blast-and-coat scope", () => {
      const project = {
        id: 99021,
        name: "Dampier LNG Tank Refurbishment",
        location: "WA",
        value: "$12M",
        owner: "Woodside",
        priority: "hot" as const,
        sector: "oil_gas",
        opportunityRoute: "direct",
        isNew: false,
        stage: "construction",
        overview: "LNG storage tank refurbishment. Scope includes abrasive blast and coat, tank blasting, and protective coating replacement. Portable air compressor fleet required.",
        equipmentSignals: ["compressor"],
        contractors: null,
      };
      const profile = makePortableAirProfile("Daniel Zec");
      const result = computePerUserFinalScore(project, profile, [], [], null);
      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(true);
    });

    it("catches port berth coating remediation package", () => {
      const project = {
        id: 99022,
        name: "Port Hedland Berth Coating Remediation",
        location: "WA",
        value: "$6M",
        owner: "Pilbara Ports Authority",
        priority: "warm" as const,
        sector: "infrastructure",
        opportunityRoute: "direct",
        isNew: false,
        stage: "construction",
        overview: "Marine infrastructure berth remediation package. Scope includes grit blasting, blasting and painting of marine steel, and corrosion maintenance. Shutdown contractor and compressor fleet required.",
        equipmentSignals: ["compressor"],
        contractors: null,
      };
      const profile = makePortableAirProfile("Leo Williams");
      const result = computePerUserFinalScore(project, profile, [], [], null);
      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(true);
    });
  });

  describe("case insensitivity", () => {
    it("fires for UPPERCASE blasting phrase", () => {
      const project = makeBlastingProject({
        name: "Refinery Maintenance",
        overview: "ABRASIVE BLASTING AND PAINTING of structural steel at the refinery. Compressor fleet required.",
        equipmentSignals: [],
      });
      const profile = makePortableAirProfile("Ryan Pemberton");
      const result = computePerUserFinalScore(project, profile, [], [], null);

      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(true);
    });

    it("fires for mixed-case rep name", () => {
      const project = makeBlastingProject();
      const profile = makePortableAirProfile("RYAN PEMBERTON");
      const result = computePerUserFinalScore(project, profile, [], [], null);

      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(true);
    });
  });

  describe("non-impact proof — unaffected reps and lanes", () => {
    it("Brett Hansen: no blasting signal even on abrasive blasting project", () => {
      const project = makeBlastingProject();
      const profile = makePortableAirProfile("Brett Hansen");
      const result = computePerUserFinalScore(project, profile, [], [], null);
      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(false);
    });

    it("Dan Day: no blasting signal even on abrasive blasting project", () => {
      const project = makeBlastingProject();
      const profile = { ...makePortableAirProfile("Dan Day"), territories: ["NSW"] };
      const result = computePerUserFinalScore(project, profile, [], [], null);
      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(false);
    });

    it("Amit: no blasting signal even on abrasive blasting project", () => {
      const project = makeBlastingProject();
      const profile = makePortableAirProfile("Amit");
      const result = computePerUserFinalScore(project, profile, [], [], null);
      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(false);
    });

    it("Pump lane: Ryan Pemberton gets no blasting signal when scored in Pump/Flow", () => {
      const project = makeBlastingProject();
      const profile = makePumpProfile("Ryan Pemberton");
      const result = computePerUserFinalScore(project, profile, [], [], null);
      const hasBlastingCode = result.reasonCodes.some(c => c.startsWith("portable_air_blasting_signal"));
      expect(hasBlastingCode).toBe(false);
    });
  });
});
