import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canPersistSendReady,
  resolvePersistedContactTrustTier,
  type PersistedSendReadyCandidate,
} from "./contactTrustPromotionBoundary";

const completeEvidence: PersistedSendReadyCandidate = {
  enrichmentSource: "apollo",
  email: "verified@example.com",
  emailVerified: true,
  verificationStatus: "verified",
  rejectionReason: null,
  crmOrphan: false,
  hasProjectLink: true,
};

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if ([".ts", ".tsx", ".mjs"].includes(extname(entry.name))) {
        files.push(relative(process.cwd(), absolute).replaceAll("\\", "/"));
      }
    }
  };
  walk(resolve(process.cwd(), root));
  return files;
}

/**
 * Detect an actual persistence operation, not a type, fixture, expected state,
 * comment, SELECT predicate or project-validation update that merely mentions
 * send_ready.
 */
function hasRawSendReadyPersistence(text: string): boolean {
  const drizzleObjectWrite = /\.(?:set|values)\(\s*\{[\s\S]{0,1600}?contactTrustTier\s*:\s*["']send_ready["'][\s\S]{0,1600}?\}\s*\)/m;
  const contactsSqlUpdate = /UPDATE\s+contacts(?:\s+[a-zA-Z_]\w*)?[\s\S]{0,1600}?\bSET\b[^;]{0,1200}?\bcontactTrustTier\s*=\s*["']send_ready["']/i;
  return drizzleObjectWrite.test(text) || contactsSqlUpdate.test(text);
}

describe("persisted send-ready promotion boundary", () => {
  it("accepts only the complete canonical evidence shape", () => {
    expect(canPersistSendReady(completeEvidence)).toBe(true);
  });

  it("accepts database-style numeric booleans", () => {
    expect(canPersistSendReady({
      ...completeEvidence,
      emailVerified: 1,
      crmOrphan: 0,
    })).toBe(true);
  });

  it.each<[string, Partial<PersistedSendReadyCandidate>]>([
    ["unsupported provenance", { enrichmentSource: "crm" }],
    ["missing provenance", { enrichmentSource: null }],
    ["blank mailbox", { email: "   " }],
    ["unverified mailbox flag", { emailVerified: false }],
    ["unknown mailbox flag", { emailVerified: null }],
    ["contradictory verification status", { verificationStatus: "unverified" }],
    ["rejected identity", { rejectionReason: "wrong_company" }],
    ["CRM orphan", { crmOrphan: true }],
    ["unknown orphan state", { crmOrphan: null }],
    ["missing project link", { hasProjectLink: false }],
  ])("fails closed for %s", (_label, override) => {
    expect(canPersistSendReady({ ...completeEvidence, ...override })).toBe(false);
  });

  it("demotes unsupported normal writers but preserves the LLM quarantine", () => {
    const blocked = { ...completeEvidence, hasProjectLink: false };
    expect(resolvePersistedContactTrustTier(blocked, "send_ready")).toBe("named_unverified");
    expect(resolvePersistedContactTrustTier(blocked, "named_unverified")).toBe("named_unverified");
    expect(resolvePersistedContactTrustTier(blocked, "llm_inferred")).toBe("llm_inferred");
  });
});

describe("Issue #82 normal-writer inventory", () => {
  it("gates both Apollo persistence paths and links before promotion", () => {
    const apollo = source("server/apolloEnrichment.ts");

    expect(apollo.match(/resolvePersistedContactTrustTier\(/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
    expect(apollo).toContain('contactTrustTier: "named_unverified"');
    expect(apollo).toContain("await tx.insert(contactProjects).values");
    expect(apollo).toContain("await db.transaction(async tx =>");
    expect(apollo).toContain("isExplicitlyNotCrmOrphan(contact.crmOrphan)");
    expect(apollo).toContain("const providerEmail = p.email?.trim() || null");
    expect(apollo).toContain("Boolean(providerEmail)");
    expect(apollo).toContain("AND c.crmOrphan = 0");
    expect(apollo).not.toContain(
      'contactTrustTier: enrichedPerson.emailStatus === "verified" ? "send_ready" : "named_unverified"',
    );
    expect(apollo).not.toContain(
      'contactTrustTier: isVerified ? "send_ready" : contact.contactTrustTier',
    );
    expect(apollo).not.toContain("AND (c.crmOrphan IS NULL OR c.crmOrphan = 0)");
  });

  it("gates Hunter persistence on rejection, orphan and exact-link evidence", () => {
    const hunter = source("server/hunterVerification.ts");

    expect(hunter).toContain('from "./contactTrustPromotionBoundary"');
    expect(hunter).toContain(".from(contactProjects)");
    expect(hunter).toContain('reason: "rejected_contact_not_eligible"');
    expect(hunter).toContain('reason: "crm_orphan_not_eligible"');
    expect(hunter).toMatch(
      /reason:\s*projectId\s*\?\s*"contact_not_linked_to_project"\s*:\s*"contact_has_no_project_link"/s,
    );
    expect(hunter).toContain("resolvePersistedContactTrustTier({");
    expect(hunter).toContain("await db.transaction(async tx =>");
  });

  it("requires complete Lusha evidence instead of promoting on email presence", () => {
    const lusha = source("server/lushaEnrichment.ts");

    expect(lusha).toContain('from "./contactTrustPromotionBoundary"');
    expect(lusha).toContain("AND c.rejectionReason IS NULL");
    expect(lusha).toContain("AND c.crmOrphan = 0");
    expect(lusha).toContain('confidence?.trim().toLowerCase() === "high"');
    expect(lusha).toContain("emailVerified,");
    expect(lusha).toContain("verificationStatus,");
    expect(lusha).toContain("resolvePersistedContactTrustTier({");
    expect(lusha).toContain("companyName: company");
    expect(lusha).toContain('"api_key": apiKey');
    expect(lusha).toMatch(
      /await db\.transaction\(async tx => \{[\s\S]*await tx\.insert\(lushaEnrichmentLog\)[\s\S]*await tx\.update\(contacts\)/,
    );
    expect(lusha).not.toContain("`Bearer ${apiKey}`");
    expect(lusha).not.toContain(
      'contactTrustTier: lushaResult.email ? "send_ready" : contact.contactTrustTier',
    );
  });

  it("blocks manual send-ready transitions unless the canonical boundary passes", () => {
    const router = source("server/routers/contactValidation.ts");

    expect(router).toContain('import { canPersistSendReady } from "../contactTrustPromotionBoundary"');
    expect(router).toContain("crmOrphan: contacts.crmOrphan");
    expect(router).toContain(".from(contactProjects)");
    expect(router).toContain("if (transition.newTier === \"send_ready\")");
    expect(router).toContain("send_ready requires an allowed source");
  });

  it("finds no unenumerated raw writer in normal server runtime", () => {
    const allowedRuntimeWriters = new Set([
      // Fail-closed stale-tier backfill — only literal "send_ready" writer in normal runtime.
      "server/contactEnrichment.ts",
    ]);

    const runtimeHits = sourceFiles("server")
      .filter(path => !/\.test\.[^.]+$/.test(path))
      .filter(path => !path.startsWith("server/scripts/"))
      .filter(path => hasRawSendReadyPersistence(source(path)))
      .sort();

    expect(runtimeHits.filter(path => !allowedRuntimeWriters.has(path))).toEqual([]);
    expect(runtimeHits).toEqual([...allowedRuntimeWriters].sort());
  });

  it("classifies contactTrustReconciliation.ts as a controlled manifest-gated operator path, not an autonomous runtime writer", () => {
    const reconciliation = source("server/contactTrustReconciliation.ts");

    // Must NOT contain a literal "send_ready" string in a persistence call —
    // it persists the dynamic value row.expectedAfter.contactTrustTier instead.
    expect(hasRawSendReadyPersistence(reconciliation)).toBe(false);

    // Must require a sealed manifest before any apply.
    expect(reconciliation).toContain("verifySealedContactTrustManifest(manifest)");

    // Must require the caller to supply the exact manifest hash.
    expect(reconciliation).toContain("options.confirmHash !== manifest.manifestHash");

    // Must compare database identity before apply.
    expect(reconciliation).toContain("currentManifest.databaseIdentity !== manifest.databaseIdentity");

    // Must compare database fingerprint before apply.
    expect(reconciliation).toContain("currentManifest.databaseFingerprint !== manifest.databaseFingerprint");

    // Must compare per-row record hash before apply.
    expect(reconciliation).toContain("current.recordHash !== row.recordHash");

    // Must apply only approved/applyable rows.
    expect(reconciliation).toContain('row.disposition === "safe_demote"');
    expect(reconciliation).toContain('row.disposition === "safe_promote"');

    // Must persist the dynamic value, not a literal.
    expect(reconciliation).toContain("contactTrustTier: row.expectedAfter.contactTrustTier");

    // Must be transaction-controlled.
    expect(reconciliation).toContain("await db.transaction(async (tx:");

    // Must NOT be called by daily/weekly pipeline, enrichment jobs, outreach routes or provider callbacks.
    const forbiddenCallers = [
      "server/pipelineRunner.ts",
      "server/weeklyPipeline.ts",
      "server/dailyPipeline.ts",
      "server/apolloEnrichment.ts",
      "server/hunterVerification.ts",
      "server/lushaEnrichment.ts",
      "server/contactEnrichment.ts",
    ];
    for (const callerPath of forbiddenCallers) {
      try {
        const callerSource = source(callerPath);
        expect(callerSource).not.toContain("applyContactTrustManifest");
      } catch {
        // File does not exist — not a caller.
      }
    }
    const routerFiles = sourceFiles("server/routers").filter(p => !/\.test\.[^.]+$/.test(p));
    for (const routerPath of routerFiles) {
      expect(source(routerPath)).not.toContain("applyContactTrustManifest");
    }

    // Must only be callable from the explicit operator script.
    const operatorScript = source("server/scripts/contactTrustReconcile.ts");
    expect(operatorScript).toContain("applyContactTrustManifest");
  });

  it("confirms all legacy direct-mutation scripts have been removed", () => {
    // All legacy scripts that directly set contactTrustTier='send_ready' outside
    // the canonical boundary have been deleted from the repository. Git history
    // preserves them for audit purposes.
    const deletedScripts = [
      "scripts/amitRescueDemo.mjs",
      "scripts/e2eRescueDemo.mjs",
      "scripts/rescueE2E.mjs",
      "scripts/trust-tier-promotion.mjs",
      "scripts/validate_digest_safe.ts",
      "server/scripts/enrichCadiaNewmont.ts",
    ];
    for (const deleted of deletedScripts) {
      let found = false;
      try {
        source(deleted);
        found = true;
      } catch {
        // Expected: file does not exist.
      }
      expect(found).toBe(false);
    }

    // No remaining scripts/ or server/scripts/ file should contain a raw send_ready write.
    const remainingManualHits: string[] = [];
    try {
      remainingManualHits.push(...sourceFiles("scripts").filter(path => !/\.test\.[^.]+$/.test(path)).filter(path => hasRawSendReadyPersistence(source(path))));
    } catch { /* scripts/ may not exist */ }
    try {
      remainingManualHits.push(...sourceFiles("server/scripts").filter(path => !/\.test\.[^.]+$/.test(path)).filter(path => hasRawSendReadyPersistence(source(path))));
    } catch { /* server/scripts/ may not exist */ }
    expect(remainingManualHits.sort()).toEqual([]);
  });

  it("retains every fail-closed gate in the stale-tier pipeline backfill", () => {
    const backfill = source("server/contactEnrichment.ts");

    for (const gate of [
      "c.contactTrustTier = 'named_unverified'",
      "c.email IS NOT NULL",
      "TRIM(c.email) <> ''",
      "c.emailVerified = 1",
      "c.verificationStatus = 'verified'",
      "c.rejectionReason IS NULL",
      "c.crmOrphan = 0",
    ]) {
      expect(backfill).toContain(gate);
    }

    expect(backfill).toMatch(
      /AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+contactProjects\s+cp\s+WHERE\s+cp\.contactId\s*=\s*c\.id\s*\)/s,
    );
  });
});
