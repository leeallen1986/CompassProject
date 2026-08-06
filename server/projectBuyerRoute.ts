import {
  classifyRoleLane,
  evaluateSlateEligibility,
  isEffectivelySendReady,
  type ContactTrustTier,
  type SlateEligibilityReason,
} from "./contactSlateTrustPolicy";

export type BuyerRouteEvidenceState =
  | "source_confirmed"
  | "recorded_unverified"
  | "inferred"
  | "not_recorded";

export type BuyerRouteLane =
  | "principal"
  | "contractor"
  | "commercial"
  | "technical"
  | "referral"
  | "unknown";

export type BuyerFunction =
  | "project_package_lead"
  | "plant_equipment_fleet"
  | "procurement_commercial"
  | "technical_site_operations";

export interface BuyerRouteProjectSource {
  label: string;
  url: string;
  date: string | null;
  claimBound: false;
}

export interface BuyerRouteProjectRecord {
  id: number;
  owner: string;
  contractors: unknown;
  sources: unknown;
}

export interface BuyerRouteContactRecord {
  id: number;
  name: string;
  title: string;
  company: string;
  email: string | null;
  linkedin: string | null;
  linkedinProfileUrl: string | null;
  linkedinSearchUrl: string | null;
  enrichmentSource: string | null;
  sourceUrl: string | null;
  enrichedAt: Date | null;
  verificationStatus: string | null;
  emailVerified: boolean | number | null;
  verifiedAt: Date | null;
  contactTrustTier: ContactTrustTier | null;
  rejectionReason: string | null;
  crmOrphan: boolean | number | null;
  createdAt: Date | null;
}

export interface BuyerRouteContactLinkRecord {
  relevance: "primary" | "secondary" | null;
  createdAt: Date | null;
}

export interface BuyerRouteContractorLinkRecord {
  contractorId: number;
  canonicalName: string;
  aliases: string[] | null;
  role: string;
  status: string;
  detail: string | null;
  confidence: number | null;
  source: string | null;
  createdAt: Date | null;
}

export interface ProjectBuyerRouteInputs {
  project: BuyerRouteProjectRecord;
  contacts: Array<{
    contact: BuyerRouteContactRecord;
    link: BuyerRouteContactLinkRecord;
  }>;
  contractorLinks: BuyerRouteContractorLinkRecord[];
}

export interface BuyerRouteContact {
  contactId: number;
  name: string;
  title: string;
  organisation: {
    recordedName: string;
    evidenceState: "not_recorded";
  };
  lane: {
    value: BuyerRouteLane;
    basis: "inferred";
  };
  storedTrustTier: ContactTrustTier | null;
  effectiveTrustTier: ContactTrustTier;
  effectivelySendReady: boolean;
  eligibilityReasons: SlateEligibilityReason[];
  email: {
    value: string | null;
    state: "verified" | "unverified" | "not_available";
  };
  linkedin: {
    profileUrl: string | null;
    searchUrl: string | null;
  };
  source: {
    type: string | null;
    url: string | null;
    evidenceMeaning: "identity_discovery_not_employment_proof";
  };
  lastChecked: {
    at: Date | null;
    basis:
      | "contact_verified_at"
      | "contact_enriched_at"
      | "not_recorded";
  };
  projectLink: {
    exactPersistedLink: true;
    relevance: "primary" | "secondary" | null;
    linkedAt: Date | null;
    externalEvidenceState: "not_recorded";
  };
  whyRelevant: {
    text: string;
    evidenceState: "inferred";
  };
}

export interface ProjectBuyerRoute {
  projectId: number;
  principal: {
    organisation: string | null;
    role: "principal";
    evidenceState: "recorded_unverified" | "not_recorded";
    buyerMeaning: "referral_and_package_confirmation_not_assumed_purchaser";
  };
  projectLevelSources: BuyerRouteProjectSource[];
  packageHolders: Array<{
    organisation: string;
    organisationType: "organisation" | "joint_venture_recorded" | "unknown";
    recordedRole: string | null;
    recordedStatus: string;
    packageScope: string | null;
    evidenceState: "recorded_unverified" | "inferred" | "not_recorded";
    ingestionSources: string[];
  }>;
  likelyEquipmentBuyer: {
    organisation: null;
    functions: BuyerFunction[];
    statement: string;
    evidenceState: "inferred";
  };
  principalValue: {
    statement: string;
    evidenceState: "inferred" | "not_recorded";
  };
  unmappedScopes: Array<{
    scope: string;
    evidenceState: "recorded_unverified" | "inferred" | "not_recorded";
    reason: string;
  }>;
  contacts: BuyerRouteContact[];
  gaps: string[];
}

