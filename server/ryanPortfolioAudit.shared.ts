import type { ProjectBuyerRoute } from "./projectBuyerRoute";

export const RYAN_PORTFOLIO_CLASSIFICATIONS = [
  "action_ready",
  "right_project_wrong_contact",
  "principal_only",
  "contractor_unmapped",
  "buyer_lane_unmapped",
  "contact_evidence_hidden",
  "unsafe_outreach_exposed",
  "product_fit_unproven",
] as const;

export type RyanPortfolioClassification =
  (typeof RYAN_PORTFOLIO_CLASSIFICATIONS)[number];

export interface RyanPortfolioAuditProject {
  rank: number;
  id: number;
  name: string;
  owner: string;
  priority: string;
  actionTier: string | null;
  relevanceScore: number;
  laneFitLabel: "High" | "Medium" | "Low" | "Not relevant";
  airFit: "High" | "Medium" | "Low" | "None";
  bestProductAngle: string;
  equipmentSignals: string[] | null;
  detectedActivities: string[];
  routeToBuy: string;
  bestNextMove: string;
  contactCTAAction: string;
  bestStakeholder: {
    name: string;
    company: string;
    email: string | null;
  } | null;
}

export interface RyanPortfolioAuditInput {
  project: RyanPortfolioAuditProject;
  dossier: ProjectBuyerRoute | null;
}

export interface RyanPortfolioAuditMetrics {
  productFitProven: boolean;
  packageHolderCount: number;
  exactContactCount: number;
  namedContactCount: number;
  effectiveSendReadyCount: number;
  buyerLaneContactCount: number;
  effectiveBuyerContactCount: number;
  principalOrReferralContactCount: number;
  unsafeOutreachExposed: boolean;
  contactEvidenceHidden: boolean;
}

export interface RyanPortfolioAuditRow {
  projectId: number;
  projectName: string;
  thisWeekRank: number;
  priority: string;
  actionTier: string | null;
  relevanceScore: number;
  primaryClassification: RyanPortfolioClassification;
  flags: RyanPortfolioClassification[];
  severity: number;
  reasons: string[];
  correctiveActions: string[];
  metrics: RyanPortfolioAuditMetrics;
  cardState: {
    contactCTAAction: string;
    bestStakeholderShown: boolean;
    bestStakeholderEmailShown: boolean;
  };
}

export interface RyanPortfolioAuditReport {
  generatedAt: string;
  rep: {
    userId: number;
    name: string;
  };
  weekLabel: string;
  sourceProjectCount: number;
  summary: {
    primaryClassifications: Record<RyanPortfolioClassification, number>;
    flagCounts: Record<RyanPortfolioClassification, number>;
    actionReadyCount: number;
    projectsRequiringCorrection: number;
  };
  rows: RyanPortfolioAuditRow[];
  worst15: RyanPortfolioAuditRow[];
}

const BUYER_LANES = new Set(["contractor", "commercial", "technical"]);
const PRINCIPAL_OR_REFERRAL_LANES = new Set(["principal", "referral"]);

const CLASSIFICATION_SEVERITY: Record<RyanPortfolioClassification, number> = {
  unsafe_outreach_exposed: 100,
  contact_evidence_hidden: 90,
  contractor_unmapped: 80,
  principal_only: 75,
  buyer_lane_unmapped: 70,
  right_project_wrong_contact: 60,
  product_fit_unproven: 40,
  action_ready: 0,
};

const CLASSIFICATION_REASON: Record<RyanPortfolioClassification, string> = {
  unsafe_outreach_exposed:
    "The card exposes a contactable state without an exact-linked effectively send-ready contact supporting that action.",
  contact_evidence_hidden:
    "Exact-linked contact evidence exists in the dossier but the This Week card does not surface the corresponding contact or validation state.",
  contractor_unmapped:
    "The project has credible product fit but no recorded contractor or package-holder route.",
  principal_only:
    "The available exact-linked contacts are limited to principal or referral lanes; the equipment-buying route is not mapped.",
  buyer_lane_unmapped:
    "A contractor/package route is recorded, but no exact-linked contractor, commercial or technical contact lane is mapped.",
  right_project_wrong_contact:
    "The project has credible product fit, but no exact-linked buyer-lane contact is effectively send-ready.",
  product_fit_unproven:
    "Persisted project evidence does not yet prove a sufficiently strong Portable Air application and product angle.",
  action_ready:
    "The project has credible product fit, a recorded package route and an exact-linked effectively send-ready buyer-lane contact.",
};

