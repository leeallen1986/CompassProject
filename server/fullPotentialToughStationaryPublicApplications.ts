import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";

interface ApplicationInput {
  recordKey: string;
  buyerSegment: string;
  application: string;
  productCell: string;
  evidenceGrade: "A" | "B" | "C";
  sourceName: string;
  sourceUrl: string;
  publicObservation: string;
  inference: string;
  addressabilityStatus: FullPotentialPublicObservationRecord["addressabilityStatus"];
  qualificationGates?: string[];
  countingTreatment?: "context_non_counting" | "application_overlay_non_counting";
}

function applicationRecord(input: ApplicationInput): FullPotentialPublicObservationRecord {
  return {
    recordKey: input.recordKey,
    commercialPoolKey: null,
    buyerAccountKey: null,
    buyerName: null,
    buyerSegment: input.buyerSegment,
    application: input.application,
    productFamily: "e_air",
    productCell: input.productCell,
    countingTreatment: input.countingTreatment ?? "context_non_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "adoption_positions",
    evidenceGrade: input.evidenceGrade,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    observedAt: "2026-08-21",
    publicObservation: input.publicObservation,
    inference: input.inference,
    modelBand: null,
    addressabilityStatus: input.addressabilityStatus,
    qualificationGates: input.qualificationGates ?? [],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  };
}

/**
 * Public product and application evidence for Tough Stationary / E-Air.
 *
 * Every row is deliberately non-counting. Monetary adoption assumptions belong
 * to distinct named buyer pools and a restricted planning pack; these records
 * describe why and where the product may be used without creating duplicate
 * market value.
 */
