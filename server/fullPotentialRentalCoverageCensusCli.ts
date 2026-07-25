import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import {
  fullPotentialAccounts,
  fullPotentialAccountAliases,
  fullPotentialActions,
  fullPotentialSignals,
  fullPotentialEvidence,
} from "../drizzle/schema";
import { getDb } from "./db";
import { assessRentalOwnership, isRentalHireAccount } from "./fullPotentialRentalHire";
import type {
  RentalCoverageAccountInput,
  RentalCoverageCandidateInput,
} from "./fullPotentialRentalCoverageCensus";
import {
  buildCanonicalRentalCoverageCensus,
  type CanonicalRentalCandidateResult,
  type CanonicalRentalCoverageGroup,
  type CanonicalRentalCoverageRow,
} from "./fullPotentialRentalCoverageCanonical";

export interface RentalCoverageCliOptions {
  outputDir: string;
  candidateFile: string | null;
  help: boolean;
}

const CANDIDATE_TEMPLATE_HEADERS = [
  "candidateName",
  "parentName",
  "website",
  "state",
  "branchOrLocation",
  "sourceName",
  "sourceUrl",
  "evidenceSummary",
  "productFit",
  "notes",
  "excludeReason",
] as const;

export function parseRentalCoverageArgs(argv: string[]): RentalCoverageCliOptions {
  let outputDir = "";
  let candidateFile: string | null = null;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--output-dir") outputDir = argv[++index] || "";
    else if (arg.startsWith("--output-dir=")) outputDir = arg.slice("--output-dir=".length);
    else if (arg === "--candidate-file") candidateFile = argv[++index] || null;
    else if (arg.startsWith("--candidate-file=")) candidateFile = arg.slice("--candidate-file=".length) || null;
    else if (["--apply", "--commit", "--seal", "--write-db", "--migrate", "--country"].includes(arg)) {
      throw new Error(`${arg} is not supported; the Rental Hire coverage census is read-only and scoped to Australia.`);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { outputDir, candidateFile, help };
}

function usage(): string {
  return [
    "Read-only Australian Rental Hire coverage census",
    "",
    "Usage:",
    "  pnpm exec tsx server/scripts/fullPotentialRentalCoverageCensus.ts --output-dir <path>",
    "",
    "Optional:",
    "  --candidate-file <csv|xlsx>  Reconcile external research candidates without importing them",
    "",
    "Scope:",
    "  country = AU (fixed)",
    "",
    "Outputs:",
    "  rental-coverage-census.csv",
    "  rental-coverage-summary.json",
    "  rental-coverage-canonical-groups.json",
    "  rental-coverage-gap-queue.csv",
    "  rental-coverage-candidate-template.csv",
    "  rental-coverage-candidate-reconciliation.csv (when --candidate-file is supplied)",
    "  rental-coverage-candidate-reconciliation.json (when --candidate-file is supplied)",
  ].join("\n");
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normaliseHeader(value: unknown): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function csvCell(value: unknown): string {
  const text = value == null
    ? ""
    : Array.isArray(value)
      ? value.join(";")
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv<T extends Record<string, unknown>>(rows: T[], headers: readonly string[]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map(header => csvCell(row[header])).join(","));
  return `${lines.join("\n")}\n`;
}

function candidateTemplateCsv(): string {
  return toCsv([{
    candidateName: "Example Regional Equipment Hire",
    parentName: "",
    website: "https://example.invalid",
    state: "QLD",
    branchOrLocation: "Toowoomba",
    sourceName: "Public company website",
    sourceUrl: "https://example.invalid/locations",
    evidenceSummary: "Illustrative template row only — replace with sourced evidence",
    productFit: "portable_air_large;dryers",
    notes: "Do not import until canonical, owner and route review is complete",
    excludeReason: "",
  }], CANDIDATE_TEMPLATE_HEADERS);
}

async function readCandidateFile(filePath: string): Promise<RentalCoverageCandidateInput[]> {
  const bytes = await readFile(path.resolve(filePath));
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Candidate file contains no worksheet.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
    header: 1,
    raw: false,
    defval: "",
  });
  if (matrix.length === 0) return [];

  const headerRowIndex = matrix.findIndex(row => row.some(cell => normaliseHeader(cell) === "candidatename"));
  if (headerRowIndex < 0) throw new Error("Candidate file is missing a candidateName header.");
  const headerMap = new Map<string, number>();
  matrix[headerRowIndex].forEach((header, index) => headerMap.set(normaliseHeader(header), index));
  const value = (row: unknown[], header: string): string => clean(row[headerMap.get(normaliseHeader(header)) ?? -1]);

  const candidates: RentalCoverageCandidateInput[] = [];
  for (const row of matrix.slice(headerRowIndex + 1)) {
    const candidateName = value(row, "candidateName");
    if (!candidateName) continue;
    candidates.push({
      candidateName,
      parentName: value(row, "parentName") || null,
      website: value(row, "website") || null,
      state: value(row, "state") || null,
      branchOrLocation: value(row, "branchOrLocation") || null,
      sourceName: value(row, "sourceName") || null,
      sourceUrl: value(row, "sourceUrl") || null,
      evidenceSummary: value(row, "evidenceSummary") || null,
      productFit: value(row, "productFit") || null,
      notes: value(row, "notes") || null,
      excludeReason: value(row, "excludeReason") || null,
    });
  }
  return candidates;
}

