/**
 * contactSelector.ts — SINGLE SOURCE OF TRUTH for rep-facing contact selection.
 *
 * Every view that shows a "primary contact" for a project MUST use this function:
 *   - Weekly top-3 action cards (thisWeekService)
 *   - Project detail page (ProjectCard via tRPC)
 *   - Email digest cards (emailDigest)
 *   - NBA cards (nextBestAction)
 *
 * Selection rules (in priority order):
 *   1. TRUST TIER: Only send_ready contacts can be primary. named_unverified shown as secondary.
 *      llm_inferred NEVER shown as primary.
 *   2. ROLE RELEVANCE: Prefer high > medium. Low relevance contacts are deprioritised.
 *   3. COMMERCIAL FIT: Prefer project-side / contractor-side / procurement / operations roles.
 *   4. TERRITORY FIT: Penalise contacts whose title/location suggests a different state.
 *   5. ROUTE-TO-BUY: Prefer contacts with direct commercial decision-making authority.
 *   6. EMAIL: Contacts with verified email rank higher than LinkedIn-only.
 *
 * Returns a structured result with:
 *   - selectedContact (or null)
 *   - trustTier
 *   - roleRelevance
 *   - routeToBuy (inferred)
 *   - whySelected (human-readable explanation)
 *   - salesReadiness: "send_ready" | "needs_verification" | "no_contact"
 *   - fallbackContacts: named_unverified contacts for the "validate before outreach" section
 */

// ── Types ──

export interface ContactInput {
  id: number;
  name: string;
  title: string;
  company: string;
  project: string;
  priority: "hot" | "warm" | "cold";
  roleBucket: string;
  email: string | null;
  linkedin?: string | null;
  linkedinProfileUrl?: string | null;
  roleRelevance?: "high" | "medium" | "low" | null;
  contactTrustTier?: "send_ready" | "named_unverified" | "llm_inferred" | null;
  verificationScore?: number | null;
  verificationStatus?: string | null;
  enrichmentSource?: string | null;
  linkedinHeadline?: string | null;
  linkedinLocation?: string | null;
  /** Set when contact has been quarantined — excluded from all selection paths */
  rejectionReason?: string | null;
}

export interface SelectedContact {
  id: number;
  name: string;
  title: string;
  company: string;
  email: string | null;
  linkedin: string | null;
  trustTier: "send_ready" | "named_unverified";
  roleRelevance: "high" | "medium" | "low";
  routeToBuy: string;
  whySelected: string;
  productAngle?: string;
  qualityScore: number;
}

export interface ContactSelectionResult {
  /** The primary selected contact, or null if none qualifies */
  selectedContact: SelectedContact | null;
  /** Overall sales readiness for this project's contact state */
  salesReadiness: "send_ready" | "needs_verification" | "no_contact";
  /** Named-unverified contacts shown as "validate before outreach" */
  fallbackContacts: Array<{
    id: number;
    name: string;
    title: string;
    company: string;
    trustTier: "named_unverified";
    roleRelevance: "high" | "medium" | "low";
  }>;
  /** Total contacts found for this project (all tiers) */
  totalContactsFound: number;
  /** Reason if no contact selected */
  noContactReason?: string;
}

// ── Configuration ──

const COMMERCIAL_TITLES = [
  "project manager", "project director", "procurement", "contracts manager",
  "operations manager", "maintenance manager", "plant manager",
  "general manager", "managing director", "ceo", "chief executive",
  "business development", "commercial manager", "asset manager",
  "construction manager", "site manager", "engineering manager",
  "superintendent", "mine manager", "drilling manager", "production manager",
  "supply chain", "purchasing", "buyer",
];

const NON_COMMERCIAL_TITLES = [
  "hr ", "human resources", "finance director", "cfo", "accountant",
  "marketing manager", "communications", "media", "receptionist",
  "admin", "secretary", "legal counsel", "compliance",
];

const AU_STATES = ["WA", "QLD", "NSW", "VIC", "SA", "NT", "TAS", "ACT"];

