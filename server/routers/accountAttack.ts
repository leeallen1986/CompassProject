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
import { eq, and, sql, desc, inArray, like, or } from "drizzle-orm";

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
const accountSearch = protectedProcedure
  .input(z.object({ query: z.string().min(1).max(200) }))
  .query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];

    // Search distinct owners from projects table
    const results = await db
      .selectDistinct({ owner: projects.owner })
      .from(projects)
      .where(
        and(
          sql`${projects.owner} IS NOT NULL`,
          sql`${projects.owner} != ''`,
          sql`LOWER(${projects.owner}) LIKE ${`%${input.query.toLowerCase()}%`}`
        )
      )
      .limit(50); // fetch more, then filter dirty ones client-side

    return results
      .map(r => r.owner)
      .filter((o): o is string => !!o && o.length > 0 && !isDirtyOwner(o))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 20); // cap at 20 after dirty filtering
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

    // ── 1. All projects for this account (by owner match) ──
    const accountProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.owner, accountName))
      .orderBy(desc(projects.createdAt));

    if (accountProjects.length === 0) {
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
        .where(inArray(pipelineClaims.projectId, projectIds))
        .orderBy(desc(pipelineClaims.createdAt));

      const projectNameMap = new Map(accountProjects.map(p => [p.id, p.name]));

      pipelineClaimRows = claims.map(c => ({
        id: c.id,
        projectId: c.projectId,
        projectName: projectNameMap.get(c.projectId) || `Project #${c.projectId}`,
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

export const accountAttackRouter = router({
  search: accountSearch,
  loadAccountData,
});