const CENSUS_HEADERS: Array<keyof CanonicalRentalCoverageRow> = [
  "accountId",
  "stableKey",
  "canonicalName",
  "displayName",
  "rootAccountId",
  "rootCanonicalName",
  "relationshipPath",
  "relationshipType",
  "recordStatus",
  "countsTowardPotential",
  "isActiveCountingRecord",
  "rowClass",
  "country",
  "state",
  "region",
  "routeToMarket",
  "ownerName",
  "ownerAlignment",
  "ownershipModel",
  "priorityTier",
  "platformPushDecision",
  "applicationPlays",
  "installedBaseStatus",
  "currentSupplier",
  "aliasCount",
  "openActionCount",
  "nextActionPresent",
  "activeInMyWeek",
  "liveSignalCount",
  "evidenceCount",
  "verifiedEvidenceCount",
  "rowGapCodes",
  "groupGapCodes",
];

const GROUP_HEADERS: Array<keyof CanonicalRentalCoverageGroup> = [
  "rootAccountId",
  "rootCanonicalName",
  "memberAccountIds",
  "activeCountingAccountIds",
  "flaggedCountingAccountIds",
  "childContextAccountIds",
  "duplicateAccountIds",
  "countries",
  "states",
  "routes",
  "owners",
  "expectedOwners",
  "ownerAlignment",
  "priorityTier",
  "pushNow",
  "applicationPlays",
  "installedBaseStatuses",
  "suppliers",
  "aliasCount",
  "openActionCount",
  "nextActionCount",
  "activeInMyWeekCount",
  "liveSignalCount",
  "evidenceCount",
  "verifiedEvidenceCount",
  "evidenceSourceCount",
  "hasFinancialPotential",
  "gapCodes",
  "criticalGapCount",
  "highGapCount",
  "mediumGapCount",
  "coverageScore",
];

const CANDIDATE_HEADERS: Array<keyof CanonicalRentalCandidateResult> = [
  "candidateName",
  "parentName",
  "website",
  "state",
  "branchOrLocation",
  "sourceName",
  "sourceUrl",
  "evidenceSummary",
  "productFit",
  "notes",
  "excludeReason",
  "normalizedCandidateName",
  "disposition",
  "matchedAccountIds",
  "matchedCanonicalNames",
  "matchedMemberAccountIds",
  "matchedSegments",
  "matchBasis",
  "researchFlags",
  "researchComplete",
  "recommendedForImport",
  "reviewComment",
];

export async function runRentalCoverageCensusCli(argv = process.argv.slice(2)): Promise<void> {
  const options = parseRentalCoverageArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.outputDir) throw new Error("--output-dir is required.");

  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const [accountRows, aliasRows, actionRows, signalRows, evidenceRows, candidates] = await Promise.all([
    db.select().from(fullPotentialAccounts),
    db.select().from(fullPotentialAccountAliases),
    db.select().from(fullPotentialActions),
    db.select().from(fullPotentialSignals),
    db.select().from(fullPotentialEvidence),
    options.candidateFile ? readCandidateFile(options.candidateFile) : Promise.resolve([]),
  ]);

  const accounts: RentalCoverageAccountInput[] = accountRows.map(account => {
    const ownership = assessRentalOwnership(account as unknown as Record<string, unknown> & { id: number });
    return {
      ...account,
      applicationPlays: account.applicationPlays || [],
      evidenceSources: account.evidenceSources || [],
      isRentalHire: isRentalHireAccount(account as unknown as Record<string, unknown> & { id: number }),
      expectedOwnerNames: ownership.expectedOwnerNames,
      ownershipModel: ownership.ownershipModel,
      ownerAlignment: ownership.ownerAlignment,
      ownershipReviewReason: ownership.reviewReason,
    } as RentalCoverageAccountInput;
  });

  const result = buildCanonicalRentalCoverageCensus({
    allAccounts: accounts,
    aliases: aliasRows,
    actions: actionRows,
    signals: signalRows,
    evidence: evidenceRows,
    candidates,
  });

  const outputDir = path.resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const writes: Array<Promise<void>> = [
    writeFile(path.join(outputDir, "rental-coverage-census.csv"), toCsv(result.rows as unknown as Record<string, unknown>[], CENSUS_HEADERS), "utf8"),
    writeFile(path.join(outputDir, "rental-coverage-summary.json"), `${JSON.stringify(result.summary, null, 2)}\n`, "utf8"),
    writeFile(path.join(outputDir, "rental-coverage-canonical-groups.json"), `${JSON.stringify(result.groups, null, 2)}\n`, "utf8"),
    writeFile(path.join(outputDir, "rental-coverage-gap-queue.csv"), toCsv(result.gapQueue as unknown as Record<string, unknown>[], GROUP_HEADERS), "utf8"),
    writeFile(path.join(outputDir, "rental-coverage-candidate-template.csv"), candidateTemplateCsv(), "utf8"),
  ];

  if (options.candidateFile) {
    writes.push(
      writeFile(path.join(outputDir, "rental-coverage-candidate-reconciliation.csv"), toCsv(result.candidateReconciliation as unknown as Record<string, unknown>[], CANDIDATE_HEADERS), "utf8"),
      writeFile(path.join(outputDir, "rental-coverage-candidate-reconciliation.json"), `${JSON.stringify(result.candidateReconciliation, null, 2)}\n`, "utf8"),
    );
  }
  await Promise.all(writes);

  process.stdout.write(`${JSON.stringify({
    mode: "read_only_canonical_rental_coverage_census",
    outputDir,
    candidateFile: options.candidateFile ? path.resolve(options.candidateFile) : null,
    ...result.summary,
  }, null, 2)}\n`);
}
