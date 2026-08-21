import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";

interface DirectMiningInput {
  recordKey: string;
  commercialPoolKey: string;
  buyerAccountKey: string;
  buyerName: string;
  application: string;
  productCell: "TS2_surface_mining_direct" | "TS3_underground_direct";
  sourceName: string;
  sourceUrl: string;
  publicObservation: string;
  inference: string;
  modelBand: "TS2-DIRECT-NAMED" | "TS3-DIRECT-NAMED";
  qualificationGates: string[];
}

function directMining(input: DirectMiningInput): FullPotentialPublicObservationRecord {
  return {
    recordKey: input.recordKey,
    commercialPoolKey: input.commercialPoolKey,
    buyerAccountKey: input.buyerAccountKey,
    buyerName: input.buyerName,
    buyerSegment: "mining_direct",
    application: input.application,
    productFamily: "e_air",
    productCell: input.productCell,
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "adoption_positions",
    evidenceGrade: "B",
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    observedAt: "2026-08-21",
    publicObservation: input.publicObservation,
    inference: input.inference,
    modelBand: input.modelBand,
    addressabilityStatus: "conditional_compliance",
    qualificationGates: input.qualificationGates,
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  };
}

/**
 * Named direct-mining buyer pools supported by public operating evidence.
 *
 * These records are adoption hypotheses, not installed-base claims. Conventional
 * permanent compressor-room demand remains excluded. A private planning pack is
 * required before any Low/Base/High value exists.
 */