export const FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1: FullPotentialPublicObservationRecord[] = [
  applicationRecord({
    recordKey: "ts1:public-product:h450-vsd",
    buyerSegment: "cross_segment_application",
    application: "abrasive blasting, cable blowing and pneumatic tooling with site power",
    productCell: "TS1_360_466_cfm_vsd",
    evidenceGrade: "A",
    sourceName: "Atlas Copco Australia E-Air H450 VSD product page",
    sourceUrl: "https://www.atlascopco.com/en-au/construction-equipment/products/mobile-air-compressors/electric-compressor/h450-vsd",
    publicObservation: "The public Australian product page lists 360 to 466 CFM, 5 to 13 bar, operation up to 50 degrees Celsius and applications including abrasive blasting, high-pressure cable blowing and pneumatic tools.",
    inference: "This directly supports a relocatable medium-electric cell for powered construction, utilities, industrial and enclosed-site applications.",
    addressabilityStatus: "addressable_now",
  }),
  applicationRecord({
    recordKey: "ts1:public-product:t400-t500",
    buyerSegment: "cross_segment_application",
    application: "rugged outdoor fixed-speed electric air without a compressor room",
    productCell: "TS1_399_493_cfm_fixed",
    evidenceGrade: "A",
    sourceName: "Atlas Copco Australia E-Air T400 and T500 product pages",
    sourceUrl: "https://www.atlascopco.com/en-au/construction-equipment/products/mobile-air-compressors/electric-compressor/t500",
    publicObservation: "The public T500 page lists 493 CFM at 10 bar, multiple industrial voltage configurations, 50-degree ambient capability and a corrosion-resistant canopy intended for harsh environments without a dedicated compressor room.",
    inference: "The fixed-speed product publicly bridges conventional stationary demand and Portable Air where outdoor exposure, ruggedness or relocation is material.",
    addressabilityStatus: "addressable_now",
  }),
  applicationRecord({
    recordKey: "ts2:public-product:low-pressure-550-900",
    buyerSegment: "cross_segment_application",
    application: "construction, utilities, tunnelling, cable blowing, blasting and industrial backup",
    productCell: "TS2_550_900_cfm_8_6_14_bar",
    evidenceGrade: "A",
    sourceName: "Atlas Copco Australia low-pressure electric compressor range",
    sourceUrl: "https://www.atlascopco.com/en-au/construction-equipment/products/mobile-air-compressors/electric-compressor/fix-wux-low-pressure",
    publicObservation: "The public Australian range states 550 to 900 CFM at 8.6 to 14 bar for construction, utilities, tunnelling, cable blowing, blasting, manufacturing processes and industrial backup in tough environments.",
    inference: "This is the strongest public product-and-application basis for the TS2 surface-mining, rental and infrastructure opportunity cell.",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      "Confirm the locally approved product configuration, Australian compliance scope and finished package economics for each intended buyer application.",
    ],
  }),
  applicationRecord({
    recordKey: "ts2:public-product:t900",
    buyerSegment: "cross_segment_application",
    application: "large fixed-speed relocatable electric air on powered sites",
    productCell: "TS2_900_cfm_fixed",
    evidenceGrade: "A",
    sourceName: "Atlas Copco Australia E-Air T900 product page",
    sourceUrl: "https://www.atlascopco.com/en-au/construction-equipment/products/mobile-air-compressors/electric-compressor/t900",
    publicObservation: "The public T900 page lists 900 CFM at 10 bar, a 160 kW motor, multiple industrial voltage configurations, 50-degree ambient operation and a rugged outdoor skid package.",
    inference: "This confirms that a large rugged fixed-speed electric product is already publicly positioned for powered job sites and harsh outdoor applications.",
    addressabilityStatus: "addressable_now",
  }),
  applicationRecord({
    recordKey: "ts2:mining:application-universe",
    buyerSegment: "mining_direct",
    application: "mine processing, plant and instrument air, workshops, wastewater and pneumatic conveying",
    productCell: "TS2_surface_mining_application",
    evidenceGrade: "A",
    sourceName: "Atlas Copco Australia mining application booklet page",
    sourceUrl: "https://www.atlascopco.com/en-au/compressors/industry-solutions/mining/mining-application-booklet",
    publicObservation: "The public mining application page identifies underground processing, general process, plant and instrument air, workshops, flotation, wastewater treatment, pneumatic conveying and dewatering as compressed-air applications in mining.",
    inference: "Only the subset requiring rugged, exposed or relocatable electric air belongs in Portable Air Full Potential; conventional permanent compressor-room demand remains outside this pool.",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      "Apply the rugged or relocatable qualification test before any named mine buyer carries monetary adoption positions.",
    ],
  }),
  applicationRecord({
    recordKey: "ts3:underground:miners-pack-415-1000v",
    buyerSegment: "underground_mining",
    application: "mine-spec relocatable underground electric air",
    productCell: "TS3_underground_415_1000v",
    evidenceGrade: "A",
    sourceName: "CAPS public underground Miners Pack page",
    sourceUrl: "https://www.caps.com.au/air-compressor-and-power-generator-rental/caps-ingersoll-rand-underground-miners-air-compressor/",
    publicObservation: "The public Miners Pack page describes 415 V and 1000 V packages from 918 to 1907 CFM and 7 to 14 bar, with an Australian-standard receiver, welded skid and mine options including filtration, protection and fire suppression.",
    inference: "This confirms an established competitor archetype for locally packaged underground electric air rather than a theoretical application.",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: [
      "Confirm the locally deployable Atlas Copco package, voltage path, mine-spec scope and commercial competitiveness before assigning direct buyer value.",
    ],
  }),
  applicationRecord({
    recordKey: "ts3:underground:custom-1000v-case",
    buyerSegment: "underground_mining",
    application: "frequently relocatable 1000 V underground compressor skid",
    productCell: "TS3_custom_1000v_skid",
    evidenceGrade: "A",
    sourceName: "Pneumatic Engineering public 1000 V underground case study",
    sourceUrl: "https://www.pneumatic.com.au/custom-1000v-skid-for-underground-mining/",
    publicObservation: "The public case study describes a 160 kW compressor converted from 415 V to 1000 V and mounted on a purpose-built 2000-litre skid suitable for lifting and dragging underground.",
    inference: "The market accepts locally engineered voltage conversion and rugged mobility where standard stationary packaging does not meet underground requirements.",
    addressabilityStatus: "conditional_compliance",
  }),
  applicationRecord({
    recordKey: "ts3:underground:telfer-lifecycle-case",
    buyerSegment: "underground_mining",
    application: "underground electric installed-base overhaul and replacement cycle",
    productCell: "TS3_underground_lifecycle",
    evidenceGrade: "A",
    sourceName: "Pneumatic Engineering public Telfer overhaul case study",
    sourceUrl: "https://www.pneumatic.com.au/underground-compressor-overhaul-at-telfer-mine/",
    publicObservation: "The public case study identifies a 160 kW, 1000 V skid-mounted Atlas Copco G160 operating underground at Telfer and states that overhaul extended its service life by an estimated four to five years.",
    inference: "Underground application potential must reflect overhaul life extension as well as new-equipment replacement; every visible position is not an immediate machine sale.",
    addressabilityStatus: "conditional_compliance",
  }),
  applicationRecord({
    recordKey: "ts4:public-demand:25bar",
    buyerSegment: "specialist_rental_application",
    application: "drilling, pipeline testing, underbalanced drilling and LNG module testing",
    productCell: "TS4_20_25_bar_demand",
    evidenceGrade: "A",
    sourceName: "Access Hire Oil & Gas public high-pressure compressor range",
    sourceUrl: "https://www.accessoilandgas.com.au/products/air-compressors/high-pressure-compressors/",
    publicObservation: "The public specialist-rental page identifies high-pressure compressor demand up to 25 bar for drilling, pipeline testing, underbalanced drilling, dewatering, drying and LNG module or pipework testing.",
    inference: "The demand is publicly evidenced, but electric adoption remains a conditional product and site-power question rather than an established fleet fact.",
    addressabilityStatus: "conditional_compliance",
  }),
  applicationRecord({
    recordKey: "ts4:public-demand:35bar-gap",
    buyerSegment: "specialist_rental_application",
    application: "high-pressure primary air above the currently evidenced electric range",
    productCell: "TS4_35_bar_gap",
    evidenceGrade: "A",
    sourceName: "Airpac Rentals public high-pressure compressor range",
    sourceUrl: "https://www.airpac-rentals.com/rental-services/air-compressors/rigsafe",
    publicObservation: "The public Rigsafe range identifies compressor demand from 24 to 35 bar and approximately 900 to 1070 CFM in the high-pressure class, with larger variants also publicly shown.",
    inference: "The 35 bar demand remains visible as a product gap and must not be assigned monetary electric potential until a sourceable product is confirmed.",
    addressabilityStatus: "portfolio_gap",
  }),
  applicationRecord({
    recordKey: "overlay:rental:temporary-electric-industrial",
    buyerSegment: "rental_hire",
    application: "temporary electric air for emergency, maintenance and production continuity",
    productCell: "TS2_temporary_industrial_overlay",
    evidenceGrade: "A",
    sourceName: "Atlas Copco Specialty Rental Australia air-rental page",
    sourceUrl: "https://www.atlascopco.com/en-au/rental/products/air-rental",
    publicObservation: "The public Australian rental page identifies electric oil-free equipment up to approximately 1000 CFM and temporary compressed-air support for emergency shutdowns and operational continuity.",
    inference: "This is a non-counting application overlay on rental-fleet purchases and must not be added as a second equipment market.",
    addressabilityStatus: "addressable_now",
    countingTreatment: "application_overlay_non_counting",
  }),
  applicationRecord({
    recordKey: "overlay:rental:victoria-food-continuity-case",
    buyerSegment: "rental_hire",
    application: "temporary electric oil-free air during compressor-room replacement",
    productCell: "TS2_temporary_industrial_overlay",
    evidenceGrade: "A",
    sourceName: "Atlas Copco Specialty Rental Victoria public case study",
    sourceUrl: "https://www.atlascopco.com/en-au/rental/news/how-specialty-rentals-oil-free-air-solutions-helped-a-leading-bakery-in-victoria-stay-operational-with-minimal-ecological-impact",
    publicObservation: "The public case study describes an electric oil-free temporary compressor maintaining round-the-clock food production during a two-week compressor-room replacement in Victoria.",
    inference: "The case validates temporary electric demand, but the equipment purchase belongs to the rental buyer pool rather than a separate manufacturing equipment total.",
    addressabilityStatus: "addressable_now",
    countingTreatment: "application_overlay_non_counting",
  }),
];
