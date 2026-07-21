from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


def replace_once(text: str, old: str, new: str, path: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exact block once, found {count}\n--- expected ---\n{old[:600]}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, path: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{path}: regex expected once, found {count}: {pattern}")
    return updated


POLICY = '''/**
 * Shared trust policy for contractor hypotheses, contact discovery and paid
 * enrichment. These helpers are deliberately pure so every ingestion path
 * applies the same evidence standard.
 */

export const APOLLO_DAILY_CREDIT_CAP = 200;
export const HUNTER_MIN_CONFIDENCE_FOR_PROMOTION = 70;

export interface LinkedInNamedResult {
  fullName?: string | null;
}

function normalisePersonName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\\s+/g, " ");
}

/**
 * Resolve a LinkedIn result only when the requested person name is supported.
 * Returning the first search result is intentionally forbidden.
 */
export function selectLinkedInPersonMatch<T extends LinkedInNamedResult>(
  requestedName: string,
  items: readonly T[],
): T | null {
  const requested = normalisePersonName(requestedName);
  if (!requested) return null;

  const exact = items.find(item => normalisePersonName(item.fullName || "") === requested);
  if (exact) return exact;

  const parts = requested.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];

  const partialMatches = items.filter(item => {
    const candidate = normalisePersonName(item.fullName || "");
    if (!candidate) return false;
    const candidateParts = candidate.split(" ");
    return candidateParts[0] === first && candidateParts[candidateParts.length - 1] === last;
  });

  return partialMatches.length === 1 ? partialMatches[0] : null;
}

/** Pattern guesses are not contact data and must never occupy contacts.email. */
export function unverifiedContactEmail(): null {
  return null;
}

export function shouldPromoteHunterResult(input: {
  status: string | null | undefined;
  score: number | null | undefined;
  disposable?: boolean;
  block?: boolean;
}): boolean {
  return input.status === "valid"
    && Number(input.score || 0) >= HUNTER_MIN_CONFIDENCE_FOR_PROMOTION
    && !input.disposable
    && !input.block;
}

export interface ContractorHypothesisInput {
  name: string;
  role: string;
  confidence: string;
  detail: string;
}

/**
 * LLM-only contractor suggestions are hypotheses. Model confidence never
 * converts an unsourced suggestion into a confirmed commercial fact.
 */
export function toPersistedContractorHypothesis(input: ContractorHypothesisInput) {
  const confidence = input.confidence.toLowerCase() === "high"
    ? 70
    : input.confidence.toLowerCase() === "medium"
      ? 55
      : 35;

  return {
    name: input.name,
    status: "Predicted",
    confidence,
    detail: `[LLM hypothesis; unverified] ${input.role}: ${input.detail}`,
  } as const;
}

const GENERIC_COMPANY_VALUES = /^(unknown|various|multiple|tba|tbc|tbd|n\\/?a|not specified|to be confirmed)$/i;

export function hasCredibleBuyingRoute(project: {
  owner?: string | null;
  opportunityRoute?: string | null;
  contractors?: unknown;
}): boolean {
  const owner = (project.owner || "").trim();
  if (project.opportunityRoute === "Direct CAPEX" && owner && !GENERIC_COMPANY_VALUES.test(owner)) {
    return true;
  }

  const contractors = Array.isArray(project.contractors) ? project.contractors : [];
  return contractors.some((contractor: any) => {
    const name = String(contractor?.name || "").trim();
    const status = String(contractor?.status || "").toLowerCase();
    return !!name
      && !GENERIC_COMPANY_VALUES.test(name)
      && (status === "confirmed" || status === "awarded" || status === "winning_contractor");
  });
}
'''

TEST = '''import { describe, expect, it } from "vitest";
import {
  APOLLO_DAILY_CREDIT_CAP,
  hasCredibleBuyingRoute,
  selectLinkedInPersonMatch,
  shouldPromoteHunterResult,
  toPersistedContractorHypothesis,
  unverifiedContactEmail,
} from "./intelligenceTrustPolicy";

describe("intelligence and contact trust policy", () => {
  it("never promotes an LLM-only contractor hypothesis to confirmed", () => {
    const result = toPersistedContractorHypothesis({
      name: "Example Civil",
      role: "contractor",
      confidence: "high",
      detail: "Has won similar work in the state",
    });
    expect(result.status).toBe("Predicted");
    expect(result.confidence).toBeLessThan(85);
    expect(result.detail).toContain("LLM hypothesis; unverified");
  });

  it("selects an exact LinkedIn name match", () => {
    const people = [{ fullName: "Alex Morgan", id: 1 }, { fullName: "Taylor Lee", id: 2 }];
    expect(selectLinkedInPersonMatch("Alex Morgan", people)?.id).toBe(1);
  });

  it("allows one unambiguous first-and-last-name match", () => {
    const people = [{ fullName: "Alex J Morgan", id: 1 }, { fullName: "Taylor Lee", id: 2 }];
    expect(selectLinkedInPersonMatch("Alex Morgan", people)?.id).toBe(1);
  });

  it("does not fall back to the first LinkedIn search result", () => {
    const people = [{ fullName: "Wrong Person", id: 1 }, { fullName: "Another Result", id: 2 }];
    expect(selectLinkedInPersonMatch("Alex Morgan", people)).toBeNull();
  });

  it("does not persist guessed email patterns", () => {
    expect(unverifiedContactEmail()).toBeNull();
  });

  it("promotes only valid Hunter mailbox evidence", () => {
    expect(shouldPromoteHunterResult({ status: "valid", score: 85 })).toBe(true);
    expect(shouldPromoteHunterResult({ status: "accept_all", score: 99 })).toBe(false);
    expect(shouldPromoteHunterResult({ status: "valid", score: 69 })).toBe(false);
    expect(shouldPromoteHunterResult({ status: "valid", score: 90, disposable: true })).toBe(false);
  });

  it("requires confirmed relationship evidence or explicit direct CAPEX", () => {
    expect(hasCredibleBuyingRoute({
      owner: "Mine Owner Pty Ltd",
      opportunityRoute: "Direct CAPEX",
      contractors: [],
    })).toBe(true);
    expect(hasCredibleBuyingRoute({
      owner: "Government Department",
      opportunityRoute: "Fleet CAPEX",
      contractors: [{ name: "Confirmed Civil", status: "Confirmed" }],
    })).toBe(true);
    expect(hasCredibleBuyingRoute({
      owner: "Government Department",
      opportunityRoute: "Fleet CAPEX",
      contractors: [{ name: "Likely Civil", status: "Predicted" }],
    })).toBe(false);
  });

  it("uses one shared conservative automatic Apollo daily cap", () => {
    expect(APOLLO_DAILY_CREDIT_CAP).toBe(200);
  });
});
'''

DOC = '''# Intelligence and contact trust hardening

This release hardens the market-intelligence waterfall before further source expansion.

## Contractor truth

LLM-only contractor output is stored as an unverified `Predicted` hypothesis. Model confidence cannot create a `Confirmed` contractor. Confirmation continues to require attributable award, tender, Projectory, ICN, public-source or human evidence.

## Contact truth

LinkedIn search results are accepted only when the requested name matches. The first result is never used as a fallback. Email-pattern guesses are no longer written into `contacts.email`; unverified contacts remain `named_unverified` until a provider or human verifies the mailbox.

Hunter `accept_all` results do not become `send_ready`. Only a valid mailbox with sufficient confidence and no disposable/block flags is promoted.

## Project linkage

Second-pass contact creation writes the contact and its `contactProjects` link in one transaction. Existing contacts are linked to every relevant project rather than silently skipped.

Manual contacts are no longer excluded from project contact-state assessment solely because they were entered by a rep. Their trust tier and rejection state determine usability.

## Paid enrichment gate

Automatic Apollo spend uses one shared daily cap and requires an active project plus a credible buying route: a confirmed/awarded contractor or an explicit Direct CAPEX owner. The discovery queue calls the eligibility engine before paid enrichment and no longer invokes the same project-level Apollo search twice.

No CRM workflow, opportunity stage, forecast, quote or C4C write is introduced.
'''

write("server/intelligenceTrustPolicy.ts", POLICY)
write("server/intelligenceTrustPolicy.test.ts", TEST)
write("docs/intelligence-contact-trust-hardening.md", DOC)

# Contractor hypotheses -------------------------------------------------------
path = "server/contractorEnrichmentPass.ts"
text = read(path)
text = replace_once(text, 'import { invokeLLM } from "./_core/llm";\n', 'import { invokeLLM } from "./_core/llm";\nimport { toPersistedContractorHypothesis } from "./intelligenceTrustPolicy";\n', path)
text = text.replace("Contractor Enrichment Pass", "Contractor Hypothesis Pass")
text = text.replace("searches the web\n * for contractor, EPC, and construction partner details using the project name.", "generates contractor, EPC and delivery-chain hypotheses from project context.\n * It does not perform attributable web search and must never create confirmed facts.")
text = text.replace("Uses LLM to extract structured contractor data from search results.", "Uses an LLM to generate structured, explicitly unverified contractor hypotheses.")
text = text.replace("llm_knowledge", "llm_hypothesis")
old_map = '''    ...toAdd.map(c => ({
      name: c.name,
      status: c.confidence === "high" ? "Confirmed" : "Predicted",
      confidence: c.confidence === "high" ? 85 : c.confidence === "medium" ? 60 : 35,
      detail: `${c.role}: ${c.detail} (enrichment pass)`,
    })),'''
text = replace_once(text, old_map, '    ...toAdd.map(toPersistedContractorHypothesis),', path)
text = text.replace("newly discovered contractors", "new contractor hypotheses")
text = text.replace("contractorsDiscovered", "contractorsDiscovered")
write(path, text)

# LinkedIn contact enrichment -------------------------------------------------
path = "server/contactEnrichment.ts"
text = read(path)
text = replace_once(text, 'import { callDataApi } from "./_core/dataApi";\n', 'import { callDataApi } from "./_core/dataApi";\nimport { selectLinkedInPersonMatch, unverifiedContactEmail } from "./intelligenceTrustPolicy";\n', path)
text = sub_once(text, r'\n//\*\* Blocked domains[\s\S]*?return `\$\{first\}\.\$\{last\}@\$\{domain\}\.com\.au`;\n}\n', '\n', path)
text = sub_once(text, r'\n    // Find best match by name similarity[\s\S]*?    // Return first result if no name match \(LinkedIn search is already filtered\)\n    return items\[0\] \|\| null;', '\n    return selectLinkedInPersonMatch(name, result.data.items);', path)
text = replace_once(text, '        // Infer email if not already set\n        email: contact.email || inferEmail(contact.name, contact.company),', '        // Never persist an inferred mailbox pattern as contact data.\n        email: contact.email || unverifiedContactEmail(),', path)
text = replace_once(text, '            email: inferEmail(person.fullName, company),', '            email: unverifiedContactEmail(),', path)
text = replace_once(text, '          if (existing.length > 0) continue;', '''          if (existing.length > 0) {
            const existingContactId = existing[0].id;
            const existingLink = await db
              .select({ id: contactProjects.id })
              .from(contactProjects)
              .where(and(
                eq(contactProjects.contactId, existingContactId),
                eq(contactProjects.projectId, projectId),
              ))
              .limit(1);
            if (existingLink.length === 0) {
              await db.insert(contactProjects).values({
                contactId: existingContactId,
                projectId,
                projectName,
                relevance: company === owner ? "primary" : "secondary",
              });
            }
            continue;
          }''', path)
write(path, text)

# Open web discovery -----------------------------------------------------------
path = "server/webStakeholderDiscovery.ts"
text = read(path)
text = replace_once(text, 'import { isLinkedInResultAustralianRelevant } from "./geoFilter";\n', 'import { isLinkedInResultAustralianRelevant } from "./geoFilter";\nimport { unverifiedContactEmail } from "./intelligenceTrustPolicy";\n', path)
text = sub_once(text, r'\n/\*\* Infer a corporate email pattern from name and company \*/[\s\S]*?return `\$\{first\}\.\$\{last\}@\$\{domain\}\.com\.au`;\n}\n', '\n', path)
text = replace_once(text, '            email: inferEmail(person.fullName, search.company),', '            email: unverifiedContactEmail(),', path)
old_dedup = '''      // Check for duplicate by name across all projects
      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(sql`LOWER(${contacts.name}) = LOWER(${contact.name})`)
        .limit(1);

      if (existing.length > 0) {
        console.log(`[WebDiscovery] Skipping duplicate name "${contact.name}" — already exists`);
        continue;
      }'''
new_dedup = '''      // Deduplicate by person + employer, then link the existing person to this project.
      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(
          sql`LOWER(${contacts.name}) = LOWER(${contact.name})`,
          sql`LOWER(${contacts.company}) = LOWER(${contact.company})`,
        ))
        .limit(1);

      if (existing.length > 0) {
        const existingLink = await db
          .select({ id: contactProjects.id })
          .from(contactProjects)
          .where(and(
            eq(contactProjects.contactId, existing[0].id),
            eq(contactProjects.projectId, project.id),
          ))
          .limit(1);
        if (existingLink.length === 0) {
          await db.insert(contactProjects).values({
            contactId: existing[0].id,
            projectId: project.id,
            projectName: project.name,
            relevance: contact.company === project.owner ? "primary" : "secondary",
          });
        }
        continue;
      }'''
text = replace_once(text, old_dedup, new_dedup, path)
text = replace_once(text, '        verificationStatus: contact.confidence === "high" ? "verified" : "ai_suggested",', '        verificationStatus: "unverified",', path)
text = replace_once(text, '        emailVerified: false,', '        emailVerified: false,\n        contactTrustTier: "named_unverified",', path)
write(path, text)

# Second pass ------------------------------------------------------------------
path = "server/secondPassContactSearch.ts"
text = read(path)
text = replace_once(text, 'import { contacts, projects, type InsertContact } from "../drizzle/schema";', 'import { contacts, projects, contactProjects, type InsertContact } from "../drizzle/schema";', path)
text = replace_once(text, 'import { isLinkedInResultAustralianRelevant } from "./geoFilter";\n', 'import { isLinkedInResultAustralianRelevant } from "./geoFilter";\nimport { unverifiedContactEmail } from "./intelligenceTrustPolicy";\n', path)
text = sub_once(text, r'\nfunction inferEmail\(name: string, company: string\): string \| null \{[\s\S]*?return `\$\{first\}\.\$\{last\}@\$\{domain\}\.com\.au`;\n}\n', '\n', path)
old_count = '''    .from(contacts)
    .where(
      and(
        sql`${contacts.project} = ${projectName}`,
        sql`${contacts.roleRelevance} IN ('high', 'medium')`
      )
    );'''
new_count = '''    .from(contactProjects)
    .innerJoin(contacts, eq(contactProjects.contactId, contacts.id))
    .where(
      and(
        eq(contactProjects.projectId, projectId),
        sql`${contacts.roleRelevance} IN ('high', 'medium')`
      )
    );'''
text = replace_once(text, old_count, new_count, path)
old_roles = '''    .from(contacts)
    .where(
      and(
        sql`${contacts.project} = ${projectName}`,
        sql`${contacts.roleRelevance} IN ('high', 'medium')`
      )
    );'''
text = replace_once(text, old_roles, new_count, path)
old_dup = '''          const [existing] = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(sql`LOWER(${contacts.name}) = LOWER(${nameKey})`)
            .limit(1);

          if (existing) continue;'''
new_dup = '''          const [existing] = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(
              sql`LOWER(${contacts.name}) = LOWER(${nameKey})`,
              sql`LOWER(${contacts.company}) = LOWER(${company})`,
            ))
            .limit(1);

          if (existing) {
            const [existingLink] = await db
              .select({ id: contactProjects.id })
              .from(contactProjects)
              .where(and(
                eq(contactProjects.contactId, existing.id),
                eq(contactProjects.projectId, projectId),
              ))
              .limit(1);
            if (!existingLink) {
              await db.insert(contactProjects).values({
                contactId: existing.id,
                projectId,
                projectName,
                relevance: company === owner ? "primary" : "secondary",
              });
            }
            continue;
          }'''
text = replace_once(text, old_dup, new_dup, path)
text = replace_once(text, '            email: inferEmail(person.fullName, company),', '            email: unverifiedContactEmail(),', path)
text = replace_once(text, '            emailVerified: false,', '            emailVerified: false,\n            contactTrustTier: "named_unverified",', path)
text = replace_once(text, '          await db.insert(contacts).values(contactData);', '''          await db.transaction(async tx => {
            const [inserted] = await tx.insert(contacts).values(contactData);
            const contactId = Number((inserted as any).insertId);
            if (!contactId) throw new Error("Second-pass contact insert did not return an ID");
            await tx.insert(contactProjects).values({
              contactId,
              projectId,
              projectName,
              relevance: company === owner ? "primary" : "secondary",
            });
          });''', path)
write(path, text)

# Hunter verification ---------------------------------------------------------
path = "server/hunterVerification.ts"
text = read(path)
text = replace_once(text, 'import { inferCompanyDomains } from "./domainInference";\n', 'import { inferCompanyDomains } from "./domainInference";\nimport { shouldPromoteHunterResult } from "./intelligenceTrustPolicy";\n', path)
text = text.replace('const HUNTER_MIN_CONFIDENCE_FOR_PROMOTION = 70;\n', '')
text = sub_once(text, r'      const shouldPromote =\n        \(verifyResult\.status === "valid" \|\| verifyResult\.status === "accept_all"\) &&\n        verifyResult\.score >= HUNTER_MIN_CONFIDENCE_FOR_PROMOTION &&\n        !verifyResult\.disposable &&\n        !verifyResult\.block;', '''      const shouldPromote = shouldPromoteHunterResult({
        status: verifyResult.status,
        score: verifyResult.score,
        disposable: verifyResult.disposable,
        block: verifyResult.block,
      });''', path)
text = sub_once(text, r'      const shouldPromote =\n        \(hunterResult\.status === "valid" \|\| hunterResult\.status === "accept_all"\) &&\n        hunterResult\.score >= HUNTER_MIN_CONFIDENCE_FOR_PROMOTION;', '''      const shouldPromote = shouldPromoteHunterResult({
        status: hunterResult.status,
        score: hunterResult.score,
      });''', path)
text = text.replace('          enrichmentSource: "apollo", // keep existing source, just mark verified\n', '')
text = text.replace('accept_all is common on enterprise/mining domains (BHP, Worley, etc.) — include if confidence ≥70', 'accept-all domains do not verify an individual mailbox and remain named_unverified')
write(path, text)

# Discovery queue --------------------------------------------------------------
path = "server/discoveryQueue.ts"
text = read(path)
text = replace_once(text, 'import { ENV } from "./_core/env";\n', 'import { ENV } from "./_core/env";\nimport { checkApolloEligibility } from "./apolloEligibility";\n', path)
text = replace_once(text, '''  )
)
AND c.enrichmentSource != 'manual'`;''', '''  )
)
AND c.rejectionReason IS NULL`;''', path)
old_apollo = '''      // Step 1: Apollo waterfall (search → enrich)
      try {
        const apolloResult = await enrichProjectContacts(project.id, reportId, {
          enrichEmails: true,
          maxPerCompany: 5,
        });
        if (apolloResult.people.length > 0) providersUsed.push("apollo");
      } catch (e: any) {
        console.warn(`[Discovery] Apollo failed for project ${project.id}: ${e.message}`);
      }'''
new_apollo = '''      // Step 1: Paid Apollo enrichment only after the central commercial/budget gate.
      try {
        const eligibility = await checkApolloEligibility(project.id);
        if (eligibility.eligible) {
          const apolloResult = await enrichProjectContacts(project.id, reportId, {
            enrichEmails: true,
            maxPerCompany: Math.min(5, eligibility.maxCreditsAllowed),
          });
          if (apolloResult.people.length > 0) providersUsed.push("apollo");
        } else {
          console.log(`[Discovery] Apollo skipped for project ${project.id}: ${eligibility.details}`);
        }
      } catch (e: any) {
        console.warn(`[Discovery] Apollo failed for project ${project.id}: ${e.message}`);
      }'''
text = replace_once(text, old_apollo, new_apollo, path)
text = sub_once(text, r'\n    // ── Also enrich principal contractor if known ──[\s\S]*?\n    // ── Assess final contact state ──', '\n    // Owner and all contractors were already handled by the single gated project-level pass.\n\n    // ── Assess final contact state ──', path)
write(path, text)

# Apollo eligibility ----------------------------------------------------------
path = "server/apolloEligibility.ts"
text = read(path)
text = replace_once(text, '  apolloCreditLog,\n} from "../drizzle/schema";\n', '  apolloCreditLog,\n  contactProjects,\n} from "../drizzle/schema";\nimport { APOLLO_DAILY_CREDIT_CAP, hasCredibleBuyingRoute } from "./intelligenceTrustPolicy";\n', path)
text = text.replace('const DAILY_CREDIT_CAP = 500;          // Raised from 300→500 to clear hot-project backlog faster (Jul 2026)\n', '')
text = text.replace('DAILY_CREDIT_CAP', 'APOLLO_DAILY_CREDIT_CAP')
old_project_query = '''  // Get project name
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return {
      totalContacts: 0,
      contactsWithEmail: 0,
      contactsWithVerifiedEmail: 0,
      contactsFromApollo: 0,
      contactsFromWebSearch: 0,
      contactsFromLLM: 0,
      needsMoreContacts: true,
      needsEmailVerification: false,
      contactsMissingEmail: [],
    };
  }

  // Get all contacts for this project
  const projectContacts = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      company: contacts.company,
      email: contacts.email,
      emailVerified: contacts.emailVerified,
      enrichmentSource: contacts.enrichmentSource,
    })
    .from(contacts)
    .where(sql`${contacts.project} = ${project.name}`);'''
new_project_query = '''  // Get all contacts through the canonical contactProjects junction.
  const projectContacts = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      company: contacts.company,
      email: contacts.email,
      emailVerified: contacts.emailVerified,
      enrichmentSource: contacts.enrichmentSource,
    })
    .from(contactProjects)
    .innerJoin(contacts, eq(contactProjects.contactId, contacts.id))
    .where(eq(contactProjects.projectId, projectId));'''
text = replace_once(text, old_project_query, new_project_query, path)
text = replace_once(text, '''      projectType: projects.projectType,
    })''', '''      projectType: projects.projectType,
      owner: projects.owner,
      opportunityRoute: projects.opportunityRoute,
      contractors: projects.contractors,
      actionTier: projects.actionTier,
    })''', path)
insert_after = '''  if (project.suppressed) {
    return makeIneligible(
      `Project "${project.name}" is suppressed (projectType: ${project.projectType || 'unknown'}) — Apollo enrichment blocked to conserve credits`,
      emptyGapAnalysis(),
      emptyBudget()
    );
  }
'''
addition = insert_after + '''
  if (!options?.explicitRequest && project.lifecycleStatus !== "active") {
    return makeIneligible(
      `Project "${project.name}" is not active (${project.lifecycleStatus || "unset"}) — automatic paid enrichment blocked`,
      emptyGapAnalysis(),
      emptyBudget(),
    );
  }

  if (!options?.explicitRequest && !hasCredibleBuyingRoute(project)) {
    return makeIneligible(
      `Project "${project.name}" has no confirmed buying route — automatic paid enrichment blocked`,
      emptyGapAnalysis(),
      emptyBudget(),
    );
  }
'''
text = replace_once(text, insert_after, addition, path)
text = replace_once(text, '  if (project.priority === "hot") {', '  if (project.priority === "hot" && project.actionTier === "tier1_actionable") {', path)
write(path, text)

# Apollo provider cap ---------------------------------------------------------
path = "server/apolloEnrichment.ts"
text = read(path)
text = replace_once(text, 'import { cleanContactName } from "./nameUtils";\n', 'import { cleanContactName } from "./nameUtils";\nimport { APOLLO_DAILY_CREDIT_CAP } from "./intelligenceTrustPolicy";\n', path)
text = text.replace('const DAILY_ENRICHMENT_CAP = 200; // Apollo credits per day\n', '')
text = text.replace('DAILY_ENRICHMENT_CAP', 'APOLLO_DAILY_CREDIT_CAP')
write(path, text)

print("PR67 trust hardening applied")
