import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";
import type { FullPotentialUndergroundPositionClass } from "../shared/fullPotentialPublicBands";

interface DirectMiningInput {
  recordKey: string;
  buyerAccountKey: string;
  buyerName: string;
  application: string;
  sourceName: string;
  sourceUrl: string;
  publicObservation: string;
  inference: string;
  positionClass: FullPotentialUndergroundPositionClass;
  qualificationGates: string[];
}

function directMining(input: DirectMiningInput): FullPotentialPublicObservationRecord {
  return {
    recordKey: input.recordKey,
    commercialPoolKey: null,
    buyerAccountKey: input.buyerAccountKey,
    buyerName: input.buyerName,
    buyerSegment: "underground_mining",
    application: input.application,
    productFamily: "e_air",
    productCell: "TS3_underground_mining_buyer",
    countingTreatment: "context_non_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "adoption_positions",
    evidenceGrade: "B",
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    observedAt: "2026-08-21",
    publicObservation: input.publicObservation,
    inference: input.inference,
    modelBand: input.positionClass,
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      ...input.qualificationGates,
      "Do not create a monetary buyer pool until a distinct relocatable underground compressed-air application is qualified.",
      "Separate new equipment adoption from central reticulation, existing package overhaul and life-extension paths.",
    ],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  };
}

/**
 * Named direct-mining qualification contexts supported by public operating
 * evidence. These records are not commercial pools and carry no monetary
 * scenarios. They identify where TS3 application qualification should focus.
 *
 * The position class is a transparent non-monetary adoption sensitivity, not an
 * installed-base claim, customer intent or sales forecast.
 */
