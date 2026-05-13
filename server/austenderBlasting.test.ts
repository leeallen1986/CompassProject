/**
 * austenderBlasting.test.ts
 *
 * Verifies that the AusTender scraper correctly captures blasting/coatings/shutdown
 * contracts relevant to Daniel Zec's NSW/VIC/SA/TAS territory.
 *
 * Tests cover:
 * 1. RELEVANCE_KEYWORDS includes all blasting/coatings/shutdown phrases
 * 2. isRelevantContract fires for blasting/coatings/shutdown descriptions
 * 3. matchBusinessLinesFromContract assigns "air" lane for blasting contracts
 * 4. False positive guard: generic non-relevant contracts are rejected
 * 5. State-neutral coverage: NSW/VIC/SA/TAS contracts are not filtered out
 * 6. Value threshold: contracts below MIN_CONTRACT_VALUE are rejected
 */

import { describe, it, expect } from "vitest";
import { _testing } from "./austenderScraper";

const {
  matchBusinessLinesFromContract,
  isRelevantContract,
  RELEVANCE_KEYWORDS,
  MIN_CONTRACT_VALUE,
} = _testing;

// Helper: build a minimal OcdsRelease object for testing
function makeRelease(description: string, valueAmount: number, title = ""): any {
  return {
    contracts: [
      {
        description,
        title,
        value: { amount: String(valueAmount), currency: "AUD" },
        items: [],
      },
    ],
  };
}

// ── 1. Keyword library coverage ──────────────────────────────────────────────

describe("RELEVANCE_KEYWORDS — blasting/coatings/shutdown coverage", () => {
  const required = [
    "abrasive blasting",
    "grit blasting",
    "surface preparation",
    "blast and paint",
    "corrosion protection",
    "protective coating",
    "shutdown",
    "turnaround",
    "refinery shutdown",
    "maintenance shutdown",
    "facility shutdown",
  ];

  required.forEach((kw) => {
    it(`includes "${kw}"`, () => {
      expect(RELEVANCE_KEYWORDS).toContain(kw);
    });
  });
});

// ── 2. isRelevantContract fires for blasting/coatings/shutdown ───────────────

describe("isRelevantContract — east-coast blasting/coatings/shutdown contracts", () => {
  const cases: { label: string; description: string }[] = [
    {
      label: "Port Kembla berth abrasive blasting and painting",
      description:
        "Provision of abrasive blasting and painting services for Port Kembla berth structures including surface preparation, corrosion protection coatings, and blast and paint works.",
    },
    {
      label: "Viva Energy Geelong refinery shutdown maintenance",
      description:
        "Geelong refinery shutdown maintenance services including plant turnaround, mechanical maintenance, and facility shutdown support.",
    },
    {
      label: "Sydney Water pipeline grit blasting",
      description:
        "Grit blasting and surface preparation services for Sydney Water pipeline rehabilitation works in NSW.",
    },
    {
      label: "Port Adelaide wharf corrosion protection",
      description:
        "Corrosion protection and protective coating services for Port Adelaide wharf structures including abrasive blasting preparation.",
    },
    {
      label: "Melbourne Water treatment facility maintenance shutdown",
      description:
        "Planned maintenance shutdown and turnaround services for Melbourne Water treatment facility in VIC.",
    },
    {
      label: "SA Water pump station blast and paint",
      description:
        "Blast and paint services for SA Water pump station structures in South Australia.",
    },
  ];

  cases.forEach(({ label, description }) => {
    it(`matches: ${label}`, () => {
      const release = makeRelease(description, MIN_CONTRACT_VALUE + 1000);
      expect(isRelevantContract(release)).toBe(true);
    });
  });
});

// ── 3. matchBusinessLinesFromContract assigns "air" for blasting ─────────────

describe("matchBusinessLinesFromContract — blasting contracts get air lane", () => {
  const blastingDescriptions = [
    "Abrasive blasting and painting services for port infrastructure",
    "Grit blasting surface preparation and corrosion protection coatings",
    "Blast and paint services for industrial structures",
    "Refinery shutdown maintenance including abrasive blasting",
    "Surface preparation using abrasive blasting techniques for bridge maintenance",
  ];

  blastingDescriptions.forEach((desc) => {
    it(`assigns "air" lane: "${desc.slice(0, 60)}..."`, () => {
      const lines = matchBusinessLinesFromContract(desc, []);
      expect(lines).toContain("air");
    });
  });
});

// ── 4. False positive guard ──────────────────────────────────────────────────
// Note: RELEVANCE_KEYWORDS includes broad substrings like "wind" and "port" that
// intentionally match wide patterns (e.g. "wind farm", "port"). These tests use
// descriptions that are genuinely unrelated to Atlas Copco's business lines.

describe("isRelevantContract — false positive guard", () => {
  it("does not match generic human resources contract", () => {
    const release = makeRelease(
      "Provision of recruitment and human resources advisory services including talent acquisition and workforce planning.",
      MIN_CONTRACT_VALUE + 1000
    );
    expect(isRelevantContract(release)).toBe(false);
  });

  it("does not match legal services contract", () => {
    const release = makeRelease(
      "Legal advisory and conveyancing services for government property transactions including title searches and contract review.",
      MIN_CONTRACT_VALUE + 1000
    );
    expect(isRelevantContract(release)).toBe(false);
  });

  it("does not match catering services", () => {
    const release = makeRelease(
      "Catering and hospitality services for government events and conferences.",
      MIN_CONTRACT_VALUE + 1000
    );
    expect(isRelevantContract(release)).toBe(false);
  });
});

// ── 5. State-neutral coverage ────────────────────────────────────────────────

describe("isRelevantContract — state-neutral (no NSW/VIC/SA/TAS filter)", () => {
  const stateContracts: { state: string; description: string }[] = [
    {
      state: "NSW",
      description:
        "Abrasive blasting and protective coating services for Port Botany infrastructure in New South Wales.",
    },
    {
      state: "VIC",
      description:
        "Grit blasting and surface preparation for Port of Melbourne wharf structures in Victoria.",
    },
    {
      state: "SA",
      description:
        "Blast and paint services for SA Water pump stations in South Australia.",
    },
    {
      state: "TAS",
      description:
        "Corrosion protection and abrasive blasting for Hobart port infrastructure in Tasmania.",
    },
  ];

  stateContracts.forEach(({ state, description }) => {
    it(`captures ${state} blasting contract`, () => {
      const release = makeRelease(description, MIN_CONTRACT_VALUE + 1000);
      expect(isRelevantContract(release)).toBe(true);
      const lines = matchBusinessLinesFromContract(description, []);
      expect(lines).toContain("air");
    });
  });
});

// ── 6. Value threshold ───────────────────────────────────────────────────────

describe("isRelevantContract — value threshold", () => {
  const desc = "Abrasive blasting and painting services for port infrastructure";

  it("rejects contracts below minimum value", () => {
    const release = makeRelease(desc, MIN_CONTRACT_VALUE - 1);
    expect(isRelevantContract(release)).toBe(false);
  });

  it("accepts contracts at minimum value", () => {
    const release = makeRelease(desc, MIN_CONTRACT_VALUE);
    expect(isRelevantContract(release)).toBe(true);
  });

  it("accepts contracts above minimum value", () => {
    const release = makeRelease(desc, MIN_CONTRACT_VALUE * 10);
    expect(isRelevantContract(release)).toBe(true);
  });
});
