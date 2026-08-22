#!/usr/bin/env node
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  RecurringCandidateProject,
  RecurringProjectSnapshotDocument,
  RecurringProjectSnapshotManifest,
} from "@shared/recurringProjectDiscoveryContract";
import {
  buildRecurringDiscoveryReviewPackage,
  DEFAULT_RECURRING_DISCOVERY_CONFIGURATION,
} from "../server/recurringProjectDiscovery";
import {
  canonicalJson,
  canonicalSha256,
  sha256,
} from "../server/recurringProjectSnapshotSafety";

const GROUPS_FILENAME = "recurring-project-candidate-groups.json";
const PROJECTS_FILENAME = "recurring-project-candidate-projects.csv";
const SUMMARY_FILENAME = "recurring-project-review-summary.json";
const CHECKSUM_FILENAME = "checksums.sha256";
const SNAPSHOT_FILENAME = "recurring-project-snapshot.json";
const MANIFEST_FILENAME = "recurring-project-snapshot-manifest.json";

function parseInteger(value: string | undefined, label: string): number {
  if (!/^[1-9][0-9]*$/.test(value ?? "")) throw new Error(`${label}_INVALID`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label}_INVALID`);
  return parsed;
}

function parseCli(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("RECURRING_PREVIEW_CLI_USAGE_INVALID");
    }
    if (values.has(key)) throw new Error(`RECURRING_PREVIEW_CLI_DUPLICATE:${key}`);
    values.set(key, value);
  }
  const allowed = new Set([
    "--snapshot",
    "--output-dir",
    "--minimum-group-size",
    "--minimum-distinct-cycles",
    "--maximum-projects-per-group",
  ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`RECURRING_PREVIEW_OPTION_REJECTED:${key}`);
  }
  const snapshot = values.get("--snapshot");
  const outputDir = values.get("--output-dir");
  if (!snapshot || !outputDir) {
    throw new Error(
      "RECURRING_PREVIEW_CLI_USAGE: --snapshot <json> --output-dir <snapshot-directory>",
    );
  }
  return {
    snapshotPath: resolve(snapshot),
    outputDir: resolve(outputDir),
    configuration: {
      minimumGroupSize: values.has("--minimum-group-size")
        ? parseInteger(
            values.get("--minimum-group-size"),
            "RECURRING_PREVIEW_MINIMUM_GROUP_SIZE",
          )
        : DEFAULT_RECURRING_DISCOVERY_CONFIGURATION.minimumGroupSize,
      minimumDistinctCycles: values.has("--minimum-distinct-cycles")
        ? parseInteger(
            values.get("--minimum-distinct-cycles"),
            "RECURRING_PREVIEW_MINIMUM_CYCLES",
          )
        : DEFAULT_RECURRING_DISCOVERY_CONFIGURATION.minimumDistinctCycles,
      maximumProjectsPerGroup: values.has("--maximum-projects-per-group")
        ? parseInteger(
            values.get("--maximum-projects-per-group"),
            "RECURRING_PREVIEW_MAXIMUM_PROJECTS",
          )
        : DEFAULT_RECURRING_DISCOVERY_CONFIGURATION.maximumProjectsPerGroup,
    },
  };
}

function readJson<T>(path: string): T {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 50_000_000) {
    throw new Error("RECURRING_PREVIEW_INPUT_FILE_INVALID");
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function assertOutputDirectory(outputDir: string, snapshotPath: string): void {
  const stat = lstatSync(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("RECURRING_PREVIEW_OUTPUT_DIRECTORY_INVALID");
  }
  if (dirname(snapshotPath) !== outputDir) {
    throw new Error("RECURRING_PREVIEW_OUTPUT_MUST_MATCH_SNAPSHOT_DIRECTORY");
  }
  for (const filename of [
    GROUPS_FILENAME,
    PROJECTS_FILENAME,
    SUMMARY_FILENAME,
    CHECKSUM_FILENAME,
  ]) {
    try {
      lstatSync(join(outputDir, filename));
      throw new Error(`RECURRING_PREVIEW_OUTPUT_ALREADY_EXISTS:${filename}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function writeAtomic(outputDir: string, filename: string, content: string): void {
  const finalPath = join(outputDir, filename);
  const temporaryPath = join(outputDir, `.${filename}.tmp-${process.pid}`);
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const fd = openSync(
    temporaryPath,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      noFollow,
    0o600,
  );
  try {
    writeFileSync(fd, Buffer.from(content, "utf8"));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, finalPath);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function candidateProjectsCsv(projects: RecurringCandidateProject[]): string {
  const headers = [
    "groupKey",
    "projectId",
    "projectKey",
    "name",
    "owner",
    "location",
    "projectState",
    "cycleLabel",
    "packageKey",
    "programmeCore",
    "scopeFingerprint",
    "sourceFingerprint",
    "evidenceCodes",
    "duplicateClusterId",
    "mergedIntoId",
  ];
  const rows = projects.map(project => [
    project.groupKey,
    project.projectId,
    project.projectKey,
    project.name,
    project.owner,
    project.location,
    project.projectState,
    project.cycleLabel,
    project.packageKey,
    project.programmeCore,
    project.scopeFingerprint,
    project.sourceFingerprint,
    project.evidenceCodes.join("|"),
    project.duplicateClusterId,
    project.mergedIntoId,
  ]);
  return `${[headers, ...rows]
    .map(row => row.map(csvCell).join(","))
    .join("\n")}\n`;
}

function fileChecksum(path: string): string {
  return sha256(readFileSync(path));
}

function buildChecksumLedger(outputDir: string): string {
  const filenames = [
    SNAPSHOT_FILENAME,
    MANIFEST_FILENAME,
    GROUPS_FILENAME,
    PROJECTS_FILENAME,
    SUMMARY_FILENAME,
  ];
  return `${filenames
    .map(filename => `${fileChecksum(join(outputDir, filename))}  ${filename}`)
    .join("\n")}\n`;
}

function main(): void {
  const cli = parseCli(process.argv.slice(2));
  assertOutputDirectory(cli.outputDir, cli.snapshotPath);
  if (cli.snapshotPath !== join(cli.outputDir, SNAPSHOT_FILENAME)) {
    throw new Error("RECURRING_PREVIEW_SNAPSHOT_FILENAME_INVALID");
  }
  const snapshot = readJson<RecurringProjectSnapshotDocument>(cli.snapshotPath);
  const manifestPath = join(cli.outputDir, MANIFEST_FILENAME);
  const manifest = readJson<RecurringProjectSnapshotManifest>(manifestPath);
  if (
    snapshot.mode !== "read_only_project_snapshot" ||
    manifest.mode !== "read_only_project_snapshot_manifest" ||
    snapshot.sourceSha !== manifest.sourceSha ||
    snapshot.snapshotRef !== manifest.snapshotRef
  ) {
    throw new Error("RECURRING_PREVIEW_SNAPSHOT_MANIFEST_MISMATCH");
  }
  const snapshotSha256 = canonicalSha256(snapshot);
  if (snapshotSha256 !== manifest.snapshotSha256) {
    throw new Error("RECURRING_PREVIEW_SNAPSHOT_HASH_MISMATCH");
  }

  const reviewPackage = buildRecurringDiscoveryReviewPackage({
    snapshot,
    snapshotSha256,
    configuration: cli.configuration,
  });
  const groupsDocument = {
    version: "recurring-project-discovery-v1",
    mode: "review_only_no_writes",
    sourceSha: snapshot.sourceSha,
    snapshotRef: snapshot.snapshotRef,
    groups: reviewPackage.groups,
  };
  const groupsJson = canonicalJson(groupsDocument);
  const projectsCsv = candidateProjectsCsv(reviewPackage.projects);
  const summaryJson = canonicalJson(reviewPackage.summary);

  writeAtomic(cli.outputDir, GROUPS_FILENAME, groupsJson);
  writeAtomic(cli.outputDir, PROJECTS_FILENAME, projectsCsv);
  writeAtomic(cli.outputDir, SUMMARY_FILENAME, summaryJson);
  writeAtomic(cli.outputDir, CHECKSUM_FILENAME, buildChecksumLedger(cli.outputDir));

  process.stdout.write(
    canonicalJson({
      status: "PASS",
      sourceSha: snapshot.sourceSha,
      snapshotRef: snapshot.snapshotRef,
      snapshotSha256,
      projectCount: snapshot.projects.length,
      candidateProjectCount: reviewPackage.projects.length,
      candidateGroupCount: reviewPackage.groups.length,
      classifications: reviewPackage.summary.classifications,
      groupsOutputSha256: sha256(groupsJson),
      candidateProjectsCsvSha256: sha256(projectsCsv),
      reviewSummarySha256: sha256(summaryJson),
      reviewPackageDeterministicSha256: canonicalSha256({
        groups: reviewPackage.groups,
        projects: reviewPackage.projects,
        summary: reviewPackage.summary,
      }),
      databaseConnections: 0,
      databaseWrites: 0,
      projectDateMutations: 0,
      fullPotentialMonetaryMutations: 0,
      crmC4cMutations: 0,
    }),
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    canonicalJson({
      status: "BLOCKED",
      error: String(error instanceof Error ? error.message : error).slice(0, 512),
    }),
  );
  process.exitCode = 1;
}
