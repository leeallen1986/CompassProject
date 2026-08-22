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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOVERNANCE_AUDIT_FILES,
  recoverGovernanceDelta,
} from "../server/fullPotentialGovernanceDeltaRecovery";

process.umask(0o077);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

interface CliOptions {
  snapshotPath: string;
  auditDir: string;
  sourceSha: string;
  retainedPostApplyEvidenceAt: string;
  checkOnly: boolean;
  outputDir: string | null;
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm exec tsx scripts/full-potential-governance-delta-recovery.ts \\",
    "    --snapshot <private-snapshot.json> \\",
    "    --audit-dir <private-audit-directory> \\",
    "    --source-sha <40-hex> \\",
    "    --retained-post-apply-evidence-at <ISO timestamp> \\",
    "    --check-only",
    "",
    "  Replace --check-only with --output-dir <new-private-directory> to write the recovered delta.",
    "",
    "The command is fully offline and performs no database, account, CRM, provider, pipeline or deployment action.",
  ].join("\n");
}

function parseCli(argv: string[]): CliOptions {
  let snapshotPath = "";
  let auditDir = "";
  let sourceSha = "";
  let retainedPostApplyEvidenceAt = "";
  let checkOnly = false;
  let outputDir = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--check-only") {
      if (checkOnly) throw new Error("RECOVERY_CLI_DUPLICATE_CHECK_ONLY");
      checkOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`RECOVERY_CLI_VALUE_REQUIRED:${arg}`);
    index += 1;
    if (arg === "--snapshot") snapshotPath = value;
    else if (arg === "--audit-dir") auditDir = value;
    else if (arg === "--source-sha") sourceSha = value;
    else if (arg === "--retained-post-apply-evidence-at") retainedPostApplyEvidenceAt = value;
    else if (arg === "--output-dir") outputDir = value;
    else throw new Error(`RECOVERY_CLI_OPTION_REJECTED:${arg}`);
  }
  if (!snapshotPath || !auditDir || !sourceSha || !retainedPostApplyEvidenceAt) {
    throw new Error("RECOVERY_CLI_REQUIRED_ARGUMENT_MISSING");
  }
  if (checkOnly === Boolean(outputDir)) {
    throw new Error("RECOVERY_CLI_REQUIRE_EXACTLY_ONE_OF_CHECK_ONLY_OR_OUTPUT_DIR");
  }
  return {
    snapshotPath: resolve(snapshotPath),
    auditDir: resolve(auditDir),
    sourceSha,
    retainedPostApplyEvidenceAt,
    checkOnly,
    outputDir: outputDir ? resolve(outputDir) : null,
  };
}

function readSecureFile(path: string, label: string): Buffer {
  if (!isAbsolute(path)) throw new Error(`${label}_ABSOLUTE_PATH_REQUIRED`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path) {
    throw new Error(`${label}_REGULAR_FILE_REQUIRED`);
  }
  if ((stat.mode & 0o077) !== 0) throw new Error(`${label}_INSECURE_PERMISSIONS`);
  return readFileSync(path);
}

function readAuditDirectory(auditDir: string): Record<(typeof GOVERNANCE_AUDIT_FILES)[number], Buffer> {
  const stat = lstatSync(auditDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(auditDir) !== auditDir) {
    throw new Error("RECOVERY_AUDIT_DIRECTORY_INVALID");
  }
  if ((stat.mode & 0o077) !== 0) throw new Error("RECOVERY_AUDIT_DIRECTORY_INSECURE");
  return Object.fromEntries(
    GOVERNANCE_AUDIT_FILES.map(filename => [
      filename,
      readSecureFile(join(auditDir, filename), `RECOVERY_AUDIT_${filename}`),
    ]),
  ) as Record<(typeof GOVERNANCE_AUDIT_FILES)[number], Buffer>;
}

