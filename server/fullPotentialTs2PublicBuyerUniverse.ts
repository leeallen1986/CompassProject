import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";
import type { FullPotentialTs2SurfacePositionClass } from "../shared/fullPotentialPublicBands";

interface Ts2BuyerInput {
  slug: string;
  buyerName: string;
  positionClass: FullPotentialTs2SurfacePositionClass;
  sourceName: string;
  sourceUrl: string;
  publicObservation: string;
  inference: string;
  application?: string;
}

function ts2Buyer(input: Ts2BuyerInput): FullPotentialPublicObservationRecord {
  return {
    recordKey: `ts2:buyer:${input.slug}:public-v1`,
    commercialPoolKey: null,
    buyerAccountKey: `${input.slug}-au`,
    buyerName: input.buyerName,
    buyerSegment: "mining_direct",
    application: input.application ?? "surface mine-spec relocatable electric air",
    productFamily: "e_air",
    productCell: "TS2_surface_mining_buyer",
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
      "Confirm at least one distinct rugged, exposed or relocatable compressed-air requirement before creating a buyer-counting TS2 pool.",
      "Exclude conventional permanent compressor-room demand that belongs to stationary Compressor Technique scope.",
      "Confirm local product configuration, site electrical interface and Australian compliance before treating the adoption position as addressable now.",
    ],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  };
}

/**
 * Publicly evidenced TS2 direct-buyer universe.
 *
 * These records prove operating scale, powered infrastructure and/or active
 * electrification context. They do not prove that a buyer owns or intends to buy
 * a Tough Stationary compressor. Every row therefore remains context-only until
 * a separate public application qualification and restricted planning review
 * justify a distinct buyer-counting adoption pool.
 */