interface RecordedContractor {
  name: string;
  role: string | null;
  status: string;
  detail: string | null;
}

const GENERIC_ORGANISATION =
  /^(unknown|various|multiple|none|pending|tba|tbc|tbd|n\/?a|not specified|to be confirmed|no\s+contractor(?:\s+(?:appointed|selected|identified))?(?:\s+yet)?|not\s+(?:yet\s+)?appointed|contractor\s+(?:tbc|tba|unknown|pending)|to\s+be\s+(?:selected|appointed)|-+)$/i;
const LLM_CONTRACTOR_MARKER = /\[LLM hypothesis; unverified\]/i;

function compact(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function safeExternalUrl(value: unknown): string | null {
  const candidate = compact(value);
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    return !parsed.username &&
      !parsed.password &&
      (parsed.protocol === "https:" || parsed.protocol === "http:")
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function safeLinkedInUrl(value: unknown): string | null {
  const safeUrl = safeExternalUrl(value);
  if (!safeUrl) return null;
  const host = new URL(safeUrl).hostname.toLowerCase();
  return host === "linkedin.com" || host.endsWith(".linkedin.com")
    ? safeUrl
    : null;
}

function validOrganisation(value: unknown): string | null {
  const candidate = compact(value);
  return candidate && /[a-z]/i.test(candidate) && !GENERIC_ORGANISATION.test(candidate)
    ? candidate
    : null;
}

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseProjectSources(value: unknown): BuyerRouteProjectSource[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap(source => {
    if (!source || typeof source !== "object") return [];
    const candidate = source as Record<string, unknown>;
    const label = compact(candidate.label);
    const url = safeExternalUrl(candidate.url);
    if (!label || !url) return [];
    return [
      {
        label,
        url,
        date: compact(candidate.date) || null,
        claimBound: false as const,
      },
    ];
  });
}

function parseProjectContractors(value: unknown): RecordedContractor[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap(contractor => {
    if (!contractor || typeof contractor !== "object") return [];
    const candidate = contractor as Record<string, unknown>;
    const name = validOrganisation(candidate.name);
    if (!name) return [];
    return [
      {
        name,
        role: null,
        status: compact(candidate.status) || "not_recorded",
        detail: compact(candidate.detail) || null,
      },
    ];
  });
}

function contractorEvidenceState(
  contractor: RecordedContractor
): "recorded_unverified" | "inferred" | "not_recorded" {
  const status = contractor.status.toLowerCase();
  if (status === "not_recorded") return "not_recorded";
  if (
    status === "predicted" ||
    LLM_CONTRACTOR_MARKER.test(contractor.detail ?? "")
  ) {
    return "inferred";
  }
  return "recorded_unverified";
}

function organisationType(
  name: string
): "organisation" | "joint_venture_recorded" | "unknown" {
  if (/\bjoint venture\b|\bjv\b/i.test(name)) return "joint_venture_recorded";
  return validOrganisation(name) ? "organisation" : "unknown";
}

function matchingIngestionSources(
  name: string,
  links: readonly BuyerRouteContractorLinkRecord[]
): string[] {
  const target = normaliseName(name);
  const values = new Set<string>();

  for (const link of links) {
    const names = [link.canonicalName, ...(link.aliases ?? [])]
      .map(normaliseName)
      .filter(Boolean);
    if (!names.includes(target)) continue;
    const source = compact(link.source);
    if (source) values.add(source);
  }

  return Array.from(values).sort();
}

function contractorNames(
  contractors: readonly RecordedContractor[],
  links: readonly BuyerRouteContractorLinkRecord[]
): Set<string> {
  const names = new Set(
    contractors.map(contractor => normaliseName(contractor.name))
  );
  const contractorRoles = new Set(["epc", "contractor", "subcontractor"]);
  for (const link of links) {
    if (contractorRoles.has(link.role)) {
      names.add(normaliseName(link.canonicalName));
    }
  }
  names.delete("");
  return names;
}

function recordedPackageHolders(
  projectContractors: readonly RecordedContractor[],
  links: readonly BuyerRouteContractorLinkRecord[]
): RecordedContractor[] {
  const holders = [...projectContractors];
  const names = new Set(holders.map(holder => normaliseName(holder.name)));

  // contractorProjectLinks is an exact persisted project association, but its
  // source describes ingestion rather than independent claim evidence. Only a
  // currently confirmed EPC/contractor/subcontractor link is eligible for this
  // contractor/package list. Other roles and non-current statuses remain gaps.
  const packageRoles = new Set(["epc", "contractor", "subcontractor"]);
  for (const link of links) {
    if (!packageRoles.has(link.role) || link.status !== "confirmed") continue;
    const name = validOrganisation(link.canonicalName);
    if (!name || names.has(normaliseName(name))) continue;
    holders.push({
      name,
      role: link.role,
      status: compact(link.status) || "not_recorded",
      detail: compact(link.detail) || null,
    });
    names.add(normaliseName(name));
  }

  return holders;
}

function inferContactLane(
  contact: BuyerRouteContactRecord,
  owner: string | null,
  knownContractors: ReadonlySet<string>
): BuyerRouteLane {
  const company = normaliseName(contact.company);
  if (owner && company === normaliseName(owner)) return "principal";
  if (company && knownContractors.has(company)) return "contractor";

  const roleLane = classifyRoleLane(`${contact.title} ${contact.company}`);
  if (roleLane === "commercial") return "commercial";
  if (roleLane === "technical") return "technical";
  if (roleLane === "primary" || roleLane === "backup") return "referral";
  return "unknown";
}

function relevanceReason(lane: BuyerRouteLane): string {
  switch (lane) {
    case "principal":
      return "Recorded organisation matches the principal; use as a referral or package-confirmation path.";
    case "contractor":
      return "Recorded organisation matches a contractor entry; the role may provide a contractor-side route.";
    case "commercial":
      return "Title or role text suggests a procurement, contracts or commercial function.";
    case "technical":
      return "Title or role text suggests an engineering, plant, fleet, maintenance or site function.";
    case "referral":
      return "Title or role text suggests a project or general referral path; buying authority is not proven.";
    default:
      return "The contact is exactly linked to the project, but a buyer lane is not recorded.";
  }
}

function contactLastChecked(
  contact: BuyerRouteContactRecord
): BuyerRouteContact["lastChecked"] {
  if (contact.verifiedAt)
    return { at: contact.verifiedAt, basis: "contact_verified_at" };
  if (contact.enrichedAt)
    return { at: contact.enrichedAt, basis: "contact_enriched_at" };
  return { at: null, basis: "not_recorded" };
}

function deduplicateContactRows(
  rows: ProjectBuyerRouteInputs["contacts"]
): ProjectBuyerRouteInputs["contacts"] {
  const byContactId = new Map<
    number,
    ProjectBuyerRouteInputs["contacts"][number]
  >();

  for (const row of rows) {
    const existing = byContactId.get(row.contact.id);
    if (!existing) {
      byContactId.set(row.contact.id, row);
      continue;
    }

    const rowPrimary = row.link.relevance === "primary";
    const existingPrimary = existing.link.relevance === "primary";
    const rowLinkedAt =
      row.link.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const existingLinkedAt =
      existing.link.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (
      (rowPrimary && !existingPrimary) ||
      (rowPrimary === existingPrimary && rowLinkedAt < existingLinkedAt)
    ) {
      byContactId.set(row.contact.id, row);
    }
  }

  return Array.from(byContactId.values());
}

function buildContact(
  row: ProjectBuyerRouteInputs["contacts"][number],
  owner: string | null,
  knownContractors: ReadonlySet<string>
): BuyerRouteContact {
  const contact = row.contact;
  const eligibility = evaluateSlateEligibility(contact, true);
  const sendReady = eligibility.eligible && isEffectivelySendReady(contact);
  const hasEmail = compact(contact.email).length > 0;
  const lane = inferContactLane(contact, owner, knownContractors);

  return {
    contactId: contact.id,
    name: contact.name,
    title: contact.title,
    organisation: {
      recordedName: contact.company,
      evidenceState: "not_recorded",
    },
    lane: { value: lane, basis: "inferred" },
    storedTrustTier: contact.contactTrustTier,
    effectiveTrustTier: sendReady
      ? "send_ready"
      : contact.contactTrustTier === "llm_inferred"
        ? "llm_inferred"
        : "named_unverified",
    effectivelySendReady: sendReady,
    eligibilityReasons: eligibility.reasons,
    email: {
      value: sendReady ? compact(contact.email) : null,
      state: sendReady ? "verified" : hasEmail ? "unverified" : "not_available",
    },
    linkedin: {
      profileUrl:
        safeLinkedInUrl(contact.linkedinProfileUrl) ||
        safeLinkedInUrl(contact.linkedin) ||
        null,
      searchUrl: safeLinkedInUrl(contact.linkedinSearchUrl),
    },
    source: {
      type: compact(contact.enrichmentSource) || null,
      url: safeExternalUrl(contact.sourceUrl),
      evidenceMeaning: "identity_discovery_not_employment_proof",
    },
    lastChecked: contactLastChecked(contact),
    projectLink: {
      exactPersistedLink: true,
      relevance: row.link.relevance,
      linkedAt: row.link.createdAt,
      externalEvidenceState: "not_recorded",
    },
    whyRelevant: {
      text: relevanceReason(lane),
      evidenceState: "inferred",
    },
  };
}

function contactSortValue(contact: BuyerRouteContact): number {
  if (contact.effectivelySendReady) return 0;
  if (contact.effectiveTrustTier === "named_unverified") return 1;
  return 2;
}

/**
 * Build a provider-free, fail-closed Route to buyer dossier from persisted data.
 *
 * Phase 1 deliberately does not emit source_confirmed claims. Existing project
 * sources are project-level only, contractor link sources describe ingestion,
 * and neither contact employment nor project-link evidence is independently
 * persisted in the current schema.
 */
export function buildProjectBuyerRoute(
  inputs: ProjectBuyerRouteInputs
): ProjectBuyerRoute {
  const owner = validOrganisation(inputs.project.owner);
  const projectSources = parseProjectSources(inputs.project.sources);
  const projectContractors = parseProjectContractors(
    inputs.project.contractors
  );
  const recordedContractors = recordedPackageHolders(
    projectContractors,
    inputs.contractorLinks
  );

  const packageHolders = recordedContractors.map(contractor => ({
    organisation: contractor.name,
    organisationType: organisationType(contractor.name),
    recordedRole: contractor.role,
    recordedStatus: contractor.status,
    packageScope: contractor.detail,
    evidenceState: contractorEvidenceState(contractor),
    ingestionSources: matchingIngestionSources(
      contractor.name,
      inputs.contractorLinks
    ),
  }));

  const knownContractors = contractorNames(
    recordedContractors,
    inputs.contractorLinks
  );
  const contacts = deduplicateContactRows(inputs.contacts)
    .filter(row => {
      const eligibility = evaluateSlateEligibility(row.contact, true);
      return (
        !eligibility.reasons.includes("rejected") &&
        !eligibility.reasons.includes("crm_orphan")
      );
    })
    .map(row => buildContact(row, owner, knownContractors))
    .sort((left, right) => {
      const tierDifference = contactSortValue(left) - contactSortValue(right);
      return tierDifference || left.contactId - right.contactId;
    });

  const gaps = new Set<string>();
  if (!owner) gaps.add("principal_not_recorded");
  else gaps.add("principal_claim_source_unbound");
  if (packageHolders.length === 0) gaps.add("contractor_unmapped");
  else {
    gaps.add("contractor_claim_source_unbound");
    if (packageHolders.some(holder => !holder.packageScope)) {
      gaps.add("package_scope_not_recorded");
    }
  }
  if (contacts.length === 0) gaps.add("buyer_lane_unmapped");
  if (
    contacts.some(
      contact => contact.organisation.evidenceState === "not_recorded"
    )
  ) {
    gaps.add("employment_evidence_not_recorded");
    gaps.add("project_link_evidence_not_recorded");
  }

  const hasPackageRoute = packageHolders.length > 0;

  return {
    projectId: inputs.project.id,
    principal: {
      organisation: owner,
      role: "principal",
      evidenceState: owner ? "recorded_unverified" : "not_recorded",
      buyerMeaning: "referral_and_package_confirmation_not_assumed_purchaser",
    },
    projectLevelSources: projectSources,
    packageHolders,
    likelyEquipmentBuyer: {
      organisation: null,
      functions: hasPackageRoute
        ? [
            "project_package_lead",
            "plant_equipment_fleet",
            "procurement_commercial",
            "technical_site_operations",
          ]
        : ["project_package_lead", "procurement_commercial"],
      statement: hasPackageRoute
        ? "The likely equipment route is through the contractor or JV project/package, plant-equipment, fleet, procurement-commercial or technical-site team. No particular buyer is proven."
        : "No contractor package holder is recorded. Use the principal for referral and package-owner confirmation; no particular buyer is proven.",
      evidenceState: "inferred",
    },
    principalValue: {
      statement: owner
        ? "Use the principal to identify the package manager and confirm package ownership; do not assume the principal purchases the equipment."
        : "A principal referral path is not recorded.",
      evidenceState: owner ? "inferred" : "not_recorded",
    },
    unmappedScopes: packageHolders
      .filter(holder => !holder.packageScope)
      .map(holder => ({
        scope: `Package scope for ${holder.organisation}`,
        evidenceState: "not_recorded" as const,
        reason:
          "The organisation is linked to the project, but a package scope is not recorded.",
      })),
    contacts,
    gaps: Array.from(gaps).sort(),
  };
}
