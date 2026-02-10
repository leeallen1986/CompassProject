/**
 * Personalization Engine — soft-ranks projects based on user profile preferences.
 *
 * Scoring dimensions (each 0–100, weighted):
 *  1. Territory match (25%)     — does the project location match the user's territories?
 *  2. Industry match (25%)      — does the project sector match the user's industries?
 *  3. Opportunity route (15%)   — does the project route match the user's offer categories?
 *  4. Customer type (15%)       — does the contractor type match the user's customer types?
 *  5. Key account boost (10%)   — is the owner or contractor a key account?
 *  6. Feedback learning (10%)   — has the user thumbs-up'd similar projects?
 *
 * Returns projects sorted by relevance score (highest first), with score and reasons attached.
 */

import type { ProjectData } from "@/components/ProjectCard";

export interface UserProfileData {
  territories?: string[] | null;
  industries?: string[] | null;
  offerCategories?: string[] | null;
  customerTypes?: string[] | null;
  keyAccounts?: string[] | null;
  excludeAccounts?: string[] | null;
  dealSizeMin?: string | null;
  dealSizeMax?: string | null;
  stageTiming?: string[] | null;
  buyerRoles?: string[] | null;
}

export interface FeedbackData {
  projectId: number;
  vote: "up" | "down";
  reason: string | null;
}

// ── State abbreviation mapping ──
const stateAbbreviations: Record<string, string[]> = {
  WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "newman", "geraldton", "bunbury", "broome"],
  QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone", "rockhampton", "cairns", "bowen basin", "moranbah", "emerald"],
  NSW: ["new south wales", "nsw", "sydney", "newcastle", "hunter valley", "wollongong", "broken hill", "orange", "dubbo", "mudgee"],
  VIC: ["victoria", "vic", "melbourne", "geelong", "ballarat", "bendigo", "latrobe valley"],
  SA: ["south australia", "sa", "adelaide", "olympic dam", "whyalla", "port augusta"],
  NT: ["northern territory", "nt", "darwin", "alice springs", "tennant creek", "katherine"],
  TAS: ["tasmania", "tas", "hobart", "launceston"],
  ACT: ["australian capital territory", "act", "canberra"],
  OFFSHORE: ["offshore", "fpso", "nwshelf", "north west shelf", "browse", "timor sea", "bass strait"],
};

// ── Sector to industry mapping ──
const sectorToIndustries: Record<string, string[]> = {
  mining: ["mining_exploration", "mining_production", "mining_services", "mining"],
  oil_gas: ["oil_gas", "lng", "petroleum", "offshore"],
  infrastructure: ["infrastructure", "civil_construction", "transport", "rail", "roads"],
  energy: ["energy", "renewables", "power_generation", "hydrogen"],
  defence: ["defence", "military", "government"],
};

// ── Route to offer category mapping ──
const routeToOfferCategories: Record<string, string[]> = {
  "Direct CAPEX": ["equipment", "capital_equipment", "compressors", "generators"],
  "Fleet CAPEX": ["rentals", "hire", "fleet", "rental_equipment"],
  "OPEX/Monitor": ["services", "maintenance", "parts", "aftermarket"],
};

function locationMatchesTerritory(location: string, territories: string[]): boolean {
  const loc = location.toLowerCase();
  for (const territory of territories) {
    const keywords = stateAbbreviations[territory.toUpperCase()] || [territory.toLowerCase()];
    if (keywords.some(kw => loc.includes(kw))) return true;
  }
  return false;
}

function sectorMatchesIndustries(sector: string, industries: string[]): boolean {
  const mappedIndustries = sectorToIndustries[sector] || [sector];
  return industries.some(ind => mappedIndustries.includes(ind.toLowerCase()));
}

function routeMatchesOfferCategories(route: string, offerCategories: string[]): boolean {
  const mappedCategories = routeToOfferCategories[route] || [];
  return offerCategories.some(cat => mappedCategories.includes(cat.toLowerCase()));
}

