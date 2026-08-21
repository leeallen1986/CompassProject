import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";

interface BuyerInput {
  recordKey: string;
  commercialPoolKey: string;
  buyerAccountKey: string;
  buyerName: string;
  buyerSegment: string;
  application: string;
  productCell: string;
  valueClass: "named_evidenced_core" | "regional_long_tail" | "unobserved_allowance";
  evidenceGrade: "A" | "B" | "C";
  sourceName: string;
  sourceUrl: string;
  publicObservation: string;
  inference: string;
  modelBand: string;
  addressabilityStatus: FullPotentialPublicObservationRecord["addressabilityStatus"];
  qualificationGates: string[];
}

function buyer(input: BuyerInput): FullPotentialPublicObservationRecord {
  return {
    recordKey: input.recordKey,
    commercialPoolKey: input.commercialPoolKey,
    buyerAccountKey: input.buyerAccountKey,
    buyerName: input.buyerName,
    buyerSegment: input.buyerSegment,
    application: input.application,
    productFamily: "e_air",
    productCell: input.productCell,
    countingTreatment: "buyer_counting",
    valueClass: input.valueClass,
    scenarioBasis: "adoption_positions",
    evidenceGrade: input.evidenceGrade,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    observedAt: "2026-08-21",
    publicObservation: input.publicObservation,
    inference: input.inference,
    modelBand: input.modelBand,
    addressabilityStatus: input.addressabilityStatus,
    qualificationGates: input.qualificationGates,
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  };
}

/**
 * Distinct incremental electric-adoption buyer pools.
 *
 * These records do not replace or expand the conventional Rental fleet bands.
 * Their commercialPoolKeys are separate because the private assumptions must
 * describe additional electric product adoption rather than the same equipment
 * replacement counted in the Rental core.
 *
 * No monetary scenarios or current planning values are committed here.
 */
