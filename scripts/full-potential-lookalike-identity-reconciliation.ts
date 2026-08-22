#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FP_LOOKALIKE_PUBLIC_CANDIDATES_V1 } from "../server/fullPotentialLookalikePublicPack";
import {
  buildFullPotentialLookalikeIdentityReport,
  verifyFullPotentialLookalikeIdentityReport,
  type FullPotentialLookalikeAccountSnapshot,
  type FullPotentialLookalikeGovernanceDelta,
  type FullPotentialLookalikeIdentityReport,
} from "../server/fullPotentialLookalikeIdentityReconciliation";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

interface CliOptions {
  snapshotPath: string;
  deltaPath: string;
  outputDir: string;
  sourceSha: string;
}

function parseCli(argv: string[]): CliOptions {
  if (argv.length % 2 !== 0) throw new Error("LOOKALIKE_IDENTITY_CLI_USAGE_INVALID");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || values.has(key)) {
      throw new Error("LOOKALIKE_IDENTITY_CLI_USAGE_INVALID");
    }
    values.set(key, value);
  }
  const allowed = new Set(["--snapshot", "--governance-delta", "--output-dir", "--source-sha"]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`LOOKALIKE_IDENTITY_CLI_OPTION_REJECTED:${key}`);
  }
  const snapshot = values.get("--snapshot");
  const delta = values.get("--governance-delta");
  const output = values.get("--output-dir");
  const sourceSha = values.get("--source-sha");
  if (!snapshot || !delta || !output || !sourceSha || !/^[a-f0-9]{40}$/.test(sourceSha)) {
    throw new Error(
      "LOOKALIKE_IDENTITY_CLI_USAGE: --snapshot <private.json> --governance-delta <private.json> --output-dir <new-dir> --source-sha <40-hex>",
    );
  }
  return {
    snapshotPath: resolve(snapshot),
    deltaPath: resolve(delta),
    outputDir: resolve(output),
    sourceSha,
  };
}

function validateOutputLocation(outputDir: string): void {
  const fromRepository = relative(PROJECT_ROOT, outputDir);
  if (
    fromRepository === ""
    || (fromRepository !== ".." && !fromRepository.startsWith(`..${sep}`))
  ) {
    throw new Error("LOOKALIKE_IDENTITY_OUTPUT_INSIDE_REPOSITORY_REJECTED");
  }
  try {
    lstatSync(outputDir);
    throw new Error("LOOKALIKE_IDENTITY_OUTPUT_ALREADY_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(outputDir);
  const stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(parent) !== parent) {
    throw new Error("LOOKALIKE_IDENTITY_OUTPUT_PARENT_INVALID");
  }
}

function reserveOutputDirectory(outputDir: string): void {
  mkdirSync(outputDir, { mode: 0o700 });
  const stat = lstatSync(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("LOOKALIKE_IDENTITY_OUTPUT_DIRECTORY_INSECURE");
  }
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeAtomic(outputDir: string, filename: string, text: string): {
  filename: string;
  sha256: string;
  byteSize: number;
} {
  const finalPath = join(outputDir, filename);
  const temporaryPath = join(outputDir, `.${filename}.tmp-${process.pid}`);
  const bytes = Buffer.from(text, "utf8");
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const fd = openSync(
    temporaryPath,
    fsConstants.O_CREAT
      | fsConstants.O_EXCL
      | fsConstants.O_WRONLY
      | noFollow,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new Error("LOOKALIKE_IDENTITY_OUTPUT_FILE_INSECURE");
    }
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, finalPath);
  return { filename, sha256: sha256(bytes), byteSize: bytes.length };
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function identityCsv(report: FullPotentialLookalikeIdentityReport): string {
  const rows: unknown[][] = [[
    "candidate_key",
    "candidate_name",
    "market_role",
    "disposition",
    "proposed_identity_status",
    "proposed_review_state",
    "proposed_route_to_market",
    "matched_account_id",
    "matched_stable_key",
    "top_candidate_score",
    "top_candidate_row_class",
    "reason",
    "weekly_recommendation_eligible",
    "counts_toward_potential",
    "monetary_impact_aud",
  ]];
  for (const row of report.results) {
    rows.push([
      row.candidateKey,
      row.candidateName,
      row.marketRole,
      row.disposition,
      row.proposedIdentityStatus,
      row.proposedReviewState,
      row.proposedRouteToMarket,
      row.matchedAccountId ?? "",
      row.matchedStableKey ?? "",
      row.candidates[0]?.score ?? "",
      row.candidates[0]?.rowClass ?? "",
      row.reason,
      row.weeklyRecommendationEligible,
      row.countsTowardPotential,
      row.monetaryImpactAud,
    ]);
  }
  return `${rows.map(row => row.map(csvCell).join(",")).join("\n")}\n`;
}

function parseJsonFile<T>(path: string, label: string): T {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${label}_READ_FAILED`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label}_JSON_INVALID`);
  }
}