function validateOutputLocation(outputDir: string): void {
  const fromRepository = relative(PROJECT_ROOT, outputDir);
  if (fromRepository === "" || (fromRepository !== ".." && !fromRepository.startsWith(`..${sep}`))) {
    throw new Error("RECOVERY_OUTPUT_INSIDE_REPOSITORY_REJECTED");
  }
  try {
    lstatSync(outputDir);
    throw new Error("RECOVERY_OUTPUT_ALREADY_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(outputDir);
  const stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(parent) !== parent || (stat.mode & 0o077) !== 0) {
    throw new Error("RECOVERY_OUTPUT_PARENT_INVALID_OR_INSECURE");
  }
}

function reserveOutputDirectory(outputDir: string): void {
  mkdirSync(outputDir, { mode: 0o700 });
  const stat = lstatSync(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("RECOVERY_OUTPUT_DIRECTORY_INSECURE");
  }
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeAtomic(outputDir: string, filename: string, content: string): {
  filename: string;
  sha256: string;
  byteSize: number;
} {
  const bytes = Buffer.from(content, "utf8");
  const finalPath = join(outputDir, filename);
  const temporaryPath = join(outputDir, `.${filename}.tmp-${process.pid}`);
  const fd = openSync(
    temporaryPath,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("RECOVERY_OUTPUT_FILE_INSECURE");
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, finalPath);
  return { filename, sha256: sha256(bytes), byteSize: bytes.length };
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main(): void {
  const cli = parseCli(process.argv.slice(2));
  const snapshot = readSecureFile(cli.snapshotPath, "RECOVERY_SNAPSHOT");
  const artifacts = readAuditDirectory(cli.auditDir);
  const result = recoverGovernanceDelta({
    sourceSha: cli.sourceSha,
    retainedPostApplyEvidenceAt: cli.retainedPostApplyEvidenceAt,
    baseSnapshotRaw: snapshot,
    artifacts,
  });

  let outputFiles: Array<{ filename: string; sha256: string; byteSize: number }> = [];
  if (cli.outputDir) {
    validateOutputLocation(cli.outputDir);
    reserveOutputDirectory(cli.outputDir);
    const deltaOutput = writeAtomic(
      cli.outputDir,
      "full-potential-governance-delta.recovered.json",
      pretty(result.delta),
    );
    const reportOutput = writeAtomic(
      cli.outputDir,
      "governance-delta-recovery-report.json",
      pretty(result.report),
    );
    const checksumContent = `${[deltaOutput, reportOutput]
      .map(item => `${item.sha256}  ${item.filename}`)
      .join("\n")}\n`;
    const checksumOutput = writeAtomic(cli.outputDir, "checksums.sha256", checksumContent);
    const dirFd = openSync(cli.outputDir, fsConstants.O_RDONLY);
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    outputFiles = [deltaOutput, reportOutput, checksumOutput];
  }

  process.stdout.write(pretty({
    status: "PASS",
    mode: cli.checkOnly ? "check_only" : "write_outputs",
    sourceSha: result.report.sourceSha,
    originalDeltaRecovered: false,
    recoveryBasis: result.report.recoveryBasis,
    baseSnapshotRawSha256: result.report.lineage.baseSnapshotRawSha256,
    baseSnapshotCanonicalSha256: result.report.lineage.baseSnapshotCanonicalSha256,
    recoveredDeltaSha256: result.report.recoveredDelta.sha256,
    baseAccountCount: result.report.counts.baseAccounts,
    governedAccountCount: result.report.counts.governedAccounts,
    baseAliasCount: result.report.counts.baseAliases,
    governedAliasCount: result.report.counts.governedAliases,
    accountCreatedCount: result.report.counts.accountCreated,
    accountReplacedCount: result.report.counts.accountReplaced,
    accountDeletedCount: 0,
    aliasAddedCount: result.report.counts.aliasAdded,
    aliasDeletedCount: 0,
    orphanAliasTargetCount: 0,
    missingParentTargetCount: 0,
    weeklyRecommendationEligibleCount: 0,
    completeForCandidateCreation: false,
    manualReviewRequired: true,
    outputFiles,
    safety: result.report.safety,
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
