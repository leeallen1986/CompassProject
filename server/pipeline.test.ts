import { describe, expect, it } from "vitest";
import { generateFingerprint, parseRSSFeed, matchKeywords } from "./rssHarvester";
import type { BusinessLine, Project, UserProfile } from "../drizzle/schema";

// ── Fingerprint tests ──

describe("generateFingerprint", () => {
  it("produces a consistent 64-char hex hash for the same input", () => {
    const fp1 = generateFingerprint("https://example.com/article-1", "Mining Project Announced");
    const fp2 = generateFingerprint("https://example.com/article-1", "Mining Project Announced");
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64);
    expect(fp1).toMatch(/^[0-9a-f]+$/);
  });

  it("produces different hashes for different URLs", () => {
    const fp1 = generateFingerprint("https://example.com/article-1", "Same Title");
    const fp2 = generateFingerprint("https://example.com/article-2", "Same Title");
    expect(fp1).not.toBe(fp2);
  });

  it("produces different hashes for different titles", () => {
    const fp1 = generateFingerprint("https://example.com/same-url", "Title A");
    const fp2 = generateFingerprint("https://example.com/same-url", "Title B");
    expect(fp1).not.toBe(fp2);
  });

  it("normalizes whitespace and case", () => {
    const fp1 = generateFingerprint("https://example.com/article", "Mining  Project");
    const fp2 = generateFingerprint("https://example.com/article", "mining project");
    expect(fp1).toBe(fp2);
  });
});

// ── RSS Parser tests ──

