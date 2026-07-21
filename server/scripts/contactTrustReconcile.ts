import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyContactTrustManifest,
  applySnapshotsToCsv,
  generateContactTrustManifest,
} from "../contactTrustReconciliation";
import {
  CONTACT_TRUST_DISPOSITIONS,
  manifestRowsToCsv,
  sealContactTrustManifest,
  type ContactTrustDisposition,
  type ContactTrustManifestDraft,
  type ContactTrustManifestSealed,
} from "../contactTrustReconciliation.shared";

interface CliArgs {
  mode: "generate" | "seal" | "apply";
  manifest?: string;
  outputDir: string;
  confirmHash?: string;
  contactIds?: number[];
  projectIds?: number[];
  dispositions?: ContactTrustDisposition[];
  maxApply?: number;
}

function usage(): string {
  return `Contact trust reconciliation\n\n`
    + `Dry-run generation (default):\n`
    + `  pnpm exec tsx server/scripts/contactTrustReconcile.ts --output-dir ./artifacts/contact-trust\n\n`
    + `Seal an operator-reviewed draft (only approved may change):\n`
    + `  pnpm exec tsx server/scripts/contactTrustReconcile.ts --seal --manifest <draft.json> --output-dir <dir>\n\n`
    + `Apply an approved sealed manifest (default canary max: 25):\n`
    + `  pnpm exec tsx server/scripts/contactTrustReconcile.ts --apply --manifest <sealed.json> \\\n`
    + `    --confirm-hash <sha256> [--contact-ids 1,2] [--project-ids 3,4] [--max-apply 10]\n\n`
    + `Options:\n`
    + `  --dispositions safe_demote,safe_promote,safe_clear_generated_email,safe_link_to_project\n`
    + `  --help\n`;
}

function parseNumberList(value: string, flag: string): number[] {
  const parsed = value.split(",").map(item => Number(item.trim())).filter(Number.isFinite);
  if (!parsed.length || parsed.some(value => !Number.isInteger(value) || value <= 0)) {
    throw new Error(`${flag} must contain positive integer IDs`);
  }
  return Array.from(new Set(parsed));
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
  if (argv.includes("--apply") && argv.includes("--seal")) throw new Error("Choose either --apply or --seal");

  const args: CliArgs = {
    mode,
    outputDir: resolve(process.cwd(), "artifacts/contact-trust-reconciliation"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply" || flag === "--seal") continue;
    if (flag === "--manifest") args.manifest = resolve(readValue(argv, index, flag));
    if (flag === "--output-dir") args.outputDir = resolve(readValue(argv, index, flag));
    if (flag === "--confirm-hash") args.confirmHash = readValue(argv, index, flag);
    if (flag === "--contact-ids") args.contactIds = parseNumberList(readValue(argv, index, flag), flag);
    if (flag === "--project-ids") args.projectIds = parseNumberList(readValue(argv, index, flag), flag);
    if (flag === "--max-apply") {
      const value = Number(readValue(argv, index, flag));
      if (!Number.isInteger(value) || value < 1) throw new Error("--max-apply must be a positive integer");
      args.maxApply = value;
    }
    if (flag === "--dispositions") {
      const allowed = new Set<string>(CONTACT_TRUST_DISPOSITIONS);
      const values = readValue(argv, index, flag).split(",").map(value => value.trim()).filter(Boolean);
      if (!values.length || values.some(value => !allowed.has(value))) {
        throw new Error(`--dispositions must use: ${CONTACT_TRUST_DISPOSITIONS.join(", ")}`);
      }
      args.dispositions = values as ContactTrustDisposition[];
    }
  }

  if ((mode === "seal" || mode === "apply") && !args.manifest) throw new Error(`${mode} requires --manifest`);
  if (mode === "apply" && !args.confirmHash) throw new Error("apply requires --confirm-hash");
  if (mode === "apply" && args.maxApply === undefined) args.maxApply = 25;
  return args;
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function generate(args: CliArgs) {
  await mkdir(args.outputDir, { recursive: true });
  const manifest = await generateContactTrustManifest();
  const jsonPath = resolve(args.outputDir, "contact-trust-manifest.draft.json");
  const csvPath = resolve(args.outputDir, "contact-trust-manifest.csv");
  const summaryPath = resolve(args.outputDir, "contact-trust-summary.json");
  await Promise.all([
    writeJson(jsonPath, manifest),
    writeFile(csvPath, manifestRowsToCsv(manifest.rows), "utf8"),
    writeJson(summaryPath, manifest.summary),
  ]);
  console.log(JSON.stringify({
    mode: "dry_run",
    databaseIdentity: manifest.databaseIdentity,
    databaseFingerprint: manifest.databaseFingerprint,
    totalContacts: manifest.summary.totalContacts,
    summary: manifest.summary,
    files: { manifest: jsonPath, csv: csvPath, summary: summaryPath },
    next: "Review the draft and change only approved=false to approved=true for safe rows, then run --seal.",
  }, null, 2));
}

async function seal(args: CliArgs) {
  await mkdir(args.outputDir, { recursive: true });
  const draft = JSON.parse(await readFile(args.manifest!, "utf8")) as ContactTrustManifestDraft;
  const sealed = sealContactTrustManifest(draft);
  const outputPath = resolve(args.outputDir, "contact-trust-manifest.sealed.json");
  await writeJson(outputPath, sealed);
  console.log(JSON.stringify({
    mode: "seal",
    approvedRows: sealed.rows.filter(row => row.approved).length,
    manifestHash: sealed.manifestHash,
    output: outputPath,
    next: `Apply with --confirm-hash ${sealed.manifestHash}`,
  }, null, 2));
}

async function apply(args: CliArgs) {
  await mkdir(args.outputDir, { recursive: true });
  const manifest = JSON.parse(await readFile(args.manifest!, "utf8")) as ContactTrustManifestSealed;
  const result = await applyContactTrustManifest(manifest, {
    confirmHash: args.confirmHash!,
    contactIds: args.contactIds,
    projectIds: args.projectIds,
    dispositions: args.dispositions,
    maxApply: args.maxApply,
  });
  const beforePath = resolve(args.outputDir, "contact-trust-apply-before.csv");
  const afterPath = resolve(args.outputDir, "contact-trust-apply-after.csv");
  const summaryPath = resolve(args.outputDir, "contact-trust-apply-summary.json");
  await Promise.all([
    writeFile(beforePath, applySnapshotsToCsv(result.before), "utf8"),
    writeFile(afterPath, applySnapshotsToCsv(result.after), "utf8"),
    writeJson(summaryPath, result),
  ]);
  console.log(JSON.stringify({
    mode: "apply",
    maxApply: args.maxApply,
    alreadyApplied: result.alreadyApplied,
    selected: result.selected,
    applied: result.applied,
    skipped: result.skipped,
    contactIds: result.contactIds,
    staleSlateCount: result.staleSlateCount,
    staleSlateIds: result.staleSlateIds,
    files: { before: beforePath, after: afterPath, summary: summaryPath },
  }, null, 2));
}

async function main() {
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