export const FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1: FullPotentialPublicObservationRecord[] = [
  directMining({
    recordKey: "mining:fortescue:solomon-ts2-direct",
    commercialPoolKey: "buyer:fortescue:solomon-ts2-direct",
    buyerAccountKey: "fortescue-au",
    buyerName: "Fortescue",
    application: "powered surface-mine relocatable electric air at Solomon and connected Pilbara operations",
    productCell: "TS2_surface_mining_direct",
    sourceName: "Fortescue public Solomon operations page",
    sourceUrl: "https://www.fortescue.com/en/what-we-do/operations/solomon",
    publicObservation: "The public Solomon page describes two ore-processing facilities, expanding renewable-energy infrastructure, new electrical systems, completed high-voltage interconnection and electric heavy-mobile-equipment trials in active mine operations.",
    inference: "The powered and electrifying site environment supports a named TS2 adoption hypothesis where rugged relocatable compressed air is preferable to diesel; it does not assert a current Portable Air electric fleet.",
    modelBand: "TS2-DIRECT-NAMED",
    qualificationGates: [
      "Identify a distinct powered, exposed or relocatable compressed-air application rather than conventional permanent plant air.",
      "Confirm local package compliance, connection requirements and economics before approval.",
    ],
  }),
  directMining({
    recordKey: "mining:greatland:telfer-ts3-direct",
    commercialPoolKey: "buyer:greatland:telfer-ts3-direct",
    buyerAccountKey: "greatland-au",
    buyerName: "Greatland",
    application: "relocatable underground electric air at Telfer",
    productCell: "TS3_underground_direct",
    sourceName: "Greatland public Telfer asset page",
    sourceUrl: "https://www.greatland.com.au/assets/telfer/",
    publicObservation: "The public asset page identifies Telfer as an operating mine with both open-pit and Main Dome underground mining, substantial processing infrastructure and active contractor mining.",
    inference: "Combined with separately retained public underground-compressor case evidence, Telfer supports a named TS3 direct-buyer pool without asserting the current quantity or replacement date of any installed package.",
    modelBand: "TS3-DIRECT-NAMED",
    qualificationGates: [
      "Validate whether new-equipment, overhaul or permanent reticulation is the relevant commercial path for each underground position.",
      "Confirm the locally deployable voltage, skid, mine-spec and compliance package.",
    ],
  }),
  directMining({
    recordKey: "mining:gold-fields-australia:underground-ts3-direct",
    commercialPoolKey: "buyer:gold-fields-australia:underground-ts3-direct",
    buyerAccountKey: "gold-fields-australia-au",
    buyerName: "Gold Fields Australia",
    application: "relocatable underground electric air across the Australian underground portfolio",
    productCell: "TS3_underground_direct",
    sourceName: "Gold Fields public Australia operations page",
    sourceUrl: "https://www.goldfields.com/australia-operations.php",
    publicObservation: "The public Australia portfolio lists three underground operations at Agnew, one at Granny Smith and two underground operations at St Ives, alongside long-life operating plans and growing renewable-energy use.",
    inference: "The multi-operation underground portfolio supports a named TS3 adoption pool; actual compressor architecture, fleet quantity and replacement timing remain unobserved.",
    modelBand: "TS3-DIRECT-NAMED",
    qualificationGates: [
      "Qualify mine-by-mine use of local relocatable packages versus central permanent compressed-air infrastructure.",
      "Prevent separate site overlays from duplicating the group-level buyer pool.",
    ],
  }),
  directMining({
    recordKey: "mining:newmont:tanami-ts3-direct",
    commercialPoolKey: "buyer:newmont-australia:tanami-ts3-direct",
    buyerAccountKey: "newmont-australia-au",
    buyerName: "Newmont Australia",
    application: "deep underground relocatable electric air at Tanami",
    productCell: "TS3_underground_direct",
    sourceName: "Newmont public Tanami operations page",
    sourceUrl: "https://operations.newmont.com/australia/tanami/",
    publicObservation: "The public page describes Tanami as one of Australia's largest underground gold mines, extending beyond 1.7 kilometres underground with a major shaft and infrastructure expansion supporting mine life to approximately 2040.",
    inference: "The scale, depth and long-life expansion support a named TS3 adoption hypothesis; the record does not assert that every underground work area requires a new compressor package.",
    modelBand: "TS3-DIRECT-NAMED",
    qualificationGates: [
      "Confirm the local compressed-air architecture, voltage standard and mobile-package need within the expansion and operating mine.",
      "Separate new adoption from existing infrastructure overhaul or life extension.",
    ],
  }),
  directMining({
    recordKey: "mining:evolution:mungari-ts3-direct",
    commercialPoolKey: "buyer:evolution-mining:mungari-ts3-direct",
    buyerAccountKey: "evolution-mining-au",
    buyerName: "Evolution Mining",
    application: "underground and surface mine-spec electric air at Mungari",
    productCell: "TS3_underground_direct",
    sourceName: "Evolution Mining public Mungari role page",
    sourceUrl: "https://careers.evolutionmining.com.au/job/Kalgoorlie-Geology-Technician-Open-Pit-WA/1363661066",
    publicObservation: "The public Mungari page describes a mine life to at least 2038, both surface and underground operations and a processing-plant expansion that more than doubled capacity.",
    inference: "The mixed operating environment supports a named rugged-electric adoption pool, conditional on identifying a distinct relocatable application outside conventional fixed plant air.",
    modelBand: "TS3-DIRECT-NAMED",
    qualificationGates: [
      "Identify the buyer and application boundary between underground mine packages, surface auxiliary air and conventional stationary plant equipment.",
    ],
  }),
  directMining({
    recordKey: "mining:evolution:cowal-ts3-direct",
    commercialPoolKey: "buyer:evolution-mining:cowal-ts3-direct",
    buyerAccountKey: "evolution-mining-au",
    buyerName: "Evolution Mining",
    application: "underground relocatable electric air at Cowal",
    productCell: "TS3_underground_direct",
    sourceName: "Evolution Mining public Cowal role page",
    sourceUrl: "https://careers.evolutionmining.com.au/job/Cowal-Geotechnical-Engineer-NSW/1363638666/",
    publicObservation: "The public Cowal page states that the operation has moved underground, operates surface and underground mining together and has a mine life extending to 2042.",
    inference: "Cowal supports a distinct site-level TS3 adoption pool under the Evolution buyer; the record does not assert current equipment quantity or purchasing intent.",
    modelBand: "TS3-DIRECT-NAMED",
    qualificationGates: [
      "Confirm a relocatable underground requirement that is distinct from the site's permanent plant and existing reticulation.",
    ],
  }),
  directMining({
    recordKey: "mining:evolution:ernest-henry-ts3-direct",
    commercialPoolKey: "buyer:evolution-mining:ernest-henry-ts3-direct",
    buyerAccountKey: "evolution-mining-au",
    buyerName: "Evolution Mining",
    application: "underground relocatable electric air at Ernest Henry",
    productCell: "TS3_underground_direct",
    sourceName: "Evolution Mining public Ernest Henry role page",
    sourceUrl: "https://careers.evolutionmining.com.au/job/Cloncurry-Senior-Metallurgist-QLD/1363299066/",
    publicObservation: "The public Ernest Henry page identifies a long-life copper-gold operation with mine life extended to at least 2040 and continuing investment in operating performance.",
    inference: "The long-life underground operating context supports a distinct TS3 adoption hypothesis, subject to public or internal qualification of the relocatable compressed-air requirement.",
    modelBand: "TS3-DIRECT-NAMED",
    qualificationGates: [
      "Confirm the underground package application and avoid counting conventional processing-plant compressed air.",
    ],
  }),
  directMining({
    recordKey: "mining:29metals:golden-grove-ts3-direct",
    commercialPoolKey: "buyer:29metals:golden-grove-ts3-direct",
    buyerAccountKey: "29metals-au",
    buyerName: "29Metals",
    application: "multi-front underground relocatable electric air at Golden Grove",
    productCell: "TS3_underground_direct",
    sourceName: "29Metals public Golden Grove asset page",
    sourceUrl: "https://www.29metals.com/assets/golden-grove",
    publicObservation: "The public asset page identifies two operating underground mines, Scuddles and Gossan Hill, a mine life exceeding ten years and Gossan Valley as an additional mining front with first ore expected in the second half of 2026.",
    inference: "The multi-front underground growth profile supports a named TS3 adoption pool without asserting the current compressed-air fleet or package count.",
    modelBand: "TS3-DIRECT-NAMED",
    qualificationGates: [
      "Qualify whether additional mining fronts require relocatable local packages or extension of central reticulation.",
    ],
  }),
  directMining({
    recordKey: "mining:westgold:cue-ts3-direct",
    commercialPoolKey: "buyer:westgold-resources:cue-ts3-direct",
    buyerAccountKey: "westgold-resources-au",
    buyerName: "Westgold Resources",
    application: "multi-mine underground relocatable electric air across Cue operations",
    productCell: "TS3_underground_direct",
    sourceName: "Westgold public Cue operations page",
    sourceUrl: "https://westgold.com.au/gold-operations/murchison-operations/cue-operations",
    publicObservation: "The public Cue page identifies the Big Bell underground mine, restarted Fender underground operations, Great Fingall development and regional processing and village infrastructure.",
    inference: "The multi-mine underground operating hub supports a named TS3 adoption pool; site-level overlays must not duplicate the group commercial pool unless the assumed purchases are distinct.",
    modelBand: "TS3-DIRECT-NAMED",
    qualificationGates: [
      "Validate site ownership, electrical infrastructure and whether separate mine packages represent distinct equipment purchases.",
    ],
  }),
  directMining({
    recordKey: "mining:mmg:dugald-river-ts3-direct",
    commercialPoolKey: "buyer:mmg:dugald-river-ts3-direct",
    buyerAccountKey: "mmg-au",
    buyerName: "MMG",
    application: "long-life underground relocatable electric air at Dugald River",
    productCell: "TS3_underground_direct",
    sourceName: "MMG public Dugald River operations page",
    sourceUrl: "https://www.mmg.com/operations/dugald-river/",
    publicObservation: "The public operation page describes Dugald River as a large underground zinc mine with a workforce exceeding 850, more than twenty years of estimated mine life, onsite processing and a solar farm supplying a material share of power.",
    inference: "The long-life underground and increasingly electrified site context supports a named TS3 adoption hypothesis, conditional on a distinct mobile or skid-mounted air requirement.",
    modelBand: "TS3-DIRECT-NAMED",
    qualificationGates: [
      "Confirm site voltage, underground mobility requirements and separation from permanent processing-plant compressed air.",
    ],
  }),
  directMining({
    recordKey: "mining:mmg:rosebery-ts3-direct",
    commercialPoolKey: "buyer:mmg:rosebery-ts3-direct",
    buyerAccountKey: "mmg-au",
    buyerName: "MMG",
    application: "underground relocatable electric air at Rosebery",
    productCell: "TS3_underground_direct",
    sourceName: "MMG public Rosebery operations page",
    sourceUrl: "https://www.mmg.com/operations/rosebery/",
    publicObservation: "The public Rosebery page describes an operating underground mine that has introduced battery-electric production drilling and diesel-electric loaders to reduce emissions, fuel use and underground heat.",
    inference: "The established underground-electrification direction supports a named TS3 adoption pool; the record does not claim current electric compressor ownership or timing.",
    modelBand: "TS3-DIRECT-NAMED",
    qualificationGates: [
      "Confirm the role of local electric compressed-air packages within Rosebery's underground electrification and ventilation strategy.",
    ],
  }),
];
