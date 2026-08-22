import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";
import type { FullPotentialRentalFleetBand } from "../shared/fullPotentialPublicBands";

interface RentalCoreInput {
  slug: string;
  buyerName: string;
  modelBand: FullPotentialRentalFleetBand;
  sourceName: string;
  sourceUrl: string;
  publicObservation: string;
  inference?: string;
}

function rentalCore(input: RentalCoreInput): FullPotentialPublicObservationRecord {
  return {
    recordKey: `rental:${input.slug}:public-core-v1`,
    commercialPoolKey: `buyer:${input.slug}:rental-portable-air`,
    buyerAccountKey: `${input.slug}-au`,
    buyerName: input.buyerName,
    buyerSegment: "rental_hire",
    application: "rental portable-air fleet replacement and refresh",
    productFamily: "other",
    productCell: "rental_portable_air_blended",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    evidenceGrade: "B",
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    observedAt: "2026-08-21",
    publicObservation: input.publicObservation,
    inference: input.inference
      ?? `The publicly visible range and operating footprint support a transparent ${input.modelBand} relevant-fleet band; this is an inference, not an asserted customer fleet count.`,
    modelBand: input.modelBand,
    addressabilityStatus: "addressable_now",
    qualificationGates: [
      "Validate the product-family and pressure mix before converting the blended public band into draft model lines.",
    ],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  };
}

/**
 * Twenty-four named Australian Rental Hire buyers supported by public evidence.
 *
 * This file intentionally contains no current commercial price ladder, no
 * Low/Base/High monetary scenarios, no contacts and no CRM/customer discovery.
 * Restricted scenario values are joined later through an authorised admin-only
 * planning pack.
 */
