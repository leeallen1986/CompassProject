import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyRentalRetainedChildBatch2Manifest,
  generateRentalRetainedChildBatch2Manifest,
} from "../rentalRetainedChildBatch2Reconciliation";
import {
  rentalRetainedChildBatch2RowsToCsv,
  sealRentalRetainedChildBatch2Manifest,
  type RentalRetainedChildBatch2ApplySnapshot,
  type RentalRetainedChildBatch2ManifestDraft,
  type RentalRetainedChildBatch2ManifestSealed,
} from "../rentalRetainedChildBatch2Reconciliation.shared";

interface CliArgs {
  mode: "generate" | "seal" | "apply";
  manifest?: string;
  outputDir: string;
  confirmHash?: string;
}

function usage(): string {
  return `Australian Rental Hire retained-child batch 2 reconciliation v3\n\n`
    + `Fixed reviewed rows:\n`
    + `  278 Coates Industrial Solutions -> 269 Coates Hire\n`
    + `  332 Kennards Hire channel track -> 272 Kennards Hire\n`
    + `  352 Tutt Bryant Equipment -> 275 Tutt Bryant Hire\n\n`
    + `Read-only generation (default):\n`
    + `  pnpm exec tsx server/scripts/rentalRetainedChildBatch2Reconcile.ts --output-dir ./artifacts/rental-retained-child-batch2\n\n`
    + `Seal an operator-reviewed v3 draft (only approved flags may change):\n`
    + `  pnpm exec tsx server/scripts/rentalRetainedChildBatch2Reconcile.ts --seal --manifest <draft.json> --output-dir <dir>\n\n`
    + `Apply the exact three-account retained-child batch:\n`
    + `  pnpm exec tsx server/scripts/rentalRetainedChildBatch2Reconcile.ts --apply --manifest <sealed.json> \\\n`
    + `    --confirm-hash <manifestHash> --output-dir <dir>\n\n`
    + `This CLI does not accept the PR #78 batch-1 v2 manifest.\n\n`
    + `Options:\n`
    + `  --help\n`;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help")) {
    console.log(usage());
    process.exit(0);
  }
  const mode: CliArgs["mode"] = argv.includes("--apply")
    ? "apply"
    : argv.includes("--seal")
      ? "seal"
      : "generate";
  if (argv.includes("--apply") && argv.includes("--seal")) {
    throw new Error("Choose either --apply or --seal");
  }

  const args: CliArgs = {
    mode,
    outputDir: resolve(process.cwd(), "artifacts/rental-retained-child-batch2-v3"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply" || flag === "--seal") continue;
    if (flag === "--manifest") args.manifest = resolve(readValue(argv, index, flag));
    if (flag === "--output-dir") args.outputDir = resolve(readValue(argv, index, flag));
    if (flag === "--confirm-hash") args.confirmHash = readValue(argv, index, flag);
  }
  if ((mode === "seal" || mode === "apply") && !args.manifest) {
    throw new Error(`${mode} requires --manifest`);
  }
  if (mode === "apply" && !args.confirmHash) {
    throw new Error("apply requires --confirm-hash");
  }
  return args;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function snapshotsToCsv(
  rows: readonly RentalRetainedChildBatch2ApplySnapshot[],
): string {
  const header = [
    "accountId",
    "parentAccountId",
    "mergedIntoAccountId",
    "relationshipType",
    "recordStatus",
    "countsTowardPotential",
    "immutableStateHash",
  ].join(",");
  const body = rows.map(row => [
    row.accountId,
    row.parentAccountId ?? "",
    row.mergedIntoAccountId ?? "",
    row.relationshipType ?? "",
    row.recordStatus ?? "",
    row.countsTowardPotential,
    row.immutableStateHash,
  ].join(","));
  return `${header}\n${body.join("\n")}\n`;
}

async function generate(args: CliArgs): Promise<void> {
  await mkdir(args.outputDir, { recursive: true });
  const manifest = await generateRentalRetainedChildBatch2Manifest();
  const manifestPath = resolve(
    args.outputDir,
    "rental-retained-child-batch2-manifest.v3.draft.json",
  );
  const csvPath = resolve(
    args.outputDir,
    "rental-retained-child-batch2-manifest.v3.csv",
  );
  const summaryPath = resolve(
    args.outputDir,
    "rental-retained-child-batch2-summary.v3.json",
  );
  await Promise.all([
    writeJson(manifestPath, manifest),
    writeFile(csvPath, rentalRetainedChildBatch2RowsToCsv(manifest.rows), "utf8"),
    writeJson(summaryPath, manifest.summary),
  ]);
  console.log(JSON.stringify({
    mode: "generate_read_only",
    schemaVersion: manifest.schemaVersion,
    batchId: manifest.batchId,
    databaseIdentity: manifest.databaseIdentity,
    databaseFingerprint: manifest.databaseFingerprint,
    sealed: manifest.sealed,
    approvedRows: 0,
    summary: manifest.summary,
    files: { manifest: manifestPath, csv: csvPath, summary: summaryPath },
    next: manifest.summary.pr78ContinuityChecksPassed
      && manifest.summary.preApplyWorkspaceChecksPassed
      && manifest.summary.manualReview === 0
      ? "Review all three safe_link_retained_child_batch2 rows. Change only approved=false to approved=true, then run --seal under separate authority."
      : "STOP: PR78 continuity, live workspace or batch-2 row gates failed.",
  }, null, 2));
}

async function seal(args: CliArgs): Promise<void> {
  await mkdir(args.outputDir, { recursive: true });
  const draft = JSON.parse(
    await readFile(args.manifest!, "utf8"),
  ) as RentalRetainedChildBatch2ManifestDraft;
  const sealed = sealRentalRetainedChildBatch2Manifest(draft);
  const outputPath = resolve(
    args.outputDir,
    "rental-retained-child-batch2-manifest.v3.sealed.json",
  );
  await writeJson(outputPath, sealed);
  console.log(JSON.stringify({
    mode: "seal",
    schemaVersion: sealed.schemaVersion,
    batchId: sealed.batchId,
    approvedRows: sealed.summary.approvedRows,
    approvedAccountIds: sealed.rows.filter(row => row.approved).map(row => row.accountId),
    manifestHash: sealed.manifestHash,
    output: outputPath,
    next: sealed.summary.approvedRows === 3
      ? `Apply with --confirm-hash ${sealed.manifestHash} under separate controller authority.`
      : "No rows are approved. Review the v3 draft before apply.",
  }, null, 2));
}

async function apply(args: CliArgs): Promise<void> {
  await mkdir(args.outputDir, { recursive: true });
  const manifest = JSON.parse(
    await readFile(args.manifest!, "utf8"),
  ) as RentalRetainedChildBatch2ManifestSealed;
  const result = await applyRentalRetainedChildBatch2Manifest(
    manifest,
    args.confirmHash!,
  );
  const beforePath = resolve(
    args.outputDir,
    "rental-retained-child-batch2-apply-before.v3.csv",
  );
  const afterPath = resolve(
    args.outputDir,
    "rental-retained-child-batch2-apply-after.v3.csv",
  );
  const summaryPath = resolve(
    args.outputDir,
    "rental-retained-child-batch2-apply-summary.v3.json",
  );
  await Promise.all([
    writeFile(beforePath, snapshotsToCsv(result.before), "utf8"),
    writeFile(afterPath, snapshotsToCsv(result.after), "utf8"),
    writeJson(summaryPath, result),
  ]);
  console.log(JSON.stringify({
    mode: "apply",
    alreadyApplied: result.alreadyApplied,
    selected: result.selected,
    applied: result.applied,
    skipped: result.skipped,
    accountIds: result.accountIds,
    workspaceBefore: result.workspaceBefore,
    workspaceAfter: result.workspaceAfter,
    pr78ContinuityFailuresBefore: result.pr78ContinuityFailuresBefore,
    pr78ContinuityFailuresAfter: result.pr78ContinuityFailuresAfter,
    batch2DispositionsAfter: result.batch2DispositionsAfter,
    files: { before: beforePath, after: afterPath, summary: summaryPath },
  }, null, 2));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "generate") return generate(args);
  if (args.mode === "seal") return seal(args);
  return apply(args);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
