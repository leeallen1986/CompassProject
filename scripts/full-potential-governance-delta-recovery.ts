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
import {
  FULL_POTENTIAL_GOVERNANCE_AUDIT_FILENAMES,
  recoverFullPotentialGovernanceDelta,
  type FullPotentialGovernanceAuditFilename,
} from "../server/fullPotentialGovernanceDeltaRecovery";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

interface CliOptions {
  snapshotPath: string;
  auditDir: string;
  outputDir: string | null;
  checkOnly: boolean;
  sourceSha: string;
  retainedPostApplyEvidenceAt: string;
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm exec tsx scripts/full-potential-governance-delta-recovery.ts \\",
    "    --snapshot <private-base-snapshot.json> \\",
    "    --audit-dir <private-governance-audit-dir> \\",
    "    --source-sha <40-hex> \\",
    "    --retained-post-apply-evidence-at <ISO-8601> \\",
    "    --check-only",
    "",
    "  pnpm exec tsx scripts/full-potential-governance-delta-recovery.ts \\",
    "    --snapshot <private-base-snapshot.json> \\",
    "    --audit-dir <private-governance-audit-dir> \\",
    "    --source-sha <40-hex> \\",
    "    --retained-post-apply-evidence-at <ISO-8601> \\",
    "    --output-dir <new-private-output-dir>",
    "",
    "The evidence timestamp is a retained post-apply file timestamp, not an exact transaction-time claim.",
    "The command performs no database, Full Potential, CRM, provider, pipeline or deployment action.",
  ].join("\n");
}

function parseCli(argv: string[]): CliOptions {
  let snapshotPath = "";
  let auditDir = "";
  let outputDir: string | null = null;
  let checkOnly = false;
  let sourceSha = "";
  let retainedPostApplyEvidenceAt = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--check-only") {
      if (checkOnly) throw new Error("GOVERNANCE_DELTA_RECOVERY_CLI_DUPLICATE_CHECK_ONLY");
      checkOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`GOVERNANCE_DELTA_RECOVERY_CLI_VALUE_REQUIRED:${arg}`);
    }
    index += 1;
    if (arg === "--snapshot") snapshotPath = value;
    else if (arg === "--audit-dir") auditDir = value;
    else if (arg === "--output-dir") outputDir = value;
    else if (arg === "--source-sha") sourceSha = value;
    else if (arg === "--retained-post-apply-evidence-at") retainedPostApplyEvidenceAt = value;
    else throw new Error(`GOVERNANCE_DELTA_RECOVERY_CLI_OPTION_REJECTED:${arg}`);
  }

  if (!snapshotPath || !auditDir || !sourceSha || !retainedPostApplyEvidenceAt) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_CLI_REQUIRED_ARGUMENT_MISSING");
  }
  if (checkOnly === Boolean(outputDir)) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_CLI_REQUIRE_EXACTLY_ONE_MODE");
  }
  return {
    snapshotPath: resolve(snapshotPath),
    auditDir: resolve(auditDir),
    outputDir: outputDir ? resolve(outputDir) : null,
    checkOnly,
    sourceSha,
    retainedPostApplyEvidenceAt,
  };
}

