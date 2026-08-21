import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FP_RENTAL_PUBLIC_CORE_V1 } from "../server/fullPotentialRentalPublicCore";
import { FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1 } from "../server/fullPotentialToughStationaryPublicBuyerCore";
import {
  buildFullPotentialAccountReconciliationReport,
  verifyFullPotentialAccountReconciliationReport,
  type FullPotentialAccountSnapshot,
} from "../server/fullPotentialAccountReconciliationReport";

interface CliOptions {
  inputPath: string;
  outputDir: string;
  checkOnly: boolean;
  includeToughStationary: boolean;
  requireComplete: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let inputPath = "";
  let outputDir = "";
  let checkOnly = false;
  let includeToughStationary = false;
  let requireComplete = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      inputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      outputDir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--check-only") {
      checkOnly = true;
      continue;
    }
    if (arg === "--include-tough-stationary") {
      includeToughStationary = true;
      continue;
    }
    if (arg === "--require-complete") {
      requireComplete = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage:",
        "  pnpm exec tsx scripts/full-potential-account-reconciliation.ts --input <snapshot.json> --check-only",
        "  pnpm exec tsx scripts/full-potential-account-reconciliation.ts --input <snapshot.json> --output-dir <dir>",
        "",
        "Options:",
        "  --include-tough-stationary  Include distinct named TS2/TS4 specialist-rental adoption pools.",
        "  --require-complete          Exit non-zero when any buyer identity is unmatched or ambiguous.",
        "",
        "The input snapshot contains only Full Potential account identity/relationship fields and aliases.",
        "The command performs no database, account, CRM, provider, pipeline or deployment action.",
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown argument ${arg}`);
  }

  if (!inputPath) throw new Error("--input is required");
  if (!checkOnly && !outputDir) throw new Error("--output-dir is required unless --check-only is used");

  return {
    inputPath: path.resolve(inputPath),
    outputDir: outputDir ? path.resolve(outputDir) : "",
    checkOnly,
    includeToughStationary,
    requireComplete,
  };
}

function assertSnapshot(value: unknown): asserts value is FullPotentialAccountSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Snapshot input must be a JSON object");
  }
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.snapshotRef !== "string" || typeof snapshot.capturedAt !== "string") {
    throw new Error("Snapshot requires snapshotRef and capturedAt strings");
  }
  if (!Array.isArray(snapshot.accounts) || !Array.isArray(snapshot.aliases)) {
    throw new Error("Snapshot requires accounts and aliases arrays");
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reconciliationCsv(report: ReturnType<typeof buildFullPotentialAccountReconciliationReport>): string {
  const rows: unknown[][] = [[
    "record_key",
    "buyer_account_key",
    "buyer_name",
    "disposition",
    "matched_account_id",
    "matched_stable_key",
    "top_candidate_score",
    "reason",
  ]];
  for (const row of report.summary.results) {
    rows.push([
      row.recordKey,
      row.buyerAccountKey ?? "",
      row.buyerName ?? "",
      row.disposition,
      row.matchedAccountId ?? "",
      row.matchedStableKey ?? "",
      row.candidates[0]?.score ?? "",
      row.reason,
    ]);
  }
  return rows.map(row => row.map(csvCell).join(",")).join("\n") + "\n";
}

async function writeOutputs(
  outputDir: string,
  report: ReturnType<typeof buildFullPotentialAccountReconciliationReport>,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(outputDir, "reconciliation-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(outputDir, "account-targets.json"),
      `${JSON.stringify(report.importTargets, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(outputDir, "reconciliation.csv"),
      reconciliationCsv(report),
      "utf8",
    ),
  ]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readFile(options.inputPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  assertSnapshot(parsed);

  const records = [
    ...FP_RENTAL_PUBLIC_CORE_V1,
    ...(options.includeToughStationary ? FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1 : []),
  ];
  const report = buildFullPotentialAccountReconciliationReport(records, parsed);
  verifyFullPotentialAccountReconciliationReport(report);

  if (!options.checkOnly) await writeOutputs(options.outputDir, report);

  const status = report.completeForDraftImport ? "PASS" : "INCOMPLETE";
  console.log(JSON.stringify({
    status,
    mode: options.checkOnly ? "check_only" : "write_outputs",
    includeToughStationary: options.includeToughStationary,
    publicRecordCount: report.publicRecordCount,
    requiredBuyerIdentityCount: report.requiredBuyerIdentityCount,
    matchedRecordCount: report.summary.matchedCount,
    unmatchedRecordCount: report.summary.unmatchedCount,
    ambiguousRecordCount: report.summary.ambiguousCount,
    importTargetCount: report.importTargets.length,
    completeForDraftImport: report.completeForDraftImport,
    reportSha256: report.reportSha256,
    outputDir: options.checkOnly ? null : options.outputDir,
  }, null, 2));

  if (options.requireComplete && !report.completeForDraftImport) {
    process.exitCode = 2;
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  console.error(JSON.stringify({ status: "BLOCKED", error: message }, null, 2));
  process.exitCode = 1;
});
