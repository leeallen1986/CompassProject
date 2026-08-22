#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
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
  rankFullPotentialLookalikes,
  type FullPotentialLookalikeCandidate,
  type FullPotentialLookalikeIdentityStatus,
  type FullPotentialLookalikeReviewState,
  type FullPotentialLookalikeReviewedEvidenceCount,
} from "../shared/fullPotentialLookalikeDiscovery";
import {
  FP_LOOKALIKE_PUBLIC_CANDIDATES_V1,
  FP_LOOKALIKE_PUBLIC_SEEDS_V1,
} from "../server/fullPotentialLookalikePublicPack";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

interface ReviewOverride {
  candidateKey: string;
  identityStatus?: FullPotentialLookalikeIdentityStatus;
  reviewState?: FullPotentialLookalikeReviewState;
  proposedRouteToMarket?: string;
  proposedOwner?: string | null;
  recurringProgrammeEvidence?: FullPotentialLookalikeReviewedEvidenceCount;
  currentSignalEvidence?: FullPotentialLookalikeReviewedEvidenceCount;
}

interface ReviewInput {
  version: 1;
  overrides: ReviewOverride[];
}

function parsePositiveInteger(value: string | undefined, field: string): number {
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new Error(`${field}_INVALID`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field}_INVALID`);
  return parsed;
}

function parseCli(argv: string[]): {
  outputDir: string;
  asOfDate: string;
  segmentCap: number;
  reviewInput: string | null;
} {
  if (argv.length % 2 !== 0) throw new Error("LOOKALIKE_CLI_USAGE_INVALID");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || values.has(key)) {
      throw new Error("LOOKALIKE_CLI_USAGE_INVALID");
    }
    values.set(key, value);
  }
  const allowed = new Set(["--output-dir", "--as-of-date", "--segment-cap", "--review-input"]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`LOOKALIKE_CLI_OPTION_REJECTED:${key}`);
  }
  const outputDir = values.get("--output-dir");
  const asOfDate = values.get("--as-of-date");
  if (!outputDir || !asOfDate || Number.isNaN(Date.parse(asOfDate))) {
    throw new Error(
      "LOOKALIKE_CLI_USAGE: --output-dir <new-dir> --as-of-date <ISO-date> [--segment-cap <n>] [--review-input <json>]",
    );
  }
  return {
    outputDir: resolve(outputDir),
    asOfDate: new Date(asOfDate).toISOString(),
    segmentCap: values.has("--segment-cap")
      ? parsePositiveInteger(values.get("--segment-cap"), "LOOKALIKE_SEGMENT_CAP")
      : 20,
    reviewInput: values.has("--review-input")
      ? resolve(values.get("--review-input") as string)
      : null,
  };
}

function validateNewOutputDirectory(outputDir: string): void {
  const fromRepository = relative(PROJECT_ROOT, outputDir);
  if (
    fromRepository === ""
    || (fromRepository !== ".." && !fromRepository.startsWith(`..${sep}`))
  ) {
    throw new Error("LOOKALIKE_OUTPUT_INSIDE_REPOSITORY_REJECTED");
  }
  try {
    lstatSync(outputDir);
    throw new Error("LOOKALIKE_OUTPUT_ALREADY_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(outputDir);
  const stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(parent) !== parent) {
    throw new Error("LOOKALIKE_OUTPUT_PARENT_INVALID");
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
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
  const fd = openSync(
    temporaryPath,
    fsConstants.O_CREAT
      | fsConstants.O_EXCL
      | fsConstants.O_WRONLY
      | (fsConstants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, finalPath);
  return { filename, sha256: sha256(bytes), byteSize: bytes.length };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function candidateCsv(summary: ReturnType<typeof rankFullPotentialLookalikes>): string {
  const headers = [
    "candidateKey",
    "candidateName",
    "buyerSegment",
    "marketRole",
    "identityStatus",
    "reviewState",
    "disposition",
    "priorityBand",
    "similarityScore",
    "matchedSeedKey",
    "matchedClusterKey",
    "proposedRouteToMarket",
    "proposedOwner",
    "weeklyRecommendationEligible",
    "countsTowardPotential",
    "monetaryImpactAud",
    "crmC4cMutationAllowed",
    "contactEnrichmentAllowed",
    "durableActionCreated",
    "manualApprovalRequired",
    "explanation",
    "sourceUrls",
  ];
  const rows = summary.results.map(row => [
    row.candidateKey,
    row.candidateName,
    row.buyerSegment,
    row.marketRole,
    row.identityStatus,
    row.reviewState,
    row.disposition,
    row.priorityBand,
    row.similarityScore,
    row.matchedSeedKey,
    row.matchedClusterKey,
    row.proposedRouteToMarket,
    row.proposedOwner,
    row.weeklyRecommendationEligible,
    row.countsTowardPotential,
    row.monetaryImpactAud,
    row.crmC4cMutationAllowed,
    row.contactEnrichmentAllowed,
    row.durableActionCreated,
    row.manualApprovalRequired,
    row.explanation.join(" "),
    row.publicSources.map(source => source.sourceUrl).join(";"),
  ]);
  return `${[headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n")}\n`;
}

function readReviewInput(path: string | null): ReviewInput | null {
  if (!path) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("LOOKALIKE_REVIEW_INPUT_INVALID");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ReviewInput;
  if (parsed.version !== 1 || !Array.isArray(parsed.overrides)) {
    throw new Error("LOOKALIKE_REVIEW_INPUT_SHAPE_INVALID");
  }
  return parsed;
}

function applyReviewInput(
  base: FullPotentialLookalikeCandidate[],
  reviewInput: ReviewInput | null,
): FullPotentialLookalikeCandidate[] {
  if (!reviewInput) return structuredClone(base);
  const byKey = new Map(base.map(candidate => [candidate.candidateKey, structuredClone(candidate)]));
  const seen = new Set<string>();
  for (const override of reviewInput.overrides) {
    if (!override || typeof override !== "object" || !override.candidateKey) {
      throw new Error("LOOKALIKE_REVIEW_OVERRIDE_INVALID");
    }
    if (seen.has(override.candidateKey)) {
      throw new Error(`LOOKALIKE_REVIEW_OVERRIDE_DUPLICATE:${override.candidateKey}`);
    }
    seen.add(override.candidateKey);
    const existing = byKey.get(override.candidateKey);
    if (!existing) throw new Error(`LOOKALIKE_REVIEW_OVERRIDE_UNKNOWN:${override.candidateKey}`);
    if (override.identityStatus !== undefined) existing.identityStatus = override.identityStatus;
    if (override.reviewState !== undefined) existing.reviewState = override.reviewState;
    if (override.proposedRouteToMarket !== undefined) {
      existing.proposedRouteToMarket = override.proposedRouteToMarket;
    }
    if (override.proposedOwner !== undefined) existing.proposedOwner = override.proposedOwner;
    if (override.recurringProgrammeEvidence !== undefined) {
      existing.features.recurringProgrammeEvidence = override.recurringProgrammeEvidence;
    }
    if (override.currentSignalEvidence !== undefined) {
      existing.features.currentSignalEvidence = override.currentSignalEvidence;
    }
  }
  return [...byKey.values()];
}

function main(): void {
  const cli = parseCli(process.argv.slice(2));
  validateNewOutputDirectory(cli.outputDir);
  const reviewInput = readReviewInput(cli.reviewInput);
  const candidates = applyReviewInput(FP_LOOKALIKE_PUBLIC_CANDIDATES_V1, reviewInput);
  const summary = rankFullPotentialLookalikes({
    seeds: FP_LOOKALIKE_PUBLIC_SEEDS_V1,
    candidates,
    asOfDate: cli.asOfDate,
    segmentCap: cli.segmentCap,
  });

  const reviewSummary = {
    version: 1,
    mode: "review_only_no_writes",
    methodologyVersion: summary.methodologyVersion,
    asOfDate: summary.asOfDate,
    sourcePack: "FP_LOOKALIKE_PUBLIC_CANDIDATES_V1",
    inputFingerprintSha256: sha256(canonical({
      seeds: FP_LOOKALIKE_PUBLIC_SEEDS_V1,
      candidates,
      asOfDate: cli.asOfDate,
      segmentCap: cli.segmentCap,
    })),
    counts: {
      seedCount: summary.seedCount,
      candidateCount: summary.candidateCount,
      scoredCandidateCount: summary.scoredCandidateCount,
      rankedCandidateCount: summary.rankedCandidateCount,
      identityCheckRequiredCount: summary.identityCheckRequiredCount,
      excludedMarketParticipantCount: summary.excludedMarketParticipantCount,
      insufficientEvidenceCount: summary.insufficientEvidenceCount,
      existingAccountCount: summary.existingAccountCount,
      ambiguousIdentityCount: summary.ambiguousIdentityCount,
      segmentCapExceededCount: summary.segmentCapExceededCount,
      weeklyRecommendationEligibleCount: summary.weeklyRecommendationEligibleCount,
    },
    completeForCandidateCreation: false,
    manualReviewRequired: true,
    safety: {
      databaseConnections: 0,
      databaseWrites: 0,
      fullPotentialAccountMutations: 0,
      fullPotentialMonetaryMutations: 0,
      crmC4cMutations: 0,
      contactEnrichmentMutations: 0,
      providerCalls: 0,
      pipelineInvocations: 0,
      durableActionsCreated: 0,
      deployments: 0,
    },
  };

  mkdirSync(cli.outputDir, { mode: 0o700 });
  const files = [
    writeAtomic(cli.outputDir, "lookalike-candidate-results.json", pretty(summary)),
    writeAtomic(cli.outputDir, "lookalike-candidates.csv", candidateCsv(summary)),
    writeAtomic(cli.outputDir, "lookalike-review-summary.json", pretty(reviewSummary)),
  ];
  const checksums = `${files
    .map(file => `${file.sha256}  ${file.filename}`)
    .sort()
    .join("\n")}\n`;
  const checksumFile = writeAtomic(cli.outputDir, "checksums.sha256", checksums);
  const dirFd = openSync(cli.outputDir, fsConstants.O_RDONLY);
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }

  process.stdout.write(pretty({
    status: "PASS",
    outputDirectory: cli.outputDir,
    candidateCount: summary.candidateCount,
    identityCheckRequiredCount: summary.identityCheckRequiredCount,
    excludedMarketParticipantCount: summary.excludedMarketParticipantCount,
    weeklyRecommendationEligibleCount: summary.weeklyRecommendationEligibleCount,
    completeForCandidateCreation: false,
    outputFiles: [...files, checksumFile],
    databaseConnections: 0,
    monetaryImpactAud: 0,
    crmC4cMutations: 0,
    durableActionsCreated: 0,
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