export const FP_RENTAL_PUBLIC_CORE_V1: FullPotentialPublicObservationRecord[] = [
  rentalCore({
    slug: "coates",
    buyerName: "Coates",
    modelBand: "P5",
    sourceName: "Coates public compressor catalogue",
    sourceUrl: "https://www.coates.com.au/hire/air-compressors-and-air-tools/air-compressors-and-accessories/compressor-250-275-cfm-diesel",
    publicObservation: "The public hire catalogue exposes diesel compressor categories at 250 to 275 CFM and 915 to 1150 CFM, within a national equipment-hire operation.",
  }),
  rentalCore({
    slug: "kennards-hire",
    buyerName: "Kennards Hire",
    modelBand: "P5",
    sourceName: "Kennards Hire public air-compressor range",
    sourceUrl: "https://www.kennards.com.au/for-hire/air-compressor-tools/air-compressors",
    publicObservation: "The public compressor range spans compact units through 275 CFM and 900 CFM equipment across a large branch network.",
  }),
  rentalCore({
    slug: "premiair-hire",
    buyerName: "PremiAir Hire",
    modelBand: "P5",
    sourceName: "PremiAir Hire public compressor range",
    sourceUrl: "https://premiairhire.com.au/equipment/cfm-electric-compressor/",
    publicObservation: "The public range covers portable diesel and stationary electric compressors, high-pressure applications and equipment from 2.2 kW to 315 kW, with related diesel products extending from 185 CFM into four-figure CFM bands.",
  }),
  rentalCore({
    slug: "onsite-rentals",
    buyerName: "Onsite Rental Group",
    modelBand: "P4",
    sourceName: "Onsite Rentals public compressor category",
    sourceUrl: "https://www.onsite.com.au/product-category/air-compressors/",
    publicObservation: "The public fleet includes portable and after-cooled compressors from approximately 175 CFM through 1250 CFM and identifies more than 35 Australian branches.",
  }),
  rentalCore({
    slug: "hawk-hire",
    buyerName: "Hawk Hire",
    modelBand: "P4",
    sourceName: "Hawk Hire public equipment catalogue",
    sourceUrl: "https://hawkhire.com.au/shop/",
    publicObservation: "The public catalogue lists portable compressor bands including 185, 210, 260, 375, 1150 and 1600 CFM, while the company describes a large independent Air and Power fleet.",
  }),
  rentalCore({
    slug: "flow-control-engineering",
    buyerName: "Flow Control Engineering",
    modelBand: "P4",
    sourceName: "Flow Control Engineering public diesel-compressor range",
    sourceUrl: "https://www.flowcontrolengineering.com.au/hire/diesel-air-compressors",
    publicObservation: "The public hire range identifies Sullair diesel compressors from 185 through 1600 CFM, including medium- and high-pressure equipment for mining, drilling, shutdown and industrial applications.",
  }),
  rentalCore({
    slug: "master-hire",
    buyerName: "Master Hire",
    modelBand: "P3",
    sourceName: "Master Hire public trailer-compressor range",
    sourceUrl: "https://masterhire.com.au/equipment/air-tools-compressors/trailer-mounted-air-compressors/130cfm-air-compressor/",
    publicObservation: "The public range shows Atlas Copco, Sullair and Bruder equipment around 175 to 185 CFM and links to 250 to 260 CFM and 425 CFM compressor categories across a multi-branch operation.",
  }),
  rentalCore({
    slug: "mega-hire",
    buyerName: "Mega Hire",
    modelBand: "P3",
    sourceName: "Mega Hire public air-compressor collection",
    sourceUrl: "https://www.megahire.com.au/collections/air-compressors",
    publicObservation: "The public compressor collection spans approximately 70 to 1600 CFM, including standard-, medium- and high-pressure diesel equipment.",
  }),
  rentalCore({
    slug: "airpac-rentals-australia",
    buyerName: "Airpac Rentals Australia",
    modelBand: "P3",
    sourceName: "Airpac Rentals public Rigsafe compressor range",
    sourceUrl: "https://www.airpac-rentals.com/rental-services/air-compressors/rigsafe",
    publicObservation: "The public Rigsafe and safe-area fleet spans approximately 70 to 2100 CFM and 7 to 35 bar, with Ingersoll Rand, Doosan, Sullair and Atlas Copco equipment identified.",
  }),
  rentalCore({
    slug: "cahs",
    buyerName: "Compressed Air Hire Services",
    modelBand: "P3",
    sourceName: "CAHS public equipment fleet",
    sourceUrl: "https://www.compressedairhire.com.au/",
    publicObservation: "The public fleet lists 185, 190, 340 high-pressure, 375, 375 high-pressure and 400 CFM trailer compressors plus a 450 CFM desiccant dryer for WA projects.",
  }),
  rentalCore({
    slug: "tutt-bryant-hire",
    buyerName: "Tutt Bryant Hire",
    modelBand: "P3",
    sourceName: "Tutt Bryant Hire public compressor range",
    sourceUrl: "https://tuttbryant.com.au/hire-range/air-compressor/",
    publicObservation: "The public range identifies Sullair and Atlas Copco compressors at approximately 185, 190, 260, 290 and 425 CFM.",
  }),
  rentalCore({
    slug: "brooks-obr-maia",
    buyerName: "Brooks OBR MAIA",
    modelBand: "P3",
    sourceName: "Brooks OBR MAIA public compressor collection",
    sourceUrl: "https://brooksobrmaia.com.au/collections/air-compressors-for-hire",
    publicObservation: "The public collection contains seventeen compressor products spanning approximately 75 to 1102 CFM for mining and construction hire.",
  }),
  rentalCore({
    slug: "hirecorp",
    buyerName: "Hirecorp",
    modelBand: "P2",
    sourceName: "Hirecorp public portable-compressor range",
    sourceUrl: "https://www.hirecorp.com.au/product-category/compressors/portable-compressors/",
    publicObservation: "The public range identifies Kaeser and Airman trailer compressors around 375, 400 and 655 CFM, with additional skid-mounted compressor products visible elsewhere in the catalogue.",
  }),
  rentalCore({
    slug: "classic-hire",
    buyerName: "Classic Hire",
    modelBand: "P2",
    sourceName: "Classic Hire public company and equipment range",
    sourceUrl: "https://www.classichire.net.au/about-us.asp",
    publicObservation: "The public site identifies air compressors as a core equipment category across eight Perth-area outlets.",
    inference: "The visible multi-outlet equipment-hire footprint supports a conservative P2 relevant-fleet band pending stronger public CFM detail.",
  }),
  rentalCore({
    slug: "pacific-hire",
    buyerName: "Pacific Hire",
    modelBand: "P2",
    sourceName: "Pacific Hire public compressor range",
    sourceUrl: "https://pacifichire.com.au/shop/185cfm-towable-air-compressor/",
    publicObservation: "The public range states that portable compressors are available from approximately 130 to 400 CFM through Victorian and South Australian branches.",
  }),
  rentalCore({
    slug: "kerrs-hire",
    buyerName: "Kerr's Hire",
    modelBand: "P2",
    sourceName: "Kerr's Hire public compressor category",
    sourceUrl: "https://kerrshire.com.au/equipment.asp?action=category&category=44",
    publicObservation: "The public compressor category lists diesel equipment around 185, 260 and 400 CFM within a regional Victorian hire network.",
  }),
  rentalCore({
    slug: "northfleet",
    buyerName: "Northfleet",
    modelBand: "P2",
    sourceName: "Northfleet public compressor fleet page",
    sourceUrl: "https://www.northfleet.com.au/fleet/375-425-cfm-sullair-air-compressor/",
    publicObservation: "The public fleet identifies a mine-site-oriented 375 to 425 CFM diesel compressor supported through WA and Pilbara depots.",
  }),
  rentalCore({
    slug: "call2hire",
    buyerName: "Call 2 Hire",
    modelBand: "P2",
    sourceName: "Call 2 Hire public compressor range",
    sourceUrl: "https://www.call2hire.com.au/equipment-hire/air-compressor-hire",
    publicObservation: "The public range identifies Sullair 185, 225, 260 and 375 high-pressure compressors plus an Ingersoll Rand 270 for civil, blasting and drilling applications in NSW.",
  }),
  rentalCore({
    slug: "ezyquip-hire",
    buyerName: "Ezyquip Hire",
    modelBand: "P2",
    sourceName: "Ezyquip Hire public compressor page",
    sourceUrl: "https://www.ezyquip.com.au/product/air-compressors/",
    publicObservation: "The public equipment page identifies Sullair air compressors within a multi-location heavy-equipment rental operation.",
    inference: "The public evidence confirms a relevant compressor category but not its exact scale, so the account is retained at a conservative P2 band.",
  }),
  rentalCore({
    slug: "hireworks-nt",
    buyerName: "Hireworks NT",
    modelBand: "P2",
    sourceName: "Hireworks NT public compressor page",
    sourceUrl: "https://hireworksnt.com.au/product/compressor-400cfm-diesel/",
    publicObservation: "The public fleet includes a 400 CFM skid- or trailer-mounted compressor and the business operates from two Northern Territory locations.",
  }),
  rentalCore({
    slug: "plantman-equipment",
    buyerName: "Plantman Equipment",
    modelBand: "P2",
    sourceName: "Plantman public Atlas Copco U75 page",
    sourceUrl: "https://www.plantman.com.au/products/atlas-copco-air-compressor-u75/",
    publicObservation: "The public fleet identifies a mine-spec Atlas Copco U75 and an Airman PDS80 alternative within a mining-equipment hire and support business.",
  }),
  rentalCore({
    slug: "direct-access-equipment",
    buyerName: "Direct Access & Equipment",
    modelBand: "P2",
    sourceName: "Direct Access public compressor range",
    sourceUrl: "https://directaccessandequipment.com.au/equipment/air-light-power/400-cfm-air-compressor/",
    publicObservation: "The public Tasmanian fleet identifies mobile diesel compressors at approximately 260 and 400 CFM, with electric units sourceable for indoor or marine projects.",
  }),
  rentalCore({
    slug: "green-monster-offshore",
    buyerName: "Green Monster Offshore",
    modelBand: "P1",
    sourceName: "Green Monster Offshore public compressor fleet",
    sourceUrl: "https://www.greenmonster.com.au/products/hire-equipment/air-compressors/default.aspx",
    publicObservation: "The public offshore fleet identifies Airman 390 CFM and Ingersoll Rand 1070 CFM diesel compressors, with additional compressor equipment shown in the category.",
  }),
  rentalCore({
    slug: "hirequip-tasmania",
    buyerName: "Hirequip Tasmania",
    modelBand: "P1",
    sourceName: "Hirequip Tasmania public compressor page",
    sourceUrl: "https://www.hirequiptas.com.au/equipment-hire/compressor/",
    publicObservation: "The public statewide rental catalogue identifies a Kaeser M43 trailer-mounted compressor.",
  }),
];