function readPrivateRegularFile(path: string, label: string): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_NOT_REGULAR_FILE`);
  }
  return readFileSync(path);
}

function validateAuditDirectory(auditDir: string): void {
  const stat = lstatSync(auditDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(auditDir) !== auditDir) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_AUDIT_DIRECTORY_INVALID");
  }
}

function validateOutputLocation(outputDir: string): void {
  const fromRepository = relative(PROJECT_ROOT, outputDir);
  if (
    fromRepository === ""
    || (fromRepository !== ".." && !fromRepository.startsWith(`..${sep}`))
  ) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_OUTPUT_INSIDE_REPOSITORY_REJECTED");
  }
  try {
    lstatSync(outputDir);
    throw new Error("GOVERNANCE_DELTA_RECOVERY_OUTPUT_ALREADY_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(outputDir);
  const stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(parent) !== parent) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_OUTPUT_PARENT_INVALID");
  }
}

function reserveOutputDirectory(outputDir: string): void {
  mkdirSync(outputDir, { mode: 0o700 });
  const stat = lstatSync(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_OUTPUT_DIRECTORY_INSECURE");
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | noFollow,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new Error("GOVERNANCE_DELTA_RECOVERY_OUTPUT_FILE_INSECURE");
    }
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, finalPath);
  return { filename, sha256: sha256(bytes), byteSize: bytes.length };
}

function boundedSummary(result: ReturnType<typeof recoverFullPotentialGovernanceDelta>, mode: string) {
  return {
    status: "PASS",
    mode,
    sourceSha: result.report.sourceSha,
    originalDeltaRecovered: result.report.originalDeltaRecovered,
    baseSnapshotRawSha256: result.report.lineage.baseSnapshotRawSha256,
    baseSnapshotCanonicalSha256: result.report.lineage.baseSnapshotCanonicalSha256,
    recoveredDeltaSha256: result.report.recoveredDelta.recoveredDeltaSha256,
    baseAccountCount: result.report.counts.baseAccountCount,
    governedAccountCount: result.report.counts.governedAccountCount,
    baseAliasCount: result.report.counts.baseAliasCount,
    governedAliasCount: result.report.counts.governedAliasCount,
    accountCreatedCount: result.report.counts.accountCreatedCount,
    accountReplacedCount: result.report.counts.accountReplacedCount,
    accountDeletedCount: result.report.counts.accountDeletedCount,
    aliasAddedCount: result.report.counts.aliasAddedCount,
    aliasReplacedCount: result.report.counts.aliasReplacedCount,
    aliasDeletedCount: result.report.counts.aliasDeletedCount,
    orphanAliasTargetCount: result.report.counts.orphanAliasTargetCount,
    missingParentTargetCount: result.report.counts.missingParentTargetCount,
    weeklyRecommendationEligibleCount: result.report.issue143Validation.weeklyRecommendationEligibleCount,
    completeForCandidateCreation: result.report.issue143Validation.completeForCandidateCreation,
    durableActionsCreated: result.report.issue143Validation.durableActionsCreated,
    monetaryImpactAud: result.report.issue143Validation.monetaryImpactAud,
    reportSha256: result.report.reportSha256,
    safety: result.report.safety,
  };
}

function main(): void {
  process.umask(0o077);
  const cli = parseCli(process.argv.slice(2));
  validateAuditDirectory(cli.auditDir);
  const artifacts = Object.fromEntries(
    FULL_POTENTIAL_GOVERNANCE_AUDIT_FILENAMES.map(filename => [
      filename,
      readPrivateRegularFile(join(cli.auditDir, filename), filename.toUpperCase().replace(/[^A-Z0-9]+/g, "_")),
    ]),
  ) as Record<FullPotentialGovernanceAuditFilename, Buffer>;
  const result = recoverFullPotentialGovernanceDelta({
    sourceSha: cli.sourceSha,
    retainedPostApplyEvidenceAt: cli.retainedPostApplyEvidenceAt,
    baseSnapshotRaw: readPrivateRegularFile(cli.snapshotPath, "BASE_SNAPSHOT"),
    artifacts,
  });

  if (cli.checkOnly) {
    process.stdout.write(pretty(boundedSummary(result, "check_only_no_outputs")));
    return;
  }
  const outputDir = cli.outputDir as string;
  validateOutputLocation(outputDir);
  reserveOutputDirectory(outputDir);
  const outputs = [
    writeAtomic(
      outputDir,
      "full-potential-governance-delta.recovered.json",
      pretty(result.delta),
    ),
    writeAtomic(
      outputDir,
      "governance-delta-recovery-report.json",
      pretty(result.report),
    ),
  ];
  const checksumText = `${outputs.map(row => `${row.sha256}  ${row.filename}`).join("\n")}\n`;
  const checksum = writeAtomic(outputDir, "checksums.sha256", checksumText);
  const dirFd = openSync(outputDir, fsConstants.O_RDONLY);
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
  process.stdout.write(pretty({
    ...boundedSummary(result, "private_outputs_written"),
    outputFiles: [...outputs, checksum],
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
