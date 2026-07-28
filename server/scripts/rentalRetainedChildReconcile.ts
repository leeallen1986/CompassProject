import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyRentalRetainedChildManifest,
  generateRentalRetainedChildManifest,
} from "../rentalRetainedChildReconciliation";
import {
  rentalRetainedChildRowsToCsv,
  sealRentalRetainedChildManifest,
  type RentalRetainedChildApplySnapshot,
  type RentalRetainedChildManifestDraft,
  type RentalRetainedChildManifestSealed,
} from "../rentalRetainedChildReconciliation.shared";

interface CliArgs {
  mode: "generate" | "seal" | "apply";
  manifest?: string;
  outputDir: string;
  confirmHash?: string;
}

function usage(): string {
  return `Rental Hire retained-child relationship reconciliation v2\n\n`
    + `Read-only generation (default):\n`
    + `  pnpm exec tsx server/scripts/rentalRetainedChildReconcile.ts --output-dir ./artifacts/rental-retained-child\n\n`
    + `Seal an operator-reviewed v2 draft (only approved flags may change):\n`
    + `  pnpm exec tsx server/scripts/rentalRetainedChildReconcile.ts --seal --manifest <draft.json> --output-dir <dir>\n\n`
    + `Apply the exact two-account retained-child link:\n`
    + `  pnpm exec tsx server/scripts/rentalRetainedChildReconcile.ts --apply --manifest <sealed.json> \\\n`
    + `    --confirm-hash <manifestHash> --output-dir <dir>\n\n`
    + `The retired PR #76 v1 non-counting draft is not accepted by this CLI.\n\n`
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
    outputDir: resolve(process.cwd(), "artifacts/rental-retained-child-reconciliation-v2"),
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

function snapshotsToCsv(rows: readonly RentalRetainedChildApplySnapshot[]): string {
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
  const manifest = await generateRentalRetainedChildManifest();
  const manifestPath = resolve(args.outputDir, "rental-retained-child-manifest.v2.draft.json");
  const csvPath = resolve(args.outputDir, "rental-retained-child-manifest.v2.csv");
  const summaryPath = resolve(args.outputDir, "rental-retained-child-summary.v2.json");
  await Promise.all([
    writeJson(manifestPath, manifest),
    writeFile(csvPath, rentalRetainedChildRowsToCsv(manifest.rows), "utf8"),
    writeJson(summaryPath, manifest.summary),
  ]);
  console.log(JSON.stringify({
    mode: "generate_read_only",
    schemaVersion: manifest.schemaVersion,
    databaseIdentity: manifest.databaseIdentity,
    databaseFingerprint: manifest.databaseFingerprint,
    sealed: manifest.sealed,
    approvedRows: 0,
    summary: manifest.summary,
    files: { manifest: manifestPath, csv: csvPath, summary: summaryPath },
    next: manifest.summary.preApplyWorkspaceChecksPassed
      ? "Review both safe_link_retained_child rows. Change only approved=false to approved=true, then run --seal."
      : "STOP: the live workspace failed retained-child pre-apply gates.",
  }, null, 2));
}

async function seal(args: CliArgs): Promise<void> {
  await mkdir(args.outputDir, { recursive: true });
  const draft = JSON.parse(await readFile(args.manifest!, "utf8")) as RentalRetainedChildManifestDraft;
  const sealed = sealRentalRetainedChildManifest(draft);
  const outputPath = resolve(args.outputDir, "rental-retained-child-manifest.v2.sealed.json");
  await writeJson(outputPath, sealed);
  console.log(JSON.stringify({
    mode: "seal",
    schemaVersion: sealed.schemaVersion,
    approvedRows: sealed.summary.approvedRows,
    approvedAccountIds: sealed.rows.filter(row => row.approved).map(row => row.accountId),
    manifestHash: sealed.manifestHash,
    output: outputPath,
    next: sealed.summary.approvedRows === 2
      ? `Apply with --confirm-hash ${sealed.manifestHash}`
      : "No rows are approved. Review the v2 draft before apply.",
  }, null, 2));
}

async function apply(args: CliArgs): Promise<void> {
  await mkdir(args.outputDir, { recursive: true });
  const manifest = JSON.parse(await readFile(args.manifest!, "utf8")) as RentalRetainedChildManifestSealed;
  const result = await applyRentalRetainedChildManifest(manifest, args.confirmHash!);
  const beforePath = resolve(args.outputDir, "rental-retained-child-apply-before.v2.csv");
  const afterPath = resolve(args.outputDir, "rental-retained-child-apply-after.v2.csv");
  const summaryPath = resolve(args.outputDir, "rental-retained-child-apply-summary.v2.json");
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
