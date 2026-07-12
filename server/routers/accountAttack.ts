/**
 * Account Attack Router — Phase 1
 * Internal-data-first account-planning queries.
 * No AI calls. No external scraping. No web search.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  projects, contacts, contactProjects,
  contractorRegistry, contractorProjectLinks, contractorPairings,
  pipelineClaims, outreachEmails,
  collateralItems, collateralProjectMatches,
} from "../../drizzle/schema";
import { eq, and, sql, desc, inArray, like, or, isNull, isNotNull } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";

// ── Dirty-owner patterns (Fix 2) ──
// Block LLM-generated guess strings from appearing in the typeahead.
// These patterns match uncertainty markers written by the LLM during enrichment.
const DIRTY_OWNER_PATTERNS = [
  /^unknown$/i,                        // exact "Unknown"
  /^unknown\s*\(/i,                    // "Unknown ("
  /^various\s*\(/i,                    // "Various ("
  /\blikely\b/i,                       // "... (likely Fortescue ...)"
  /\be\.g\./i,                         // "... (e.g., ...)"
  /\bpossibly\b/i,                     // "... (possibly ...)"
  /\bprobably\b/i,                     // "... (probably ...)"
  /\bor similar\b/i,                   // "... or similar entity"
  /\bsimilar entity\b/i,
  /\bstate-backed\b/i,
  /\bgovernment called in\b/i,
  /\binitiative\b.*\bgovernment\b/i,
];

function isDirtyOwner(owner: string): boolean {
  if (owner.length > 80) return true; // LLM guess strings are typically long
  return DIRTY_OWNER_PATTERNS.some(pattern => pattern.test(owner));
}

// ── Account search (typeahead) ──
// Returns merged results from project owners AND contractor registry,
// so contractor-type accounts like DDH1 Drilling appear in the typeahead.
const accountSearch = protectedProcedure
  .input(z.object({ query: z.string().min(1).max(200) }))
  .query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];

    const q = input.query.toLowerCase();

    // ── Source 1: Project owners ──
    const ownerResults = await db
      .selectDistinct({ owner: projects.owner })
      .from(projects)
      .where(
        and(
          sql`${projects.owner} IS NOT NULL`,
          sql`${projects.owner} != ''`,
          sql`LOWER(${projects.owner}) LIKE ${`%${q}%`}`
        )
      )
      .limit(50);

    const ownerNames = ownerResults
      .map(r => r.owner)
      .filter((o): o is string => !!o && o.length > 0 && !isDirtyOwner(o));

    // ── Source 2: Contractor registry ──
    const contractorResults = await db
      .select({
        canonicalName: contractorRegistry.canonicalName,
        primaryRole: contractorRegistry.primaryRole,
        projectCount: contractorRegistry.projectCount,
      })
      .from(contractorRegistry)
      .where(
        sql`LOWER(${contractorRegistry.canonicalName}) LIKE ${`%${q}%`}`
      )
      .limit(30);

    // Build a set of owner names for deduplication
    const ownerSet = new Set(ownerNames.map(n => n.toLowerCase()));

    // Merge: owner entries first, then contractor entries not already in owner list
    const merged: { name: string; accountKind: 'owner' | 'contractor' }[] = [
      ...ownerNames.map(n => ({ name: n, accountKind: 'owner' as const })),
      ...contractorResults
        .filter(c => !ownerSet.has(c.canonicalName.toLowerCase()))
        .map(c => ({ name: c.canonicalName, accountKind: 'contractor' as const })),
    ];

    return merged
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20);
  });

// ── Load full account data ──
const loadAccountData = protectedProcedure
  .input(z.object({
    accountName: z.string().min(1),
  }))
  .query(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) {
      return {
        account: null,
        opportunities: [],
        stakeholders: [],
        contractors: [],
        contractorPairings: [],
        actionHistory: [],
        collateral: [],
      };
    }

    const accountName = input.accountName;

    // ── 1. All projects for this account (by owner match, AU-only) ──
    const accountProjectsRaw = await db
      .select()
      .from(projects)
      .where(and(
        eq(projects.owner, accountName),
        isNull(projects.geoBlockedReason) // AU-only gate
      ))
      .orderBy(desc(projects.createdAt));
    const accountProjects = accountProjectsRaw;

    if (accountProjects.length === 0) {
      // ── Contractor-mode fallback ──
      // If no projects found as owner, check if the account is a contractor in the registry.
      // If so, load the projects they appear on via contractorProjectLinks.
      const contractorRow = await db
        .select()
        .from(contractorRegistry)
        .where(eq(contractorRegistry.canonicalName, accountName))
        .limit(1);

      if (contractorRow.length > 0) {
        const contractor = contractorRow[0];
        // Get all project links for this contractor
        const links = await db
          .select()
          .from(contractorProjectLinks)
          .where(eq(contractorProjectLinks.contractorId, contractor.id));

        if (links.length === 0) {
          return { account: null, opportunities: [], stakeholders: [], contractors: [], contractorPairings: [], actionHistory: [], collateral: [] };
        }

        const linkedProjectIds = links.map(l => l.projectId);
        const linkedProjects = await db
          .select()
          .from(projects)
          .where(and(
            inArray(projects.id, linkedProjectIds),
            isNull(projects.geoBlockedReason) // AU-only gate
          ))
          .orderBy(desc(projects.createdAt));

        if (linkedProjects.length === 0) {
          return { account: null, opportunities: [], stakeholders: [], contractors: [], contractorPairings: [], actionHistory: [], collateral: [] };
        }

        // Build summary stats from linked projects
        const sectorCounts: Record<string, number> = {};
        const stateCounts: Record<string, number> = {};
        const laneCounts: Record<string, number> = {};
        const statusCounts: Record<string, number> = { active: 0, stale: 0, archived: 0, awarded: 0, completed: 0 };
        let hotCount = 0, warmCount = 0, coldCount = 0;
        for (const p of linkedProjects) {
          if (p.sector) sectorCounts[p.sector] = (sectorCounts[p.sector] || 0) + 1;
          if (p.location) {
            const stateMatch = p.location.match(/\b(WA|QLD|NSW|VIC|SA|TAS|NT|ACT)\b/i);
            if (stateMatch) { const s = stateMatch[1].toUpperCase(); stateCounts[s] = (stateCounts[s] || 0) + 1; }
          }
          if (p.productLane) laneCounts[p.productLane] = (laneCounts[p.productLane] || 0) + 1;
          else laneCounts["unclassified"] = (laneCounts["unclassified"] || 0) + 1;
          const ls = p.lifecycleStatus || "active";
          statusCounts[ls] = (statusCounts[ls] || 0) + 1;
          if (p.priority === "hot") hotCount++;
          else if (p.priority === "warm") warmCount++;
          else coldCount++;
        }

        // Map contractor primaryRole to accountType label
        const roleToType: Record<string, string> = {
          epc: "EPC / Head Contractor",
          contractor: "Contractor",
          drilling: "Drilling Contractor",
          consultant: "Consultant / Engineer",
          supplier: "Supplier",
          owner: "Owner / Client",
        };
        const contractorAccountType = roleToType[contractor.primaryRole] || "Contractor";

        const contractorAccount = {
          name: accountName,
          accountType: contractorAccountType,
          accountKind: "contractor" as const,
          projectCount: linkedProjects.length,
          hotCount, warmCount, coldCount,
          statusDistribution: statusCounts,
          sectorDistribution: sectorCounts,
          stateDistribution: stateCounts,
          laneDistribution: laneCounts,
          contractorMeta: {
            primaryRole: contractor.primaryRole,
            compositeScore: contractor.compositeScore,
            confirmedCount: contractor.confirmedCount,
          },
        };

        const contractorOpportunities = linkedProjects.map(p => ({
          id: p.id,
          name: p.name,
          location: p.location,
          value: p.value,
          priority: p.priority,
          sector: p.sector,
          productLane: p.productLane,
          stageCode: p.stageCode,
          stage: p.stage,
          overview: p.overview,
          actionTier: p.actionTier,
          lifecycleStatus: p.lifecycleStatus,
          equipmentSignals: p.equipmentSignals,
          contractors: p.contractors,
          sources: p.sources,
          timeline: p.timeline,
          completion: p.completion,
          isNew: p.isNew,
          createdAt: p.createdAt,
          enrichmentBlockedReason: p.enrichmentBlockedReason,
          govFallbackStatus: p.govFallbackStatus,
          tenderCloseDate: p.tenderCloseDate,
          keepFlag: p.keepFlag,
          // Annotate with this contractor's role on the project
          contractorRole: links.find(l => l.projectId === p.id)?.role ?? null,
        }));

        // Fetch pairings for this contractor
        const pairingRows = await db
          .select()
          .from(contractorPairings)
          .where(
            or(
              eq(contractorPairings.companyAName, accountName),
              eq(contractorPairings.companyBName, accountName),
            )
          )
          .orderBy(desc(contractorPairings.strengthScore))
          .limit(10);

        return {
          account: contractorAccount,
          opportunities: contractorOpportunities,
          stakeholders: [],
          contractors: [],
          contractorPairings: pairingRows.map(p => ({
            id: p.id,
            companyAName: p.companyAName,
            companyARoleInPairing: p.companyARoleInPairing,
            companyBName: p.companyBName,
            companyBRoleInPairing: p.companyBRoleInPairing,
            pairingType: p.pairingType,
            coOccurrenceCount: p.coOccurrenceCount,
            strengthScore: p.strengthScore,
          })),
          actionHistory: [],
          collateral: [],
        };
      }

      // Not an owner and not a contractor — truly not found
      return {
        account: null,
        opportunities: [],
        stakeholders: [],
        contractors: [],
        contractorPairings: [],
        actionHistory: [],
        collateral: [],
      };
    }

    const projectIds = accountProjects.map(p => p.id);

    // ── 2. Account header summary ──
    const sectorCounts: Record<string, number> = {};
    const stateCounts: Record<string, number> = {};
    const laneCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = { active: 0, stale: 0, archived: 0, awarded: 0, completed: 0 };
    let hotCount = 0;
    let warmCount = 0;
    let coldCount = 0;

    for (const p of accountProjects) {
      if (p.sector) sectorCounts[p.sector] = (sectorCounts[p.sector] || 0) + 1;
      if (p.location) {
        // Extract state abbreviation from location
        const stateMatch = p.location.match(/\b(WA|QLD|NSW|VIC|SA|TAS|NT|ACT)\b/i);
        if (stateMatch) {
          const state = stateMatch[1].toUpperCase();
          stateCounts[state] = (stateCounts[state] || 0) + 1;
        }
      }
      if (p.productLane) laneCounts[p.productLane] = (laneCounts[p.productLane] || 0) + 1;
      else laneCounts["unclassified"] = (laneCounts["unclassified"] || 0) + 1;

      const ls = p.lifecycleStatus || "active";
      statusCounts[ls] = (statusCounts[ls] || 0) + 1;

      if (p.priority === "hot") hotCount++;
      else if (p.priority === "warm") warmCount++;
      else coldCount++;
    }

    // Infer account type from owner patterns + enrichmentBlockedReason
    const ownerLower = accountName.toLowerCase();
    const hasGovBlockedProject = accountProjects.some(
      p => p.enrichmentBlockedReason === "blocked_government_owner_manual_discovery"
    );
    let accountType: string = "Private Company";
    if (
      hasGovBlockedProject ||
      /government|department|authority|commission|council|state\s|federal|nt\s|nsw\s|qld\s|wa\s|sa\s|vic\s|tas\s|corporation|hydro\s|water\s|power\s.*water|main\s*roads|transport/i.test(ownerLower)
    ) {
      accountType = "Government / Public Body";
    } else if (/university|institute|csiro|research/i.test(ownerLower)) {
      accountType = "Research / Academic";
    } else if (/bhp|rio\s*tinto|fortescue|glencore|anglo\s*american|newmont|south32/i.test(ownerLower)) {
      accountType = "Major Mining Company";
    } else if (/santos|woodside|chevron|shell|bp\b|origin|ampol/i.test(ownerLower)) {
      accountType = "Energy / Oil & Gas";
    }

    const account = {
      name: accountName,
      accountType,
      projectCount: accountProjects.length,
      hotCount,
      warmCount,
      coldCount,
      statusDistribution: statusCounts,
      sectorDistribution: sectorCounts,
      stateDistribution: stateCounts,
      laneDistribution: laneCounts,
    };

    // ── 3. Opportunities (projects with enriched fields) ──
    const opportunities = accountProjects.map(p => ({
      id: p.id,
      name: p.name,
      location: p.location,
      value: p.value,
      priority: p.priority,
      sector: p.sector,
      productLane: p.productLane,
      stageCode: p.stageCode,
      stage: p.stage,
      overview: p.overview,
      actionTier: p.actionTier,
      lifecycleStatus: p.lifecycleStatus,
      equipmentSignals: p.equipmentSignals,
      contractors: p.contractors,
      sources: p.sources,
      timeline: p.timeline,
      completion: p.completion,
      isNew: p.isNew,
      createdAt: p.createdAt,
      // actionabilityScore not in schema — omitted
      enrichmentBlockedReason: p.enrichmentBlockedReason,
      govFallbackStatus: p.govFallbackStatus,
      tenderCloseDate: p.tenderCloseDate,
      keepFlag: p.keepFlag,
    }));

    // ── 4. Known stakeholders (contacts linked to account projects) ──
    let stakeholders: {
      id: number;
      name: string;
      title: string | null;
      company: string | null;
      email: string | null;
      linkedin: string | null;
      roleRelevance: string | null;
      enrichmentSource: string | null;
      verifiedByUser: boolean | null;
      linkedProjectIds: number[];
      linkedProjectNames: string[];
    }[] = [];

    if (projectIds.length > 0) {
      // Get all contact-project links for these projects
      const cpLinks = await db
        .select({
          contactId: contactProjects.contactId,
          projectId: contactProjects.projectId,
        })
        .from(contactProjects)
        .where(inArray(contactProjects.projectId, projectIds));

      if (cpLinks.length > 0) {
        const contactIds = Array.from(new Set(cpLinks.map(l => l.contactId)));

        const contactRows = await db
          .select()
          .from(contacts)
          .where(inArray(contacts.id, contactIds));

        // Build a map of contactId -> linked projects
        const contactProjectMap = new Map<number, number[]>();
        for (const link of cpLinks) {
          if (!contactProjectMap.has(link.contactId)) {
            contactProjectMap.set(link.contactId, []);
          }
          contactProjectMap.get(link.contactId)!.push(link.projectId);
        }

        // Build project name lookup
        const projectNameMap = new Map<number, string>();
        for (const p of accountProjects) {
          projectNameMap.set(p.id, p.name);
        }

        stakeholders = contactRows.map(c => ({
          id: c.id,
          name: c.name,
          title: c.title,
          company: c.company,
          email: c.email,
          linkedin: c.linkedin,
          roleRelevance: c.roleRelevance,
          enrichmentSource: c.enrichmentSource,
          verifiedByUser: c.verifiedByUserId ? true : false,
          linkedProjectIds: contactProjectMap.get(c.id) || [],
          linkedProjectNames: (contactProjectMap.get(c.id) || [])
            .map(pid => projectNameMap.get(pid) || `Project #${pid}`)
            .slice(0, 3), // cap at 3 for display
        }));
      }
    }

    // ── 5. Contractor & delivery chain ──
    let contractorData: {
      id: number;
      name: string;
      primaryRole: string;
      projectCount: number;
      confirmedCount: number;
      sectorBreakdown: Record<string, number> | null;
      stateBreakdown: Record<string, number> | null;
      compositeScore: number | null;
      linkedProjects: { projectId: number; projectName: string; role: string; status: string }[];
    }[] = [];

    let pairingData: {
      id: number;
      companyAName: string;
      companyARoleInPairing: string;
      companyBName: string;
      companyBRoleInPairing: string;
      pairingType: string;
      coOccurrenceCount: number;
      strengthScore: number | null;
    }[] = [];

    if (projectIds.length > 0) {
      // Find contractors linked to account projects
      const contractorLinks = await db
        .select({
          contractorId: contractorProjectLinks.contractorId,
          projectId: contractorProjectLinks.projectId,
          role: contractorProjectLinks.role,
          status: contractorProjectLinks.status,
        })
        .from(contractorProjectLinks)
        .where(inArray(contractorProjectLinks.projectId, projectIds));

      if (contractorLinks.length > 0) {
        const contractorIds = Array.from(new Set(contractorLinks.map(l => l.contractorId)));

        const contractorRows = await db
          .select()
          .from(contractorRegistry)
          .where(inArray(contractorRegistry.id, contractorIds));

        const projectNameMap = new Map<number, string>();
        for (const p of accountProjects) {
          projectNameMap.set(p.id, p.name);
        }

        // Fix 4: Exclude owner-role entries from the contractor chain.
        // The account owner is already shown in the header — listing them again in
        // the contractor chain is noise and inflates the count.
        const nonOwnerContractorRows = contractorRows.filter(c => c.primaryRole !== 'owner');

        contractorData = nonOwnerContractorRows.map(c => ({
          id: c.id,
          name: c.canonicalName,
          primaryRole: c.primaryRole,
          projectCount: c.projectCount,
          confirmedCount: c.confirmedCount,
          sectorBreakdown: c.sectorBreakdown,
          stateBreakdown: c.stateBreakdown,
          compositeScore: c.compositeScore,
          linkedProjects: contractorLinks
            .filter(l => l.contractorId === c.id)
            .map(l => ({
              projectId: l.projectId,
              projectName: projectNameMap.get(l.projectId) || `Project #${l.projectId}`,
              role: l.role,
              status: l.status,
            })),
        }));

        // Find pairings involving the account owner
        const pairingRows = await db
          .select()
          .from(contractorPairings)
          .where(
            or(
              eq(contractorPairings.companyAName, accountName),
              eq(contractorPairings.companyBName, accountName),
              inArray(contractorPairings.companyAId, contractorIds),
              inArray(contractorPairings.companyBId, contractorIds),
            )
          )
          .orderBy(desc(contractorPairings.strengthScore))
          .limit(10);

        pairingData = pairingRows.map(p => ({
          id: p.id,
          companyAName: p.companyAName,
          companyARoleInPairing: p.companyARoleInPairing,
          companyBName: p.companyBName,
          companyBRoleInPairing: p.companyBRoleInPairing,
          pairingType: p.pairingType,
          coOccurrenceCount: p.coOccurrenceCount,
          strengthScore: p.strengthScore,
        }));
      }
    }

    // ── 6. Action history (outreach emails for account projects) ──
    let actionHistory: {
      id: number;
      contactName: string;
      projectName: string | null;
      subject: string;
      tone: string;
      status: string;
      createdAt: Date;
      userId: number;
    }[] = [];

    if (projectIds.length > 0) {
      const outreachRows = await db
        .select()
        .from(outreachEmails)
        .where(inArray(outreachEmails.projectId, projectIds))
        .orderBy(desc(outreachEmails.createdAt))
        .limit(20);

      actionHistory = outreachRows.map(r => ({
        id: r.id,
        contactName: r.contactName,
        projectName: r.projectName,
        subject: r.subject,
        tone: r.tone,
        status: r.status,
        createdAt: r.createdAt,
        userId: r.userId,
      }));
    }

    // ── 7. Collateral matches ──
    let collateral: {
      id: number;
      name: string;
      productLine: string;
      fileUrl: string;
      description: string | null;
      matchedProjectId: number;
      matchedProjectName: string;
      matchScore: number;
    }[] = [];

    if (projectIds.length > 0) {
      const matchRows = await db
        .select({
          matchId: collateralProjectMatches.id,
          collateralId: collateralProjectMatches.collateralId,
          projectId: collateralProjectMatches.projectId,
          matchScore: collateralProjectMatches.matchScore,
        })
        .from(collateralProjectMatches)
        .where(inArray(collateralProjectMatches.projectId, projectIds))
        .orderBy(desc(collateralProjectMatches.matchScore))
        .limit(20);

      if (matchRows.length > 0) {
        const collateralIds = Array.from(new Set(matchRows.map(m => m.collateralId)));
        const collateralRows = await db
          .select()
          .from(collateralItems)
          .where(inArray(collateralItems.id, collateralIds));

        const collateralMap = new Map(collateralRows.map(c => [c.id, c]));
        const projectNameMap = new Map(accountProjects.map(p => [p.id, p.name]));

        collateral = matchRows
          .map(m => {
            const item = collateralMap.get(m.collateralId);
            if (!item) return null;
            return {
              id: item.id,
              name: item.name,
              productLine: item.productLine,
              fileUrl: item.fileUrl,
              description: item.description,
              matchedProjectId: m.projectId,
              matchedProjectName: projectNameMap.get(m.projectId) || `Project #${m.projectId}`,
              matchScore: m.matchScore,
            };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);
      }
    }

    // ── 8. Pipeline claims for this account's projects ──
    let pipelineClaimRows: {
      id: number;
      projectId: number;
      projectName: string;
      userId: number;
      status: string;
      notes: string | null;
      createdAt: Date;
    }[] = [];

    if (projectIds.length > 0) {
      const claims = await db
        .select()
        .from(pipelineClaims)
        .where(and(
          // Only include project-sourced claims — FP-sourced claims have null projectId
          // and are rendered separately via the FP workspace, not here.
          isNotNull(pipelineClaims.projectId),
          inArray(pipelineClaims.projectId, projectIds),
        ))
        .orderBy(desc(pipelineClaims.createdAt));

      const projectNameMap = new Map(accountProjects.map(p => [p.id, p.name]));

      pipelineClaimRows = claims.map(c => ({
        id: c.id,
        projectId: c.projectId!,
        projectName: projectNameMap.get(c.projectId!) || `Project #${c.projectId}`,
        userId: c.userId,
        status: c.status,
        notes: c.notes,
        createdAt: c.createdAt,
      }));
    }

    return {
      account,
      opportunities,
      stakeholders,
      contractors: contractorData,
      contractorPairings: pairingData,
      actionHistory: [...actionHistory, ...pipelineClaimRows.map(c => ({
        id: c.id,
        contactName: `Pipeline: ${c.status}`,
        projectName: c.projectName,
        subject: c.notes || `Pipeline claim: ${c.status}`,
        tone: "pipeline_claim" as const,
        status: c.status,
        createdAt: c.createdAt,
        userId: c.userId,
      }))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      collateral,
    };
  });

// ── Suggest close matches for no-match state ──
// Returns up to 5 fuzzy-matched Atlas accounts for a query that returned no exact match.
// Used to show "Did you mean?" suggestions before offering External Prospect Mode.
const suggestCloseMatches = protectedProcedure
  .input(z.object({ query: z.string().min(1).max(200) }))
  .query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];

    const q = input.query.toLowerCase();
    // Extract first significant word (3+ chars) for broader fuzzy match
    const words = q.split(/\s+/).filter(w => w.length >= 3);
    if (words.length === 0) return [];

    const suggestions: { name: string; accountKind: 'owner' | 'contractor'; matchReason: string }[] = [];
    const seen = new Set<string>();

    // Try each significant word as a LIKE match
    for (const word of words.slice(0, 3)) {
      const ownerRows = await db
        .selectDistinct({ owner: projects.owner })
        .from(projects)
        .where(
          and(
            sql`${projects.owner} IS NOT NULL`,
            sql`${projects.owner} != ''`,
            sql`LOWER(${projects.owner}) LIKE ${`%${word}%`}`
          )
        )
        .limit(10);

      for (const r of ownerRows) {
        if (r.owner && !seen.has(r.owner.toLowerCase()) && !isDirtyOwner(r.owner)) {
          seen.add(r.owner.toLowerCase());
          suggestions.push({ name: r.owner, accountKind: 'owner', matchReason: `Matches "${word}"` });
        }
      }

      const contractorRows = await db
        .select({ canonicalName: contractorRegistry.canonicalName })
        .from(contractorRegistry)
        .where(sql`LOWER(${contractorRegistry.canonicalName}) LIKE ${`%${word}%`}`)
        .limit(10);

      for (const r of contractorRows) {
        if (!seen.has(r.canonicalName.toLowerCase())) {
          seen.add(r.canonicalName.toLowerCase());
          suggestions.push({ name: r.canonicalName, accountKind: 'contractor', matchReason: `Matches "${word}"` });
        }
      }
    }

    return suggestions.slice(0, 6);
  });

// ── External Prospect Mode ──
// Runs a bounded LLM synthesis for accounts NOT found in Atlas.
// Output is clearly labelled as external / not Atlas-verified.
const runExternalProspect = protectedProcedure
  .input(z.object({
    companyName: z.string().min(1).max(200),
    industry: z.string().optional(),
    region: z.string().optional(),
    objective: z.enum(['general', 'map_stakeholders', 'pursue_tender', 'explore_cross_sell', 'meeting_prep']).optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    const systemPrompt = `You are a B2B sales intelligence assistant for Atlas Copco Power Technique (PT).
Atlas Copco PT sells portable air compressors, pumps/dewatering, BESS, PAL, and nitrogen equipment into mining, oil & gas, infrastructure, energy, and defence sectors.

You are being asked to research a company that does NOT yet exist in the Atlas Copco internal project database.
This is an EXTERNAL PROSPECT — treat all output as externally-sourced intelligence, not Atlas-verified data.

Your task: produce a structured prospect brief for the company below.
Be honest about what you know vs. what is inferred. Do NOT fabricate specific contacts, emails, or phone numbers.
Label every claim with a confidence level: HIGH (well-known public fact), MEDIUM (reasonable inference), or LOW (speculative).

Return a JSON object matching this exact schema (no extra keys):
{
  "companyOverview": {
    "description": "string — 2-3 sentence company description",
    "industry": "string",
    "region": "string",
    "estimatedSize": "string — e.g. Large Enterprise / Mid-Market / SME",
    "publiclyListed": "boolean | null",
    "confidence": "HIGH | MEDIUM | LOW"
  },
  "relevanceToAtlasCopco": {
    "summary": "string — why this company might need PT equipment",
    "likelyEquipmentNeeds": ["string"],
    "estimatedOpportunitySize": "string — e.g. $500K-$2M annually",
    "confidence": "HIGH | MEDIUM | LOW"
  },
  "knownProjects": [
    {
      "name": "string",
      "description": "string",
      "status": "string",
      "region": "string",
      "confidence": "HIGH | MEDIUM | LOW"
    }
  ],
  "stakeholderGuidance": {
    "typicalBuyingRoles": ["string — e.g. Fleet Manager, Project Manager, Procurement"],
    "suggestedEntryPoints": ["string — e.g. LinkedIn search for Operations Director"],
    "warningFlags": ["string — e.g. May have preferred supplier agreements"]
  },
  "recommendedActions": [
    {
      "action": "string",
      "rationale": "string",
      "confidence": "HIGH | MEDIUM | LOW",
      "isVerified": false
    }
  ],
  "dataQualityWarning": "string — honest statement about data limitations for this company"
}`;

    const userPrompt = `Company: ${input.companyName}
Industry: ${input.industry || 'Unknown'}
Region: ${input.region || 'Australia'}
Objective: ${input.objective || 'general'}

Produce the external prospect brief for this company.`;

    try {
      const response = await invokeLLM({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      });

      const rawContent = response?.choices?.[0]?.message?.content;
      if (!rawContent) throw new Error('Empty LLM response');
      const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

      const parsed = JSON.parse(content);
      return {
        success: true as const,
        companyName: input.companyName,
        sourceLabel: 'EXTERNAL — Not Atlas-verified' as const,
        generatedAt: new Date().toISOString(),
        result: parsed,
      };
    } catch (err) {
      return {
        success: false as const,
        companyName: input.companyName,
        sourceLabel: 'EXTERNAL — Not Atlas-verified' as const,
        generatedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Unknown error',
        result: null,
      };
    }
  });

export const accountAttackRouter = router({
  search: accountSearch,
  loadAccountData,
  suggestCloseMatches,
  runExternalProspect,
});