const CLASSIFICATION_ACTION: Record<RyanPortfolioClassification, string> = {
  unsafe_outreach_exposed:
    "Remove the contactable CTA until the card and server both resolve the same exact-linked effectively send-ready contact.",
  contact_evidence_hidden:
    "Render the dossier's exact-linked contact state on the card and route named-unverified contacts to Validate contacts rather than Find contacts.",
  contractor_unmapped:
    "Confirm the awarded contractor, JV or package holder from evidence; keep the principal as a referral path rather than assuming it buys the equipment.",
  principal_only:
    "Map contractor-side plant/equipment, procurement/commercial or technical/site contacts; retain the principal contact for referral only.",
  buyer_lane_unmapped:
    "Add at least one exact-linked contractor, commercial or technical contact with a visible lane rationale and evidence state.",
  right_project_wrong_contact:
    "Validate or replace the current contact with a buyer-lane contact whose current mailbox satisfies the canonical send-ready policy.",
  product_fit_unproven:
    "Add persisted compressed-air application evidence and a defensible product hypothesis before treating the project as a sales action.",
  action_ready:
    "Proceed with evidence-limited, confirmation-first outreach and preserve the current trust boundary.",
};

function normaliseIdentity(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function meaningfulText(value: string | null | undefined): boolean {
  const compact = value?.trim() ?? "";
  if (!compact) return false;
  return !/^(unknown|none|n\/?a|not available|not recorded|monitor|generic|tbc|tbd)$/i.test(compact);
}

function productFitProven(project: RyanPortfolioAuditProject): boolean {
  const laneFit = project.laneFitLabel === "High" || project.laneFitLabel === "Medium";
  const airFit = project.airFit === "High" || project.airFit === "Medium";
  const persistedApplicationEvidence =
    (project.equipmentSignals ?? []).some(meaningfulText) ||
    project.detectedActivities.some(meaningfulText) ||
    meaningfulText(project.bestProductAngle);
  return laneFit && airFit && persistedApplicationEvidence;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function matchingDossierContact(
  project: RyanPortfolioAuditProject,
  dossier: ProjectBuyerRoute | null,
) {
  const stakeholder = project.bestStakeholder;
  if (!stakeholder || !dossier) return null;
  const targetName = normaliseIdentity(stakeholder.name);
  const targetCompany = normaliseIdentity(stakeholder.company);
  return dossier.contacts.find(contact =>
    normaliseIdentity(contact.name) === targetName &&
    normaliseIdentity(contact.organisation.recordedName) === targetCompany,
  ) ?? null;
}

function primaryClassification(
  flags: RyanPortfolioClassification[],
): RyanPortfolioClassification {
  return [...flags].sort((a, b) =>
    CLASSIFICATION_SEVERITY[b] - CLASSIFICATION_SEVERITY[a]
  )[0] ?? "action_ready";
}

export function classifyRyanPortfolioProject(
  input: RyanPortfolioAuditInput,
): RyanPortfolioAuditRow {
  const { project, dossier } = input;
  const contacts = dossier?.contacts ?? [];
  const packageHolders = (dossier?.packageHolders ?? [])
    .filter(holder => holder.evidenceState !== "not_recorded");
  const namedContacts = contacts.filter(contact => contact.effectiveTrustTier !== "llm_inferred");
  const effectiveContacts = contacts.filter(contact => contact.effectivelySendReady);
  const buyerLaneContacts = namedContacts.filter(contact => BUYER_LANES.has(contact.lane.value));
  const effectiveBuyerContacts = effectiveContacts.filter(contact => BUYER_LANES.has(contact.lane.value));
  const principalOrReferralContacts = namedContacts.filter(contact =>
    PRINCIPAL_OR_REFERRAL_LANES.has(contact.lane.value),
  );
  const projectFit = productFitProven(project);
  const matchedStakeholder = matchingDossierContact(project, dossier);
  const stakeholderEmailShown = Boolean(project.bestStakeholder?.email?.trim());
  const unsafeOutreachExposed =
    (project.contactCTAAction === "view_best" && effectiveContacts.length === 0) ||
    (stakeholderEmailShown && !matchedStakeholder?.effectivelySendReady);
  const cardAcknowledgesEvidence =
    project.bestStakeholder !== null ||
    project.contactCTAAction === "view_best" ||
    project.contactCTAAction === "validate_contacts";
  const contactEvidenceHidden =
    (namedContacts.length > 0 && !cardAcknowledgesEvidence) ||
    (effectiveContacts.length > 0 && project.contactCTAAction !== "view_best");
  const principalOnly =
    projectFit &&
    namedContacts.length > 0 &&
    buyerLaneContacts.length === 0 &&
    principalOrReferralContacts.length === namedContacts.length;
  const contractorUnmapped = projectFit && packageHolders.length === 0;
  const buyerLaneUnmapped =
    projectFit &&
    packageHolders.length > 0 &&
    buyerLaneContacts.length === 0 &&
    !principalOnly;
  const wrongContact =
    projectFit &&
    namedContacts.length > 0 &&
    effectiveBuyerContacts.length === 0;

  const flags: RyanPortfolioClassification[] = [];
  if (unsafeOutreachExposed) flags.push("unsafe_outreach_exposed");
  if (!projectFit) {
    flags.push("product_fit_unproven");
  } else {
    if (contactEvidenceHidden) flags.push("contact_evidence_hidden");
    if (contractorUnmapped) flags.push("contractor_unmapped");
    if (principalOnly) flags.push("principal_only");
    if (buyerLaneUnmapped) flags.push("buyer_lane_unmapped");
    if (wrongContact) flags.push("right_project_wrong_contact");
  }

  const finalFlags = flags.length > 0 ? unique(flags) : ["action_ready" as const];
  const primary = primaryClassification(finalFlags);
  const reasons = finalFlags.map(flag => CLASSIFICATION_REASON[flag]);
  const correctiveActions = unique(finalFlags.map(flag => CLASSIFICATION_ACTION[flag]));

  return {
    projectId: project.id,
    projectName: project.name,
    thisWeekRank: project.rank,
    priority: project.priority,
    actionTier: project.actionTier,
    relevanceScore: project.relevanceScore,
    primaryClassification: primary,
    flags: finalFlags,
    severity: CLASSIFICATION_SEVERITY[primary],
    reasons,
    correctiveActions,
    metrics: {
      productFitProven: projectFit,
      packageHolderCount: packageHolders.length,
      exactContactCount: contacts.length,
      namedContactCount: namedContacts.length,
      effectiveSendReadyCount: effectiveContacts.length,
      buyerLaneContactCount: buyerLaneContacts.length,
      effectiveBuyerContactCount: effectiveBuyerContacts.length,
      principalOrReferralContactCount: principalOrReferralContacts.length,
      unsafeOutreachExposed,
      contactEvidenceHidden,
    },
    cardState: {
      contactCTAAction: project.contactCTAAction,
      bestStakeholderShown: project.bestStakeholder !== null,
      bestStakeholderEmailShown: stakeholderEmailShown,
    },
  };
}

function emptyClassificationCounts(): Record<RyanPortfolioClassification, number> {
  return Object.fromEntries(
    RYAN_PORTFOLIO_CLASSIFICATIONS.map(value => [value, 0]),
  ) as Record<RyanPortfolioClassification, number>;
}

export function buildRyanPortfolioAudit(
  inputs: RyanPortfolioAuditInput[],
  metadata: {
    userId: number;
    userName: string;
    weekLabel: string;
    generatedAt?: Date;
    worstLimit?: number;
  },
): RyanPortfolioAuditReport {
  const rows = inputs.map(classifyRyanPortfolioProject);
  const primaryClassifications = emptyClassificationCounts();
  const flagCounts = emptyClassificationCounts();
  for (const row of rows) {
    primaryClassifications[row.primaryClassification] += 1;
    for (const flag of row.flags) flagCounts[flag] += 1;
  }

  const worstLimit = Math.max(1, Math.min(metadata.worstLimit ?? 15, 100));
  const worst15 = rows
    .filter(row => row.primaryClassification !== "action_ready")
    .sort((a, b) =>
      b.severity - a.severity ||
      b.relevanceScore - a.relevanceScore ||
      a.thisWeekRank - b.thisWeekRank ||
      a.projectId - b.projectId,
    )
    .slice(0, worstLimit);

  return {
    generatedAt: (metadata.generatedAt ?? new Date()).toISOString(),
    rep: { userId: metadata.userId, name: metadata.userName },
    weekLabel: metadata.weekLabel,
    sourceProjectCount: rows.length,
    summary: {
      primaryClassifications,
      flagCounts,
      actionReadyCount: primaryClassifications.action_ready,
      projectsRequiringCorrection: rows.length - primaryClassifications.action_ready,
    },
    rows,
    worst15,
  };
}
