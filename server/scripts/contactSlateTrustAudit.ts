#!/usr/bin/env tsx
/**
 * Read-only contact candidate-slate trust audit.
 *
 * Usage:
 *   pnpm exec tsx server/scripts/contactSlateTrustAudit.ts --output-dir <path>
 *
 * This command contains no apply mode and performs no database mutation.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "../db";
import { contactCandidateSlates, contactProjects, contacts } from "../../drizzle/schema";
import { buildSlateTrustAudit } from "../contactSlateTrustAudit";
import type { SlatePolicyContact, StoredCandidateSlate } from "../contactSlateTrustPolicy";

interface CliOptions {
  outputDir: string;
  help: boolean;
}

export function parseSlateTrustAuditArgs(argv: string[]): CliOptions {
  let outputDir = "";
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--output-dir") outputDir = argv[index + 1] || "";
    else if (arg.startsWith("--output-dir=")) outputDir = arg.slice("--output-dir=".length);
    else if (arg === "--apply" || arg === "--seal") {
      throw new Error(`${arg} is not supported; this audit is read-only.`);
    }
  }
  return { outputDir, help };
}

function usage(): string {
  return [
    "Read-only candidate-slate trust audit",
    "",
    "Usage:",
    "  pnpm exec tsx server/scripts/contactSlateTrustAudit.ts --output-dir <path>",
    "",
    "Outputs:",
    "  contact-slate-trust-audit.json",
    "  contact-slate-trust-audit.csv",
    "  contact-slate-trust-summary.json",
  ].join("\n");
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: ReturnType<typeof buildSlateTrustAudit>["rows"]): string {
  const headers = [
    "slateId",
    "projectId",
    "status",
    "severity",
    "isStale",
    "generatedAt",
    "totalSlotsFilled",
    "sendReadySlots",
    "namedUnverifiedSlots",
    "llmSlots",
    "computedTotalSlotsFilled",
    "computedSendReadySlots",
    "computedNamedUnverifiedSlots",
    "issueCodes",
    "issueDetails",
    "requiresAction",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push([
      row.slateId,
      row.projectId,
      row.status,
      row.severity,
      row.isStale,
      row.generatedAt,
      row.totalSlotsFilled,
      row.sendReadySlots,
      row.namedUnverifiedSlots,
      row.llmSlots,
      row.computedTotalSlotsFilled,
      row.computedSendReadySlots,
      row.computedNamedUnverifiedSlots,
      row.issueCodes.join(";"),
      row.issueDetails.join(" | "),
      row.requiresAction,
    ].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export async function runSlateTrustAuditCli(argv = process.argv.slice(2)): Promise<void> {
  const options = parseSlateTrustAuditArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.outputDir) throw new Error("--output-dir is required.");

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const slates = await db.select().from(contactCandidateSlates);
  const contactIds = new Set<number>();
  const projectIds = new Set<number>();
  for (const slate of slates) {
    projectIds.add(slate.projectId);
    for (const contactId of [
      slate.primaryContactId,
      slate.backup1ContactId,
      slate.backup2ContactId,
      slate.commercialContactId,
      slate.technicalContactId,
    ]) {
      if (contactId != null) contactIds.add(contactId);
    }
  }

  const contactIdList = [...contactIds];
  const projectIdList = [...projectIds];
  const liveRows: SlatePolicyContact[] = contactIdList.length > 0
    ? await db
        .select({
          id: contacts.id,
          name: contacts.name,
          title: contacts.title,
          company: contacts.company,
          email: contacts.email,
          linkedin: contacts.linkedin,
          enrichmentSource: contacts.enrichmentSource,
          contactTrustTier: contacts.contactTrustTier,
          confidenceScore: contacts.confidenceScore,
          roleRelevance: contacts.roleRelevance,
          emailVerified: contacts.emailVerified,
          verificationStatus: contacts.verificationStatus,
          rejectionReason: contacts.rejectionReason,
          crmOrphan: contacts.crmOrphan,
        })
        .from(contacts)
        .where(inArray(contacts.id, contactIdList))
    : [];

  const linkRows: Array<{ contactId: number; projectId: number }> =
    contactIdList.length > 0 && projectIdList.length > 0
      ? await db
          .select({ contactId: contactProjects.contactId, projectId: contactProjects.projectId })
          .from(contactProjects)
          .where(inArray(contactProjects.contactId, contactIdList))
      : [];

  const liveMap = new Map(liveRows.map(row => [row.id, row]));
  const linksByProject = new Map<number, Set<number>>();
  for (const link of linkRows) {
    if (!projectIds.has(link.projectId)) continue;
    const set = linksByProject.get(link.projectId) || new Set<number>();
    set.add(link.contactId);
    linksByProject.set(link.projectId, set);
  }

  const result = buildSlateTrustAudit(
    slates as unknown as StoredCandidateSlate[],
    liveMap,
    linksByProject,
  );

  const outputDir = path.resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(outputDir, "contact-slate-trust-audit.json"),
      `${JSON.stringify(result.rows, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(outputDir, "contact-slate-trust-audit.csv"),
      toCsv(result.rows),
      "utf8",
    ),
    writeFile(
      path.join(outputDir, "contact-slate-trust-summary.json"),
      `${JSON.stringify(result.summary, null, 2)}\n`,
      "utf8",
    ),
  ]);

  process.stdout.write(`${JSON.stringify({ mode: "read_only_audit", outputDir, ...result.summary }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSlateTrustAuditCli().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