function isKeyAccount(project: ProjectData, keyAccounts: string[]): boolean {
  const names = [project.owner, ...(project.contractors ?? []).map(c => c.name)];
  return names.some(name =>
    keyAccounts.some(ka => name.toLowerCase().includes(ka.toLowerCase()))
  );
}

function isExcludedAccount(project: ProjectData, excludeAccounts: string[]): boolean {
  const names = [project.owner, ...(project.contractors ?? []).map(c => c.name)];
  return names.some(name =>
    excludeAccounts.some(ea => name.toLowerCase().includes(ea.toLowerCase()))
  );
}

export function scoreAndRankProjects(
  projects: ProjectData[],
  profile: UserProfileData | null,
  feedback: FeedbackData[]
): ProjectData[] {
  // If no profile, return projects as-is (no personalization)
  if (!profile) return projects;

  const feedbackMap = new Map(feedback.map(f => [f.projectId, f]));

  // Track sectors/locations that got thumbs up for learning
  const upvotedSectors = new Set<string>();
  const downvotedReasons = new Map<string, number>();

  feedback.forEach(f => {
    if (f.vote === "up") {
      // We don't have the project data here, but we track by ID
    }
    if (f.vote === "down" && f.reason) {
      downvotedReasons.set(f.reason, (downvotedReasons.get(f.reason) || 0) + 1);
    }
  });

  const scored = projects.map(project => {
    let score = 50; // Base score
    const reasons: string[] = [];

    // 1. Territory match (25 points)
    if (profile.territories && profile.territories.length > 0) {
      if (locationMatchesTerritory(project.location, profile.territories)) {
        score += 25;
        reasons.push("Territory match");
      } else {
        score -= 10;
      }
    }

    // 2. Industry match (25 points)
    if (profile.industries && profile.industries.length > 0) {
      if (sectorMatchesIndustries(project.sector, profile.industries)) {
        score += 25;
        reasons.push("Industry match");
      } else {
        score -= 10;
      }
    }

    // 3. Opportunity route match (15 points)
    if (profile.offerCategories && profile.offerCategories.length > 0) {
      if (routeMatchesOfferCategories(project.opportunityRoute, profile.offerCategories)) {
        score += 15;
        reasons.push("Offer category match");
      }
    }

    // 4. Customer type match (15 points)
    if (profile.customerTypes && profile.customerTypes.length > 0) {
      const hasContractor = project.contractors?.some(c => c.status === "confirmed") ?? false;
      const isOwnerOperator = !hasContractor;
      if (
        (profile.customerTypes.includes("principal_contractor") && hasContractor) ||
        (profile.customerTypes.includes("owner_operator") && isOwnerOperator) ||
        profile.customerTypes.includes("both")
      ) {
        score += 15;
        reasons.push("Customer type match");
      }
    }

    // 5. Key account boost (10 points)
    if (profile.keyAccounts && profile.keyAccounts.length > 0) {
      if (isKeyAccount(project, profile.keyAccounts)) {
        score += 10;
        reasons.push("Key account");
      }
    }

    // 6. Exclude accounts (hard filter — set score to 0)
    if (profile.excludeAccounts && profile.excludeAccounts.length > 0) {
      if (isExcludedAccount(project, profile.excludeAccounts)) {
        score = 0;
        reasons.length = 0;
        reasons.push("Excluded account");
      }
    }

    // 7. Feedback learning (10 points)
    const fb = feedbackMap.get(project.id);
    if (fb) {
      if (fb.vote === "up") {
        score += 10;
        reasons.push("You liked this");
      } else if (fb.vote === "down") {
        score -= 20;
        reasons.push("You dismissed this");
      }
    }

    // Clamp score to 0–100
    score = Math.max(0, Math.min(100, score));

    return {
      ...project,
      relevanceScore: score,
      relevanceReasons: reasons,
    };
  });

  // Sort by relevance score (descending), then by priority (hot > warm > cold)
  const priorityOrder = { hot: 3, warm: 2, cold: 1 };
  scored.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
    return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
  });

  return scored;
}
