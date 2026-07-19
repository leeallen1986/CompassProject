import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  awardedProjects,
  contactProjects,
  contacts,
  contractorProjectLinks,
  contractorRegistry,
  fullPotentialAccountAliases,
  fullPotentialAccounts,
  fullPotentialActions,
  fullPotentialModels,
  pipelineClaims,
  projects,
} from "../drizzle/schema";
import {
  buildFullPotentialMatchIndex,
  normalizeCompanyName,
  resolveFullPotentialCandidate,
  resolveProjectFullPotentialContext,
  type FullPotentialAccountCandidate,
  type FullPotentialAccountForMatching,
  type FullPotentialAccountRuntimeState,
  type FullPotentialAliasForMatching,
  type FullPotentialMatchIndex,
  type LinkedContractorForFullPotentialMatching,
  type ProjectFullPotentialContext,
  type ProjectLikeForFullPotentialMatching,
} from "./fullPotentialAccountMatching.shared";

const OPEN_ACTION_STATUSES = ["not_started", "in_progress", "contacted", "meeting_booked", "quoted"] as const;
const ACTIVE_PURSUIT_STATUSES = ["identified", "contacted", "meeting_booked", "qualified", "quoted", "deferred"] as const;
const INDEX_TTL_MS = 2 * 60 * 1000;

interface CachedIndex {
  expiresAt: number;
  index: FullPotentialMatchIndex;
}

let cachedIndex: CachedIndex | null = null;

export function clearFullPotentialMatchIndexCache(): void {
  cachedIndex = null;
}

