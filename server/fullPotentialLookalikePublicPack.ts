import {
  FP_LOOKALIKE_METHOD_VERSION,
  type FullPotentialLookalikeCandidate,
  type FullPotentialLookalikeFeatures,
  type FullPotentialLookalikePublicSource,
  type FullPotentialLookalikeSeed,
} from "../shared/fullPotentialLookalikeDiscovery";

function source(input: FullPotentialLookalikePublicSource): FullPotentialLookalikePublicSource {
  return input;
}

function features(
  input: Omit<FullPotentialLookalikeFeatures, "recurringProgrammeEvidence" | "currentSignalEvidence">,
): FullPotentialLookalikeFeatures {
  return {
    ...input,
    recurringProgrammeEvidence: { reviewed: false, count: 0 },
    currentSignalEvidence: { reviewed: false, count: 0 },
  };
}

/**
 * Public-evidence seed accounts. These profiles do not contain customer
 * conversations, contacts, quotations, private fleet registers or current
 * commercial values.
 */
export const FP_LOOKALIKE_PUBLIC_SEEDS_V1: FullPotentialLookalikeSeed[] = [
  {
    seedKey: "master-hire-regional-general",
    seedName: "Master Hire",
    clusterKey: "regional-general-hire",
    methodologyVersion: FP_LOOKALIKE_METHOD_VERSION,
    publicSources: [source({
      sourceName: "Master Hire public trailer-compressor range",
      sourceUrl: "https://masterhire.com.au/equipment/air-tools-compressors/trailer-mounted-air-compressors/185cfm-air-compressors/",
      observedAt: "2026-08-21",
      sourceKind: "first_party_company",
      publicObservation: "The public range shows several trailer-compressor sizes and multiple portable-compressor brands within a regional equipment-hire business.",
    })],
    features: features({
      buyerSegment: "rental_hire",
      subsegments: ["regional_general_hire"],
      applications: ["civil", "construction", "demolition", "industrial_maintenance"],
      productCells: ["small_medium_portable_air", "medium_portable_air"],
      cfmBands: ["130_190", "250_275", "350_450"],
      pressureBands: ["standard", "medium"],
      geographies: ["qld"],
      oemExposure: ["atlas_copco", "sullair", "bruder"],
      branchFootprint: "regional",
    }),
  },
  {
    seedKey: "hawk-hire-specialist-air-power",
    seedName: "Hawk Hire",
    clusterKey: "specialist-air-power",
    methodologyVersion: FP_LOOKALIKE_METHOD_VERSION,
    publicSources: [source({
      sourceName: "Hawk Hire public Air and Power range",
      sourceUrl: "https://hawkhire.com.au/",
      observedAt: "2026-08-21",
      sourceKind: "first_party_company",
      publicObservation: "The public site describes a specialist Air and Power fleet serving mining, construction, oil and gas, industrial and government users across Queensland regions.",
    })],
    features: features({
      buyerSegment: "specialist_compressor_rental",
      subsegments: ["air_power_specialist", "mining_rental"],
      applications: ["mining", "construction", "oil_gas", "industrial_maintenance", "drilling"],
      productCells: ["medium_portable_air", "large_portable_air", "high_pressure_portable_air"],
      cfmBands: ["130_190", "250_275", "350_450", "750_1150", "1150_plus"],
      pressureBands: ["standard", "medium", "high"],
      geographies: ["qld", "bowen_basin"],
      oemExposure: ["sullivan_palatek", "sullair"],
      branchFootprint: "regional",
    }),
  },
  {
    seedKey: "northfleet-mining-civil",
    seedName: "Northfleet",
    clusterKey: "mining-civil-hire",
    methodologyVersion: FP_LOOKALIKE_METHOD_VERSION,
    publicSources: [source({
      sourceName: "Northfleet public compressor fleet page",
      sourceUrl: "https://www.northfleet.com.au/fleet/375-425-cfm-sullair-air-compressor/",
      observedAt: "2026-08-21",
      sourceKind: "first_party_company",
      publicObservation: "The public fleet exposes mine-site-oriented portable compressor hire supported through Western Australian and Pilbara depots.",
    })],
    features: features({
      buyerSegment: "mining_civil_hire",
      subsegments: ["mining_equipment_hire", "civil_equipment_hire"],
      applications: ["mining", "civil", "construction", "industrial_maintenance"],
      productCells: ["medium_portable_air"],
      cfmBands: ["350_450"],
      pressureBands: ["standard", "medium"],
      geographies: ["wa", "pilbara"],
      oemExposure: ["sullair"],
      branchFootprint: "regional",
    }),
  },
  {
    seedKey: "pacific-hire-regional",
    seedName: "Pacific Hire",
    clusterKey: "regional-general-hire",
    methodologyVersion: FP_LOOKALIKE_METHOD_VERSION,
    publicSources: [source({
      sourceName: "Pacific Hire public compressor range",
      sourceUrl: "https://pacifichire.com.au/shop/185cfm-towable-air-compressor/",
      observedAt: "2026-08-21",
      sourceKind: "first_party_company",
      publicObservation: "The public range states that portable compressors are available across regional Victorian and South Australian branches.",
    })],
    features: features({
      buyerSegment: "rental_hire",
      subsegments: ["regional_general_hire"],
      applications: ["civil", "construction", "industrial_maintenance"],
      productCells: ["small_medium_portable_air", "medium_portable_air"],
      cfmBands: ["130_190", "350_450"],
      pressureBands: ["standard"],
      geographies: ["vic", "sa"],
      oemExposure: [],
      branchFootprint: "regional",
    }),
  },
];

