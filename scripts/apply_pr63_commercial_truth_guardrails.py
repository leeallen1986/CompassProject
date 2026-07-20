from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    file_path = ROOT / path
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exact block once, found {count}")
    file_path.write_text(text.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    file_path = ROOT / path
    text = file_path.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{path}: expected regex block once, found {count}")
    file_path.write_text(updated)


# ── This Week: fail-closed profile scope and territory-before-ranking ─────────
replace_once(
    "server/thisWeekService.ts",
    'import { resolveTerritories, resolveBusinessLines, getPrimaryDimension } from "./canonicalMappings";\n',
    'import { resolveTerritories, resolveBusinessLines, getPrimaryDimension } from "./canonicalMappings";\n'
    'import { hasConfiguredTerritoryInput, scopeProjectsToResolvedTerritories } from "./commercialTruthGuardrails";\n',
)

replace_once(
    "server/thisWeekService.ts",
    '''export interface UserContext {
  territories: string[];
  assignedBusinessLines: string[];
  sectorFocus: string[];
  hasPreferences: boolean;
  /** Rep name for rep-gated signal logic (e.g. portable_air_blasting_signal) */
  repName?: string | null;
}
''',
    '''export interface UserContext {
  territories: string[];
  assignedBusinessLines: string[];
  sectorFocus: string[];
  hasPreferences: boolean;
  /** Personalised recommendations fail closed when profile territory cannot be resolved. */
  scopeResolved: boolean;
  scopeIssue: "missing_profile" | "territory_not_configured" | "profile_lookup_failed" | "database_unavailable" | null;
  /** Rep name for rep-gated signal logic (e.g. portable_air_blasting_signal) */
  repName?: string | null;
}
''',
)

sub_once(
    "server/thisWeekService.ts",
    r'''  // ── Load user preferences for personalisation ──\n  let userContext: UserContext = \{.*?\n  \}\n\n  // ── 1\. Top Priority Projects ──''',
    '''  // ── Load user preferences for personalisation ──
  let userContext: UserContext = {
    territories: [],
    assignedBusinessLines: [],
    sectorFocus: [],
    hasPreferences: false,
    scopeResolved: !userId,
    scopeIssue: userId ? "missing_profile" : null,
  };
  let userProfile: any = null;
  let userRepName: string | null = null;
  if (userId) {
    if (!db) {
      userContext.scopeIssue = "database_unavailable";
    } else {
      try {
        userProfile = await getProfileByUserId(userId);
        const userRow = await getUserById(userId);
        userRepName = userRow?.name || null;
        if (userProfile) {
          const territoryConfigured = hasConfiguredTerritoryInput(userProfile.territories);
          const resolvedTerritories = territoryConfigured
            ? resolveTerritories(
                userProfile.territories as string[] | string | null,
                userProfile.sectorFocus as string[] | string | null,
              )
            : [];
          const resolvedBLs = resolveBusinessLines(
            userProfile.assignedBusinessLines as string[] | string | null,
          );
          const scopeResolved = territoryConfigured && resolvedTerritories.length > 0;
          userContext = {
            territories: resolvedTerritories,
            assignedBusinessLines: resolvedBLs,
            sectorFocus: (userProfile.sectorFocus as string[]) || [],
            hasPreferences: scopeResolved || resolvedBLs.length > 0,
            scopeResolved,
            scopeIssue: scopeResolved ? null : "territory_not_configured",
            repName: userRepName,
          };
        }
      } catch {
        userContext.scopeResolved = false;
        userContext.scopeIssue = "profile_lookup_failed";
      }
    }
  }

  // ── 1. Top Priority Projects ──''',
    flags=re.S,
)

replace_once(
    "server/thisWeekService.ts",
    '''  const actionableProjects = activeProjects.filter(p => {
    const tier = (p as any).actionTier as ActionTier | null;
    const priority = p.priority as "hot" | "warm" | "cold";
    return shouldIncludeInBrief(tier ?? "tier3_monitor", priority);
  });
''',
    '''  const baseActionableProjects = activeProjects.filter(p => {
    const tier = (p as any).actionTier as ActionTier | null;
    const priority = p.priority as "hot" | "warm" | "cold";
    return shouldIncludeInBrief(tier ?? "tier3_monitor", priority);
  });
  const actionableProjects = scopeProjectsToResolvedTerritories(
    baseActionableProjects,
    userContext.territories,
    !userId || userContext.scopeResolved,
  );
''',
)

sub_once(
    "server/thisWeekService.ts",
    r'''  // ── Hard-filter by user's territory and assigned business lines ──\n  // Only apply when user has explicit preferences set\n  const stateKeywords: Record<string, string\[\]> = \{.*?\n  \};\n\n  const locationMatchesTerritories = \(location: string, territories: string\[\]\): boolean => \{.*?\n  \};\n\n  if \(userContext\.territories\.length > 0 \|\| userContext\.assignedBusinessLines\.length > 0\) \{''',
    '''  // ── Hard-filter by assigned business lines ──
  // Territory scope was applied before scoring so out-of-scope projects never influence rank.
  if (userContext.assignedBusinessLines.length > 0) {''',
    flags=re.S,
)

sub_once(
    "server/thisWeekService.ts",
    r'''    rankedProjects = rankedProjects\.filter\(p => \{\n      // Territory check: resolved territories already expanded NATIONAL to all states\n      if \(userContext\.territories\.length > 0 && userContext\.territories\.length < 9\) \{.*?\n      \}\n\n      // BL check:''',
    '''    rankedProjects = rankedProjects.filter(p => {
      // BL check:''',
    flags=re.S,
)

# ── Closing Soon: fail closed and reuse the same projectState-first scope ──────
sub_once(
    "server/routers.ts",
    r'''        // Load user profile for lane gate \+ territory filter\n        let profile: any = null;\n        try \{\n          profile = await getProfileByUserId\(ctx\.user\.id\);\n        \} catch \{ /\* continue without profile \*/ \}\n\n        if \(!profile\) return rows\.slice\(0, 10\); // no profile = return raw top 10\n\n        const resolved = resolveUserProfile\(\{\n          territories: profile\.territories,\n          assignedBusinessLines: profile\.assignedBusinessLines,\n          sectorFocus: profile\.sectorFocus,\n        \}\);\n\n        // Territory filter helper\n        const stateKeywords: Record<string, string\[\]> = \{.*?\n        \};\n        const locationMatchesTerritories = \(location: string, territories: string\[\]\): boolean => \{.*?\n        \};''',
    '''        // Load user profile for lane gate + territory filter. Personalised
        // tender recommendations fail closed when profile scope is unavailable.
        let profile: any = null;
        try {
          profile = await getProfileByUserId(ctx.user.id);
        } catch {
          return [];
        }

        const { hasConfiguredTerritoryInput, projectMatchesResolvedTerritories } = await import("./commercialTruthGuardrails");
        if (!profile || !hasConfiguredTerritoryInput(profile.territories)) return [];

        const resolved = resolveUserProfile({
          territories: profile.territories,
          assignedBusinessLines: profile.assignedBusinessLines,
          sectorFocus: profile.sectorFocus,
        });
        if (resolved.territories.length === 0) return [];''',
    flags=re.S,
)

replace_once(
    "server/routers.ts",
    '''          // Territory filter (skip if national)
          if (resolved.territories.length > 0 && resolved.territories.length < 8) {
            if (!locationMatchesTerritories(p.location, resolved.territories)) return false;
          }
''',
    '''          // Project state is authoritative; location is a controlled fallback.
          if (!projectMatchesResolvedTerritories({
            projectState: (p as any).projectState ?? null,
            location: p.location,
          }, resolved.territories)) return false;
''',
)

# ── Portable Air: suppress generic accommodation unless an explicit package ──
replace_once(
    "server/laneScoring.ts",
    '''  // ── Hard suppression: negative signals ──
  // These project types have no credible portable air direct-sale path.
''',
    '''  // ── Hard suppression: generic accommodation ──
  // AI-inferred equipmentSignals cannot rescue building-only accommodation work.
  // A separately stated compressed-air package in project text may proceed.
  const accommodationProjectPattern = /\\b(student accommodation|student housing|university accommodation|university housing|dormitory|dormitories|apartment development|residential accommodation)\\b/i;
  const explicitAccommodationAirPackage = /\\b(compressed air package|portable air package|air compressor package|compressor package|portable compressor|\\d{2,4}\\s*(?:cfm|psi)|pneumatic work package|abrasive blasting package)\\b/i.test(textWithoutEquipment);
  if (accommodationProjectPattern.test(textWithoutEquipment) && !explicitAccommodationAirPackage) {
    return { pass: false, reason: "student/residential accommodation — no explicit portable air package", suppressionLevel: "suppress" };
  }

  // ── Hard suppression: negative signals ──
  // These project types have no credible portable air direct-sale path.
''',
)

replace_once(
    "server/laneScoring.ts",
    '[\\b(residential|apartment|townhouse|housing estate|retirement village|social housing|affordable housing)\\b/, "residential development — no portable air demand"],',
    '[\\b(residential|townhouse|housing estate|retirement village|social housing|affordable housing)\\b/, "residential development — no portable air demand"],',
)

replace_once(
    "server/laneScoring.ts",
    '''  if (/\\b(university|college)\\b/.test(nameText)) {
    return { pass: false, reason: 'university/college project — no portable air demand', suppressionLevel: 'suppress' };
  }
''',
    '''  if (/\\b(university|college)\\b/.test(nameText) && !explicitAccommodationAirPackage) {
    return { pass: false, reason: 'university/college project — no portable air demand', suppressionLevel: 'suppress' };
  }
''',
)

# ── Account resolver: composite parsing and token hardening ───────────────────
replace_once(
    "server/fullPotentialAccountMatching.shared.ts",
    '''  "operations",
  "the",
  "and",
]);
''',
    '''  "operations",
  "joint",
  "venture",
  "jv",
  "alliance",
  "comprising",
  "package",
  "packages",
  "consortium",
  "partner",
  "partners",
  "the",
  "and",
]);
''',
)

replace_once(
    "server/fullPotentialAccountMatching.shared.ts",
    '  reason: "no_match" | "ambiguous_match" | "weak_match";\n',
    '  reason: "no_match" | "ambiguous_match" | "weak_match" | "composite_name";\n',
)

replace_once(
    "server/fullPotentialAccountMatching.shared.ts",
    '''export function significantCompanyTokens(value: unknown): string[] {
  return normalizeCompanyName(value)
    .split(" ")
    .filter(token => token.length >= 3 && !GENERIC_COMPANY_TOKENS.has(token));
}

function hasDistinctiveIdentity(value: string): boolean {
''',
    '''export function significantCompanyTokens(value: unknown): string[] {
  return normalizeCompanyName(value)
    .split(" ")
    .filter(token => token.length >= 3 && !GENERIC_COMPANY_TOKENS.has(token));
}

export interface ParsedContractorIdentity {
  originalName: string;
  isComposite: boolean;
  operatingNames: string[];
  parentNames: string[];
}

function companyInitials(value: string): string {
  return significantCompanyTokens(value).map(token => token[0]).join("").toLowerCase();
}

function splitParentheticalIdentity(value: string): {
  operatingName: string;
  parentName: string | null;
} {
  const match = value.trim().match(/^(.*?)\\s*\\(([^()]+)\\)\\s*$/);
  if (!match) return { operatingName: value.trim(), parentName: null };
  const base = match[1].trim();
  const inside = match[2].trim();
  const normalisedInside = normalizeCompanyName(inside);
  const normalisedBase = normalizeCompanyName(base);
  const metadata = /^asx\\s*:/i.test(inside)
    || normalisedBase.includes(normalisedInside)
    || (normalisedInside.length >= 2
      && normalisedInside.length <= 8
      && !normalisedInside.includes(" ")
      && companyInitials(base) === normalisedInside);
  return metadata
    ? { operatingName: base, parentName: null }
    : { operatingName: base, parentName: inside };
}

function cleanContractorParticipant(value: string): string {
  return value
    .replace(/^\\s*(?:alliance\\s+comprising|consortium\\s+comprising|comprising)\\s+/i, "")
    .replace(/^\\s*(?:and|the)\\s+/i, "")
    .replace(/\\b(?:joint venture|consortium|alliance)\\b\\s*$/i, "")
    .replace(/^[,;\\s]+|[,;\\s]+$/g, "")
    .trim();
}

/**
 * Split multi-party contractor labels before account matching. Parent/group text is
 * retained as lower-confidence context and the whole composite is never fuzzy-matched.
 */
export function parseContractorIdentity(value: unknown): ParsedContractorIdentity {
  const originalName = String(value ?? "").trim();
  if (!originalName) return { originalName, isComposite: false, operatingNames: [], parentNames: [] };

  const hasCompositeMarker = /\\b(joint venture|\\bjv\\b|alliance|consortium|comprising)\\b/i.test(originalName)
    || /[,;]/.test(originalName)
    || /[–—]/.test(originalName);
  const stripped = originalName
    .replace(/^\\s*(?:alliance\\s+comprising|consortium\\s+comprising|comprising)\\s+/i, "")
    .replace(/\\b(?:joint venture|consortium|alliance)\\b\\s*$/i, "")
    .trim();
  const rawParts = hasCompositeMarker
    ? stripped.split(/\\s*,\\s*|\\s*;\\s*|\\s*[–—]\\s*|\\s+and\\s+/i)
    : [stripped];

  const operatingNames: string[] = [];
  const parentNames: string[] = [];
  for (const rawPart of rawParts) {
    const participant = cleanContractorParticipant(rawPart);
    if (!participant) continue;
    const parsed = splitParentheticalIdentity(participant);
    if (parsed.operatingName && !operatingNames.includes(parsed.operatingName)) operatingNames.push(parsed.operatingName);
    if (parsed.parentName && !parentNames.includes(parsed.parentName)) parentNames.push(parsed.parentName);
  }

  return {
    originalName,
    isComposite: hasCompositeMarker || parentNames.length > 0 || operatingNames.length > 1,
    operatingNames,
    parentNames,
  };
}

function hasDistinctiveIdentity(value: string): boolean {
''',
)

replace_once(
    "server/fullPotentialAccountMatching.shared.ts",
    '''  const normalizedCandidate = normalizeCompanyName(candidate.name);
  if (normalizedCandidate.length < 2) {
''',
    '''  const normalizedCandidate = normalizeCompanyName(candidate.name);
  const parsedIdentity = parseContractorIdentity(candidate.name);
  if (parsedIdentity.isComposite) {
    return {
      match: null,
      unresolved: {
        candidateName: candidate.name,
        candidateSource: candidate.source,
        candidateRole: candidate.role,
        relationshipEvidence: candidate.relationshipEvidence,
        reason: "composite_name",
        possibleAccountIds: [],
        bestScore: 0,
      },
    };
  }
  if (normalizedCandidate.length < 2) {
''',
)

replace_once(
    "server/fullPotentialAccountMatching.shared.ts",
    '''function dedupeCandidates(candidates: FullPotentialAccountCandidate[]): FullPotentialAccountCandidate[] {
  const byKey = new Map<string, FullPotentialAccountCandidate>();
  for (const candidate of candidates) {
    const normalized = normalizeCompanyName(candidate.name);
    if (!normalized) continue;
    const key = `${normalized}:${candidate.role}`;
    const existing = byKey.get(key);
    if (!existing || candidateQuality(candidate) > candidateQuality(existing)) byKey.set(key, candidate);
  }
  return [...byKey.values()].sort((a, b) => candidateQuality(b) - candidateQuality(a));
}

export function extractProjectAccountCandidates(
''',
    '''function dedupeCandidates(candidates: FullPotentialAccountCandidate[]): FullPotentialAccountCandidate[] {
  const byKey = new Map<string, FullPotentialAccountCandidate>();
  for (const candidate of candidates) {
    const normalized = normalizeCompanyName(candidate.name);
    if (!normalized) continue;
    const key = `${normalized}:${candidate.role}`;
    const existing = byKey.get(key);
    if (!existing || candidateQuality(candidate) > candidateQuality(existing)) byKey.set(key, candidate);
  }
  return [...byKey.values()].sort((a, b) => candidateQuality(b) - candidateQuality(a));
}

function pushParsedContractorCandidates(
  candidates: FullPotentialAccountCandidate[],
  name: string,
  template: Omit<FullPotentialAccountCandidate, "name">,
): void {
  const parsed = parseContractorIdentity(name);
  const operatingNames = parsed.operatingNames.length > 0 ? parsed.operatingNames : [name.trim()];
  for (const operatingName of operatingNames) {
    candidates.push({
      ...template,
      name: operatingName,
      detail: parsed.isComposite
        ? `${template.detail ?? "Contractor evidence"}; operating participant parsed from “${name}”`
        : template.detail,
    });
  }
  for (const parentName of parsed.parentNames) {
    candidates.push({
      ...template,
      name: parentName,
      role: "unknown",
      relationshipEvidence: "historical",
      confidence: Math.min(Number(template.confidence ?? 55), 60),
      detail: `Parent/group context parsed from “${name}”; validate the operating buying entity`,
    });
  }
}

export function extractProjectAccountCandidates(
''',
)

replace_once(
    "server/fullPotentialAccountMatching.shared.ts",
    '''  if (options.awardedContractor?.trim()) {
    candidates.push({
      name: options.awardedContractor.trim(),
      source: "awarded_project",
      role: "winning_contractor",
      relationshipEvidence: "confirmed",
      confidence: 100,
      state,
      detail: `Winning contractor for ${project.name}`,
    });
  }
''',
    '''  if (options.awardedContractor?.trim()) {
    pushParsedContractorCandidates(candidates, options.awardedContractor.trim(), {
      source: "awarded_project",
      role: "winning_contractor",
      relationshipEvidence: "confirmed",
      confidence: 100,
      state,
      detail: `Winning contractor for ${project.name}`,
    });
  }
''',
)

replace_once(
    "server/fullPotentialAccountMatching.shared.ts",
    '''  for (const linked of options.linkedContractors ?? []) {
    candidates.push({
      name: linked.name,
      source: "contractor_registry",
      role: normalizeRole(linked.role),
      relationshipEvidence: normalizeRelationshipEvidence(linked.status),
      confidence: linked.confidence ?? null,
      state,
      detail: linked.detail ?? null,
    });
    for (const alias of linked.aliases ?? []) {
      candidates.push({
        name: alias,
        source: "contractor_registry",
        role: normalizeRole(linked.role),
        relationshipEvidence: normalizeRelationshipEvidence(linked.status),
        confidence: linked.confidence ?? null,
        state,
        detail: linked.detail ?? null,
      });
    }
  }
''',
    '''  for (const linked of options.linkedContractors ?? []) {
    const template = {
      source: "contractor_registry" as const,
      role: normalizeRole(linked.role),
      relationshipEvidence: normalizeRelationshipEvidence(linked.status),
      confidence: linked.confidence ?? null,
      state,
      detail: linked.detail ?? null,
    };
    pushParsedContractorCandidates(candidates, linked.name, template);
    for (const alias of linked.aliases ?? []) {
      pushParsedContractorCandidates(candidates, alias, template);
    }
  }
''',
)

replace_once(
    "server/fullPotentialAccountMatching.shared.ts",
    '''  for (const contractor of project.contractors ?? []) {
    if (!contractor.name?.trim()) continue;
    candidates.push({
      name: contractor.name.trim(),
      source: "project_contractor",
      role: normalizeRole(contractor.role ?? contractor.detail ?? "contractor"),
      relationshipEvidence: normalizeRelationshipEvidence(contractor.status),
      confidence: contractor.confidence ?? null,
      state,
      detail: contractor.detail ?? null,
    });
  }
''',
    '''  for (const contractor of project.contractors ?? []) {
    if (!contractor.name?.trim()) continue;
    pushParsedContractorCandidates(candidates, contractor.name.trim(), {
      source: "project_contractor",
      role: normalizeRole(contractor.role ?? contractor.detail ?? "contractor"),
      relationshipEvidence: normalizeRelationshipEvidence(contractor.status),
      confidence: contractor.confidence ?? null,
      state,
      detail: contractor.detail ?? null,
    });
  }
''',
)

print("PR63 commercial truth guardrails applied")
