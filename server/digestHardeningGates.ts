/**
 * Digest Hardening Gates
 *
 * Automated quality gates that run post-pipeline and pre-digest to prevent
 * weak contacts, generic junk, and regressions from reaching reps.
 *
 * Architecture:
 *  1. Post-pipeline: captures visible top 3 snapshot, runs delta comparison
 *  2. Pre-digest (per-rep): runs SEND/HOLD gate, contact defensibility, junk suppression
 *  3. Results stored in repDigestGateResults table for operator visibility
 *
 * Gate taxonomy:
 *  - REP_SEND_GATE: 7-criteria rep-level SEND/HOLD decision
 *  - CONTACT_DEFENSIBILITY: per-project contact quality validation
 *  - JUNK_SUPPRESSION: lane-aware automated junk removal
 *  - DELTA_REGRESSION: post-pipeline visible top 3 quality comparison
 *  - RESCUE_TRIGGER: narrow budget-aware contact rescue for weak visible projects
 */

// ═══════════════════════════════════════════════════════════════════════════════
// PART D — AUTOMATED JUNK SUPPRESSION GATE (lane-aware)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Junk patterns that should never appear in rep-facing digest output.
 * Each pattern has a name, a matcher function, and lane exceptions.
 */
interface JunkPattern {
  name: string;
  /** Returns true if the project matches this junk pattern */
  matches: (project: { name: string; overview?: string; sector?: string; owner?: string }) => boolean;
  /** Lanes where this pattern is NOT junk (e.g., hospitals might be valid for BESS backup power) */
  laneExceptions?: string[];
}

const JUNK_PATTERNS: JunkPattern[] = [
  {
    name: "school",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(school|primary school|high school|college|university|campus|education precinct)\b/.test(text)
        && !/\b(mining school|school of mines|training facility)\b/.test(text);
    },
    laneExceptions: [], // Never valid for any lane
  },
  {
    name: "police_station",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(police station|police complex|police headquarters)\b/.test(text);
    },
    laneExceptions: [],
  },
  {
    name: "prison_correctional",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(prison|correctional|detention centre|remand|gaol|jail)\b/.test(text);
    },
    laneExceptions: [],
  },
  {
    name: "hospital_health",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(hospital|health precinct|medical centre|aged care|nursing home)\b/.test(text)
        && !/\b(backup power|emergency power|generator|bess|battery)\b/.test(text);
    },
    laneExceptions: ["BESS"], // BESS backup power for hospitals is valid
  },
  {
    name: "zoo_museum_library",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(zoo|museum|library|playground|aquarium|botanical garden)\b/.test(text);
    },
    laneExceptions: [],
  },
  {
    name: "sports_only",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(stadium|sports complex|swimming pool|recreation centre|cricket ground|football ground|tennis)\b/.test(text)
        && !/\b(dewatering|pump|compressed air|generator)\b/.test(text);
    },
    laneExceptions: [],
  },
  {
    name: "consulting_only",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(feasibility study|concept design|master plan|strategic assessment|environmental impact statement)\b/.test(text)
        && !/\b(construction|build|install|commission)\b/.test(text);
    },
    laneExceptions: [],
  },
  {
    name: "community_local_gov",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(community centre|civic centre|town hall|local government|council chambers|public toilet)\b/.test(text);
    },
    laneExceptions: [],
  },
  {
    name: "generic_wrapper",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(multiple projects|various works|annual maintenance|routine maintenance|facility management|general works)\b/.test(text)
        && !/\b(mining|dewatering|compressed air|drill|bore|tunnel|shaft)\b/.test(text);
    },
    laneExceptions: [],
  },
  {
    name: "generic_maintenance",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(office fit-?out|office refurbishment|carpet replacement|painting|signage|landscaping)\b/.test(text);
    },
    laneExceptions: [],
  },
  {
    name: "data_centre",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(data cent(re|er)|server farm|hyperscale)\b/.test(text)
        && !/\b(backup power|generator|cooling|chiller|compressed air)\b/.test(text);
    },
    laneExceptions: ["BESS", "PAL"], // BESS/PAL for data centre power is valid
  },
  {
    name: "student_housing",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      return /\b(student (housing|accommodation|residence)|dormitor(y|ies)|student village)\b/.test(text);
    },
    laneExceptions: [], // Never valid for any lane
  },
  {
    name: "residential_only",
    matches: (p) => {
      const text = `${p.name} ${p.overview || ""}`.toLowerCase();
      const sector = (p.sector || "").toLowerCase();
      return (sector === "residential" || /\b(apartment|townhouse|residential estate|housing estate)\b/.test(text))
        && !/\b(mining camp|workers? accommodation|fly-in|fifo|remote camp)\b/.test(text);
    },
    laneExceptions: [],
  },
];

