import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateRyanPortfolioAudit } from "../ryanPortfolioAudit";
import type {
  RyanPortfolioAuditReport,
  RyanPortfolioAuditRow,
} from "../ryanPortfolioAudit.shared";

interface CliOptions {
  userId: number;
  outputDir: string;
  worstLimit: number;
}

function parsePositiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }

  const outputDir = values.get("--output-dir")?.trim();
  if (!outputDir) throw new Error("--output-dir is required");

  return {
    userId: parsePositiveInteger(values.get("--user-id"), "--user-id"),
    outputDir,
    worstLimit: values.has("--worst-limit")
      ? parsePositiveInteger(values.get("--worst-limit"), "--worst-limit")
      : 15,
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join(";") : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowsToCsv(rows: RyanPortfolioAuditRow[]): string {
  const header = [
    "projectId",
    "projectName",
    "thisWeekRank",
    "priority",
    "actionTier",
    "relevanceScore",
    "primaryClassification",
    "flags",
    "severity",
    "productFitProven",
    "packageHolderCount",
    "exactContactCount",
    "namedContactCount",
    "effectiveSendReadyCount",
    "buyerLaneContactCount",
    "effectiveBuyerContactCount",
    "principalOrReferralContactCount",
    "contactCTAAction",
    "bestStakeholderShown",
    "bestStakeholderEmailShown",
    "reasons",
    "correctiveActions",
  ];

  const body = rows.map(row => [
    row.projectId,
    row.projectName,
    row.thisWeekRank,
    row.priority,
    row.actionTier,
    row.relevanceScore,
    row.primaryClassification,
    row.flags,
    row.severity,
    row.metrics.productFitProven,
    row.metrics.packageHolderCount,
    row.metrics.exactContactCount,
    row.metrics.namedContactCount,
    row.metrics.effectiveSendReadyCount,
    row.metrics.buyerLaneContactCount,
    row.metrics.effectiveBuyerContactCount,
    row.metrics.principalOrReferralContactCount,
    row.cardState.contactCTAAction,
    row.cardState.bestStakeholderShown,
    row.cardState.bestStakeholderEmailShown,
    row.reasons,
    row.correctiveActions,
  ].map(csvCell).join(","));

  return `${header.join(",")}\n${body.join("\n")}\n`;
}

function reportToMarkdown(report: RyanPortfolioAuditReport): string {
  const countRows = Object.entries(report.summary.primaryClassifications)
    .map(([classification, count]) => `| \`${classification}\` | ${count} |`)
    .join("\n");
  const worstRows = report.worst15.length > 0
    ? report.worst15.map((row, index) => [
        `### ${index + 1}. ${row.projectName} (project ${row.projectId})`,
        "",
        `- This Week rank: ${row.thisWeekRank}`,
        `- Primary classification: \`${row.primaryClassification}\``,
        `- Flags: ${row.flags.map(flag => `\`${flag}\``).join(", ")}`,
        `- Product fit proven: ${row.metrics.productFitProven}`,
        `- Package holders: ${row.metrics.packageHolderCount}`,
        `- Exact contacts: ${row.metrics.exactContactCount}`,
        `- Effective buyer-lane contacts: ${row.metrics.effectiveBuyerContactCount}`,
        `- Card CTA: \`${row.cardState.contactCTAAction}\``,
        "- Why:",
        ...row.reasons.map(reason => `  - ${reason}`),
        "- Corrective action:",
        ...row.correctiveActions.map(action => `  - ${action}`),
        "",
      ].join("\n")).join("\n")
    : "No projects require correction.";

  return [
    "# Ryan-mode portfolio audit",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Rep: ${report.rep.name} (user ${report.rep.userId})`,
    `- Week: ${report.weekLabel}`,
    `- This Week projects audited: ${report.sourceProjectCount}`,
    `- Action ready: ${report.summary.actionReadyCount}`,
    `- Requiring correction: ${report.summary.projectsRequiringCorrection}`,
    "",
    "## Primary classifications",
    "",
    "| Classification | Count |",
    "|---|---:|",
    countRows,
    "",
    "## Worst 15",
    "",
    worstRows,
    "",
    "## Safety boundary",
    "",
    "This report is generated from existing read paths only. It performs no project, contact, provider, pipeline, outreach or database mutation and intentionally excludes plaintext email addresses.",
    "",
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await generateRyanPortfolioAudit(options.userId, {
    worstLimit: options.worstLimit,
  });
  const outputDir = path.resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, "ryan-portfolio-audit.json");
  const csvPath = path.join(outputDir, "ryan-portfolio-audit.csv");
  const markdownPath = path.join(outputDir, "ryan-portfolio-audit.md");

  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(csvPath, rowsToCsv(report.rows), "utf8"),
    writeFile(markdownPath, reportToMarkdown(report), "utf8"),
  ]);

  console.log(JSON.stringify({
    status: "RYAN_PORTFOLIO_AUDIT_COMPLETE",
    userId: options.userId,
    sourceProjectCount: report.sourceProjectCount,
    actionReadyCount: report.summary.actionReadyCount,
    projectsRequiringCorrection: report.summary.projectsRequiringCorrection,
    files: { jsonPath, csvPath, markdownPath },
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