export const FP_TS2_PUBLIC_BUYER_UNIVERSE_V1: FullPotentialPublicObservationRecord[] = [
  ts2Buyer({
    slug: "bhp-waio",
    buyerName: "BHP Western Australia Iron Ore",
    positionClass: "S3",
    sourceName: "BHP public mining electrification update",
    sourceUrl: "https://www.bhp.com/news/bhp-insights/2026/06/why-electrification-is-gaining-momentum-across-australias-mining-sector",
    publicObservation: "BHP states that Western Australia Iron Ore has secured renewable supply for part of Port Hedland electricity demand and is exploring large-scale Pilbara power solutions while mining fleet electrification progresses.",
    inference: "The integrated Pilbara operation is a high-priority TS2 qualification pool because large powered mine and port infrastructure is established and electrical demand is expected to grow as diesel use is displaced; this does not by itself evidence a compressor purchase.",
  }),
  ts2Buyer({
    slug: "rio-tinto-pilbara",
    buyerName: "Rio Tinto Iron Ore — Pilbara",
    positionClass: "S3",
    sourceName: "Rio Tinto public Pilbara renewables page",
    sourceUrl: "https://www.riotinto.com/news/stories/pilbara-renewables",
    publicObservation: "Rio Tinto describes a Pilbara power network underpinned by roughly 480 MW of gas generation and a requirement for 600 to 700 MW of renewable energy to displace most gas use across its mining power network.",
    inference: "The scale and distribution of the Pilbara power network justify S3 priority for rugged relocatable electric-air qualification across mine, rail and port operations, subject to proving a distinct Portable Air application.",
  }),
  ts2Buyer({
    slug: "fortescue-pilbara",
    buyerName: "Fortescue Pilbara Operations",
    positionClass: "S3",
    sourceName: "Fortescue public Pilbara Green Grid operations page",
    sourceUrl: "https://www.fortescue.com/en/what-we-do/operations",
    publicObservation: "Fortescue publicly describes Cloudbreak, Eliwana, Solomon and Iron Bridge within an integrated Pilbara operating system and a Green Grid targeting large-scale solar, wind and battery storage to power Pilbara operations.",
    inference: "The combination of multiple large operating hubs and expanding site power infrastructure makes Fortescue a high-priority TS2 qualification pool, without asserting a current Tough Stationary installed base.",
  }),
  ts2Buyer({
    slug: "minres-onslow-iron",
    buyerName: "Mineral Resources — Onslow Iron",
    positionClass: "S3",
    sourceName: "Mineral Resources public Onslow Iron energy case",
    sourceUrl: "https://www.mineralresources.com.au/news/stories/hybrid-energy-model-powering-onslow-iron/",
    publicObservation: "MinRes states that the Ken's Bore mine site is powered by a hybrid gas and solar system with a 26 MW power station supplying crushers, loaders, reclaimers and other site infrastructure.",
    inference: "Public evidence of powered heavy-process infrastructure and a long-life iron ore operating system supports S3 TS2 qualification for exposed or relocatable electric-air applications, but not a compressor fleet claim.",
  }),
  ts2Buyer({
    slug: "newmont-boddington",
    buyerName: "Newmont Boddington",
    positionClass: "S2",
    sourceName: "Newmont public Boddington operation page",
    sourceUrl: "https://operations.newmont.com/australia/boddington/",
    publicObservation: "Newmont describes Boddington as a large long-life surface gold and copper mine and identifies diesel and electricity as the site's primary energy sources while energy-efficiency opportunities continue to be pursued.",
    inference: "A large powered surface operation with substantial process infrastructure supports a medium TS2 qualification class; permanent compressor-room demand remains excluded unless ruggedness or relocation is demonstrated.",
  }),
  ts2Buyer({
    slug: "gold-fields-st-ives",
    buyerName: "Gold Fields — St Ives",
    positionClass: "S2",
    sourceName: "Gold Fields public St Ives renewable-energy release",
    sourceUrl: "https://www.goldfields.com/download/media-release-wind-turbine-foundations-laid-for-st-ives-renewables-project.pdf",
    publicObservation: "Gold Fields publicly describes a 42 MW wind farm and 35 MW solar farm designed to provide more than 70 percent of St Ives mine electricity, with construction advancing toward completion in 2026.",
    inference: "The expanded electrical supply and mixed mining/processing footprint make St Ives a credible S2 TS2 qualification target for powered relocatable air, without implying a known purchase intention.",
  }),
  ts2Buyer({
    slug: "mmg-dugald-river",
    buyerName: "MMG Dugald River",
    positionClass: "S2",
    sourceName: "MMG public Dugald River renewable-energy planning report",
    sourceUrl: "https://www.mmg.com/wp-content/uploads/2026/04/3.-Cover-Letter-Attachment-C-DRWF-Planning-Report.pdf",
    publicObservation: "MMG's public planning material states that Dugald River currently sources electricity from Diamantina Power Station and the Dugald River Solar Farm, with a wind, substation and battery project intended to provide additional power to mining operations.",
    inference: "The significant and expanding electrical infrastructure supports S2 qualification for relocatable surface or underground-support electric air; underground-specific demand remains separately analysed under TS3.",
  }),
  ts2Buyer({
    slug: "south32-worsley",
    buyerName: "South32 Worsley Alumina",
    positionClass: "S2",
    sourceName: "South32 public Worsley operations description",
    sourceUrl: "https://careers.south32.net/job/Collie-Technician-Electrical-Instrument-WA-6225/1364963166/",
    publicObservation: "South32 publicly describes Worsley as an integrated bauxite mine, alumina refinery and port operation with substantial electrical and process infrastructure in Western Australia.",
    inference: "The integrated mine-to-port footprint supports a medium TS2 qualification pool for exposed project, maintenance or relocatable auxiliary air, while permanent refinery compressor-room demand remains outside Portable Air Full Potential.",
    application: "mine, refinery and port relocatable electric auxiliary air",
  }),
  ts2Buyer({
    slug: "minres-port-ashburton",
    buyerName: "Mineral Resources — Port of Ashburton",
    positionClass: "S2",
    sourceName: "Mineral Resources public port-power case",
    sourceUrl: "https://www.mineralresources.com.au/news/stories/minres-transitions-to-gas-powered-port-operations/",
    publicObservation: "MinRes states that Onslow Iron port operations at the Port of Ashburton use a 14 MW gas-fired power station and form a critical bulk-material export link for the integrated project.",
    inference: "Powered bulk-handling infrastructure makes the port a credible TS2 application context for rugged relocatable electric air during maintenance, shutdown or project work; the record is non-counting until a distinct buyer pool is proven.",
    application: "port and bulk-handling relocatable electric auxiliary air",
  }),
];