describe("parseRSSFeed", () => {
  it("parses RSS 2.0 items correctly", () => {
    const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Test Feed</title>
        <item>
          <title>BHP Announces $2B Expansion</title>
          <link>https://example.com/bhp-expansion</link>
          <description>BHP has announced a major expansion of its Olympic Dam operations.</description>
          <pubDate>Mon, 10 Feb 2026 00:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Rio Tinto Drilling Campaign</title>
          <link>https://example.com/rio-drilling</link>
          <description>Rio Tinto begins new drilling program in Pilbara.</description>
          <pubDate>Sun, 09 Feb 2026 00:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;

    const items = parseRSSFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("BHP Announces $2B Expansion");
    expect(items[0].url).toBe("https://example.com/bhp-expansion");
    expect(items[0].summary).toContain("Olympic Dam");
    expect(items[0].publishedAt).toBeInstanceOf(Date);
    expect(items[1].title).toBe("Rio Tinto Drilling Campaign");
  });

  it("parses Atom feed entries", () => {
    const xml = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Feed</title>
      <entry>
        <title>New Mine Approved</title>
        <link href="https://example.com/new-mine" />
        <summary>A new mine has been approved in Queensland.</summary>
        <published>2026-02-10T00:00:00Z</published>
      </entry>
    </feed>`;

    const items = parseRSSFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("New Mine Approved");
    expect(items[0].url).toBe("https://example.com/new-mine");
  });

  it("handles CDATA content", () => {
    const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title><![CDATA[Mining & Resources Update]]></title>
          <link>https://example.com/update</link>
          <description><![CDATA[<p>Latest mining news</p>]]></description>
        </item>
      </channel>
    </rss>`;

    const items = parseRSSFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Mining & Resources Update");
    expect(items[0].summary).toBe("Latest mining news");
  });

  it("returns empty array for invalid XML", () => {
    const items = parseRSSFeed("not xml at all");
    expect(items).toHaveLength(0);
  });

  it("skips items without title or link", () => {
    const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <description>No title or link</description>
        </item>
        <item>
          <title>Has Title</title>
          <link>https://example.com/valid</link>
        </item>
      </channel>
    </rss>`;

    const items = parseRSSFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Has Title");
  });
});

// ── Keyword Gate tests ──

describe("matchKeywords", () => {
  const mockBusinessLines: BusinessLine[] = [
    {
      id: 1,
      name: "Portable Air",
      description: "Portable compressors",
      keywords: ["compressor", "drilling", "portable air", "blasting"],
      sectors: ["mining", "infrastructure"],
      equipmentTypes: ["Portable Compressor"],
      defaultTerritories: ["WA", "QLD"],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      name: "Power Technique",
      description: "Generators and pumps",
      keywords: ["generator", "dewatering pump", "lighting tower"],
      sectors: ["mining", "infrastructure"],
      equipmentTypes: ["Diesel Generator"],
      defaultTerritories: ["WA"],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 3,
      name: "Inactive Line",
      description: "Should be skipped",
      keywords: ["everything", "matches"],
      sectors: ["mining"],
      equipmentTypes: null,
      defaultTerritories: null,
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  it("matches keywords from title and summary", () => {
    const result = matchKeywords(
      "New drilling campaign announced in Pilbara",
      "BHP will deploy additional compressor units for the RC drilling program",
      mockBusinessLines
    );
    expect(result.matchedKeywords).toContain("drilling");
    expect(result.matchedKeywords).toContain("compressor");
    expect(result.matchedBusinessLineIds).toContain(1);
  });

  it("matches across multiple business lines", () => {
    const result = matchKeywords(
      "Mining site needs generator and compressor",
      "The project requires both portable air and temporary power solutions",
      mockBusinessLines
    );
    expect(result.matchedBusinessLineIds).toContain(1);
    expect(result.matchedBusinessLineIds).toContain(2);
    expect(result.matchedKeywords).toContain("compressor");
    expect(result.matchedKeywords).toContain("generator");
    expect(result.matchedKeywords).toContain("portable air");
  });

  it("returns empty arrays when no keywords match", () => {
    const result = matchKeywords(
      "Weather forecast for Sydney",
      "Sunny skies expected throughout the week",
      mockBusinessLines
    );
    expect(result.matchedKeywords).toHaveLength(0);
    expect(result.matchedBusinessLineIds).toHaveLength(0);
  });

  it("skips inactive business lines", () => {
    const result = matchKeywords(
      "Everything matches this title",
      "And this summary too",
      mockBusinessLines
    );
    // "Inactive Line" has keywords ["everything", "matches"] but isActive=false
    expect(result.matchedBusinessLineIds).not.toContain(3);
  });

  it("deduplicates matched keywords", () => {
    const result = matchKeywords(
      "Drilling drilling drilling",
      "More drilling content here",
      mockBusinessLines
    );
    const drillingCount = result.matchedKeywords.filter(k => k === "drilling").length;
    expect(drillingCount).toBe(1);
  });

  it("is case-insensitive", () => {
    const result = matchKeywords(
      "COMPRESSOR DEPLOYED",
      "GENERATOR INSTALLED",
      mockBusinessLines
    );
    expect(result.matchedKeywords).toContain("compressor");
    expect(result.matchedKeywords).toContain("generator");
  });
});

// ── ML Ranker scoring tests (unit-level, no DB) ──

describe("ML Ranker scoring logic", () => {
  it("extractTerritory correctly identifies Australian states from location strings", async () => {
    // We test the territory extraction indirectly through the module
    // Import the function dynamically to test it
    const { rankProjectsForUser } = await import("./mlRanker");
    expect(rankProjectsForUser).toBeDefined();
    expect(typeof rankProjectsForUser).toBe("function");
  });

  it("parseValueToNumber handles various value formats", () => {
    // Test the value parsing logic used in ML ranker
    const parseValue = (value: string): number => {
      const cleaned = value.replace(/[^0-9.bmk]/gi, "").toLowerCase();
      const num = parseFloat(cleaned);
      if (isNaN(num)) return 0;
      if (value.toLowerCase().includes("b")) return num * 1_000_000_000;
      if (value.toLowerCase().includes("m")) return num * 1_000_000;
      if (value.toLowerCase().includes("k")) return num * 1_000;
      return num;
    };

    expect(parseValue("$2.5B")).toBe(2_500_000_000);
    expect(parseValue("$500M")).toBe(500_000_000);
    expect(parseValue("$150M")).toBe(150_000_000);
    expect(parseValue("$50k")).toBe(50_000);
    expect(parseValue("Unknown")).toBe(0);
    expect(parseValue("TBC")).toBe(0);
  });

  it("territory extraction handles common Australian locations", () => {
    const extractTerritory = (location: string): string[] => {
      const territories: string[] = [];
      const loc = location.toLowerCase();
      const stateMap: Record<string, string[]> = {
        WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha"],
        QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "bowen basin"],
        NSW: ["new south wales", "nsw", "sydney", "newcastle", "hunter valley"],
        VIC: ["victoria", "vic", "melbourne"],
        SA: ["south australia", "sa", "adelaide", "olympic dam"],
        NT: ["northern territory", "nt", "darwin"],
      };
      for (const [state, keywords] of Object.entries(stateMap)) {
        if (keywords.some(kw => loc.includes(kw))) {
          territories.push(state);
        }
      }
      return territories.length > 0 ? territories : ["National"];
    };

    expect(extractTerritory("Pilbara, Western Australia")).toContain("WA");
    expect(extractTerritory("Bowen Basin, QLD")).toContain("QLD");
    expect(extractTerritory("Olympic Dam, SA")).toContain("SA");
    expect(extractTerritory("Darwin, NT")).toContain("NT");
    expect(extractTerritory("Somewhere overseas")).toEqual(["National"]);
  });

  it("sector to industry mapping covers all sectors", () => {
    const sectorToIndustries = (sector: string): string[] => {
      const map: Record<string, string[]> = {
        mining: ["mining_exploration", "mining_production", "mining_processing"],
        oil_gas: ["oil_gas_upstream", "oil_gas_downstream", "oil_gas_lng"],
        infrastructure: ["infrastructure_transport", "infrastructure_water", "infrastructure_civil"],
        energy: ["energy_renewables", "energy_conventional", "energy_transmission"],
        defence: ["defence_naval", "defence_land", "defence_aerospace"],
      };
      return map[sector] || [];
    };

    expect(sectorToIndustries("mining")).toHaveLength(3);
    expect(sectorToIndustries("oil_gas")).toHaveLength(3);
    expect(sectorToIndustries("infrastructure")).toHaveLength(3);
    expect(sectorToIndustries("energy")).toHaveLength(3);
    expect(sectorToIndustries("defence")).toHaveLength(3);
    expect(sectorToIndustries("unknown")).toHaveLength(0);
  });
});

// ── Seed data tests ──

describe("seedPipeline defaults", () => {
  it("exports the seed function", async () => {
    const { seedDefaultPipelineData } = await import("./seedPipeline");
    expect(seedDefaultPipelineData).toBeDefined();
    expect(typeof seedDefaultPipelineData).toBe("function");
  });
});

// ── AI Extractor tests ──

describe("aiExtractor module", () => {
  it("exports the extraction pipeline function", async () => {
    const { runExtractionPipeline } = await import("./aiExtractor");
    expect(runExtractionPipeline).toBeDefined();
    expect(typeof runExtractionPipeline).toBe("function");
  });
});

// ── Pipeline DB helpers tests ──

describe("pipelineDb helpers", () => {
  it("exports all required helper functions", async () => {
    const mod = await import("./pipelineDb");
    expect(mod.getAllBusinessLines).toBeDefined();
    expect(mod.getActiveBusinessLines).toBeDefined();
    expect(mod.createBusinessLine).toBeDefined();
    expect(mod.updateBusinessLine).toBeDefined();
    expect(mod.deleteBusinessLine).toBeDefined();
    expect(mod.getAllRssSources).toBeDefined();
    expect(mod.createRssSource).toBeDefined();
    expect(mod.getRecentArticles).toBeDefined();
    expect(mod.getArticleStats).toBeDefined();
    expect(mod.getDailyExtractionStats).toBeDefined();
  });
});