/**
 * Public market evidence retained for competitor/channel context only. This
 * record must never contribute a monetary Rental buyer pool.
 */
export const FP_RENTAL_PUBLIC_MARKET_CONTEXT_V1: FullPotentialPublicObservationRecord[] = [
  {
    recordKey: "context:mobile-compressed-air:public-core-v1",
    commercialPoolKey: null,
    buyerAccountKey: "mobile-compressed-air-au",
    buyerName: "Mobile Compressed Air",
    buyerSegment: "rental_market_context",
    application: "competitor and channel market evidence for portable-air rental and distribution",
    productFamily: "other",
    productCell: "rental_competitor_channel_context",
    countingTreatment: "context_non_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    evidenceGrade: "B",
    sourceName: "Mobile Compressed Air public portable-compressor range",
    sourceUrl: "https://compressedair.com.au/product/mobilar-m135-m171-m210-m235-m250-m450-portable-diesel-air-compressors/",
    observedAt: "2026-08-21",
    publicObservation: "The public Kaeser portable range includes multiple pressure and flow configurations from roughly 370 CFM through 930 CFM within a compressed-air specialist business.",
    inference: "The public fleet is useful market evidence, but the governed platform classifies the identity as non-counting competitor/channel context rather than an addressable Rental buyer.",
    modelBand: null,
    addressabilityStatus: "excluded",
    qualificationGates: [
      "Retain as market context only; do not assign monetary buyer potential without a separately approved addressability exception.",
    ],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  },
];