function main(): void {
  const cli = parseCli(process.argv.slice(2));
  validateOutputLocation(cli.outputDir);
  const snapshot = parseJsonFile<FullPotentialLookalikeAccountSnapshot>(
    cli.snapshotPath,
    "LOOKALIKE_IDENTITY_SNAPSHOT",
  );
  const delta = parseJsonFile<FullPotentialLookalikeGovernanceDelta>(
    cli.deltaPath,
    "LOOKALIKE_IDENTITY_DELTA",
  );

  const report = buildFullPotentialLookalikeIdentityReport({
    sourceSha: cli.sourceSha,
    candidates: FP_LOOKALIKE_PUBLIC_CANDIDATES_V1,
    baseSnapshot: snapshot,
    governanceDelta: delta,
  });
  verifyFullPotentialLookalikeIdentityReport(report);

  reserveOutputDirectory(cli.outputDir);
  const outputs = [
    writeAtomic(
      cli.outputDir,
      "lookalike-identity-resolution.json",
      pretty(report),
    ),
    writeAtomic(
      cli.outputDir,
      "lookalike-identity-resolution.csv",
      identityCsv(report),
    ),
    writeAtomic(
      cli.outputDir,
      "lookalike-review-input.json",
      pretty(report.reviewInput),
    ),
    writeAtomic(
      cli.outputDir,
      "governed-snapshot-summary.json",
      pretty(report.governedSnapshot),
    ),
  ];
  const checksumText = `${outputs
    .map(row => `${row.sha256}  ${row.filename}`)
    .join("\n")}\n`;
  const checksum = writeAtomic(cli.outputDir, "checksums.sha256", checksumText);

  const dirFd = openSync(cli.outputDir, fsConstants.O_RDONLY);
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }

  process.stdout.write(pretty({
    status: "PASS",
    mode: "review_only_no_writes",
    sourceSha: report.sourceSha,
    baseSnapshotSha256: report.governedSnapshot.baseSnapshotSha256,
    governanceDeltaSha256: report.governedSnapshot.governanceDeltaSha256,
    governedSnapshotSha256: report.governedSnapshot.governedSnapshotSha256,
    candidateCount: report.counts.candidateCount,
    buyerCandidateCount: report.counts.buyerCandidateCount,
    marketParticipantControlCount: report.counts.marketParticipantControlCount,
    existingAccountCount: report.counts.existingAccountCount,
    existingMarketContextCount: report.counts.existingMarketContextCount,
    newIdentityCount: report.counts.newIdentityCount,
    ambiguousIdentityCount: report.counts.ambiguousIdentityCount,
    excludedMarketParticipantCount: report.counts.excludedMarketParticipantCount,
    weeklyRecommendationEligibleCount: 0,
    completeForCandidateCreation: false,
    manualReviewRequired: true,
    reportSha256: report.reportSha256,
    checksumFileSha256: checksum.sha256,
    outputFiles: [...outputs, checksum],
    safety: report.safety,
  }));
}

try {
  main();
} catch (error) {
  process.stderr.write(pretty({
    status: "BLOCKED",
    error: String(error instanceof Error ? error.message : error).slice(0, 512),
  }));
  process.exitCode = 1;
}
