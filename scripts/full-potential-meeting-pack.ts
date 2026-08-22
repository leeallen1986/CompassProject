import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FP_RENTAL_PUBLIC_CORE_V1,
  FP_RENTAL_PUBLIC_MARKET_CONTEXT_V1,
} from "../server/fullPotentialRentalPublicCore";
import { FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1 } from "../server/fullPotentialToughStationaryPublicApplications";
import { FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1 } from "../server/fullPotentialToughStationaryPublicBuyerCore";
import { FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1 } from "../server/fullPotentialToughStationaryDirectMiningCore";
import { FP_TS2_PUBLIC_BUYER_UNIVERSE_V1 } from "../server/fullPotentialTs2PublicBuyerUniverse";
import {
  buildAdoptionRestrictedPlanningPack,
  buildRentalRestrictedPlanningPack,
  type FullPotentialAdoptionPlanningDefaults,
  type FullPotentialRentalPlanningDefaults,
} from "../shared/fullPotentialRestrictedPlanningFactory";
import type { FullPotentialManagementCurrentRevenueInput } from "../shared/fullPotentialManagementView";
import type { FullPotentialManagementReadinessInput } from "../shared/fullPotentialManagementReadiness";
import type { FullPotentialManagementExportOptions } from "../shared/fullPotentialManagementExport";
import {
  buildFullPotentialMeetingPack,
  verifyFullPotentialMeetingPack,
} from "../server/fullPotentialMeetingPack";

interface MeetingPackCliInput {
  rentalPlanning: FullPotentialRentalPlanningDefaults;
  /** Optional specialist-rental TS2/TS4 adoption planning. */
  toughStationaryPlanning?: FullPotentialAdoptionPlanningDefaults;
  currentRevenueInputs?: FullPotentialManagementCurrentRevenueInput[];
  readiness: FullPotentialManagementReadinessInput;
  exportOptions?: FullPotentialManagementExportOptions;
  generatedAt: string;
  sourcePackRef: string;
}

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
        "  pnpm exec tsx scripts/full-potential-meeting-pack.ts --input <private.json> --output-dir <dir>",
        "  pnpm exec tsx scripts/full-potential-meeting-pack.ts --input <private.json> --check-only",
        "",
        "The input contains restricted aggregate planning assumptions. Do not commit it to the public repository.",
        "Specialist-rental Tough Stationary planning is optional. Direct-mining TS3 evidence remains non-counting until a distinct application is qualified.",
        "The command performs no database, CRM, provider, pipeline or deployment action.",
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

function assertInput(value: unknown): asserts value is MeetingPackCliInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Input must be a JSON object");
  }
  const input = value as Record<string, unknown>;
  if (!input.rentalPlanning || typeof input.rentalPlanning !== "object") {
    throw new Error("rentalPlanning is required");
  }
  if (
    input.toughStationaryPlanning !== undefined
    && (!input.toughStationaryPlanning || typeof input.toughStationaryPlanning !== "object")
  ) {
    throw new Error("toughStationaryPlanning must be an object when supplied");
  }
  if (!input.readiness || typeof input.readiness !== "object") {
    throw new Error("readiness is required");
  }
  if (typeof input.generatedAt !== "string" || typeof input.sourcePackRef !== "string") {
    throw new Error("generatedAt and sourcePackRef are required strings");
  }
  if (input.currentRevenueInputs !== undefined && !Array.isArray(input.currentRevenueInputs)) {
    throw new Error("currentRevenueInputs must be an array when supplied");
  }
}

async function writeOutputs(outputDir: string, pack: ReturnType<typeof buildFullPotentialMeetingPack>) {
  await mkdir(outputDir, { recursive: true });
  const writes: Array<[string, string]> = [
    ["management-brief.md", pack.exportBundle.markdown],
    ["management-view.json", `${JSON.stringify(pack.view, null, 2)}\n`],
    ["management-readiness.json", `${JSON.stringify(pack.readiness, null, 2)}\n`],
    ["meeting-pack-manifest.json", `${JSON.stringify(pack.manifest, null, 2)}\n`],
    ["headline.csv", pack.exportBundle.csv.headline],
    ["buyer-segments.csv", pack.exportBundle.csv.buyerSegments],
    ["product-cells.csv", pack.exportBundle.csv.productCells],
    ["confidence.csv", pack.exportBundle.csv.confidence],
    ["qualification-gaps.csv", pack.exportBundle.csv.qualificationGaps],
    ["qualification-universe.csv", pack.exportBundle.csv.qualificationUniverse],
    ["data-gaps.csv", pack.exportBundle.csv.dataGaps],
  ];
  await Promise.all(writes.map(([fileName, content]) => (
    writeFile(path.join(outputDir, fileName), content, "utf8")
  )));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readFile(options.inputPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  assertInput(parsed);

  const rentalPlanning = buildRentalRestrictedPlanningPack(
    FP_RENTAL_PUBLIC_CORE_V1,
    parsed.rentalPlanning,
  );
  const specialistBuyerObservations = parsed.toughStationaryPlanning
    ? FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1
    : [];
  const specialistPlanning = parsed.toughStationaryPlanning
    ? buildAdoptionRestrictedPlanningPack(
      FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1,
      parsed.toughStationaryPlanning,
    )
    : [];
  const rentalMarketContext = FP_RENTAL_PUBLIC_MARKET_CONTEXT_V1.map(record => ({
    ...record,
    // Excluded competitor/channel context is visible in market cuts but is not
    // a named qualification target or monetary account-reconciliation input.
    buyerAccountKey: null,
  }));

  const pack = buildFullPotentialMeetingPack({
    publicObservations: [
      ...FP_RENTAL_PUBLIC_CORE_V1,
      ...rentalMarketContext,
      ...specialistBuyerObservations,
      ...FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1,
      ...FP_TS2_PUBLIC_BUYER_UNIVERSE_V1,
      ...FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1,
    ],
    restrictedPlanning: [
      ...rentalPlanning,
      ...specialistPlanning,
    ],
    currentRevenueInputs: parsed.currentRevenueInputs ?? [],
    readiness: parsed.readiness,
    exportOptions: parsed.exportOptions,
    generatedAt: parsed.generatedAt,
    sourcePackRef: parsed.sourcePackRef,
  });
  verifyFullPotentialMeetingPack(pack);

  if (!options.checkOnly) await writeOutputs(options.outputDir, pack);

  console.log(JSON.stringify({
    status: "PASS",
    mode: options.checkOnly ? "check_only" : "write_outputs",
    meetingStatus: pack.readiness.meetingStatus,
    includedToughStationaryBuyerPlanning: Boolean(parsed.toughStationaryPlanning),
    publicObservationCount: pack.manifest.publicObservationCount,
    restrictedPlanningCount: pack.manifest.restrictedPlanningCount,
    countingRecordCount: pack.manifest.countingRecordCount,
    nonCountingRecordCount: pack.manifest.nonCountingRecordCount,
    namedQualificationContextCount: pack.view.qualificationUniverse.namedBuyerContextCount,
    ts2SurfacePositionUniverse: pack.view.qualificationUniverse.ts2SurfacePositionUniverse,
    ts3UndergroundPositionUniverse: pack.view.qualificationUniverse.ts3UndergroundPositionUniverse,
    missingCurrentRevenueSegments: pack.readiness.missingCurrentRevenueSegments,
    manifestSha256: pack.manifest.manifestSha256,
    outputDir: options.checkOnly ? null : options.outputDir,
  }, null, 2));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  console.error(JSON.stringify({ status: "BLOCKED", error: message }, null, 2));
  process.exitCode = 1;
});