function dateValue(value: Date | string | null | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function buildRuntimeState(
  models: Array<any>,
  actions: Array<any>,
  claims: Array<any>,
): Map<number, FullPotentialAccountRuntimeState> {
  const runtime = new Map<number, FullPotentialAccountRuntimeState>();

  const ensure = (accountId: number): FullPotentialAccountRuntimeState => {
    const existing = runtime.get(accountId) ?? {
      approvedModelId: null,
      approvedModelKey: null,
      approvedModelVersion: null,
      approvedModelPotentialAud: null,
      approvedModelConfidence: null,
      openActionCount: 0,
      nextOpenActionType: null,
      nextOpenActionDueDate: null,
      activePursuitCount: 0,
      activePursuitStatuses: [],
    };
    runtime.set(accountId, existing);
    return existing;
  };

  for (const model of models) {
    const state = ensure(Number(model.accountId));
    if (
      !state.approvedModelId
      || Number(model.versionNumber ?? 0) > Number(state.approvedModelVersion ?? 0)
    ) {
      state.approvedModelId = Number(model.id);
      state.approvedModelKey = model.modelKey ?? null;
      state.approvedModelVersion = Number(model.versionNumber ?? 0);
      state.approvedModelPotentialAud = model.totalPotentialAud ?? null;
      state.approvedModelConfidence = model.confidenceLevel ?? null;
    }
  }

  const actionsByAccount = new Map<number, any[]>();
  for (const action of actions) {
    const accountId = Number(action.accountId);
    const list = actionsByAccount.get(accountId) ?? [];
    list.push(action);
    actionsByAccount.set(accountId, list);
  }
  for (const [accountId, accountActions] of actionsByAccount) {
    const state = ensure(accountId);
    accountActions.sort((a, b) => dateValue(a.dueDate) - dateValue(b.dueDate));
    state.openActionCount = accountActions.length;
    state.nextOpenActionType = accountActions[0]?.actionType ?? null;
    state.nextOpenActionDueDate = accountActions[0]?.dueDate ?? null;
  }

  const claimsByAccount = new Map<number, any[]>();
  for (const claim of claims) {
    if (!claim.sourceAccountId) continue;
    const accountId = Number(claim.sourceAccountId);
    const list = claimsByAccount.get(accountId) ?? [];
    list.push(claim);
    claimsByAccount.set(accountId, list);
  }
  for (const [accountId, accountClaims] of claimsByAccount) {
    const state = ensure(accountId);
    state.activePursuitCount = accountClaims.length;
    state.activePursuitStatuses = [...new Set(accountClaims.map(claim => String(claim.status)))];
  }

  return runtime;
}

export async function loadFullPotentialMatchIndex(forceRefresh = false): Promise<FullPotentialMatchIndex> {
  const now = Date.now();
  if (!forceRefresh && cachedIndex && cachedIndex.expiresAt > now) return cachedIndex.index;

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const [accounts, aliases, models, actions, claims] = await Promise.all([
    db.select().from(fullPotentialAccounts),
    db.select().from(fullPotentialAccountAliases),
    db
      .select()
      .from(fullPotentialModels)
      .where(eq(fullPotentialModels.status, "approved"))
      .orderBy(desc(fullPotentialModels.versionNumber)),
    db
      .select()
      .from(fullPotentialActions)
      .where(inArray(fullPotentialActions.status, [...OPEN_ACTION_STATUSES])),
    db
      .select()
      .from(pipelineClaims)
      .where(
        and(
          inArray(pipelineClaims.status, [...ACTIVE_PURSUIT_STATUSES]),
          inArray(pipelineClaims.sourceType, ["full_potential", "signal", "ai_recommendation", "manual"]),
        ),
      ),
  ]);

  const runtime = buildRuntimeState(models, actions, claims);
  const index = buildFullPotentialMatchIndex(
    accounts as unknown as FullPotentialAccountForMatching[],
    aliases as unknown as FullPotentialAliasForMatching[],
    runtime,
  );
  cachedIndex = { index, expiresAt: now + INDEX_TTL_MS };
  return index;
}

async function loadProjectRelationshipInputs(projectIds: number[]) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  if (projectIds.length === 0) {
    return {
      linkedContractorsByProject: new Map<number, LinkedContractorForFullPotentialMatching[]>(),
      contactCompaniesByProject: new Map<number, string[]>(),
      awardedContractorByProjectName: new Map<string, string>(),
    };
  }

  const [links, contactLinks, awards] = await Promise.all([
    db
      .select()
      .from(contractorProjectLinks)
      .where(inArray(contractorProjectLinks.projectId, projectIds)),
    db
      .select()
      .from(contactProjects)
      .where(inArray(contactProjects.projectId, projectIds)),
    db.select().from(awardedProjects),
  ]);

  const contractorIds = [...new Set(links.map(link => Number(link.contractorId)))];
  const contactIds = [...new Set(contactLinks.map(link => Number(link.contactId)))];
  const [registryRows, contactRows] = await Promise.all([
    contractorIds.length > 0
      ? db.select().from(contractorRegistry).where(inArray(contractorRegistry.id, contractorIds))
      : Promise.resolve([]),
    contactIds.length > 0
      ? db.select().from(contacts).where(inArray(contacts.id, contactIds))
      : Promise.resolve([]),
  ]);

  const registryById = new Map(registryRows.map(row => [Number(row.id), row]));
  const linkedContractorsByProject = new Map<number, LinkedContractorForFullPotentialMatching[]>();
  for (const link of links) {
    const registry = registryById.get(Number(link.contractorId));
    if (!registry) continue;
    const projectId = Number(link.projectId);
    const list = linkedContractorsByProject.get(projectId) ?? [];
    list.push({
      name: registry.canonicalName,
      aliases: registry.aliases ?? [],
      role: link.role ?? registry.primaryRole,
      status: link.status,
      confidence: link.confidence,
      detail: link.detail,
    });
    linkedContractorsByProject.set(projectId, list);
  }

  const contactsById = new Map(contactRows.map(row => [Number(row.id), row]));
  const contactCompaniesByProject = new Map<number, string[]>();
  for (const link of contactLinks) {
    const contact = contactsById.get(Number(link.contactId));
    if (!contact?.company?.trim()) continue;
    const projectId = Number(link.projectId);
    const list = contactCompaniesByProject.get(projectId) ?? [];
    list.push(contact.company.trim());
    contactCompaniesByProject.set(projectId, [...new Set(list)]);
  }

  const awardedContractorByProjectName = new Map<string, string>();
  for (const award of awards) {
    const key = normalizeCompanyName(award.project);
    if (key && award.winningContractor?.trim()) {
      awardedContractorByProjectName.set(key, award.winningContractor.trim());
    }
  }

  return { linkedContractorsByProject, contactCompaniesByProject, awardedContractorByProjectName };
}