function candidate(
  input: Omit<FullPotentialLookalikeCandidate, "methodologyVersion" | "reviewState" | "identityStatus" | "proposedOwner">,
): FullPotentialLookalikeCandidate {
  return {
    ...input,
    methodologyVersion: FP_LOOKALIKE_METHOD_VERSION,
    reviewState: "pending_review",
    identityStatus: "not_checked",
    proposedOwner: null,
  };
}

/**
 * First bounded public candidate tranche. Every buyer remains identity-check
 * required and non-counting. The two non-buyer market participants are included
 * deliberately to prove filtering occurs before candidate promotion.
 */
export const FP_LOOKALIKE_PUBLIC_CANDIDATES_V1: FullPotentialLookalikeCandidate[] = [
  candidate({
    candidateKey: "avenida-australia",
    candidateName: "Avenida Australia",
    marketRole: "buyer",
    proposedRouteToMarket: "manual_review",
    publicSimilarityRationale: "A Western Australian site-mobilisation and equipment-hire business publicly offering high-pressure portable air for mining, shutdown, civil and industrial work resembles a small regional rental buyer.",
    publicSources: [source({
      sourceName: "Avenida Australia public compressor-hire page",
      sourceUrl: "https://avenidagroup.com.au/",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public site offers 400 CFM high-pressure compressor hire for blasting, shutdowns, civil works, industrial cleaning and heavy pneumatic tools across Western Australia.",
    })],
    features: features({
      buyerSegment: "rental_hire",
      subsegments: ["regional_general_hire", "site_mobilisation_hire"],
      applications: ["mining", "shutdown", "civil", "blasting", "industrial_maintenance"],
      productCells: ["medium_portable_air", "high_pressure_portable_air"],
      cfmBands: ["350_450"],
      pressureBands: ["medium", "high"],
      geographies: ["wa", "perth"],
      oemExposure: ["atlas_copco"],
      branchFootprint: "single_site",
    }),
  }),
  candidate({
    candidateKey: "aztech-group",
    candidateName: "Aztech Group",
    marketRole: "buyer",
    proposedRouteToMarket: "manual_review",
    publicSimilarityRationale: "A multi-state civil, mining and construction dry-hire operation with a publicly visible Airman portable compressor resembles a regional mining and civil hire buyer.",
    publicSources: [source({
      sourceName: "Aztech Group public 185 CFM compressor page",
      sourceUrl: "https://www.aztechgroup.com.au/equipment-hire/equipment/air-compressor-trailer-185cfm",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public hire page lists an Airman 185 CFM trailer compressor for civil, mining, industrial, drilling and blasting applications, supported from New South Wales and Queensland operations.",
    }), source({
      sourceName: "Aztech Group public service-area page",
      sourceUrl: "https://www.aztechgroup.com.au/service-areas",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public service-area page identifies equipment-hire coverage from Gunnedah and Brisbane across Northern New South Wales and South East Queensland.",
    })],
    features: features({
      buyerSegment: "mining_civil_hire",
      subsegments: ["civil_equipment_hire", "mining_equipment_hire", "earthmoving_hire"],
      applications: ["civil", "mining", "construction", "industrial_maintenance", "drilling", "blasting"],
      productCells: ["small_medium_portable_air"],
      cfmBands: ["130_190"],
      pressureBands: ["standard"],
      geographies: ["nsw", "qld"],
      oemExposure: ["airman"],
      branchFootprint: "multi_state",
    }),
  }),
  candidate({
    candidateKey: "rawson-hire",
    candidateName: "Rawson Hire",
    marketRole: "buyer",
    proposedRouteToMarket: "manual_review",
    publicSimilarityRationale: "A specialist regional compressor and rock-drilling hirer with public Sullair exposure resembles the specialist Air and Power seed cluster.",
    publicSources: [source({
      sourceName: "Rawson Hire public compressor fleet page",
      sourceUrl: "https://www.rawsonhire.com/",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public site lists high- and low-pressure Sullair portable diesel compressors from 185 to 400 CFM plus rock-drilling services across the Townsville region.",
    })],
    features: features({
      buyerSegment: "specialist_compressor_rental",
      subsegments: ["compressor_specialist", "rock_drilling_hire"],
      applications: ["mining", "drilling", "rock_excavation", "civil", "industrial_maintenance"],
      productCells: ["small_medium_portable_air", "medium_portable_air", "high_pressure_portable_air"],
      cfmBands: ["130_190", "350_450"],
      pressureBands: ["standard", "high"],
      geographies: ["qld", "townsville"],
      oemExposure: ["sullair"],
      branchFootprint: "regional",
    }),
  }),
  candidate({
    candidateKey: "jc-hire",
    candidateName: "JC Hire",
    marketRole: "buyer",
    proposedRouteToMarket: "manual_review",
    publicSimilarityRationale: "A long-established Sunshine Coast dry-hire business with public 185 and 260 CFM portable compressors resembles a regional general-hire buyer with medium-air exposure.",
    publicSources: [source({
      sourceName: "JC Hire public 185 CFM compressor page",
      sourceUrl: "https://www.jchire.com.au/product/compair-c50-portable-175cfm-compressor",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public page lists a 185 CFM towable compressor for construction, roadworks, civil, pipeline and industrial maintenance applications.",
    }), source({
      sourceName: "JC Hire public 260 CFM compressor page",
      sourceUrl: "https://www.jchire.com.au/product/compair-c76-260cfm-portable-compressor",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public page lists a 260 CFM towable compressor for pipeline, drilling, civil construction, industrial maintenance and shutdown work.",
    })],
    features: features({
      buyerSegment: "rental_hire",
      subsegments: ["regional_general_hire", "dry_hire"],
      applications: ["civil", "construction", "pipeline", "drilling", "industrial_maintenance", "shutdown"],
      productCells: ["small_medium_portable_air", "medium_portable_air"],
      cfmBands: ["130_190", "250_275"],
      pressureBands: ["standard", "medium"],
      geographies: ["qld", "sunshine_coast"],
      oemExposure: ["airman", "sullair"],
      branchFootprint: "regional",
    }),
  }),
  candidate({
    candidateKey: "winch-hire-australia",
    candidateName: "Winch Hire Australia",
    marketRole: "buyer",
    proposedRouteToMarket: "manual_review",
    publicSimilarityRationale: "A specialist cable-handling and lifting hirer with a national portable-compressor range resembles a multi-state civil and infrastructure equipment buyer.",
    publicSources: [source({
      sourceName: "Winch Hire Australia public compressor range",
      sourceUrl: "https://winchhire.com.au/",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public site states that diesel air compressors from 100 to 500 CFM are available for projects through Brisbane and Sydney operations with national logistics support.",
    }), source({
      sourceName: "Winch Hire Australia public 260 CFM page",
      sourceUrl: "https://winchhire.com.au/shop/compressors/260cfm-diesel-compressor/",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public product page lists a 260 CFM compressor for construction, mining, industrial and agricultural applications.",
    })],
    features: features({
      buyerSegment: "mining_civil_hire",
      subsegments: ["specialist_equipment_hire", "cable_handling_hire", "civil_equipment_hire"],
      applications: ["civil", "construction", "mining", "industrial_maintenance", "utilities", "cable_blowing"],
      productCells: ["small_medium_portable_air", "medium_portable_air"],
      cfmBands: ["75_110", "130_190", "250_275", "350_450"],
      pressureBands: ["standard", "medium"],
      geographies: ["qld", "nsw", "national"],
      oemExposure: [],
      branchFootprint: "multi_state",
    }),
  }),
  candidate({
    candidateKey: "feniks-plant-equipment",
    candidateName: "Feniks Plant & Equipment",
    marketRole: "buyer",
    proposedRouteToMarket: "manual_review",
    publicSimilarityRationale: "A plant-and-equipment hirer publicly offering a Rotair 185 CFM compressor resembles a small regional rental buyer, but the visible compressor depth is limited.",
    publicSources: [source({
      sourceName: "Feniks Plant & Equipment public compressor page",
      sourceUrl: "https://www.fenikshire.com.au/185-cfm-rotair-diesel-box-compressor-hire",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public hire page lists a Rotair 185 CFM diesel compressor for industrial and trade applications in tough operating conditions.",
    })],
    features: features({
      buyerSegment: "rental_hire",
      subsegments: ["regional_general_hire", "plant_equipment_hire"],
      applications: ["construction", "industrial_maintenance"],
      productCells: ["small_medium_portable_air"],
      cfmBands: ["130_190"],
      pressureBands: ["standard"],
      geographies: ["au"],
      oemExposure: ["rotair"],
      branchFootprint: "single_site",
    }),
  }),
  candidate({
    candidateKey: "gaamben",
    candidateName: "Gaamben",
    marketRole: "dealer",
    proposedRouteToMarket: "exclude",
    publicSimilarityRationale: "The public range is useful market evidence, but a supplier aligned to the existing Atlas Copco product route must be filtered before buyer-candidate scoring.",
    publicSources: [source({
      sourceName: "Gaamben public hire range",
      sourceUrl: "https://www.gaamben.com.au/hire/",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public page offers Atlas Copco compressors from 75 to 600 CFM for hire and rent-to-buy throughout regional New South Wales.",
    })],
    features: features({
      buyerSegment: "channel_market_participant",
      subsegments: ["dealer_hire"],
      applications: ["construction", "industrial_maintenance", "regional_hire"],
      productCells: ["small_medium_portable_air", "medium_portable_air", "large_portable_air"],
      cfmBands: ["75_110", "130_190", "250_275", "350_450", "550_700"],
      pressureBands: ["standard", "medium"],
      geographies: ["nsw", "regional_nsw"],
      oemExposure: ["atlas_copco"],
      branchFootprint: "regional",
    }),
  }),
  candidate({
    candidateKey: "lifting-gear-hire-sales",
    candidateName: "Lifting Gear Hire & Sales",
    marketRole: "reseller",
    proposedRouteToMarket: "exclude",
    publicSimilarityRationale: "The public compressor offer is delivered in partnership with an existing compressor specialist, so it should remain route/context evidence rather than become another monetary buyer pool.",
    publicSources: [source({
      sourceName: "Lifting Gear Hire & Sales public compressor page",
      sourceUrl: "https://liftinggearhire.com.au/hire/air-compressor-hire/",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public page offers 185 and 375 CFM trailer compressors through a stated partnership with Compressed Air Hire for mining, oil and gas and general industry applications.",
    })],
    features: features({
      buyerSegment: "channel_market_participant",
      subsegments: ["reseller_hire", "lifting_rigging_hire"],
      applications: ["mining", "oil_gas", "industrial_maintenance"],
      productCells: ["small_medium_portable_air", "medium_portable_air"],
      cfmBands: ["130_190", "350_450"],
      pressureBands: ["standard", "high"],
      geographies: ["wa", "perth", "karratha"],
      oemExposure: [],
      branchFootprint: "regional",
    }),
  }),
];