const STATE_MISMATCH_PHRASES: Record<string, string[]> = {
  WA: ["eastern states", "east coast", "nsw", "victoria", "queensland", "south australia", "sydney", "melbourne", "brisbane", "adelaide"],
  QLD: ["wa", "western australia", "victoria", "nsw", "south australia", "perth", "melbourne", "sydney", "adelaide"],
  NSW: ["wa", "western australia", "victoria", "queensland", "south australia", "perth", "melbourne", "brisbane", "adelaide"],
  VIC: ["wa", "western australia", "nsw", "queensland", "south australia", "perth", "sydney", "brisbane", "adelaide"],
  SA: ["wa", "western australia", "nsw", "victoria", "queensland", "perth", "sydney", "melbourne", "brisbane"],
};

// ── Core Selection Function ──

export function selectProjectContact(
  contacts: ContactInput[],
  options: {
    projectName: string;
    projectOwner?: string;
    projectState?: string | null;
    buyerRoles?: string[];
    /** When true, uses pump-specific role ranking (site ops, maintenance, dewatering, package engineer) */
    isPumpLane?: boolean;
  }
): ContactSelectionResult {
  const { projectName, projectOwner, projectState, buyerRoles } = options;

  if (!contacts || contacts.length === 0) {
    return {
      selectedContact: null,
      salesReadiness: "no_contact",
      fallbackContacts: [],
      totalContactsFound: 0,
      noContactReason: "No contacts found for this project",
    };
  }

  // Pre-filter: remove quarantined contacts (rejectionReason set) before any selection logic
  const activeContacts = contacts.filter(c => !c.rejectionReason);

  // Step 1: Match contacts to this project (fuzzy name/company match)
  const projectContacts = matchContactsToProject(activeContacts, projectName, projectOwner ?? "");

  if (projectContacts.length === 0) {
    return {
      selectedContact: null,
      salesReadiness: "no_contact",
      fallbackContacts: [],
      totalContactsFound: contacts.length,
      noContactReason: "Contacts exist but none match this project",
    };
  }

  // Step 2: Segment by trust tier
  const sendReady = projectContacts.filter(c => c.contactTrustTier === "send_ready");
  const namedUnverified = projectContacts.filter(c => c.contactTrustTier === "named_unverified");
  // llm_inferred contacts are NEVER shown as primary

  // Step 3: Score send_ready contacts (pump-lane uses different scoring)
  const isPump = options.isPumpLane ?? false;
  const scoredSendReady = sendReady.map(c =>
    isPump ? scorePumpContact(c, { projectState, buyerRoles }) : scoreContact(c, { projectState, buyerRoles })
  );
  scoredSendReady.sort((a, b) => b.score - a.score);

  // Step 4: Build fallback list from named_unverified
  const scoredFallback = namedUnverified
    .map(c => isPump ? scorePumpContact(c, { projectState, buyerRoles }) : scoreContact(c, { projectState, buyerRoles }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // Step 5: Select primary contact
  if (scoredSendReady.length > 0) {
    const best = scoredSendReady[0];
    return {
      selectedContact: buildSelectedContact(best, "send_ready"),
      salesReadiness: "send_ready",
      fallbackContacts: scoredFallback.map(f => ({
        id: f.contact.id,
        name: f.contact.name,
        title: f.contact.title,
        company: f.contact.company,
        trustTier: "named_unverified" as const,
        roleRelevance: (f.contact.roleRelevance ?? "low") as "high" | "medium" | "low",
      })),
      totalContactsFound: projectContacts.length,
    };
  }

  // No send_ready contacts — check named_unverified
  if (scoredFallback.length > 0) {
    const best = scoredFallback[0];
    return {
      selectedContact: buildSelectedContact(best, "named_unverified"),
      salesReadiness: "needs_verification",
      fallbackContacts: scoredFallback.slice(1).map(f => ({
        id: f.contact.id,
        name: f.contact.name,
        title: f.contact.title,
        company: f.contact.company,
        trustTier: "named_unverified" as const,
        roleRelevance: (f.contact.roleRelevance ?? "low") as "high" | "medium" | "low",
      })),
      totalContactsFound: projectContacts.length,
      noContactReason: "No send-ready contacts — best available is named_unverified",
    };
  }

  // Only llm_inferred contacts exist
  return {
    selectedContact: null,
    salesReadiness: "no_contact",
    fallbackContacts: [],
    totalContactsFound: projectContacts.length,
    noContactReason: "Only LLM-inferred contacts found — not credible for outreach",
  };
}

// ── Contact Scoring ──

interface ScoredContact {
  contact: ContactInput;
  score: number;
  whySelected: string;
  routeToBuy: string;
}

function scoreContact(
  contact: ContactInput,
  options: { projectState?: string | null; buyerRoles?: string[] }
): ScoredContact {
  const { projectState, buyerRoles } = options;
  let score = 0;
  const reasons: string[] = [];

  // Role relevance (0-20)
  const relOrder: Record<string, number> = { high: 20, medium: 10, low: 0 };
  const relScore = relOrder[contact.roleRelevance ?? "low"] ?? 0;
  score += relScore;
  if (contact.roleRelevance === "high") reasons.push("High role relevance");
  else if (contact.roleRelevance === "medium") reasons.push("Medium role relevance");

  // Commercial title match (0-15)
  const titleLower = (contact.title ?? "").toLowerCase();
  if (COMMERCIAL_TITLES.some(t => titleLower.includes(t))) {
    score += 15;
    reasons.push("Commercial/project role");
  }
  if (NON_COMMERCIAL_TITLES.some(t => titleLower.includes(t))) {
    score -= 20;
  }

  // Buyer role match (0-12)
  if (buyerRoles && buyerRoles.length > 0) {
    const roleLower = contact.roleBucket.toLowerCase();
    if (buyerRoles.some(r => roleLower.includes(r.toLowerCase()))) {
      score += 12;
      reasons.push("Matches target buyer role");
    }
  }

  // Email availability (0-8)
  if (contact.email) {
    score += 8;
    reasons.push("Has verified email");
  } else if (contact.linkedinProfileUrl || contact.linkedin) {
    score += 3;
    reasons.push("LinkedIn available");
  }

  // Verification score bonus (0-5)
  if (contact.verificationScore && contact.verificationScore > 80) {
    score += 5;
  }

  // Territory fit penalty (-25 to 0)
  const projectStateUpper = (projectState ?? "").toUpperCase();
  if (projectStateUpper && AU_STATES.includes(projectStateUpper)) {
    const mismatchPhrases = STATE_MISMATCH_PHRASES[projectStateUpper] ?? [];
    const companyLower = (contact.company ?? "").toLowerCase();
    if (mismatchPhrases.some(m => titleLower.includes(m) || companyLower.includes(m))) {
      score -= 25;
      reasons.push("Territory mismatch (penalised)");
    } else {
      reasons.push("Territory aligned");
    }
  }

  // Route-to-buy inference
  let routeToBuy = "Unknown";
  if (titleLower.includes("procurement") || titleLower.includes("purchasing") || titleLower.includes("buyer") || titleLower.includes("supply chain")) {
    routeToBuy = "Direct procurement authority";
  } else if (titleLower.includes("project manager") || titleLower.includes("project director") || titleLower.includes("construction manager")) {
    routeToBuy = "Project-level equipment decision maker";
  } else if (titleLower.includes("operations") || titleLower.includes("maintenance") || titleLower.includes("plant manager")) {
    routeToBuy = "Operations/maintenance influencer";
  } else if (titleLower.includes("general manager") || titleLower.includes("managing director") || titleLower.includes("ceo")) {
    routeToBuy = "Executive sponsor / budget holder";
  } else if (titleLower.includes("business development") || titleLower.includes("commercial")) {
    routeToBuy = "Commercial relationship path";
  } else {
    routeToBuy = "Technical/specialist influencer";
  }

  return {
    contact,
    score,
    whySelected: reasons.length > 0 ? reasons.join("; ") : "Default selection",
    routeToBuy,
  };
}

// ── Build Selected Contact Output ──

function buildSelectedContact(scored: ScoredContact, trustTier: "send_ready" | "named_unverified"): SelectedContact {
  return {
    id: scored.contact.id,
    name: scored.contact.name,
    title: scored.contact.title,
    company: scored.contact.company,
    email: scored.contact.email,
    linkedin: scored.contact.linkedinProfileUrl ?? scored.contact.linkedin ?? null,
    trustTier,
    roleRelevance: (scored.contact.roleRelevance ?? "low") as "high" | "medium" | "low",
    routeToBuy: scored.routeToBuy,
    whySelected: scored.whySelected,
    qualityScore: scored.score,
  };
}

// ── Project-Contact Matching ──

const STOP_WORDS = new Set(["the", "a", "an", "of", "in", "for", "and", "or", "to", "at", "by", "on", "is", "—", "-", "/"]);

/** Generic words that should not count as meaningful keyword overlap */
const GENERIC_PROJECT_WORDS = new Set([
  "project", "projects", "program", "programme", "works", "construction",
  "development", "upgrade", "expansion", "stage", "phase", "new", "major",
  "facility", "operations", "services", "management", "australia", "australian",
]);

function extractKeywords(text: string): string[] {
  return text.toLowerCase().split(/[\s/—\-–,()]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function hasKeywordOverlap(a: string, b: string): boolean {
  const kwA = Array.from(new Set(extractKeywords(a))); // deduplicate
  const kwB = Array.from(new Set(extractKeywords(b))); // deduplicate
  if (kwA.length === 0 || kwB.length === 0) return false;
  // Find shared keywords, excluding generic project words
  const shared = kwA.filter(w => {
    if (GENERIC_PROJECT_WORDS.has(w)) return false;
    return kwB.some(bw => {
      if (GENERIC_PROJECT_WORDS.has(bw)) return false;
      return bw.includes(w) || w.includes(bw);
    });
  });
  return shared.length >= 2 || (shared.length >= 1 && kwA.length <= 2);
}

function matchContactsToProject(contacts: ContactInput[], projectName: string, projectOwner: string): ContactInput[] {
  const projectNameLower = projectName.toLowerCase();
  const ownerLower = projectOwner.toLowerCase();
  const ownerParts = ownerLower.split(/[/&,]+/).map(s => s.trim()).filter(Boolean);

  return contacts.filter(c => {
    const cProject = (c.project || '').toLowerCase();
    const cCompany = (c.company || '').toLowerCase();
    // Direct project name match
    if (cProject.includes(projectNameLower) || projectNameLower.includes(cProject)) return true;
    // Keyword overlap
    if (hasKeywordOverlap(cProject, projectNameLower)) return true;
    // Owner/company match
    if (ownerParts.some(op => cCompany.includes(op) || op.includes(cCompany))) return true;
    if (projectNameLower.includes(cCompany) && cCompany.length > 3) return true;
    return false;
  });
}

// ── Pump/Flow Lane: Contact Role Ranking ──
// For Pump/Flow, prefer site operations, maintenance, dewatering/pump supervisors,
// package engineers, contractor PMs, and service/branch managers over generic procurement.

const PUMP_PREFERRED_TITLES = [
  // Tier 1 — highest value for pump (site ops, dewatering, pump-specific)
  "dewatering", "pump supervisor", "pump manager", "water manager",
  "dewatering supervisor", "dewatering manager", "site operations",
  "operations superintendent", "mine operations", "maintenance superintendent",
  "maintenance manager", "plant maintenance", "fixed plant",
  "package engineer", "mechanical engineer", "site engineer",
  // Tier 2 — project delivery / contractor PM
  "project manager", "project director", "construction manager",
  "site manager", "works manager", "contracts manager",
  "superintendent", "mine manager", "production manager",
  // Tier 3 — service / branch (at supplier or contractor)
  "service manager", "branch manager", "fleet manager",
  "asset manager", "workshop manager", "hire manager",
  "rental manager", "equipment manager",
];

const PUMP_TIER1_TITLES = [
  "dewatering", "pump", "water manager", "site operations",
  "operations superintendent", "mine operations",
  "maintenance superintendent", "maintenance manager",
  "plant maintenance", "fixed plant", "package engineer",
  "mechanical engineer", "site engineer",
];

const PUMP_TIER2_TITLES = [
  "project manager", "project director", "construction manager",
  "site manager", "works manager", "contracts manager",
  "superintendent", "mine manager", "production manager",
];

const PUMP_TIER3_TITLES = [
  "service manager", "branch manager", "fleet manager",
  "asset manager", "workshop manager", "hire manager",
  "rental manager", "equipment manager",
];

/**
 * Pump-specific contact scoring function.
 * Replaces the generic scoreContact for pump-lane projects.
 * Prioritises site operations, maintenance, and dewatering roles
 * over generic procurement unless justified.
 */
function scorePumpContact(
  contact: ContactInput,
  options: { projectState?: string | null; buyerRoles?: string[] }
): ScoredContact {
  const { projectState, buyerRoles } = options;
  let score = 0;
  const reasons: string[] = [];

  // Role relevance (0-20)
  const relOrder: Record<string, number> = { high: 20, medium: 10, low: 0 };
  const relScore = relOrder[contact.roleRelevance ?? "low"] ?? 0;
  score += relScore;
  if (contact.roleRelevance === "high") reasons.push("High role relevance");
  else if (contact.roleRelevance === "medium") reasons.push("Medium role relevance");

  // Pump-specific title match (0-25) — higher weight than generic commercial
  const titleLower = (contact.title ?? "").toLowerCase();
  if (PUMP_TIER1_TITLES.some(t => titleLower.includes(t))) {
    score += 25;
    reasons.push("Pump-priority role (site ops/maintenance/dewatering)");
  } else if (PUMP_TIER2_TITLES.some(t => titleLower.includes(t))) {
    score += 18;
    reasons.push("Project delivery/contractor PM role");
  } else if (PUMP_TIER3_TITLES.some(t => titleLower.includes(t))) {
    score += 14;
    reasons.push("Service/branch/fleet manager role");
  } else if (COMMERCIAL_TITLES.some(t => titleLower.includes(t))) {
    // Generic procurement — lower priority for pump lane
    score += 8;
    reasons.push("Generic commercial role (lower priority for pump)");
  }

  // Non-commercial penalty (same as generic)
  if (NON_COMMERCIAL_TITLES.some(t => titleLower.includes(t))) {
    score -= 20;
  }

  // Buyer role match (0-12)
  if (buyerRoles && buyerRoles.length > 0) {
    const roleLower = contact.roleBucket.toLowerCase();
    if (buyerRoles.some(r => roleLower.includes(r.toLowerCase()))) {
      score += 12;
      reasons.push("Matches target buyer role");
    }
  }

  // Email availability (0-8)
  if (contact.email) {
    score += 8;
    reasons.push("Has verified email");
  } else if (contact.linkedinProfileUrl || contact.linkedin) {
    score += 3;
    reasons.push("LinkedIn available");
  }

  // Verification score bonus (0-5)
  if (contact.verificationScore && contact.verificationScore > 80) {
    score += 5;
  }

  // Territory fit penalty (-25 to 0) — same as generic
  const projectStateUpper = (projectState ?? "").toUpperCase();
  if (projectStateUpper && AU_STATES.includes(projectStateUpper)) {
    const mismatchPhrases = STATE_MISMATCH_PHRASES[projectStateUpper] ?? [];
    const companyLower = (contact.company ?? "").toLowerCase();
    if (mismatchPhrases.some(m => titleLower.includes(m) || companyLower.includes(m))) {
      score -= 25;
      reasons.push("Territory mismatch (penalised)");
    } else {
      reasons.push("Territory aligned");
    }
  }

  // Route-to-buy inference (pump-specific)
  let routeToBuy = "Unknown";
  if (PUMP_TIER1_TITLES.some(t => titleLower.includes(t))) {
    routeToBuy = "Site operations / maintenance — direct pump user or specifier";
  } else if (titleLower.includes("project manager") || titleLower.includes("project director") || titleLower.includes("construction manager")) {
    routeToBuy = "Project delivery — equipment package decision maker";
  } else if (titleLower.includes("service") || titleLower.includes("branch") || titleLower.includes("fleet")) {
    routeToBuy = "Service/fleet channel — fleet refresh or service agreement path";
  } else if (titleLower.includes("procurement") || titleLower.includes("purchasing") || titleLower.includes("buyer")) {
    routeToBuy = "Procurement — transactional purchase path";
  } else if (titleLower.includes("general manager") || titleLower.includes("managing director") || titleLower.includes("ceo")) {
    routeToBuy = "Executive sponsor / budget holder";
  } else {
    routeToBuy = "Technical/specialist influencer";
  }

  return {
    contact,
    score,
    whySelected: reasons.length > 0 ? reasons.join("; ") : "Default selection",
    routeToBuy,
  };
}