export async function enrichProjectsWithFullPotentialContext<T extends ProjectLikeForFullPotentialMatching>(
  projectRows: T[],
  options: { forceIndexRefresh?: boolean } = {},
): Promise<Array<T & { fullPotentialContext: ProjectFullPotentialContext }>> {
  if (projectRows.length === 0) return [];
  const projectIds = [...new Set(projectRows.map(project => Number(project.id)).filter(Number.isFinite))];
  const [index, relationships] = await Promise.all([
    loadFullPotentialMatchIndex(options.forceIndexRefresh ?? false),
    loadProjectRelationshipInputs(projectIds),
  ]);

  return projectRows.map(project => ({
    ...project,
    fullPotentialContext: resolveProjectFullPotentialContext(project, index, {
      linkedContractors: relationships.linkedContractorsByProject.get(Number(project.id)) ?? [],
      contactCompanies: relationships.contactCompaniesByProject.get(Number(project.id)) ?? [],
      awardedContractor: relationships.awardedContractorByProjectName.get(normalizeCompanyName(project.name)) ?? null,
    }),
  }));
}

export async function getProjectFullPotentialContext(projectId: number): Promise<{
  project: any;
  context: ProjectFullPotentialContext;
}> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  const [enriched] = await enrichProjectsWithFullPotentialContext([
    project as unknown as ProjectLikeForFullPotentialMatching,
  ]);
  return { project, context: enriched.fullPotentialContext };
}

export async function getProjectFullPotentialContexts(projectIds: number[]): Promise<Array<{
  projectId: number;
  context: ProjectFullPotentialContext;
}>> {
  const uniqueIds = [...new Set(projectIds)].filter(id => Number.isInteger(id) && id > 0);
  if (uniqueIds.length === 0) return [];
  if (uniqueIds.length > 250) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A maximum of 250 project IDs may be resolved at once" });
  }

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const rows = await db.select().from(projects).where(inArray(projects.id, uniqueIds));
  const enriched = await enrichProjectsWithFullPotentialContext(
    rows as unknown as ProjectLikeForFullPotentialMatching[],
  );
  const contextById = new Map(enriched.map(row => [Number(row.id), row.fullPotentialContext]));
  return uniqueIds.map(projectId => ({
    projectId,
    context: contextById.get(projectId) ?? {
      primaryMatch: null,
      matches: [],
      unresolvedCandidates: [],
      candidateCount: 0,
      confirmedCount: 0,
      likelyCount: 0,
    },
  }));
}

export async function getAwardedProjectFullPotentialContexts(limit = 250): Promise<Array<{
  awardedProject: any;
  context: ProjectFullPotentialContext;
}>> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const [index, awards] = await Promise.all([
    loadFullPotentialMatchIndex(),
    db.select().from(awardedProjects).orderBy(desc(awardedProjects.createdAt)).limit(safeLimit),
  ]);

  return awards.map(award => ({
    awardedProject: award,
    context: resolveProjectFullPotentialContext(
      {
        id: award.id,
        name: award.project,
        owner: null,
        location: award.location,
        projectState: award.location,
        sourcePurpose: "awarded",
        lifecycleStatus: "awarded",
        contractors: [],
      },
      index,
      { awardedContractor: award.winningContractor },
    ),
  }));
}

export async function resolveFullPotentialAccountName(
  name: string,
  options: {
    state?: string | null;
    source?: FullPotentialAccountCandidate["source"];
    role?: FullPotentialAccountCandidate["role"];
    relationshipEvidence?: FullPotentialAccountCandidate["relationshipEvidence"];
    confidence?: number | null;
  } = {},
) {
  const index = await loadFullPotentialMatchIndex();
  return resolveFullPotentialCandidate(
    {
      name,
      source: options.source ?? "project_owner",
      role: options.role ?? "project_owner",
      relationshipEvidence: options.relationshipEvidence ?? "confirmed",
      confidence: options.confidence ?? 90,
      state: options.state ?? null,
    },
    index,
  );
}