export const FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1: FullPotentialPublicObservationRecord[] = [
  directMining({
    recordKey: "ts3:qualification:greatland:telfer",
    buyerAccountKey: "greatland-au",
    buyerName: "Greatland",
    application: "relocatable underground electric air at Telfer",
    sourceName: "Greatland public Telfer asset page",
    sourceUrl: "https://www.greatland.com.au/assets/telfer/",
    publicObservation: "The public asset page identifies Telfer as an operating mine with both open-pit and Main Dome underground mining, substantial processing infrastructure and active contractor mining.",
    inference: "Combined with separately retained public underground-compressor case evidence, Telfer is a priority TS3 qualification context without asserting current equipment quantity or replacement timing.",
    positionClass: "U3",
    qualificationGates: [
      "Validate the locally deployable voltage, skid, mine-spec and compliance package for any qualified underground position.",
    ],
  }),
  directMining({
    recordKey: "ts3:qualification:gold-fields-australia:portfolio",
    buyerAccountKey: "gold-fields-australia-au",
    buyerName: "Gold Fields Australia",
    application: "relocatable underground electric air across the Australian underground portfolio",
    sourceName: "Gold Fields public Australia operations page",
    sourceUrl: "https://www.goldfields.com/australia-operations.php",
    publicObservation: "The public Australia portfolio lists three underground operations at Agnew, one at Granny Smith and two underground operations at St Ives, alongside long-life operating plans and growing renewable-energy use.",
    inference: "The multi-operation underground portfolio supports a priority TS3 qualification context; actual compressor architecture, fleet quantity and replacement timing remain unobserved.",
    positionClass: "U3",
    qualificationGates: [
      "Qualify mine-by-mine use of local relocatable packages versus central permanent compressed-air infrastructure.",
      "Prevent separate site overlays from duplicating any later group-level commercial pool.",
    ],
  }),
  directMining({
    recordKey: "ts3:qualification:newmont:tanami",
    buyerAccountKey: "newmont-australia-au",
    buyerName: "Newmont Australia",
    application: "deep underground relocatable electric air at Tanami",
    sourceName: "Newmont public Tanami operations page",
    sourceUrl: "https://operations.newmont.com/australia/tanami/",
    publicObservation: "The public page describes Tanami as one of Australia's largest underground gold mines, extending beyond 1.7 kilometres underground with a major shaft and infrastructure expansion supporting mine life to approximately 2040.",
    inference: "The scale, depth and long-life expansion support a priority TS3 qualification context; the record does not assert that every underground work area requires a new compressor package.",
    positionClass: "U3",
    qualificationGates: [
      "Confirm the local compressed-air architecture, voltage standard and mobile-package need within the expansion and operating mine.",
    ],
  }),
  directMining({
    recordKey: "ts3:qualification:evolution:mungari",
    buyerAccountKey: "evolution-mining-au",
    buyerName: "Evolution Mining",
    application: "underground mine-spec electric air at Mungari",
    sourceName: "Evolution Mining FY25 Mungari fact sheet",
    sourceUrl: "https://evolutionmining.com.au/storage/2024/10/FY25-Fact-sheet-Mungari_June-2025.pdf",
    publicObservation: "Evolution's public FY25 fact sheet states that Mungari uses conventional open-pit and underground mining, has mine life to at least 2038, grid power from Western Power and a processing expansion from about 2 Mtpa to 4.2 Mtpa.",
    inference: "The long-life underground operation, grid connection and expanded processing footprint support a material TS3 qualification context, conditional on identifying a distinct relocatable underground application outside conventional fixed plant air.",
    positionClass: "U2",
    qualificationGates: [
      "Identify the boundary between underground mine packages, surface auxiliary air and conventional stationary plant equipment.",
    ],
  }),
  directMining({
    recordKey: "ts3:qualification:evolution:cowal",
    buyerAccountKey: "evolution-mining-au",
    buyerName: "Evolution Mining",
    application: "underground relocatable electric air at Cowal",
    sourceName: "Evolution Mining FY25 Cowal Forward Program",
    sourceUrl: "https://evolutionmining.com.au/storage/2025/10/CGO_Forward_Program_FY25FINAL__.pdf",
    publicObservation: "Evolution's public Cowal Forward Program describes active underground development and production, multiple access points and declines, ventilation expansion and continuing underground services development across FY26 to FY28.",
    inference: "The sustained multi-year underground development program supports a material TS3 qualification context under the Evolution buyer without asserting current equipment quantity or procurement timing.",
    positionClass: "U2",
    qualificationGates: [
      "Confirm a relocatable underground requirement that is distinct from the site's permanent plant and existing reticulation.",
    ],
  }),
  directMining({
    recordKey: "ts3:qualification:evolution:ernest-henry",
    buyerAccountKey: "evolution-mining-au",
    buyerName: "Evolution Mining",
    application: "underground relocatable electric air at Ernest Henry",
    sourceName: "Evolution Mining Ernest Henry Update July 2025",
    sourceUrl: "https://evolutionmining.com.au/storage/2025/07/EHO-Update-July-2025-External.pdf",
    publicObservation: "Evolution's public July 2025 update describes work to extend Ernest Henry to 2040, a ventilation upgrade, refrigeration infrastructure and mining below the current underground crusher with a growing underground truck fleet.",
    inference: "The deepening operation, ventilation investment and expanding underground fleet support a priority TS3 qualification context, subject to qualification of a distinct relocatable compressed-air requirement.",
    positionClass: "U3",
    qualificationGates: [
      "Confirm the underground package application and avoid counting conventional processing-plant compressed air.",
    ],
  }),
  directMining({
    recordKey: "ts3:qualification:29metals:golden-grove",
    buyerAccountKey: "29metals-au",
    buyerName: "29Metals",
    application: "multi-front underground relocatable electric air at Golden Grove",
    sourceName: "29Metals public Golden Grove asset page",
    sourceUrl: "https://www.29metals.com/assets/golden-grove",
    publicObservation: "The public asset page identifies two operating underground mines, Scuddles and Gossan Hill, a mine life exceeding ten years and Gossan Valley as an additional mining front with first ore expected in the second half of 2026.",
    inference: "The multi-front underground growth profile supports a priority TS3 qualification context without asserting the current compressed-air fleet or package count.",
    positionClass: "U3",
    qualificationGates: [
      "Qualify whether additional mining fronts require relocatable local packages or extension of central reticulation.",
    ],
  }),
  directMining({
    recordKey: "ts3:qualification:westgold:cue",
    buyerAccountKey: "westgold-resources-au",
    buyerName: "Westgold Resources",
    application: "multi-mine underground relocatable electric air across Cue operations",
    sourceName: "Westgold public Cue operations page",
    sourceUrl: "https://westgold.com.au/gold-operations/murchison-operations/cue-operations",
    publicObservation: "The public Cue page identifies the Big Bell underground mine, restarted Fender underground operations, Great Fingall development and regional processing and village infrastructure.",
    inference: "The multi-mine underground operating hub supports a priority TS3 qualification context; site-level qualification must prove distinct equipment requirements before any commercial pool is created.",
    positionClass: "U3",
    qualificationGates: [
      "Validate site ownership, electrical infrastructure and whether separate mine packages represent distinct equipment purchases.",
    ],
  }),
  directMining({
    recordKey: "ts3:qualification:mmg:dugald-river",
    buyerAccountKey: "mmg-au",
    buyerName: "MMG",
    application: "long-life underground relocatable electric air at Dugald River",
    sourceName: "MMG public Dugald River operations page",
    sourceUrl: "https://www.mmg.com/operations/dugald-river/",
    publicObservation: "The public operation page describes Dugald River as a large underground zinc mine with a workforce exceeding 850, more than twenty years of estimated mine life, onsite processing and a solar farm supplying a material share of power.",
    inference: "The long-life underground and increasingly electrified site context supports a material TS3 qualification hypothesis, conditional on a distinct mobile or skid-mounted air requirement.",
    positionClass: "U2",
    qualificationGates: [
      "Confirm site voltage, underground mobility requirements and separation from permanent processing-plant compressed air.",
    ],
  }),
  directMining({
    recordKey: "ts3:qualification:mmg:rosebery",
    buyerAccountKey: "mmg-au",
    buyerName: "MMG",
    application: "underground relocatable electric air at Rosebery",
    sourceName: "MMG public Rosebery operations page",
    sourceUrl: "https://www.mmg.com/operations/rosebery/",
    publicObservation: "The public Rosebery page describes an operating underground mine that has introduced battery-electric production drilling and diesel-electric loaders to reduce emissions, fuel use and underground heat.",
    inference: "The established underground-electrification direction supports a material TS3 qualification context without claiming current electric compressor ownership or timing.",
    positionClass: "U2",
    qualificationGates: [
      "Confirm the role of local electric compressed-air packages within Rosebery's underground electrification and ventilation strategy.",
    ],
  }),
];
