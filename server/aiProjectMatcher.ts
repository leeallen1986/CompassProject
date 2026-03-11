/**
 * AI Project Matcher — LLM-powered project search for sales teams.
 *
 * Takes a keyword, product, or solution description (e.g., "N2 solutions",
 * "portable compressors for blast hole drilling", "dewatering pumps") and
 * intelligently matches and ranks projects from the database.
 *
 * The LLM understands context — "N2" maps to nitrogen generation which maps
 * to mining, oil & gas, and food processing projects. "ZenergiZe" maps to
 * BESS/hybrid power projects.
 *
 * Two-stage approach for efficiency:
 * 1. Pre-filter: keyword-based scoring to narrow 500+ projects to top ~60
 * 2. LLM ranking: deep analysis of the shortlist with reasoning
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { projects, contacts, userProfiles, type Project, type Contact } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";

// ── Types ──

export interface MatchedProject {
  projectId: number;
  name: string;
  location: string;
  value: string;
  owner: string;
  priority: "hot" | "warm" | "cold";
  sector: string;
  stage: string;
  overview: string;
  relevanceScore: number;       // 0-100
  salesAngle: string;           // Why this project matters for the query
  suggestedApproach: string;    // How to approach the opportunity
  matchedProducts: string[];    // Which Atlas Copco products fit
  contactCount: number;
  topContact?: { name: string; title: string; company: string };
}

export interface MatchResult {
  query: string;
  totalProjectsSearched: number;
  preFilteredCount: number;
  matches: MatchedProject[];
  searchInsight: string;        // Overall market insight for this search
  suggestedKeywords: string[];  // Related searches the user might want to try
  personalised: boolean;        // Whether results were boosted by user preferences
}

// ── Atlas Copco PT Product Knowledge Base ──
// Used for pre-filtering and context

const PRODUCT_KNOWLEDGE: Record<string, string[]> = {
  // Portable Air
  "compressor": ["mining", "drilling", "blasting", "tunnelling", "construction", "quarry", "shotcrete", "pneumatic"],
  "portable air": ["mining", "drilling", "blasting", "tunnelling", "construction", "quarry"],
  "n2": ["nitrogen", "mining", "oil", "gas", "pipeline", "purging", "inerting", "food", "chemical"],
  "nitrogen": ["mining", "oil", "gas", "pipeline", "purging", "inerting", "food", "chemical", "n2"],
  "drilling": ["mining", "exploration", "rc", "diamond", "blast hole", "water bore", "geotechnical"],
  "blasting": ["mining", "quarry", "construction", "tunnelling", "explosive"],
  "shotcrete": ["tunnelling", "underground", "mining", "construction"],

  // PAL (Power & Light)
  "generator": ["power", "remote", "mining", "construction", "events", "emergency", "backup", "qas", "qes"],
  "lighting": ["construction", "mining", "events", "emergency", "hilight", "tower"],
  "pal": ["generator", "lighting", "power", "remote", "mining", "construction"],
  "qas": ["generator", "power", "diesel", "mobile"],
  "qes": ["generator", "power", "diesel", "mobile"],
  "hilight": ["lighting", "tower", "construction", "mining"],

  // Pump / Flow
  "pump": ["dewatering", "submersible", "wellpoint", "mining", "construction", "flood", "water"],
  "dewatering": ["pump", "mining", "construction", "flood", "groundwater", "excavation"],
  "submersible": ["pump", "water", "mining", "sewage", "flood"],
  "wellpoint": ["pump", "dewatering", "construction", "excavation", "groundwater"],
  "weda": ["pump", "submersible", "dewatering"],
  "pas": ["pump", "dewatering", "wellpoint"],
  "flood": ["pump", "dewatering", "emergency", "water", "recovery"],

  // BESS
  "bess": ["battery", "energy", "storage", "solar", "hybrid", "microgrid", "peak", "renewable"],
  "battery": ["energy", "storage", "bess", "lithium", "solar", "hybrid"],
  "energy storage": ["bess", "battery", "solar", "hybrid", "microgrid", "peak shaving"],
  "zenergize": ["bess", "battery", "hybrid", "solar", "energy storage", "microgrid"],
  "hybrid": ["bess", "solar", "generator", "battery", "remote", "mining"],
  "microgrid": ["bess", "solar", "battery", "remote", "mining", "hybrid"],
  "solar": ["bess", "hybrid", "renewable", "energy", "battery"],
};

// ── Pre-filter: keyword scoring ──

function preFilterProjects(query: string, allProjects: Project[]): { project: Project; score: number }[] {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);

  // Expand query with product knowledge
  const expandedTerms = new Set<string>(queryTerms);
  for (const term of queryTerms) {
    const related = PRODUCT_KNOWLEDGE[term];
    if (related) {
      for (const r of related) expandedTerms.add(r);
    }
    // Also check partial matches in product knowledge keys
    for (const [key, values] of Object.entries(PRODUCT_KNOWLEDGE)) {
      if (key.includes(term) || term.includes(key)) {
        for (const v of values) expandedTerms.add(v);
        expandedTerms.add(key);
      }
    }
  }

  const expandedArray = Array.from(expandedTerms);

  const scored = allProjects.map(p => {
    let score = 0;
    const searchableText = [
      p.name,
      p.location,
      p.owner,
      p.overview,
      p.stage,
      p.opportunityNote,
      p.sector,
      p.opportunityRoute,
      ...(Array.isArray(p.equipmentSignals) ? p.equipmentSignals as string[] : []),
      ...(Array.isArray(p.contractors) ? (p.contractors as { name: string }[]).map(c => c.name) : []),
    ].filter(Boolean).join(" ").toLowerCase();

    // Direct query term matches (highest weight)
    for (const term of queryTerms) {
      if (searchableText.includes(term)) score += 10;
    }

    // Expanded term matches (lower weight)
    for (const term of expandedArray) {
      if (!queryTerms.includes(term) && searchableText.includes(term)) score += 3;
    }

    // Only apply priority/capex boosts if there's at least one keyword match
    if (score > 0) {
      // Priority boost
      if (p.priority === "hot") score += 5;
      else if (p.priority === "warm") score += 2;

      // CAPEX grade boost
      if (p.capexGrade === "A") score += 3;
      else if (p.capexGrade === "B") score += 1;
    }

    return { project: p, score };
  });

  // Sort by score descending, take top 60
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);
}

// ── LLM ranking ──

async function llmRankProjects(
  query: string,
  candidates: { project: Project; score: number }[]
): Promise<{ matches: MatchedProject[]; searchInsight: string; suggestedKeywords: string[] }> {
  // Build a compact summary of each candidate for the LLM
  const projectSummaries = candidates.map((c, i) => {
    const p = c.project;
    const contractors = Array.isArray(p.contractors)
      ? (p.contractors as { name: string; status: string }[]).map(ct => `${ct.name} (${ct.status})`).join(", ")
      : "None listed";
    const equipment = Array.isArray(p.equipmentSignals)
      ? (p.equipmentSignals as string[]).join(", ")
      : "None";

    return `[${i}] ID:${p.id} | ${p.name} | ${p.location} | ${p.sector} | ${p.priority} | ${p.value} | Owner: ${p.owner} | Stage: ${p.stage} | Equipment: ${equipment} | Contractors: ${contractors} | ${p.overview?.slice(0, 200) || "No overview"}`;
  }).join("\n");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a sales intelligence assistant for Atlas Copco Power Technique (PT) division. PT sells:
- Portable Air: portable compressors (XAS, XATS, XAVS series) for mining, drilling, blasting, tunnelling, shotcrete, N2 generation
- PAL: power generators (QAS/QES), lighting towers (HiLight)
- Pump/Flow: dewatering pumps (PAS), submersible pumps (WEDA), wellpoint systems
- BESS: battery energy storage (ZenergiZe), hybrid power, solar hybrid, microgrids

Your job is to help sales reps find the best projects to pursue based on what they're selling or looking for.`,
      },
      {
        role: "user",
        content: `A sales rep is searching for: "${query}"

Here are ${candidates.length} candidate projects from our database. Rank the TOP 15 most relevant projects for this search query. For each, provide:
- relevanceScore (0-100): how well this project matches the search
- salesAngle: 1-2 sentences on WHY this project is relevant and what the opportunity is
- suggestedApproach: 1 sentence on HOW to approach (who to contact, what to pitch)
- matchedProducts: array of specific Atlas Copco products that fit (e.g., "XATS 900", "ZenergiZe 100", "PAS 100")

Also provide:
- searchInsight: 2-3 sentences of market insight related to this search (trends, opportunities, competitive landscape)
- suggestedKeywords: 3-5 related searches the rep might also want to try

Projects:
${projectSummaries}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "project_matching_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            rankedProjects: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", description: "Index from the project list [0-based]" },
                  relevanceScore: { type: "integer", description: "0-100 relevance score" },
                  salesAngle: { type: "string" },
                  suggestedApproach: { type: "string" },
                  matchedProducts: { type: "array", items: { type: "string" } },
                },
                required: ["index", "relevanceScore", "salesAngle", "suggestedApproach", "matchedProducts"],
                additionalProperties: false,
              },
            },
            searchInsight: { type: "string" },
            suggestedKeywords: { type: "array", items: { type: "string" } },
          },
          required: ["rankedProjects", "searchInsight", "suggestedKeywords"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Empty LLM response");
  }

  const parsed = JSON.parse(content) as {
    rankedProjects: Array<{
      index: number;
      relevanceScore: number;
      salesAngle: string;
      suggestedApproach: string;
      matchedProducts: string[];
    }>;
    searchInsight: string;
    suggestedKeywords: string[];
  };

  // Map LLM results back to project data
  const matches: MatchedProject[] = [];
  for (const ranked of parsed.rankedProjects) {
    if (ranked.index < 0 || ranked.index >= candidates.length) continue;
    const p = candidates[ranked.index].project;

    matches.push({
      projectId: p.id,
      name: p.name,
      location: p.location,
      value: p.value,
      owner: p.owner,
      priority: p.priority,
      sector: p.sector,
      stage: p.stage || "",
      overview: p.overview || "",
      relevanceScore: Math.min(100, Math.max(0, ranked.relevanceScore)),
      salesAngle: ranked.salesAngle,
      suggestedApproach: ranked.suggestedApproach,
      matchedProducts: ranked.matchedProducts,
      contactCount: 0,  // Will be filled in below
    });
  }

  return {
    matches: matches.sort((a, b) => b.relevanceScore - a.relevanceScore),
    searchInsight: parsed.searchInsight,
    suggestedKeywords: parsed.suggestedKeywords,
  };
}

// ── Main search function ──

/**
 * Search projects with optional user-preference boosting.
 * When userId is provided, results matching the user's territory and BL are boosted.
 * Users can still find projects outside their scope — they just rank lower by default.
 */
