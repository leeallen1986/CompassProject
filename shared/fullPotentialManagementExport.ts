import type {
  FullPotentialManagementReadiness,
} from "./fullPotentialManagementReadiness";
import type {
  FullPotentialManagementBuyerRow,
  FullPotentialManagementRow,
  FullPotentialManagementScenarioValue,
  FullPotentialSeptemberManagementView,
} from "./fullPotentialManagementView";

export interface FullPotentialManagementExportOptions {
  title?: string;
  asOfLabel?: string;
  meetingDateLabel?: string;
  currencyLabel?: string;
}

export interface FullPotentialManagementExportBundle {
  markdown: string;
  csv: {
    headline: string;
    buyerSegments: string;
    productCells: string;
    confidence: string;
    qualificationGaps: string;
    qualificationUniverse: string;
    dataGaps: string;
  };
}

function formatAud(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Pending";
  if (Math.abs(value) >= 1_000_000) return `A$${(value / 1_000_000).toFixed(1)}m`;
  if (Math.abs(value) >= 1_000) return `A$${(value / 1_000).toFixed(0)}k`;
  return `A$${Math.round(value).toLocaleString("en-AU")}`;
}

function escapeMarkdown(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csv(rows: unknown[][]): string {
  return rows.map(row => row.map(csvCell).join(",")).join("\n") + "\n";
}

function scenarioMarkdown(value: FullPotentialManagementScenarioValue): string {
  return `${formatAud(value.lowAud)} / **${formatAud(value.baseAud)}** / ${formatAud(value.highAud)}`;
}

function scenarioCsvRow(
  key: string,
  label: string,
  value: FullPotentialManagementScenarioValue,
  extras: unknown[] = [],
): unknown[] {
  return [key, label, value.lowAud, value.baseAud, value.highAud, ...extras];
}

function rowTable(
  title: string,
  rows: FullPotentialManagementRow[],
): string[] {
  if (rows.length === 0) return [`### ${title}`, "", "No quantified rows.", ""];
  return [
    `### ${title}`,
    "",
    "| Item | Records | Low | Base | High | Share of Base |",
    "|---|---:|---:|---:|---:|---:|",
    ...rows.map(row => `| ${escapeMarkdown(row.label)} | ${row.recordCount} | ${formatAud(row.lowAud)} | **${formatAud(row.baseAud)}** | ${formatAud(row.highAud)} | ${row.shareOfBasePct.toFixed(1)}% |`),
    "",
  ];
}

function buyerTable(rows: FullPotentialManagementBuyerRow[]): string[] {
  if (rows.length === 0) return ["### Buyer segments", "", "No quantified buyer segments.", ""];
  return [
    "### Buyer segments",
    "",
    "| Buyer segment | Low | Base | High | Current revenue | Period | Remaining Base potential |",
    "|---|---:|---:|---:|---:|---|---:|",
    ...rows.map(row => `| ${escapeMarkdown(row.label)} | ${formatAud(row.lowAud)} | **${formatAud(row.baseAud)}** | ${formatAud(row.highAud)} | ${formatAud(row.currentRevenueAud)} | ${escapeMarkdown(row.currentRevenuePeriod ?? "Pending")} | ${formatAud(row.remainingBasePotentialAud)} |`),
    "",
  ];
}

function qualificationUniverseTable(view: FullPotentialSeptemberManagementView): string[] {
  const records = view.qualificationUniverse.records;
  if (records.length === 0) {
    return [
      "## Named qualification universe",
      "",
      "No named non-counting qualification contexts in this snapshot.",
      "",
    ];
  }

  const classSummary = view.qualificationUniverse.byModelBand
    .map(row => `${row.label}: ${row.count}`)
    .join("; ");

  return [
    "## Named qualification universe",
    "",
    `**Named public qualification contexts:** ${view.qualificationUniverse.namedBuyerContextCount}  `,
    `**Class distribution:** ${escapeMarkdown(classSummary || "Unbanded")}`,
    "",
    "> These are public-evidence qualification targets only. They carry no monetary Full Potential until a distinct buyer application is proven and separately reviewed.",
    "",
    "| Buyer | Segment | Application | Product cell | Class | Status | Public source |",
    "|---|---|---|---|---|---|---|",
    ...records.map(record => `| ${escapeMarkdown(record.buyerName)} | ${escapeMarkdown(record.buyerSegment.replace(/_/g, " "))} | ${escapeMarkdown(record.application)} | ${escapeMarkdown(record.productCell)} | ${escapeMarkdown(record.modelBand ?? "—")} | ${escapeMarkdown(record.addressabilityStatus.replace(/_/g, " "))} | ${escapeMarkdown(record.sourceName)} |`),
    "",
  ];
}

export function buildFullPotentialManagementMarkdown(
  view: FullPotentialSeptemberManagementView,
  readiness: FullPotentialManagementReadiness,
  options: FullPotentialManagementExportOptions = {},
): string {
  const title = options.title ?? "Oceania Portable Air Full Potential";
  const asOf = options.asOfLabel ?? "As-of date not supplied";
  const meeting = options.meetingDateLabel ?? "3 September 2026";

  const lines: string[] = [
    `# ${title}`,
    "",
    `**Management review:** ${escapeMarkdown(meeting)}  `,
    `**Evidence snapshot:** ${escapeMarkdown(asOf)}  `,
    `**Methodology:** ${escapeMarkdown(view.methodologyVersion)}  `,
    `**Readiness:** ${readiness.meetingStatus.replace(/_/g, " ").toUpperCase()}`,
    "",
    "> Estimated market potential is derived from public evidence and transparent assumptions. Fleet quantities are inferred ranges, not customer-provided or confidential installed-base data.",
    "",
    "## Executive headline",
    "",
    "| Value class | Low / Base / High |",
    "|---|---:|",
    `| Named Evidenced Core | ${scenarioMarkdown(view.headline.namedEvidencedCore)} |`,
    `| Regional Long Tail | ${scenarioMarkdown(view.headline.regionalLongTail)} |`,
    `| Unobserved Allowance | ${scenarioMarkdown(view.headline.unobservedAllowance)} |`,
    `| **Total** | ${scenarioMarkdown(view.headline.total)} |`,
    "",
    "## Addressability",
    "",
    "| Classification | Low / Base / High |",
    "|---|---:|",
    `| Addressable now | ${scenarioMarkdown(view.addressability.addressableNow)} |`,
    `| Conditional factory / voltage / compliance | ${scenarioMarkdown(view.addressability.conditional)} |`,
    `| Portfolio-gap evidence records | ${view.addressability.portfolioGapRecordCount} |`,
    `| Excluded records | ${view.addressability.excludedRecordCount} |`,
    "",
    ...qualificationUniverseTable(view),
    ...buyerTable(view.buyerSegments),
    ...rowTable("Product cells", view.productCells),
    ...rowTable("Evidence confidence", view.confidence),
    ...rowTable("Qualification gaps", view.qualificationGaps),
    "## Declared data gaps",
    "",
  ];

  if (readiness.dataGaps.length === 0) {
    lines.push("No declared gaps for this snapshot.", "");
  } else {
    lines.push(
      "| Gap | Severity | Headline impact | Current-vs-potential impact | Import impact | Treatment |",
      "|---|---|---|---|---|---|",
      ...readiness.dataGaps.map(gap => `| ${escapeMarkdown(gap.label)} | ${gap.severity} | ${gap.blocksHeadline ? "Blocked" : "No"} | ${gap.blocksCurrentVsPotentialGap ? "Pending" : "No"} | ${gap.blocksDraftImport ? "Blocked" : "No"} | ${escapeMarkdown(gap.treatment)} |`),
      "",
    );
  }

  lines.push(
    "## Reconciliation and governance",
    "",
    `- Buyer-segment Base total: **${formatAud(view.reconciliation.buyerSegmentBaseAud)}**`,
    `- Headline Base total: **${formatAud(view.reconciliation.headlineBaseAud)}**`,
    `- Reconciliation difference: **${formatAud(view.reconciliation.differenceAud)}**`,
    `- Reconciled: **${view.reconciliation.reconciled ? "Yes" : "No"}**`,
    `- Counting records: **${view.countingRecordCount}**`,
    `- Non-counting context/application records: **${view.nonCountingRecordCount}**`,
    "",
    ...view.governanceNotes.map(note => `- ${escapeMarkdown(note)}`),
    ...readiness.meetingNotes.map(note => `- ${escapeMarkdown(note)}`),
    "",
    "## Decisions required",
    "",
    "1. Confirm whether the Base scenario is suitable as the management planning case.",
    "2. Confirm the product-qualification priorities that should move conditional value toward addressable-now.",
    "3. Confirm which buyer segments and named accounts require the first commercial action plans.",
    "4. Confirm whether any Regional Long Tail or Unobserved Allowance should be added after the Named Evidenced Core is accepted.",
    "5. Keep customer-specific conversations, contacts, quotations and close plans in CRM/C4C rather than Full Potential.",
    "",
  );

  return lines.join("\n");
}

function rowsCsv(rows: FullPotentialManagementRow[]): string {
  return csv([
    ["key", "label", "record_count", "low_aud", "base_aud", "high_aud", "share_of_base_pct"],
    ...rows.map(row => [
      row.key,
      row.label,
      row.recordCount,
      row.lowAud,
      row.baseAud,
      row.highAud,
      row.shareOfBasePct,
    ]),
  ]);
}

export function buildFullPotentialManagementCsvBundle(
  view: FullPotentialSeptemberManagementView,
  readiness: FullPotentialManagementReadiness,
): FullPotentialManagementExportBundle["csv"] {
  const headline = csv([
    ["key", "label", "low_aud", "base_aud", "high_aud", "record_count", "status"],
    scenarioCsvRow("named_evidenced_core", "Named Evidenced Core", view.headline.namedEvidencedCore, [view.countingRecordCount, readiness.meetingStatus]),
    scenarioCsvRow("regional_long_tail", "Regional Long Tail", view.headline.regionalLongTail, ["", readiness.meetingStatus]),
    scenarioCsvRow("unobserved_allowance", "Unobserved Allowance", view.headline.unobservedAllowance, ["", readiness.meetingStatus]),
    scenarioCsvRow("total", "Total", view.headline.total, [view.generatedFromRecordCount, readiness.meetingStatus]),
    scenarioCsvRow("addressable_now", "Addressable now", view.addressability.addressableNow, ["", readiness.meetingStatus]),
    scenarioCsvRow("conditional", "Conditional", view.addressability.conditional, ["", readiness.meetingStatus]),
  ]);

  const buyerSegments = csv([
    [
      "key",
      "label",
      "record_count",
      "low_aud",
      "base_aud",
      "high_aud",
      "share_of_base_pct",
      "current_revenue_aud",
      "current_revenue_period",
      "current_revenue_source_reference",
      "remaining_base_potential_aud",
    ],
    ...view.buyerSegments.map(row => [
      row.key,
      row.label,
      row.recordCount,
      row.lowAud,
      row.baseAud,
      row.highAud,
      row.shareOfBasePct,
      row.currentRevenueAud ?? "",
      row.currentRevenuePeriod ?? "",
      row.currentRevenueSourceReference ?? "",
      row.remainingBasePotentialAud ?? "",
    ]),
  ]);

  const qualificationUniverse = csv([
    [
      "record_key",
      "buyer_name",
      "buyer_account_key",
      "buyer_segment",
      "application",
      "product_cell",
      "model_band",
      "evidence_grade",
      "addressability_status",
      "source_name",
      "source_url",
    ],
    ...view.qualificationUniverse.records.map(record => [
      record.recordKey,
      record.buyerName,
      record.buyerAccountKey ?? "",
      record.buyerSegment,
      record.application,
      record.productCell,
      record.modelBand ?? "",
      record.evidenceGrade,
      record.addressabilityStatus,
      record.sourceName,
      record.sourceUrl,
    ]),
  ]);

  const dataGaps = csv([
    [
      "key",
      "label",
      "severity",
      "blocks_headline",
      "blocks_current_vs_potential_gap",
      "blocks_draft_import",
      "treatment",
    ],
    ...readiness.dataGaps.map(gap => [
      gap.key,
      gap.label,
      gap.severity,
      gap.blocksHeadline,
      gap.blocksCurrentVsPotentialGap,
      gap.blocksDraftImport,
      gap.treatment,
    ]),
  ]);

  return {
    headline,
    buyerSegments,
    productCells: rowsCsv(view.productCells),
    confidence: rowsCsv(view.confidence),
    qualificationGaps: rowsCsv(view.qualificationGaps),
    qualificationUniverse,
    dataGaps,
  };
}

export function buildFullPotentialManagementExportBundle(
  view: FullPotentialSeptemberManagementView,
  readiness: FullPotentialManagementReadiness,
  options: FullPotentialManagementExportOptions = {},
): FullPotentialManagementExportBundle {
  return {
    markdown: buildFullPotentialManagementMarkdown(view, readiness, options),
    csv: buildFullPotentialManagementCsvBundle(view, readiness),
  };
}