export const FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1: FullPotentialPublicObservationRecord[] = [
  buyer({
    recordKey: "rental:airpac-rentals-australia:ts2-electric-adoption",
    commercialPoolKey: "buyer:airpac-rentals-australia:ts2-electric-adoption",
    buyerAccountKey: "airpac-rentals-australia-au",
    buyerName: "Airpac Rentals Australia",
    buyerSegment: "rental_hire",
    application: "incremental medium electric rental-fleet adoption",
    productCell: "TS2_specialist_rental_electric",
    valueClass: "named_evidenced_core",
    evidenceGrade: "B",
    sourceName: "Airpac Rentals public 530 CFM electric compressor page",
    sourceUrl: "https://www.airpac-rentals.com/rental-services/product-datasheets/530-cfm-157-psi-rigsafe-electric-air-compressor",
    publicObservation: "The public rental page identifies a 530 CFM, 10.8 bar, 415 V three-phase electric compressor mounted in a certified lifting frame for onshore and offshore project use.",
    inference: "Existing electric rental capability supports a distinct incremental TS2 adoption pool; it is not counted inside the conventional Rental replacement pool.",
    modelBand: "TS2-NAMED-ADOPTION",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      "Confirm the locally deployable Atlas Copco TS2 configuration and finished package competitiveness before approval.",
    ],
  }),
  buyer({
    recordKey: "rental:flow-control-engineering:ts2-electric-adoption",
    commercialPoolKey: "buyer:flow-control-engineering:ts2-electric-adoption",
    buyerAccountKey: "flow-control-engineering-au",
    buyerName: "Flow Control Engineering",
    buyerSegment: "rental_hire",
    application: "incremental large electric rental-fleet adoption",
    productCell: "TS2_specialist_rental_electric",
    valueClass: "named_evidenced_core",
    evidenceGrade: "B",
    sourceName: "Flow Control Engineering public VOC 185 electric compressor page",
    sourceUrl: "https://www.flowcontrolengineering.com.au/hire/electric-air-compressors/voc-185",
    publicObservation: "The public hire page identifies a 185 kW electric compressor delivering up to 1095 CFM at 7.5 to 13 bar, with an outdoor-rated enclosure and mining, manufacturing and power-station applications.",
    inference: "The visible large electric hire capability supports a distinct TS2 buyer pool for future rugged Portable Air adoption.",
    modelBand: "TS2-NAMED-ADOPTION",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      "Confirm whether the Portable Air package offers sufficient mobility, outdoor protection and commercial advantage over the incumbent electric hire format.",
    ],
  }),
  buyer({
    recordKey: "rental:premiair-hire:ts4-electric-adoption",
    commercialPoolKey: "buyer:premiair-hire:ts4-electric-adoption",
    buyerAccountKey: "premiair-hire-au",
    buyerName: "PremiAir Hire",
    buyerSegment: "rental_hire",
    application: "incremental high-pressure electric rental-fleet adoption",
    productCell: "TS4_specialist_rental_electric",
    valueClass: "named_evidenced_core",
    evidenceGrade: "B",
    sourceName: "PremiAir Hire public electric compressor range",
    sourceUrl: "https://premiairhire.com.au/equipment/cfm-electric-compressor/",
    publicObservation: "The public range describes electric compressors from 2.2 kW to 315 kW and pressure configurations extending through 20 and 25 bar, alongside high-pressure drilling, gas-line, mining and exploration applications.",
    inference: "Public high-pressure electric capability supports a named TS4 adoption pool, subject to product differentiation and local package economics.",
    modelBand: "TS4-NAMED-ADOPTION",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      "Validate the incumbent high-pressure electric configuration, replacement logic and finished local-package value before approval.",
    ],
  }),
  buyer({
    recordKey: "rental:access-hire-oil-gas:ts4-electric-adoption",
    commercialPoolKey: "buyer:access-hire-oil-gas:ts4-electric-adoption",
    buyerAccountKey: "access-hire-oil-gas-au",
    buyerName: "Access Hire Oil & Gas",
    buyerSegment: "rental_hire",
    application: "high-pressure electric conversion opportunity in an established specialist fleet",
    productCell: "TS4_specialist_rental_electric",
    valueClass: "named_evidenced_core",
    evidenceGrade: "C",
    sourceName: "Access Hire Oil & Gas public XRVS 1050 page",
    sourceUrl: "https://www.accessoilandgas.com.au/product/atlas-copco-xrvs-1050-cd/",
    publicObservation: "The public fleet page identifies a 1050 CFM, 25 bar Atlas Copco high-pressure compressor for heavy-duty and large-scale high-pressure applications.",
    inference: "The established high-pressure fleet makes electric conversion commercially relevant where suitable site power exists; the record does not claim a current electric installed fleet.",
    modelBand: "TS4-NAMED-ADOPTION",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      "Confirm powered-application demand, site-supply suitability and whether an electric package improves total rental economics.",
    ],
  }),
  buyer({
    recordKey: "rental:airpac-rentals-australia:ts4-electric-adoption",
    commercialPoolKey: "buyer:airpac-rentals-australia:ts4-electric-adoption",
    buyerAccountKey: "airpac-rentals-australia-au",
    buyerName: "Airpac Rentals Australia",
    buyerSegment: "rental_hire",
    application: "high-pressure electric conversion opportunity in an established offshore and project fleet",
    productCell: "TS4_specialist_rental_electric",
    valueClass: "named_evidenced_core",
    evidenceGrade: "C",
    sourceName: "Airpac Rentals public 900 and 1070 CFM high-pressure page",
    sourceUrl: "https://www.airpac-rentals.com/rental-services/product-datasheets/1070-900-cfm-350-psi-rigsafe-air-compressors",
    publicObservation: "The public range identifies 900 and 1070 CFM high-pressure compressors at 24.1 bar in certified lifting frames for pipeline drying and specialist project applications.",
    inference: "The high-pressure project fleet supports a distinct TS4 electric-conversion hypothesis; it does not assert present electric high-pressure adoption.",
    modelBand: "TS4-NAMED-ADOPTION",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      "Confirm the share of powered safe-area work that can support a large electric primary compressor.",
    ],
  }),
  buyer({
    recordKey: "rental:flow-control-engineering:ts4-electric-adoption",
    commercialPoolKey: "buyer:flow-control-engineering:ts4-electric-adoption",
    buyerAccountKey: "flow-control-engineering-au",
    buyerName: "Flow Control Engineering",
    buyerSegment: "rental_hire",
    application: "high-pressure electric conversion opportunity in an established Sullair fleet",
    productCell: "TS4_specialist_rental_electric",
    valueClass: "named_evidenced_core",
    evidenceGrade: "C",
    sourceName: "Flow Control Engineering public 900XHH and 1150XH page",
    sourceUrl: "https://www.flowcontrolengineering.com.au/hire/diesel-air-compressors/900XHH-1150XH",
    publicObservation: "The public hire page identifies 900 CFM at 34.5 bar or 1150 CFM at 24 bar for drilling, mining, blasting, power stations, oil and gas and factory shutdowns.",
    inference: "The visible high-pressure demand and existing large electric hire capability support a TS4 electric-conversion hypothesis without claiming current electric high-pressure fleet units.",
    modelBand: "TS4-NAMED-ADOPTION",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      "Confirm which high-pressure applications have suitable grid power and remain inside the 20 to 25 bar product envelope.",
    ],
  }),
  buyer({
    recordKey: "allowance:ts4:direct-powered-projects",
    commercialPoolKey: "allowance:ts4:direct-powered-projects",
    buyerAccountKey: "ts4-direct-powered-project-allowance",
    buyerName: "TS4 direct powered-project allowance",
    buyerSegment: "mining_direct",
    application: "direct powered-site high-pressure electric adoption",
    productCell: "TS4_direct_powered_project_allowance",
    valueClass: "unobserved_allowance",
    evidenceGrade: "C",
    sourceName: "Access Hire Oil & Gas public high-pressure application page",
    sourceUrl: "https://www.accessoilandgas.com.au/products/air-compressors/high-pressure-compressors/",
    publicObservation: "Public specialist-rental material identifies 20 to 25 bar demand across drilling, pipeline testing, dewatering, drying and LNG or pipework testing applications.",
    inference: "A separately labelled direct-project allowance captures possible powered-site adoption that is not yet assigned to named buyers; it must not be represented as a named customer fleet.",
    modelBand: "TS4-DIRECT-ALLOWANCE",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      "Replace this allowance with named public buyer pools before any production import or account-level approval.",
    ],
  }),
];
