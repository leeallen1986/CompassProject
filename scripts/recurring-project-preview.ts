import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildRecurringProjectPlanningManifest,
  verifyRecurringProjectPlanningManifest,
  type RecurringProjectPlanningInput,
} from "../server/recurringProjectPlanning";

interface CliOptions {
  inputPath: string;
  outputDir: string;
  checkOnly: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let inputPath = "";
  let outputDir = "";
  let checkOnly = false;

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
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage:",
        "  pnpm exec tsx scripts/recurring-project-preview.ts --input <review.json> --check-only",
        "  pnpm exec tsx scripts/recurring-project-preview.ts --input <review.json> --output-dir <dir>",
        "",
        "The input is a bounded recurrence-review package. Do not include contacts, CRM notes, prices or credentials.",
        "The command performs no database, project, Full Potential, CRM, provider, pipeline or deployment operation.",
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
  };
}

function assertInput(value: unknown): asserts value is RecurringProjectPlanningInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Input must be a JSON object");
  }
  const row = value as Record<string, unknown>;
  if (typeof row.generatedAt !== "string") throw new Error("generatedAt is required");
  if (typeof row.generatedByRef !== "string") throw new Error("generatedByRef is required");
  if (typeof row.sourceSnapshotRef !== "string") throw new Error("sourceSnapshotRef is required");
  if (!row.programme || typeof row.programme !== "object") throw new Error("programme is required");
  if (!row.candidateOccurrence || typeof row.candidateOccurrence !== "object") {
    throw new Error("candidateOccurrence is required");
  }
  if (!Array.isArray(row.existingOccurrences)) throw new Error("existingOccurrences must be an array");
  if (!Array.isArray(row.existingProjectLinks)) throw new Error("existingProjectLinks must be an array");
  if (!Array.isArray(row.proposedProjectLinks)) throw new Error("proposedProjectLinks must be an array");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const parsed: unknown = JSON.parse(await readFile(options.inputPath, "utf8"));
  assertInput(parsed);
  const manifest = buildRecurringProjectPlanningManifest(parsed);
  verifyRecurringProjectPlanningManifest(manifest);

  if (!options.checkOnly) {
    await mkdir(options.outputDir, { recursive: true });
    await writeFile(
      path.join(options.outputDir, "recurring-project-preview.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }

  console.log(JSON.stringify({
    status: manifest.occurrenceProposal.operation === "manual_review" ? "REVIEW_REQUIRED" : "PASS",
    mode: options.checkOnly ? "check_only" : "write_outputs",
    programmeOperation: manifest.programmeOperation,
    occurrenceOperation: manifest.occurrenceProposal.operation,
    projectLinkProposalCount: manifest.projectLinkProposals.length,
    weeklyRecommendationProjected: Boolean(manifest.weeklyRecommendation),
    durableActionsCreated: manifest.invariants.durableActionsCreated,
    databaseWrites: manifest.invariants.databaseWrites,
    fullPotentialMonetaryMutations: manifest.invariants.fullPotentialMonetaryMutations,
    manifestSha256: manifest.manifestSha256,
    outputDir: options.checkOnly ? null : options.outputDir,
  }, null, 2));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  console.error(JSON.stringify({ status: "BLOCKED", error: message }, null, 2));
  process.exitCode = 1;
});