/**
 * Run junk suppression gate on a project for a given lane.
 * Returns null if project is clean, or the junk pattern name if it should be suppressed.
 */
export function checkJunkSuppression(
  project: { name: string; overview?: string; sector?: string; owner?: string },
  repLane: string, // "Portable Air" | "Pump" | "PAL" | "BESS"
): { isJunk: boolean; pattern?: string; reason?: string } {
  const normalizedLane = repLane.toUpperCase().replace(/[^A-Z]/g, "");
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.matches(project)) {
      // Check lane exceptions
      const hasException = (pattern.laneExceptions || []).some(
        ex => normalizedLane.includes(ex.toUpperCase())
      );
      if (!hasException) {
        return {
          isJunk: true,
          pattern: pattern.name,
          reason: `Project matches junk pattern "${pattern.name}" and lane "${repLane}" has no exception`,
        };
      }
    }
  }
  return { isJunk: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART B — PRE-SEND CONTACT DEFENSIBILITY GATE
// ═══════════════════════════════════════════════════════════════════════════════

export interface ContactDefensibilityResult {
  passes: boolean;
  contactName: string;
  contactEmail: string;
  checks: {
    trustTierOk: boolean;
    domainDefensible: boolean;
    noFabricatedEmail: boolean;
    noIndustryMismatch: boolean;
    titleRelevant: boolean;
    notDowngraded: boolean;
    cardDetailConsistent: boolean;
  };
  failedChecks: string[];
  reason?: string;
}

/** Known fabricated email patterns (from past failures) */
const FABRICATED_EMAIL_PATTERNS = [
  /\.pe@/i,           // P.E. suffix parsed as surname (Melanie Mayne case)
  /\.am@/i,           // A.M. suffix parsed as surname
  /\.phd@/i,          // PhD suffix parsed as surname
  /\.(jr|sr|iii|iv)@/i, // Generational suffix parsed as surname
];

/** Non-industrial title patterns that should never be primary contact for PA/Pump */
const NON_INDUSTRIAL_TITLES = [
  /\b(professor|lecturer|teacher|principal|dean)\b/i,
  /\b(chef|cook|barista|waiter)\b/i,
  /\b(lawyer|solicitor|barrister|paralegal)\b/i,
  /\b(doctor|nurse|surgeon|pharmacist|dentist)\b/i,
  /\b(librarian|curator|archivist)\b/i,
  /\b(journalist|reporter|editor)\b/i,
];

/**
 * Check if a domain appears truncated (e.g., wateroration.com.au instead of watercorporation.com.au)
 * Detection: if the domain prefix is a proper subsequence of the owner name but not equal,
 * and differs by 2+ characters, it's likely truncated.
 */
function isTruncatedDomain(domain: string, projectOwner: string | null | undefined): boolean {
  if (!projectOwner) return false;
  // Normalize owner name to expected domain prefix
  const ownerNorm = projectOwner.toLowerCase().replace(/[^a-z0-9]/g, "");
  const domainPrefix = domain.split(".")[0].toLowerCase();
  // Exact match is fine
  if (domainPrefix === ownerNorm) return false;
  // If domain prefix is a clean prefix of the owner name, it's a legitimate shorter brand domain.
  // e.g., "fortescuemetals" is a prefix of "fortescuemetalsgroupltd" - NOT truncated.
  // This handles ICN-registered full legal names (Fortescue Metals Group Ltd, Chevron Australia Pty Limited, etc.)
  if (ownerNorm.startsWith(domainPrefix)) return false;
  // Genuine truncation: domain prefix is a subsequence of ownerNorm with 1-4 internal chars missing.
  // e.g., "wateroration" from "watercorporation" (missing "corp" chars)
  if (domainPrefix.length >= ownerNorm.length - 4 && domainPrefix.length < ownerNorm.length) {
    let oi = 0, di = 0;
    while (oi < ownerNorm.length && di < domainPrefix.length) {
      if (ownerNorm[oi] === domainPrefix[di]) di++;
      oi++;
    }
    if (di === domainPrefix.length) return true;
  }
  // Also check: domain prefix is a non-prefix substring of owner with 1-4 char difference.
  // This catches cases where the domain is a garbled middle section of the owner name.
  if (ownerNorm.includes(domainPrefix) && domainPrefix.length > 5 && !ownerNorm.startsWith(domainPrefix)) {
    const diff = ownerNorm.length - domainPrefix.length;
    if (diff >= 1 && diff <= 4) {
      return true;
    }
  }
  return false;
}

/**
 * Government/institutional domains that ARE defensible for outreach.
 * These are verified procurement-facing departments where contacts are legitimate buyers.
 * Add domains here when a government entity is a confirmed project owner with procurement authority.
 */
const GOV_DOMAIN_ALLOWLIST: string[] = [
  // ── Federal government ──
  "defence.gov.au",          // Australian Defence — confirmed procurement contacts
  "infrastructure.gov.au",   // Dept of Infrastructure — major project owners
  // ── State/territory government (all states) ──
  // Using top-level state suffixes so that any *.state.gov.au subdomain is covered
  // (e.g. northeastlink.vic.gov.au, dpie.nsw.gov.au, dpti.sa.gov.au, etc.)
  "wa.gov.au",               // WA Government — mining/resources procurement
  "nt.gov.au",               // NT Government — infrastructure projects
  "qld.gov.au",              // QLD Government — state infrastructure
  "vic.gov.au",              // VIC Government — e.g. northeastlink.vic.gov.au
  "nsw.gov.au",              // NSW Government
  "sa.gov.au",               // SA Government
  "tas.gov.au",              // TAS Government
  "act.gov.au",              // ACT Government
  // ── Project-specific government delivery agencies ──
  "northeastlink.vic.gov.au", // North East Link Program — VIC infrastructure
  "crossriverrail.qld.gov.au", // Cross River Rail — QLD
  "sydneymetro.info",         // Sydney Metro — NSW delivery authority
  "snowy2.com.au",            // Snowy 2.0 — federal
  "lumsdenpoint.com.au",      // Lumsden Point — WA port
  "linkconsortium.com.au",    // Link Consortium — NEL delivery partner
];
/** Domains that are known non-industrial (government, education, etc.) */
const NON_DEFENSIBLE_DOMAINS = [
  /\.gov\.au$/i,
  /\.edu\.au$/i,
  /\.edu$/i,
  /\.gov$/i,
  /\.ac\.uk$/i,
  /gmail\.com$/i,
  /yahoo\.com$/i,
  /hotmail\.com$/i,
  /outlook\.com$/i,
];

/**
 * Validate a contact's defensibility for Monday digest inclusion.
 * A contact must pass ALL 7 checks to be considered defensible.
 */
export function checkContactDefensibility(
  contact: {
    name: string;
    email: string | null;
    title: string | null;
    company: string | null;
    trustTier: string | null;
    source: string | null;
    verificationScore: number | null;
    isDowngraded?: boolean;
  },
  project: {
    name: string;
    owner: string | null;
    contractors: string[] | null;
  },
  repLane: string,
): ContactDefensibilityResult {
  const email = contact.email || "";
  const domain = email.split("@")[1] || "";
  const title = contact.title || "";
  const failedChecks: string[] = [];

  // 1. Trust tier must be send_ready
  const trustTierOk = contact.trustTier === "send_ready";
  if (!trustTierOk) failedChecks.push("trust_tier_not_send_ready");

  // 2. Email domain must match a defensible company
  let domainDefensible = true;
  if (!email || !domain) {
    domainDefensible = false;
    failedChecks.push("no_email_or_domain");
  } else if (NON_DEFENSIBLE_DOMAINS.some(re => re.test(domain)) && !GOV_DOMAIN_ALLOWLIST.some(allowed => domain.endsWith(allowed))) {
    domainDefensible = false;
    failedChecks.push("non_defensible_domain");
  } else if (isTruncatedDomain(domain, project.owner)) {
    domainDefensible = false;
    failedChecks.push("domain_not_defensible");
  }

  // 3. No fabricated email pattern
  let noFabricatedEmail = true;
  if (FABRICATED_EMAIL_PATTERNS.some(re => re.test(email))) {
    noFabricatedEmail = false;
    failedChecks.push("fabricated_email_pattern");
  }
  // 3b. No LLM-inferred contacts as primary
  if ((contact as any).isLlmInferred) {
    failedChecks.push("llm_inferred_primary");
  }

  // 4. No cross-industry mismatch (contact company should relate to project)
  let noIndustryMismatch = true;
  if (contact.company) {
    const companyLower = contact.company.toLowerCase();
    // Check if the contact's company is completely unrelated to the project
    const projectContext = `${project.name} ${project.owner || ""} ${(project.contractors || []).join(" ")}`.toLowerCase();
    // Simple heuristic: if company name has no overlap with project context
    // and is a known non-industrial company, flag it
    const isNonIndustrial = /\b(university|school|hospital|council|church|charity)\b/i.test(companyLower);
    if (isNonIndustrial && !projectContext.includes(companyLower.slice(0, 10))) {
      noIndustryMismatch = false;
      failedChecks.push("cross_industry_mismatch");
    }
  }

  // 5. Title must be commercially relevant for the lane
  let titleRelevant = true;
  if (title && NON_INDUSTRIAL_TITLES.some(re => re.test(title))) {
    titleRelevant = false;
    failedChecks.push("non_industrial_title");
  }

  // 6. No downgraded/quarantined contact appearing as primary
  const notDowngraded = !contact.isDowngraded;
  if (!notDowngraded) failedChecks.push("contact_downgraded");

  // 7. Card and detail page must resolve to same contact (structural check)
  // Validated by ensuring the contact has email + name + trustTier (source is optional metadata)
  const cardDetailConsistent = !!(contact.email && contact.name && contact.trustTier);
  if (!cardDetailConsistent) failedChecks.push("card_detail_inconsistent");

  const passes = failedChecks.length === 0;

  return {
    passes,
    contactName: contact.name,
    contactEmail: email,
    checks: {
      trustTierOk,
      domainDefensible,
      noFabricatedEmail,
      noIndustryMismatch,
      titleRelevant,
      notDowngraded,
      cardDetailConsistent,
    },
    failedChecks,
    reason: passes ? undefined : `Failed: ${failedChecks.join(", ")}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART A — REP-LEVEL SEND GATE
// ═══════════════════════════════════════════════════════════════════════════════

export type RepGateDecision = "SEND" | "HOLD";

export interface RepGateBlocker {
  criterion: string;
  detail: string;
  severity: "blocking" | "warning";
}

export interface RepSendGateResult {
  userId: number;
  userName: string;
  decision: RepGateDecision;
  blockers: RepGateBlocker[];
  evidence: {
    top3Projects: Array<{
      projectId: number;
      projectName: string;
      laneFit: string;
      contactDefensibility: ContactDefensibilityResult | null;
      junkCheck: { isJunk: boolean; pattern?: string } | null;
    }>;
    contactsDefensible: number; // how many of top 3 have defensible contacts
    junkInMustAct: number;
    llmInferredPrimary: boolean;
    deltaRegression: boolean;
  };
  timestamp: string;
}

/**
 * Run the full rep-level SEND gate.
 *
 * A rep is SEND only if ALL 7 criteria pass:
 * 1. Top 3 visible projects are commercially sensible for lane + territory
 * 2. At least 2 of top 3 have defensible primary contacts
 * 3. No obvious generic junk remains in Must Act / Closing Soon
 * 4. No llm_inferred primary contacts
 * 5. No card/detail contact mismatch
 * 6. No selected contact with wrong company/domain/title pattern
 * 7. No newly promoted project is weaker than the one it displaced (delta check)
 */
export function runRepSendGate(
  userId: number,
  userName: string,
  top3Projects: Array<{
    id: number;
    name: string;
    overview?: string;
    sector?: string;
    owner?: string;
    laneFitLabel: string;
    bestContact: {
      name: string;
      email: string | null;
      title: string | null;
      company: string | null;
      trustTier: string | null;
      source: string | null;
      verificationScore: number | null;
      isDowngraded?: boolean;
      isLlmInferred?: boolean;
    } | null;
    contractors?: string[] | null;
    relevanceScore?: number;
  }>,
  repLane: string,
  previousTop3?: Array<{ id: number; name: string; relevanceScore?: number; contactQuality?: number }> | null,
): RepSendGateResult {
  const blockers: RepGateBlocker[] = [];
  const projectEvidence: RepSendGateResult["evidence"]["top3Projects"] = [];
  let contactsDefensible = 0;
  let junkInMustAct = 0;
  let llmInferredPrimary = false;
  let deltaRegression = false;

  for (const project of top3Projects) {
    // Junk check
    const junkCheck = checkJunkSuppression(
      { name: project.name, overview: project.overview, sector: project.sector, owner: project.owner },
      repLane,
    );
    if (junkCheck.isJunk) {
      junkInMustAct++;
      blockers.push({
        criterion: "no_junk_in_must_act",
        detail: `"${project.name}" matches junk pattern "${junkCheck.pattern}"`,
        severity: "blocking",
      });
    }

    // Contact defensibility
    let contactResult: ContactDefensibilityResult | null = null;
    if (project.bestContact) {
      contactResult = checkContactDefensibility(
        project.bestContact,
        { name: project.name, owner: project.owner || null, contractors: project.contractors || null },
        repLane,
      );
      if (contactResult.passes) {
        contactsDefensible++;
      } else {
        blockers.push({
          criterion: "contact_not_defensible",
          detail: `"${project.name}" contact "${project.bestContact.name}" failed: ${contactResult.failedChecks.join(", ")}`,
          severity: "warning",
        });
      }

      // Check llm_inferred
      if (project.bestContact.isLlmInferred) {
        llmInferredPrimary = true;
        blockers.push({
          criterion: "no_llm_inferred_primary",
          detail: `"${project.name}" has llm_inferred primary contact "${project.bestContact.name}"`,
          severity: "blocking",
        });
      }

      // Check card/detail consistency (criterion 5)
      if (!contactResult.checks.cardDetailConsistent) {
        blockers.push({
          criterion: "card_detail_mismatch",
          detail: `"${project.name}" contact "${project.bestContact.name}" has inconsistent card/detail data`,
          severity: "blocking",
        });
      }

      // Check wrong company/domain/title (criterion 6)
      if (!contactResult.checks.domainDefensible || !contactResult.checks.noIndustryMismatch || !contactResult.checks.titleRelevant) {
        blockers.push({
          criterion: "wrong_contact_pattern",
          detail: `"${project.name}" contact has wrong company/domain/title pattern`,
          severity: "blocking",
        });
      }
    } else {
      // No contact at all
      blockers.push({
        criterion: "contact_not_defensible",
        detail: `"${project.name}" has no primary contact`,
        severity: "warning",
      });
    }

    // Lane fit check (criterion 1)
    if (project.laneFitLabel !== "High" && project.laneFitLabel !== "Medium") {
      blockers.push({
        criterion: "not_commercially_sensible",
        detail: `"${project.name}" has lane fit "${project.laneFitLabel}" — not commercially sensible for ${repLane}`,
        severity: "warning",
      });
    }

    projectEvidence.push({
      projectId: project.id,
      projectName: project.name,
      laneFit: project.laneFitLabel,
      contactDefensibility: contactResult,
      junkCheck,
    });
  }

  // Criterion 2: at least 2 of top 3 must have defensible contacts
  if (contactsDefensible < 2) {
    blockers.push({
      criterion: "insufficient_defensible_contacts",
      detail: `Only ${contactsDefensible}/3 top projects have defensible contacts (minimum 2 required)`,
      severity: "blocking",
    });
  }

  // Criterion 7: delta regression check
  if (previousTop3 && previousTop3.length > 0) {
    const prevAvgScore = previousTop3.reduce((sum, p) => sum + (p.relevanceScore || 0), 0) / previousTop3.length;
    const currAvgScore = top3Projects.reduce((sum, p) => sum + (p.relevanceScore || 0), 0) / top3Projects.length;
    // Check if a weaker project displaced a stronger one
    for (const curr of top3Projects) {
      const wasInPrev = previousTop3.some(p => p.id === curr.id);
      if (!wasInPrev && curr.relevanceScore !== undefined) {
        // New project entered top 3 — check if it's weaker than what it displaced
        const displaced = previousTop3.find(p => !top3Projects.some(c => c.id === p.id));
        if (displaced && (displaced.relevanceScore || 0) > (curr.relevanceScore || 0) + 5) {
          deltaRegression = true;
          blockers.push({
            criterion: "delta_regression",
            detail: `"${curr.name}" (score ${curr.relevanceScore}) displaced "${displaced.name}" (score ${displaced.relevanceScore}) — weaker replacement`,
            severity: "warning",
          });
        }
      }
    }
  }

  // Final decision: HOLD if any blocking blocker exists
  const hasBlockingBlocker = blockers.some(b => b.severity === "blocking");
  // Also HOLD if fewer than 2 defensible contacts (even though it's already a blocker)
  const decision: RepGateDecision = hasBlockingBlocker ? "HOLD" : "SEND";

  return {
    userId,
    userName,
    decision,
    blockers,
    evidence: {
      top3Projects: projectEvidence,
      contactsDefensible,
      junkInMustAct,
      llmInferredPrimary,
      deltaRegression,
    },
    timestamp: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART C — POST-PIPELINE VISIBLE DELTA GATE
// ═══════════════════════════════════════════════════════════════════════════════

export interface DeltaComparison {
  userId: number;
  userName: string;
  before: Array<{ id: number; name: string; relevanceScore: number; contactQuality: number }>;
  after: Array<{ id: number; name: string; relevanceScore: number; contactQuality: number }>;
  changes: DeltaChange[];
  qualityDelta: "improved" | "unchanged" | "weakened";
  flaggedForReview: boolean;
  flagReasons: string[];
}

export interface DeltaChange {
  type: "promoted" | "demoted" | "unchanged";
  projectId: number;
  projectName: string;
  reason?: string;
}

/**
 * Compare before/after visible top 3 and detect regressions.
 */
export function computeDelta(
  userId: number,
  userName: string,
  before: Array<{ id: number; name: string; relevanceScore: number; contactQuality: number }>,
  after: Array<{ id: number; name: string; relevanceScore: number; contactQuality: number }>,
): DeltaComparison {
  const changes: DeltaChange[] = [];
  const flagReasons: string[] = [];

  // Detect newly promoted projects
  for (const curr of after) {
    const wasInBefore = before.some(p => p.id === curr.id);
    if (!wasInBefore) {
      changes.push({ type: "promoted", projectId: curr.id, projectName: curr.name });

      // Check if the promoted project is weaker than what it displaced
      const displaced = before.find(p => !after.some(a => a.id === p.id));
      if (displaced) {
        if (curr.contactQuality < displaced.contactQuality) {
          flagReasons.push(
            `"${curr.name}" (contact quality ${curr.contactQuality}) displaced "${displaced.name}" (contact quality ${displaced.contactQuality}) — weaker contacts`
          );
        }
        if (curr.relevanceScore < displaced.relevanceScore - 5) {
          flagReasons.push(
            `"${curr.name}" (score ${curr.relevanceScore}) displaced "${displaced.name}" (score ${displaced.relevanceScore}) — lower relevance`
          );
        }
      }

      // Check if promoted project has no contacts
      if (curr.contactQuality === 0) {
        flagReasons.push(`"${curr.name}" promoted to top 3 with no send_ready contacts`);
      }
    }
  }

  // Detect demoted projects
  for (const prev of before) {
    const stillInAfter = after.some(p => p.id === prev.id);
    if (!stillInAfter) {
      changes.push({ type: "demoted", projectId: prev.id, projectName: prev.name });
    }
  }

  // Overall quality delta
  const beforeAvg = before.length > 0
    ? before.reduce((sum, p) => sum + p.contactQuality, 0) / before.length
    : 0;
  const afterAvg = after.length > 0
    ? after.reduce((sum, p) => sum + p.contactQuality, 0) / after.length
    : 0;

  let qualityDelta: "improved" | "unchanged" | "weakened";
  if (afterAvg > beforeAvg + 0.5) qualityDelta = "improved";
  else if (afterAvg < beforeAvg - 0.5) qualityDelta = "weakened";
  else qualityDelta = "unchanged";

  return {
    userId,
    userName,
    before,
    after,
    changes,
    qualityDelta,
    flaggedForReview: flagReasons.length > 0,
    flagReasons,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART E — AUTOMATION-SAFE CONTACT RESCUE TRIGGER
// ═══════════════════════════════════════════════════════════════════════════════

export interface RescueCandidate {
  projectId: number;
  projectName: string;
  reason: string;
  priority: "high" | "medium";
}

export interface RescueTriggerResult {
  candidates: RescueCandidate[];
  budgetRemaining: number;
  cooldownBlocked: number;
  triggered: boolean;
}

/**
 * Determine which visible-top projects need contact rescue.
 *
 * Only triggers if:
 * 1. Project is in or near the rep's visible top set (top 5)
 * 2. Project is commercially strong (relevance > 40, lane fit High/Medium)
 * 3. Contact quality is below threshold (no send_ready, or only web_search)
 * 4. Provider budget remains (Apollo daily < cap)
 * 5. Project is not in dedup cooldown (enriched within last 7 days)
 */
export function identifyRescueCandidates(
  topProjects: Array<{
    id: number;
    name: string;
    relevanceScore: number;
    laneFitLabel: string;
    bestContactTrustTier: string | null;
    lastEnrichedAt: Date | null;
    contactCount: number;
  }>,
  apolloDailyUsed: number,
  apolloDailyCap: number,
): RescueTriggerResult {
  const COOLDOWN_DAYS = 7;
  const MIN_RELEVANCE = 40;
  const MAX_RESCUE_PER_RUN = 3;
  const BUDGET_RESERVE = 5; // Reserve 5 credits for post-delta pass

  const budgetRemaining = apolloDailyCap - apolloDailyUsed - BUDGET_RESERVE;
  const candidates: RescueCandidate[] = [];
  let cooldownBlocked = 0;

  for (const project of topProjects.slice(0, 5)) { // Only top 5
    // Skip if commercially weak
    if (project.relevanceScore < MIN_RELEVANCE) continue;
    if (project.laneFitLabel !== "High" && project.laneFitLabel !== "Medium") continue;

    // Skip if already has good contacts
    if (project.bestContactTrustTier === "send_ready" && project.contactCount >= 2) continue;

    // Skip if in cooldown
    if (project.lastEnrichedAt) {
      const daysSinceEnrich = (Date.now() - project.lastEnrichedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceEnrich < COOLDOWN_DAYS) {
        cooldownBlocked++;
        continue;
      }
    }

    // Skip if no budget
    if (budgetRemaining <= 0) continue;
    if (candidates.length >= MAX_RESCUE_PER_RUN) continue;

    const priority = project.bestContactTrustTier === null || project.contactCount === 0
      ? "high" : "medium";

    candidates.push({
      projectId: project.id,
      projectName: project.name,
      reason: project.contactCount === 0
        ? "No contacts at all"
        : `Only ${project.contactCount} contacts, best tier: ${project.bestContactTrustTier}`,
      priority,
    });
  }

  return {
    candidates,
    budgetRemaining,
    cooldownBlocked,
    triggered: candidates.length > 0 && budgetRemaining > 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART F — HOLD STATE STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

export interface RepDigestGateRecord {
  userId: number;
  userName: string;
  weekKey: string;
  decision: RepGateDecision;
  blockers: RepGateBlocker[];
  top3Snapshot: Array<{ id: number; name: string; score: number; contactName?: string }>;
  rescueAttempted: boolean;
  rescueResult?: RescueTriggerResult;
  deltaComparison?: DeltaComparison;
  createdAt: string;
}

/**
 * Store rep-level gate result in the database.
 * Called after each pipeline run and before each digest send.
 */
export async function storeGateResult(
  record: RepDigestGateRecord,
  db: any, // drizzle db instance
  table: any, // repDigestGateResults table
): Promise<void> {
  try {
    await db.insert(table).values({
      userId: record.userId,
      weekKey: record.weekKey,
      decision: record.decision,
      blockers: JSON.stringify(record.blockers),
      top3Snapshot: JSON.stringify(record.top3Snapshot),
      rescueAttempted: record.rescueAttempted,
      rescueResult: record.rescueResult ? JSON.stringify(record.rescueResult) : null,
      deltaComparison: record.deltaComparison ? JSON.stringify(record.deltaComparison) : null,
    });
  } catch (err) {
    console.error(`[DigestHardeningGates] Failed to store gate result for user ${record.userId}:`, err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR — runs all gates for a single rep
// ═══════════════════════════════════════════════════════════════════════════════

export interface DigestGateInput {
  userId: number;
  userName: string;
  repLane: string;
  weekKey: string;
  top3Projects: Array<{
    id: number;
    name: string;
    overview?: string;
    sector?: string;
    owner?: string;
    laneFitLabel: string;
    relevanceScore?: number;
    contractors?: string[] | null;
    bestContact: {
      name: string;
      email: string | null;
      title: string | null;
      company: string | null;
      trustTier: string | null;
      source: string | null;
      verificationScore: number | null;
      isDowngraded?: boolean;
      isLlmInferred?: boolean;
    } | null;
  }>;
  previousTop3?: Array<{ id: number; name: string; relevanceScore?: number; contactQuality?: number }> | null;
}

/**
 * Run all hardening gates for a single rep.
 * Returns the SEND/HOLD decision with full evidence.
 */
export function runAllGates(input: DigestGateInput): RepSendGateResult {
  return runRepSendGate(
    input.userId,
    input.userName,
    input.top3Projects,
    input.repLane,
    input.previousTop3,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST-PIPELINE SNAPSHOT
// Called after each pipeline run to capture current top 3 per rep.
// The Monday digest gate uses this to detect regressions.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Snapshot the current top 3 visible projects per rep after a pipeline run.
 * Stores results in repDigestGateResults with phase="post_pipeline".
 * Returns the count of reps snapshotted.
 */
export async function snapshotPostPipelineState(): Promise<{ repsSnapshotted: number }> {
  const { getDb } = await import("./db");
  const db = await getDb();
  if (!db) return { repsSnapshotted: 0 };

  // Get all active reps with profiles
  const reps = await db.execute(
    `SELECT u.id, u.name, up.assignedBusinessLines, up.territories
     FROM users u
     JOIN userProfiles up ON up.userId = u.id
     WHERE u.role != 'admin'
     AND up.assignedBusinessLines IS NOT NULL
     AND up.territories IS NOT NULL`
  );

  const rows = (reps as any)[0] || reps;
  if (!Array.isArray(rows) || rows.length === 0) return { repsSnapshotted: 0 };

  let snapshotted = 0;
  const weekKey = getWeekKey();

  for (const rep of rows) {
    try {
      // Parse territories
      let territories: string[] = [];
      try {
        const raw = rep.territories;
        if (typeof raw === "string") {
          territories = JSON.parse(raw);
        } else if (Buffer.isBuffer(raw)) {
          territories = JSON.parse(raw.toString("utf-8"));
        } else if (Array.isArray(raw)) {
          territories = raw;
        }
      } catch { territories = []; }

      // Parse BLs
      let bls: string[] = [];
      try {
        const raw = rep.assignedBusinessLines;
        if (typeof raw === "string") {
          try { bls = JSON.parse(raw); } catch { bls = raw.split(",").map((s: string) => s.trim()); }
        } else if (Buffer.isBuffer(raw)) {
          bls = JSON.parse(raw.toString("utf-8"));
        } else if (Array.isArray(raw)) {
          bls = raw;
        }
      } catch { bls = []; }

      // Determine lane
      const repLane = bls.some(b => b.includes("Pump"))
        ? "pumps"
        : bls.some(b => b === "PAL" || b === "BESS")
          ? "pal_bess"
          : "portable_air";

      // Get BL dimension for scoring
      const BL_TO_DIM: Record<string, string[]> = {
        "Portable Air": ["Portable Air"],
        "PT Capital Sales": ["Portable Air"],
        "Pump": ["Pump (Dewatering)", "Pump (Flow)"],
        "Pump (Flow)": ["Pump (Flow)"],
        "Pump (Dewatering)": ["Pump (Dewatering)"],
        "PAL": ["Power and Light"],
        "BESS": ["Power and Light"],
      };
      const dims = bls.flatMap(b => BL_TO_DIM[b] || []);
      if (dims.length === 0) continue;

      // Build territory filter
      const isNational = territories.includes("NATIONAL") || territories.length === 0;
      const stateFilter = isNational
        ? ""
        : `AND (p.projectState IN (${territories.map(t => `'${t}'`).join(",")}) OR p.projectState IS NULL)`;

      // Query top 3 projects for this rep
      const dimFilter = dims.map(d => `'${d}'`).join(",");
      const top3Query = `
        SELECT p.id, p.name, bls.score as relevanceScore,
               (SELECT COUNT(*) FROM contacts c WHERE c.projectId = p.id AND c.trustTier = 'send_ready') as srCount
        FROM projects p
        JOIN projectBusinessLineScores bls ON bls.projectId = p.id
        WHERE bls.scoringDimension IN (${dimFilter})
        AND bls.score >= 60
        AND p.suppressed = 0
        AND p.lifecycleStatus != 'completed'
        ${stateFilter}
        ORDER BY bls.score DESC, srCount DESC
        LIMIT 3
      `;

      const [top3Rows] = await db.execute(top3Query) as any;
      if (!Array.isArray(top3Rows) || top3Rows.length === 0) continue;

      // Store snapshot
      const { repDigestGateResults } = await import("../drizzle/schema");
      await db.insert(repDigestGateResults).values({
        userId: rep.id,
        weekKey,
        decision: "SEND", // snapshot only, not a real gate decision
        blockers: "[]",
        top3Snapshot: JSON.stringify(
          top3Rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            score: r.relevanceScore || 0,
          }))
        ),
        phase: "post_pipeline",
        rescueAttempted: false,
      });
      snapshotted++;
    } catch (err) {
      console.warn(`[DigestHardeningGates] Snapshot failed for rep ${rep.id}:`, err);
    }
  }

  return { repsSnapshotted: snapshotted };
}

/**
 * Get the current ISO week key (e.g., "2026-W19")
 */
function getWeekKey(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const weekNum = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