export async function searchProjects(query: string, userId?: number): Promise<MatchResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (!query || query.trim().length < 2) {
    throw new Error("Search query must be at least 2 characters");
  }

  // Load user preferences for boosting
  let userTerritories: string[] = [];
  let userBLs: string[] = [];
  let userSectorFocus: string[] = [];
  let personalised = false;
  if (userId) {
    try {
      const [profile] = await db.select().from(userProfiles)
        .where(eq(userProfiles.userId, userId)).limit(1);
      if (profile) {
        userTerritories = (profile.territories as string[]) || [];
        userBLs = (profile.assignedBusinessLines as string[]) || [];
        userSectorFocus = (profile.sectorFocus as string[]) || [];
        personalised = userTerritories.length > 0 || userBLs.length > 0;
      }
    } catch { /* continue without preferences */ }
  }

  // Step 1: Load all projects
  const allProjects = await db.select().from(projects).orderBy(desc(projects.id));

  // Step 2: Pre-filter with keyword scoring
  const preFiltered = preFilterProjects(query, allProjects);

  if (preFiltered.length === 0) {
    return {
      query,
      totalProjectsSearched: allProjects.length,
      preFilteredCount: 0,
      matches: [],
      searchInsight: "No projects matched your search terms. Try broader keywords or check the product knowledge base.",
      suggestedKeywords: ["compressor", "generator", "pump", "bess", "mining", "drilling"],
      personalised,
    };
  }

  // Step 3: LLM ranking
  const { matches, searchInsight, suggestedKeywords } = await llmRankProjects(query, preFiltered);

  // Step 4: Enrich with contact counts
  if (matches.length > 0) {
    const allContacts = await db.select()
      .from(contacts)
      .orderBy(desc(contacts.id));

    for (const match of matches) {
      const projectContacts = allContacts.filter(c => c.project === match.name);
      match.contactCount = projectContacts.length;
      if (projectContacts.length > 0) {
        const top = projectContacts[0];
        match.topContact = {
          name: top.name,
          title: top.title,
          company: top.company,
        };
      }
    }
  }

  // Step 5: Apply user-preference boosting to re-rank results
  if (personalised && matches.length > 1) {
    const STATE_KEYWORDS: Record<string, string[]> = {
      WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland"],
      QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone", "bowen basin"],
      NSW: ["new south wales", "nsw", "sydney", "newcastle", "wollongong", "hunter valley"],
      VIC: ["victoria", "vic", "melbourne"],
      SA: ["south australia", "sa", "adelaide", "olympic dam"],
      NT: ["northern territory", "nt", "darwin"],
      TAS: ["tasmania", "tas", "hobart"],
      ACT: ["act", "canberra"],
    };

    // BL keyword matching for product alignment
    const BL_KEYWORDS: Record<string, string[]> = {
      "Portable Air": ["compressor", "portable air", "air compressor", "cfm", "pneumatic"],
      "PAL": ["generator", "lighting", "power", "qas", "qes", "hilight", "pal"],
      "BESS": ["bess", "battery", "energy storage", "hybrid", "zenergize"],
      "Pump/Dewatering": ["pump", "dewatering", "submersible", "wellpoint", "weda", "flow"],
      "Generators": ["generator", "genset", "power", "diesel", "qas", "qes"],
      "Nitrogen": ["nitrogen", "n2", "purging", "inerting"],
      "Booster": ["booster", "high pressure", "hp"],
      "Service Potential": ["service", "maintenance", "aftermarket", "parts"],
      "Rental Influence": ["rental", "hire", "fleet"],
    };

    for (const match of matches) {
      let boost = 0;
      const loc = match.location.toLowerCase();

      // Territory boost: +15 if project is in user's territory
      if (userTerritories.length > 0) {
        const inTerritory = userTerritories.some(t => {
          const kws = STATE_KEYWORDS[t] || [t.toLowerCase()];
          return kws.some(kw => loc.includes(kw));
        });
        if (inTerritory) boost += 15;
      }

      // Sector boost: +8 if project sector matches user's sector focus
      if (userSectorFocus.length > 0 && userSectorFocus.includes(match.sector)) {
        boost += 8;
      }

      // BL boost: +12 if project mentions products matching user's BLs
      if (userBLs.length > 0) {
        const projText = `${match.name} ${match.overview} ${(match.matchedProducts || []).join(" ")}`.toLowerCase();
        const blMatch = userBLs.some(bl => {
          const kws = BL_KEYWORDS[bl] || [];
          return kws.some(kw => projText.includes(kw));
        });
        if (blMatch) boost += 12;
      }

      match.relevanceScore = Math.min(100, match.relevanceScore + boost);
    }

    // Re-sort by boosted relevance score
    matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  return {
    query,
    totalProjectsSearched: allProjects.length,
    preFilteredCount: preFiltered.length,
    matches,
    searchInsight,
    suggestedKeywords,
    personalised,
  };
}

// ── Export pre-filter for testing ──
export { preFilterProjects };
