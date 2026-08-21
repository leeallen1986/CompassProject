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
    sourceName: "Evolution Mining public Mungari role page",
    sourceUrl: "https://careers.evolutionmining.com.au/job/Kalgoorlie-Geology-Technician-Open-Pit-WA/1363661066",
    publicObservation: "The public Mungari page describes a mine life to at least 2038, both surface and underground operations and a processing-plant expansion that more than doubled capacity.",
    inference: "The mixed operating environment supports a material TS3 qualification context, conditional on identifying a distinct relocatable underground application outside conventional fixed plant air.",
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
    sourceName: "Evolution Mining public Cowal role page",
    sourceUrl: "https://careers.evolutionmining.com.au/job/Cowal-Geotechnical-Engineer-NSW/1363638666/",
    publicObservation: "The public Cowal page states that the operation has moved underground, operates surface and underground mining together and has a mine life extending to 2042.",
    inference: "Cowal supports a material TS3 qualification context under the Evolution buyer without asserting current equipment quantity or procurement timing.",
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
    sourceName: "Evolution Mining public Ernest Henry role page",
    sourceUrl: "https://careers.evolutionmining.com.au/job/Cloncurry-Senior-Metallurgist-QLD/1363299066/",
    publicObservation: "The public Ernest Henry page identifies a long-life copper-gold operation with mine life extended to at least 2040 and continuing investment in operating performance.",
    inference: "The long-life underground operating context supports a priority TS3 qualification context, subject to public or internal qualification of the relocatable compressed-air requirement.",
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
