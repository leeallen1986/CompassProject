import { describe, it, expect } from "vitest";
import { _testing } from "./austenderScraper";

const {
  matchBusinessLinesFromContract,
  isRelevantContract,
  mapPriority,
  mapCapexGrade,
  mapSectorFromUnspsc,
  formatCurrency,
  RELEVANCE_KEYWORDS,
  RELEVANT_UNSPSC_PREFIXES,
  MIN_CONTRACT_VALUE,
} = _testing;

// ── Business Line Matching ──

describe("matchBusinessLinesFromContract", () => {
  it("matches Portable Air for construction descriptions", () => {
    const lines = matchBusinessLinesFromContract("Road construction and earthworks", []);
    expect(lines).toContain("air");
  });

  it("matches PAL for generator/power descriptions", () => {
    const lines = matchBusinessLinesFromContract("Temporary power supply and generator hire", []);
    expect(lines).toContain("pal");
  });

  it("matches BESS for battery/solar descriptions", () => {
    const lines = matchBusinessLinesFromContract("Battery energy storage system installation", []);
    expect(lines).toContain("bess");
  });

  it("matches Pump for water/dewatering descriptions", () => {
    const lines = matchBusinessLinesFromContract("Dewatering pump system for dam construction", []);
    expect(lines).toContain("pump");
  });

  it("matches multiple business lines for complex projects", () => {
    const lines = matchBusinessLinesFromContract(
      "Mining construction with dewatering and temporary power generation",
      []
    );
    expect(lines).toContain("air");
    expect(lines).toContain("pal");
    expect(lines).toContain("pump");
  });

  it("matches from UNSPSC codes when description is vague", () => {
    const lines = matchBusinessLinesFromContract("General services", ["72000000"]);
    expect(lines).toContain("air");
    expect(lines).toContain("pal");
  });

  it("matches mining from UNSPSC code 20", () => {
    const lines = matchBusinessLinesFromContract("Equipment supply", ["20150000"]);
    expect(lines).toContain("air");
  });

  it("matches power from UNSPSC code 26", () => {
    const lines = matchBusinessLinesFromContract("Equipment supply", ["26100000"]);
    expect(lines).toContain("pal");
    expect(lines).toContain("bess");
  });

  it("matches pump from UNSPSC code 40", () => {
    const lines = matchBusinessLinesFromContract("Equipment supply", ["40140000"]);
    expect(lines).toContain("pump");
  });

  it("matches defence from UNSPSC code 46", () => {
    const lines = matchBusinessLinesFromContract("Equipment supply", ["46000000"]);
    expect(lines).toContain("air");
    expect(lines).toContain("pal");
  });
});

// ── Relevance Filtering ──

describe("isRelevantContract", () => {
  it("rejects contracts below $1M", () => {
    const release = {
      ocid: "test-1",
      id: "test-1",
      date: "2026-01-01",
      parties: [],
      contracts: [{
        id: "c1",
        awardID: "a1",
        dateSigned: "2026-01-01",
        description: "Road construction",
        title: "Road construction",
        items: [{ id: "i1", classification: { scheme: "UNSPSC", id: "72000000" } }],
        value: { currency: "AUD", amount: "500000" },
        status: "active",
      }],
    };
    expect(isRelevantContract(release)).toBe(false);
  });

  it("accepts contracts over $1M with relevant UNSPSC", () => {
    const release = {
      ocid: "test-2",
      id: "test-2",
      date: "2026-01-01",
      parties: [],
      contracts: [{
        id: "c2",
        awardID: "a2",
        dateSigned: "2026-01-01",
        description: "Building construction services",
        title: "Building construction",
        items: [{ id: "i1", classification: { scheme: "UNSPSC", id: "72100000" } }],
        value: { currency: "AUD", amount: "5000000" },
        status: "active",
      }],
    };
    expect(isRelevantContract(release)).toBe(true);
  });

  it("accepts contracts with relevant keywords even without UNSPSC", () => {
    const release = {
      ocid: "test-3",
      id: "test-3",
      date: "2026-01-01",
      parties: [],
      contracts: [{
        id: "c3",
        awardID: "a3",
        dateSigned: "2026-01-01",
        description: "Mining equipment and compressor supply",
        title: "Mining equipment",
        items: [],
        value: { currency: "AUD", amount: "2000000" },
        status: "active",
      }],
    };
    expect(isRelevantContract(release)).toBe(true);
  });

  it("rejects contracts without relevant codes or keywords", () => {
    const release = {
      ocid: "test-4",
      id: "test-4",
      date: "2026-01-01",
      parties: [],
      contracts: [{
        id: "c4",
        awardID: "a4",
        dateSigned: "2026-01-01",
        description: "Office furniture supply",
        title: "Furniture",
        items: [{ id: "i1", classification: { scheme: "UNSPSC", id: "56000000" } }],
        value: { currency: "AUD", amount: "2000000" },
        status: "active",
      }],
    };
    expect(isRelevantContract(release)).toBe(false);
  });

  it("rejects releases without contracts", () => {
    const release = {
      ocid: "test-5",
      id: "test-5",
      date: "2026-01-01",
      parties: [],
    };
    expect(isRelevantContract(release)).toBe(false);
  });
});

// ── Priority Mapping ──

describe("mapPriority", () => {
  it("maps $50M+ to hot", () => {
    expect(mapPriority(50_000_000)).toBe("hot");
    expect(mapPriority(100_000_000)).toBe("hot");
  });

  it("maps $10M-$50M to warm", () => {
    expect(mapPriority(10_000_000)).toBe("warm");
    expect(mapPriority(25_000_000)).toBe("warm");
  });

  it("maps below $10M to cold", () => {
    expect(mapPriority(5_000_000)).toBe("cold");
    expect(mapPriority(1_000_000)).toBe("cold");
  });
});

// ── CAPEX Grade ──

describe("mapCapexGrade", () => {
  it("maps $100M+ to A", () => {
    expect(mapCapexGrade(100_000_000)).toBe("A");
    expect(mapCapexGrade(500_000_000)).toBe("A");
  });

  it("maps $10M-$100M to B", () => {
    expect(mapCapexGrade(10_000_000)).toBe("B");
    expect(mapCapexGrade(50_000_000)).toBe("B");
  });

  it("maps below $10M to Unknown", () => {
    expect(mapCapexGrade(5_000_000)).toBe("Unknown");
    expect(mapCapexGrade(1_000_000)).toBe("Unknown");
  });
});

// ── Sector Mapping ──

describe("mapSectorFromUnspsc", () => {
  it("maps defence keywords to defence", () => {
    expect(mapSectorFromUnspsc([], "Defence facility construction")).toBe("defence");
    expect(mapSectorFromUnspsc([], "Navy base upgrade")).toBe("defence");
  });

  it("maps mining keywords to mining", () => {
    expect(mapSectorFromUnspsc([], "Mining equipment supply")).toBe("mining");
  });

  it("maps oil/gas keywords to oil_gas", () => {
    expect(mapSectorFromUnspsc([], "LNG plant maintenance")).toBe("oil_gas");
    expect(mapSectorFromUnspsc([], "Petroleum refinery upgrade")).toBe("oil_gas");
  });

  it("maps energy keywords to energy", () => {
    expect(mapSectorFromUnspsc([], "Solar farm construction")).toBe("energy");
    expect(mapSectorFromUnspsc([], "Battery energy storage")).toBe("energy");
  });

  it("maps UNSPSC code 46 to defence", () => {
    expect(mapSectorFromUnspsc(["46000000"], "General services")).toBe("defence");
  });

  it("defaults to infrastructure", () => {
    expect(mapSectorFromUnspsc([], "General building services")).toBe("infrastructure");
  });
});

// ── Currency Formatting ──

describe("formatCurrency", () => {
  it("formats billions", () => {
    expect(formatCurrency(1_500_000_000)).toBe("$1.5B");
    expect(formatCurrency(10_000_000_000)).toBe("$10.0B");
  });

  it("formats millions", () => {
    expect(formatCurrency(25_000_000)).toBe("$25.0M");
    expect(formatCurrency(1_000_000)).toBe("$1.0M");
  });

  it("formats smaller amounts", () => {
    const result = formatCurrency(500_000);
    expect(result).toContain("500");
  });
});

// ── Configuration ──

describe("configuration", () => {
  it("has minimum contract value of $1M", () => {
    expect(MIN_CONTRACT_VALUE).toBe(1_000_000);
  });

  it("has relevant UNSPSC prefixes", () => {
    expect(RELEVANT_UNSPSC_PREFIXES).toContain("72"); // Construction
    expect(RELEVANT_UNSPSC_PREFIXES).toContain("20"); // Mining
    expect(RELEVANT_UNSPSC_PREFIXES).toContain("26"); // Power generation
    expect(RELEVANT_UNSPSC_PREFIXES).toContain("40"); // Distribution
    expect(RELEVANT_UNSPSC_PREFIXES).toContain("46"); // Defence
  });

  it("has comprehensive relevance keywords", () => {
    expect(RELEVANCE_KEYWORDS).toContain("compressor");
    expect(RELEVANCE_KEYWORDS).toContain("generator");
    expect(RELEVANCE_KEYWORDS).toContain("pump");
    expect(RELEVANCE_KEYWORDS).toContain("mining");
    expect(RELEVANCE_KEYWORDS).toContain("dewatering");
    expect(RELEVANCE_KEYWORDS).toContain("construction");
  });
});
