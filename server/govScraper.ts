/**
 * Government Major Projects Scraper
 *
 * Curated database of nationally significant infrastructure projects from:
 * 1. Infrastructure Australia Priority List (transport, water, social)
 * 2. National Renewable Energy Priority List (NREPL — generation, storage, transmission)
 * 3. State Government Capital Works Programs (major civil/water projects)
 *
 * These are multi-billion dollar projects that drive demand for Atlas Copco
 * Power Technique equipment across all business lines:
 * - Portable Air: tunnelling, civil works, commissioning
 * - PAL: temporary power, lighting towers for 24/7 construction
 * - BESS: battery storage co-located with renewables
 * - Pump: dewatering, water management, dam construction
 *
 * Runs weekly (Tuesdays) as part of the daily pipeline.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { projects, reports, businessLines } from "../drizzle/schema";
import type { InsertProject } from "../drizzle/schema";
import { generateAndEnrichContacts } from "./contactEnrichment";
import { scoreProjectAsync } from "./businessLineScoring";

// ── Types ──

interface GovProject {
  name: string;
  owner: string;
  state: string;
  sector: "infrastructure" | "energy" | "mining" | "defence";
  category: string;
  value: string;
  stage: string;
  description: string;
  source: { label: string; url: string };
  equipmentRelevance: string[];
  businessLineHints: ("air" | "pal" | "bess" | "pump")[];
}

export interface GovScrapeResult {
  totalFetched: number;
  totalNewProjects: number;
  totalDuplicates: number;
  totalSkipped: number;
  totalErrors: number;
  errors: string[];
  duration: number;
}

// ── Infrastructure Australia Priority List Projects ──
// Source: https://www.infrastructureaustralia.gov.au/infrastructure-priority-list
// As at January 2024

const INFRA_AUSTRALIA_PROJECTS: GovProject[] = [
  {
    name: "Inland Rail — Melbourne to Brisbane",
    owner: "Australian Rail Track Corporation (ARTC)",
    state: "NSW/QLD/VIC",
    sector: "infrastructure",
    category: "National Connectivity",
    value: "$31.4 billion",
    stage: "Under Construction — Multiple Sections",
    description: "1,700km dedicated freight rail corridor from Melbourne to Brisbane. 13 separate construction packages across three states. Massive tunnelling, earthworks, and bridge construction. Multi-year construction program through 2030.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Tunnel boring requires high-volume compressed air (2000+ CFM)",
      "Bridge construction needs portable generators and lighting towers",
      "Earthworks and rail formation require dewatering pumps",
      "Remote construction camps need temporary power generation",
      "Multiple concurrent work fronts — fleet-scale equipment demand",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Western Sydney International Airport",
    owner: "Western Sydney Airport Company",
    state: "NSW",
    sector: "infrastructure",
    category: "National Connectivity",
    value: "$11 billion",
    stage: "Under Construction — Phase 1",
    description: "Australia's first new major airport in 50 years. Phase 1 includes single runway, terminal, and supporting infrastructure. Massive earthworks, concrete, and steel construction. Opening targeted for 2026.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Concrete placement and curing requires compressed air systems",
      "24/7 construction operations need lighting towers and generators",
      "Groundwater management requires dewatering pump systems",
      "Terminal fit-out needs portable air for HVAC commissioning",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Snowy 2.0 Pumped Hydro",
    owner: "Snowy Hydro Limited",
    state: "NSW",
    sector: "energy",
    category: "Energy Transformation",
    value: "$12 billion",
    stage: "Under Construction",
    description: "2,000 MW pumped hydro expansion of the Snowy Mountains Scheme. 27km of tunnels connecting existing dams. Australia's largest renewable energy project. TBMs and drill-and-blast operations ongoing.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Tunnel boring machines require massive compressed air supply (3000+ CFM)",
      "Underground works need continuous dewatering pump operations",
      "Remote mountain construction requires portable power generation",
      "Drill-and-blast operations need high-pressure compressors (350+ psi)",
      "Multi-year construction — long-term rental opportunity",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Melbourne Metro Tunnel",
    owner: "Rail Projects Victoria",
    state: "VIC",
    sector: "infrastructure",
    category: "National Connectivity",
    value: "$14.3 billion",
    stage: "Under Construction — Tunnelling Complete",
    description: "Twin 9km rail tunnels under central Melbourne with five new underground stations. Tunnelling complete, now in fit-out and commissioning phase. Systems integration and testing through 2025.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Station fit-out requires compressed air for concrete and tiling",
      "Electrical commissioning needs portable power and lighting",
      "Ongoing dewatering during underground station construction",
      "Ventilation system testing requires temporary air supply",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Sydney Metro West",
    owner: "Sydney Metro",
    state: "NSW",
    sector: "infrastructure",
    category: "National Connectivity",
    value: "$25 billion",
    stage: "Under Construction — Tunnelling",
    description: "24km metro line from Sydney CBD to Parramatta via 9 new stations. TBM tunnelling underway. Major underground station construction. Expected completion 2032.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "TBM operations require high-volume compressed air supply",
      "Underground station excavation needs dewatering pumps",
      "24/7 tunnelling operations need portable generators and lighting",
      "Concrete segment production requires compressed air systems",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Cross River Rail",
    owner: "Cross River Rail Delivery Authority",
    state: "QLD",
    sector: "infrastructure",
    category: "National Connectivity",
    value: "$6.9 billion",
    stage: "Under Construction — Station Fit-out",
    description: "10.2km rail line including 5.9km twin tunnels under Brisbane River and CBD. Four new underground stations. Tunnelling complete, station fit-out and systems installation underway.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Station fit-out requires portable compressed air and power",
      "Systems commissioning needs temporary electrical supply",
      "Ongoing dewatering in underground station boxes",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Suburban Rail Loop — East Section",
    owner: "Suburban Rail Loop Authority",
    state: "VIC",
    sector: "infrastructure",
    category: "National Connectivity",
    value: "$34.5 billion",
    stage: "Early Works — TBM Launch 2026",
    description: "26km underground rail from Cheltenham to Box Hill via 6 new stations. Australia's largest ever public transport project. TBM launch expected 2026. Full completion 2035.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "TBM launch and operation requires massive compressed air infrastructure",
      "Station box excavation needs high-capacity dewatering pumps",
      "Multi-year tunnel construction — fleet-scale generator and lighting demand",
      "Concrete segment factory requires industrial compressed air",
      "Largest single equipment demand opportunity in Australia",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "North East Link",
    owner: "North East Link Program",
    state: "VIC",
    sector: "infrastructure",
    category: "National Connectivity",
    value: "$26 billion",
    stage: "Under Construction — Tunnelling 2025",
    description: "6.5km twin tunnels connecting M80 Ring Road to Eastern Freeway. Australia's largest road project. TBM tunnelling commencing 2025. Includes major interchange construction.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Twin TBM operations require dual compressed air supply systems",
      "Cut-and-cover sections need dewatering and temporary power",
      "Interchange construction requires portable air for concrete work",
      "24/7 construction needs lighting towers across multiple work fronts",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "WestConnex M12 Motorway",
    owner: "Transport for NSW",
    state: "NSW",
    sector: "infrastructure",
    category: "National Connectivity",
    value: "$2.6 billion",
    stage: "Under Construction",
    description: "16km motorway connecting Western Sydney Airport to the existing motorway network. Major bridge and interchange construction. Supporting the new airport precinct.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Bridge construction requires compressed air for post-tensioning",
      "Earthworks and drainage need dewatering pumps",
      "Night construction requires lighting towers",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Warragamba Dam Wall Raising",
    owner: "WaterNSW",
    state: "NSW",
    sector: "infrastructure",
    category: "Access to Water",
    value: "$1.6 billion",
    stage: "Approved — Construction Pending",
    description: "Raising Warragamba Dam wall by 14 metres to provide flood mitigation for the Hawkesbury-Nepean Valley. Major concrete and earthworks construction on existing dam structure.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Dam construction requires high-volume compressed air for concrete placement",
      "Massive dewatering pump requirements during construction",
      "Remote site needs portable power generation",
      "Drill-and-blast for rock foundations needs high-pressure compressors",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Hells Gates Dam",
    owner: "Queensland Government",
    state: "QLD",
    sector: "infrastructure",
    category: "Access to Water",
    value: "$5.4 billion",
    stage: "Feasibility — Investment Decision Pending",
    description: "Major new dam on the Burdekin River to support agriculture and industry in North Queensland. 2,000 GL capacity. Would be one of Australia's largest dams.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Dam construction requires massive dewatering pump systems",
      "Concrete batching needs industrial compressed air",
      "Remote North QLD location requires portable power generation",
      "Multi-year construction — long-term equipment rental opportunity",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Marinus Link — Tasmania to Victoria",
    owner: "TasNetworks / Marinus Link Pty Ltd",
    state: "TAS/VIC",
    sector: "energy",
    category: "Energy Transformation",
    value: "$3.8 billion",
    stage: "Approved — Construction 2025",
    description: "1,500 MW undersea HVDC cable connecting Tasmania to Victoria. 255km submarine cable plus onshore converter stations. Enables Tasmania's Battery of the Nation strategy.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Converter station construction requires compressed air and portable power",
      "Cable landing sites need dewatering pumps",
      "Onshore cable trenching requires portable air for pneumatic tools",
      "Remote Tasmanian construction sites need generator sets",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "AUKUS Submarine Base — Stirling",
    owner: "Department of Defence",
    state: "WA",
    sector: "defence",
    category: "National Security",
    value: "$8 billion+",
    stage: "Planning — Construction 2026",
    description: "Major expansion of HMAS Stirling naval base to support nuclear-powered submarine fleet under AUKUS agreement. Includes new wharves, maintenance facilities, and supporting infrastructure.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Wharf construction requires marine-grade compressed air systems",
      "Submarine maintenance facilities need industrial air compressors",
      "Dredging and marine works require dewatering pumps",
      "Secure facility construction needs portable power and lighting",
      "Long-term defence contract — premium equipment demand",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Osborne Naval Shipyard Expansion",
    owner: "ASC / BAE Systems",
    state: "SA",
    sector: "defence",
    category: "National Security",
    value: "$4.5 billion",
    stage: "Under Construction",
    description: "Expansion of Osborne shipyard for Hunter-class frigate and AUKUS submarine construction. New assembly halls, outfitting wharves, and testing facilities.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Shipyard construction requires industrial compressed air systems",
      "Marine works need dewatering and drainage pumps",
      "24/7 construction requires portable power and lighting",
      "Steel fabrication needs high-pressure air for blasting and painting",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Olympic Dam Expansion — BHP",
    owner: "BHP",
    state: "SA",
    sector: "mining",
    category: "Resource Development",
    value: "$10 billion+",
    stage: "Feasibility — Phased Expansion",
    description: "Phased expansion of the world's largest uranium deposit and fourth-largest copper deposit. Includes underground mine expansion, new processing facilities, and desalination plant.",
    source: { label: "Infrastructure Australia", url: "https://www.infrastructureaustralia.gov.au/infrastructure-priority-list" },
    equipmentRelevance: [
      "Underground mine expansion requires massive compressed air infrastructure",
      "Processing plant construction needs portable power and air",
      "Desalination plant requires industrial pump systems",
      "Remote SA location — all equipment must be portable/mobile",
      "Multi-decade project — ongoing equipment demand",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
];

// ── National Renewable Energy Priority List (NREPL) Projects ──
// Source: https://www.dcceew.gov.au/energy/renewable/priority-list
// 56 priority projects as of March 2025

const NREPL_PROJECTS: GovProject[] = [
  {
    name: "Australian Renewable Energy Hub (AREH)",
    owner: "AREH Pty Ltd",
    state: "WA",
    sector: "energy",
    category: "NREPL — Generation",
    value: "1,000 MW (Wind + Solar)",
    stage: "Proposed",
    description: "Massive hybrid wind and solar energy hub in the Pilbara region of Western Australia. One of the world's largest planned renewable energy projects.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Wind turbine foundation construction requires compressed air for concrete",
      "Solar farm installation needs portable power for remote sites",
      "Pilbara location requires robust dewatering for seasonal flooding",
      "Multi-year construction across vast area — fleet-scale demand",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Bungaban Renewable Energy Project",
    owner: "Windlab Developments",
    state: "QLD",
    sector: "energy",
    category: "NREPL — Generation",
    value: "1,750 MW (Wind 1400 + BESS 350)",
    stage: "Proposed",
    description: "Major wind farm with battery storage in Queensland. One of Australia's largest proposed wind-battery hybrid projects.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Wind turbine installation requires crane support and compressed air",
      "BESS construction needs temporary power during installation",
      "Remote QLD site needs portable generators and lighting",
    ],
    businessLineHints: ["air", "pal", "bess"],
  },
  {
    name: "Liverpool Range Wind Farm",
    owner: "Tilt Renewables",
    state: "NSW",
    sector: "energy",
    category: "NREPL — Generation",
    value: "1,332 MW (Wind)",
    stage: "Proposed",
    description: "One of Australia's largest proposed wind farms in the NSW Hunter Valley region. Would be a transformational project for the region's energy transition.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Massive wind farm requires fleet of cranes with compressed air support",
      "Road construction for turbine access needs portable air and power",
      "Foundation construction requires concrete pumping and compressed air",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Cannie Wind Farm",
    owner: "RES",
    state: "VIC",
    sector: "energy",
    category: "NREPL — Generation",
    value: "1,300 MW (Wind)",
    stage: "Proposed",
    description: "Large-scale wind farm in regional Victoria. Part of the Victorian Renewable Energy Zone development.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Wind turbine foundation construction requires compressed air",
      "Access road construction needs portable power and lighting",
      "Substation construction requires temporary power supply",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Theodore Wind Farm",
    owner: "Theodore Energy Development",
    state: "QLD",
    sector: "energy",
    category: "NREPL — Generation",
    value: "1,340 MW (Wind 1100 + BESS 240)",
    stage: "Proposed",
    description: "Major wind-battery hybrid project in Queensland. Significant BESS component for grid stability.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Wind turbine installation requires compressed air systems",
      "BESS construction needs temporary power and cooling",
      "Remote site requires portable generators",
    ],
    businessLineHints: ["air", "pal", "bess"],
  },
  {
    name: "Boomer Green Energy Hub",
    owner: "Ark Energy",
    state: "QLD",
    sector: "energy",
    category: "NREPL — Generation",
    value: "1,000 MW (Wind)",
    stage: "Proposed",
    description: "Large wind energy hub in Queensland developed by Ark Energy (Korea Zinc subsidiary).",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Wind farm construction requires portable air and power equipment",
      "Foundation works need compressed air for concrete placement",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Bundey BESS and Solar Project",
    owner: "Genaspi Energy Group",
    state: "SA",
    sector: "energy",
    category: "NREPL — Generation",
    value: "2,100 MW (Solar 900 + BESS 1200)",
    stage: "Proposed",
    description: "Massive solar-battery hybrid in South Australia. 1,200 MW BESS would be one of the world's largest battery installations.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "World-scale BESS construction requires temporary power systems",
      "Solar farm installation needs portable generators for remote SA site",
      "Battery module installation requires compressed air for cooling",
      "Site preparation needs dewatering pumps",
    ],
    businessLineHints: ["air", "pal", "bess", "pump"],
  },
  {
    name: "Mount Rawdon Pumped Hydro",
    owner: "Mt Rawdon Pumped Hydro Pty Ltd",
    state: "QLD",
    sector: "energy",
    category: "NREPL — Generation",
    value: "2,000 MW (Pumped Storage)",
    stage: "Proposed",
    description: "Repurposing of former gold mine as a 2,000 MW pumped hydro facility. Would be one of Australia's largest energy storage projects.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Dam and reservoir construction requires massive dewatering pumps",
      "Underground powerhouse excavation needs high-volume compressed air",
      "Tunnel construction requires drill-and-blast compressed air (350+ psi)",
      "Multi-year construction — long-term equipment rental opportunity",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Capricornia Energy Hub — Pumped Hydro",
    owner: "Copenhagen Infrastructure Partners",
    state: "QLD",
    sector: "energy",
    category: "NREPL — Generation",
    value: "750 MW (Pumped Storage)",
    stage: "Proposed",
    description: "Pumped hydro energy storage project in Central Queensland. Part of the broader Capricornia Energy Hub development.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Dam construction requires dewatering pumps and compressed air",
      "Underground works need portable power and lighting",
      "Remote QLD location requires self-sufficient power supply",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Valley of the Winds",
    owner: "ACEN Australia",
    state: "NSW",
    sector: "energy",
    category: "NREPL — Generation",
    value: "900 MW (Wind)",
    stage: "Proposed",
    description: "Large wind farm in New South Wales developed by ACEN Australia (AC Energy subsidiary).",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Wind turbine installation requires crane support and compressed air",
      "Foundation construction needs portable power and concrete equipment",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Cobbora Solar Farm",
    owner: "Pacific Partnerships",
    state: "NSW",
    sector: "energy",
    category: "NREPL — Generation",
    value: "1,100 MW (Solar 700 + BESS 400)",
    stage: "Proposed",
    description: "Large solar-battery hybrid in central western NSW. Significant BESS component for dispatchable power.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Solar farm construction requires portable power for inverter installation",
      "BESS construction needs temporary power and compressed air",
      "Site preparation may require dewatering",
    ],
    businessLineHints: ["air", "pal", "bess"],
  },
  {
    name: "Spicers Creek Wind Farm",
    owner: "Squadron Energy",
    state: "NSW",
    sector: "energy",
    category: "NREPL — Generation",
    value: "702 MW (Wind)",
    stage: "Proposed",
    description: "Major wind farm in central western NSW developed by Squadron Energy (Tattarang subsidiary).",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Wind turbine foundation construction requires compressed air",
      "Access road construction needs portable power equipment",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Hexham Wind Farm",
    owner: "Wind Prospect Pty Ltd",
    state: "VIC",
    sector: "energy",
    category: "NREPL — Generation",
    value: "686 MW (Wind)",
    stage: "Proposed",
    description: "Large wind farm in regional Victoria. Part of the Western Victorian Renewable Energy Zone.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Wind farm construction requires portable air and power fleet",
      "Foundation works need compressed air for concrete placement",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Baru-Marnda Renewable Energy Project",
    owner: "Yindjibarndi Energy Corporation",
    state: "WA",
    sector: "energy",
    category: "NREPL — Generation",
    value: "550 MW (Wind + Solar)",
    stage: "Proposed",
    description: "Indigenous-led wind and solar project in the Pilbara. First Nations energy sovereignty project.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Remote Pilbara construction requires portable power generation",
      "Wind and solar installation needs compressed air systems",
      "Seasonal flooding requires dewatering pumps",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Richmond Valley Solar and BESS",
    owner: "Ark Energy",
    state: "NSW",
    sector: "energy",
    category: "NREPL — Generation",
    value: "775 MW (Solar 500 + BESS 275)",
    stage: "Proposed",
    description: "Solar-battery hybrid in northern NSW. Part of Ark Energy's Australian renewable energy portfolio.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Solar farm construction requires portable generators",
      "BESS installation needs temporary power and compressed air",
    ],
    businessLineHints: ["air", "pal", "bess"],
  },
  {
    name: "Parron Wind Farm",
    owner: "Zephyr Energy",
    state: "WA",
    sector: "energy",
    category: "NREPL — Generation",
    value: "490 MW (Wind)",
    stage: "Proposed",
    description: "Wind farm in Western Australia's south-west. Part of WA's energy transition strategy.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Wind turbine construction requires compressed air and portable power",
      "Foundation works need concrete placement equipment",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Bashan Wind Farm",
    owner: "Bashan Wind Farm Pty Ltd",
    state: "TAS",
    sector: "energy",
    category: "NREPL — Generation",
    value: "460 MW (Wind)",
    stage: "Proposed",
    description: "Large wind farm in Tasmania. Supports Tasmania's Battery of the Nation strategy.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Tasmanian wind farm construction requires portable air and power",
      "Remote site needs self-sufficient equipment fleet",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Moreton Hill Wind Farm",
    owner: "Squadron Energy",
    state: "VIC",
    sector: "energy",
    category: "NREPL — Generation",
    value: "420 MW (Wind)",
    stage: "Proposed",
    description: "Wind farm in regional Victoria developed by Squadron Energy.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Wind turbine installation requires compressed air systems",
      "Foundation construction needs portable power",
    ],
    businessLineHints: ["air", "pal"],
  },
  // ── NREPL Transmission Projects (major civil works) ──
  {
    name: "HumeLink Transmission",
    owner: "Transgrid",
    state: "NSW",
    sector: "energy",
    category: "NREPL — Transmission",
    value: "$4.9 billion (500 kV, 360 km)",
    stage: "Under Construction — Early Works",
    description: "360km high-voltage transmission line connecting Snowy 2.0 to Sydney and Melbourne load centres. Massive tower construction and line stringing across rugged terrain.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Tower foundation construction requires compressed air for concrete",
      "Remote mountain terrain needs portable generators and lighting",
      "Access road construction requires earthmoving support equipment",
      "Line stringing operations need portable power for winch systems",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "VNI West Transmission",
    owner: "AEMO / Transgrid / AusNet",
    state: "VIC/NSW",
    sector: "energy",
    category: "NREPL — Transmission",
    value: "$3.3 billion (500 kV)",
    stage: "Approved — Route Selection",
    description: "New 500kV interconnector between Victoria and NSW. Critical for renewable energy zone connections.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Transmission tower construction requires compressed air and portable power",
      "Substation construction needs temporary power supply",
      "Rural construction requires self-sufficient equipment fleet",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Central West Orana REZ Transmission",
    owner: "EnergyCo NSW",
    state: "NSW",
    sector: "energy",
    category: "NREPL — Transmission",
    value: "$4.4 billion (500 kV, 460 km)",
    stage: "Approved — Construction 2025",
    description: "460km transmission network connecting the Central West Orana Renewable Energy Zone to the NSW grid. Australia's first coordinated REZ transmission project.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Tower foundation construction requires compressed air systems",
      "460km of line construction needs fleet-scale portable power",
      "Substation construction requires temporary generators",
      "Remote NSW construction needs lighting towers for safety",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Project EnergyConnect",
    owner: "ElectraNet / Transgrid",
    state: "SA/NSW",
    sector: "energy",
    category: "NREPL — Transmission",
    value: "$2.4 billion (330 kV, 900 km)",
    stage: "Under Construction",
    description: "900km transmission interconnector between South Australia and NSW via Broken Hill. Critical for SA renewable energy export.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "900km of remote construction requires portable power fleet",
      "Tower construction in arid conditions needs compressed air",
      "Remote outback locations require self-sufficient generator sets",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Western Renewables Link",
    owner: "AusNet Services",
    state: "VIC",
    sector: "energy",
    category: "NREPL — Transmission",
    value: "$2.8 billion (500 kV, 190 km)",
    stage: "Approved — Construction 2025",
    description: "190km transmission line connecting western Victorian renewable energy zones to Melbourne. Critical for Victoria's renewable energy targets.",
    source: { label: "NREPL", url: "https://www.dcceew.gov.au/energy/renewable/priority-list" },
    equipmentRelevance: [
      "Transmission tower construction requires compressed air and power",
      "Substation construction needs temporary power supply",
    ],
    businessLineHints: ["air", "pal"],
  },
  // ── State Government Major Water Projects ──
  {
    name: "Wyangala Dam Wall Raising",
    owner: "WaterNSW",
    state: "NSW",
    sector: "infrastructure",
    category: "State — Water Infrastructure",
    value: "$2.1 billion",
    stage: "Under Construction",
    description: "Raising Wyangala Dam wall by 10 metres to increase storage capacity by 53%. Major concrete and earthworks construction.",
    source: { label: "NSW Government", url: "https://www.waternsw.com.au/projects/new-dams-and-pipelines/wyangala-dam-wall-raising" },
    equipmentRelevance: [
      "Dam wall construction requires high-volume compressed air",
      "Massive dewatering pump requirements during construction",
      "Concrete batching and placement needs industrial air supply",
      "Remote site needs portable power generation",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Dungowan Dam",
    owner: "WaterNSW",
    state: "NSW",
    sector: "infrastructure",
    category: "State — Water Infrastructure",
    value: "$1.3 billion",
    stage: "Approved — Construction Pending",
    description: "New 22.5 GL dam on the Peel River near Tamworth. Replaces existing small dam to improve regional water security.",
    source: { label: "NSW Government", url: "https://www.waternsw.com.au/projects/new-dams-and-pipelines/dungowan-dam" },
    equipmentRelevance: [
      "New dam construction requires dewatering pumps and compressed air",
      "Earthworks and rock foundation work needs portable power",
      "Concrete placement requires industrial compressed air systems",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Rookwood Weir",
    owner: "Sunwater",
    state: "QLD",
    sector: "infrastructure",
    category: "State — Water Infrastructure",
    value: "$567 million",
    stage: "Under Construction",
    description: "New weir on the Fitzroy River in Central Queensland. 76 GL capacity to support agriculture and industry.",
    source: { label: "QLD Government", url: "https://www.sunwater.com.au/projects/rookwood-weir/" },
    equipmentRelevance: [
      "Weir construction requires dewatering pumps for river diversion",
      "Concrete placement needs compressed air systems",
      "Remote site needs portable generators",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Onslow Water Supply Scheme",
    owner: "Water Corporation WA",
    state: "WA",
    sector: "infrastructure",
    category: "State — Water Infrastructure",
    value: "$275 million",
    stage: "Under Construction",
    description: "New desalination plant and pipeline to supply water to the Onslow region supporting Pilbara resource projects.",
    source: { label: "WA Government", url: "https://www.watercorporation.com.au/Our-water/Major-projects" },
    equipmentRelevance: [
      "Desalination plant construction requires industrial pump systems",
      "Pipeline construction needs portable air for welding and testing",
      "Remote Pilbara location requires portable power generation",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
];

// ── All Government Projects ──

const ALL_GOV_PROJECTS = [...INFRA_AUSTRALIA_PROJECTS, ...NREPL_PROJECTS];

// ── Business Line Matching ──

function matchBusinessLines(project: GovProject): number[] {
  const ids: number[] = [];
  for (const hint of project.businessLineHints) {
    if (hint === "air") ids.push(-1);
    if (hint === "bess") ids.push(-2);
    if (hint === "pal") ids.push(-3);
    if (hint === "pump") ids.push(-4);
  }
  return ids;
}

function mapPriority(stage: string, value: string): "hot" | "warm" | "cold" {
  const s = stage.toLowerCase();
  if (s.includes("under construction") || s.includes("early works")) return "hot";
  if (s.includes("approved") || s.includes("committed") || s.includes("construction 2025") || s.includes("construction 2026")) return "hot";
  if (s.includes("proposed") || s.includes("feasibility") || s.includes("route selection")) return "warm";
  return "cold";
}

function mapCapexGrade(value: string): "A" | "B" | "Unknown" {
  // Extract numeric value in billions or millions
  const billionMatch = value.match(/\$?([\d.]+)\s*billion/i);
  if (billionMatch) {
    const billions = parseFloat(billionMatch[1]);
    if (billions >= 1) return "A";
    return "B";
  }
  const millionMatch = value.match(/\$?([\d,]+)\s*million/i);
  if (millionMatch) {
    const millions = parseFloat(millionMatch[1].replace(/,/g, ""));
    if (millions >= 500) return "A";
    if (millions >= 100) return "B";
    return "Unknown";
  }
  // Check for MW-based values (renewable energy)
  const mwMatch = value.match(/([\d,]+)\s*MW/i);
  if (mwMatch) {
    const mw = parseInt(mwMatch[1].replace(/,/g, ""));
    if (mw >= 500) return "A";
    if (mw >= 200) return "B";
    return "Unknown";
  }
  return "Unknown";
}

function mapSector(project: GovProject): "infrastructure" | "energy" | "mining" | "oil_gas" | "defence" {
  return project.sector as "infrastructure" | "energy" | "mining" | "oil_gas" | "defence";
}

function mapOpportunityRoute(priority: "hot" | "warm" | "cold"): "Direct CAPEX" | "Fleet CAPEX" | "OPEX/Monitor" {
  if (priority === "hot") return "Direct CAPEX";
  if (priority === "warm") return "Fleet CAPEX";
  return "OPEX/Monitor";
}

// ── Deduplication ──

async function isGovDuplicate(projectName: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const normalized = projectName.toLowerCase().trim();
  const existing = await db
    .select({ name: projects.name })
    .from(projects)
    .where(sql`LOWER(${projects.name}) LIKE ${`%${normalized}%`}`)
    .limit(1);

  if (existing.length > 0) return true;

  // Fuzzy match on key words
  const words = normalized.split(/\s+/).filter(w => w.length > 3);
  if (words.length >= 2) {
    const pattern = `%${words[0]}%${words[1]}%`;
    const fuzzy = await db
      .select({ name: projects.name })
      .from(projects)
      .where(sql`LOWER(${projects.name}) LIKE ${pattern}`)
      .limit(1);
    if (fuzzy.length > 0) return true;
  }

  return false;
}

// ── Report helper ──

async function getOrCreateTodayReport(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const today = new Date().toISOString().split("T")[0];
  const existing = await db
    .select()
    .from(reports)
    .where(sql`DATE(${reports.createdAt}) = ${today}`)
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [newReport] = await db.insert(reports).values({
    weekEnding: today,
    generatedTime: new Date().toISOString(),
    executiveSummaryMain: "Auto-generated report from Government Major Projects scraper",
    totalProjects: 0,
    hotProjects: 0,
    warmProjects: 0,
    coldProjects: 0,
    newProjectsCount: 0,
  }).$returningId();

  return newReport.id;
}

// ── Main Scraper ──

export async function runGovScraper(): Promise<GovScrapeResult> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const errors: string[] = [];
  let totalFetched = 0;
  let totalNewProjects = 0;
  let totalDuplicates = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  console.log(`[GOV] Starting scrape — ${ALL_GOV_PROJECTS.length} government major projects...`);

  // Look up business line IDs
  const allBL = await db.select().from(businessLines);
  const blMap: Record<string, number> = {};
  for (const bl of allBL) {
    const name = bl.name.toLowerCase();
    if (name.includes("portable air")) blMap["air"] = bl.id;
    if (name.includes("pal")) blMap["pal"] = bl.id;
    if (name.includes("bess")) blMap["bess"] = bl.id;
    if (name.includes("pump")) blMap["pump"] = bl.id;
  }

  const reportId = await getOrCreateTodayReport();

  for (const govProject of ALL_GOV_PROJECTS) {
    totalFetched++;

    // Dedup check
    const isDup = await isGovDuplicate(govProject.name);
    if (isDup) {
      totalDuplicates++;
      continue;
    }

    // Map business lines
    const rawBLIds = matchBusinessLines(govProject);
    const mappedBLIds: number[] = [];
    for (const rawId of rawBLIds) {
      if (rawId === -1 && blMap["air"]) mappedBLIds.push(blMap["air"]);
      if (rawId === -2 && blMap["bess"]) mappedBLIds.push(blMap["bess"]);
      if (rawId === -3 && blMap["pal"]) mappedBLIds.push(blMap["pal"]);
      if (rawId === -4 && blMap["pump"]) mappedBLIds.push(blMap["pump"]);
    }

    const priority = mapPriority(govProject.stage, govProject.value);
    const capexGrade = mapCapexGrade(govProject.value);
    const sector = mapSector(govProject);
    const opportunityRoute = mapOpportunityRoute(priority);

    const projectData: InsertProject = {
      reportId,
      projectKey: `gov-${govProject.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 120)}`,
      name: govProject.name,
      location: `${govProject.state}, Australia`,
      value: govProject.value,
      owner: govProject.owner,
      priority,
      capexGrade,
      opportunityRoute,
      sector,
      isNew: true,
      stage: govProject.stage,
      overview: govProject.description,
      equipmentSignals: govProject.equipmentRelevance,
      contractors: [
        { name: govProject.owner, status: "confirmed", confidence: 1.0, detail: `Project owner — ${govProject.category}` },
      ],
      opportunityNote: `Government priority project — ${govProject.category}. ${govProject.equipmentRelevance[0]}`,
      sources: [
        { label: govProject.source.label, url: govProject.source.url, date: new Date().toISOString().split("T")[0] },
      ],
      timeline: govProject.stage,
      completion: govProject.stage,
      matchedBusinessLines: mappedBLIds.length > 0 ? mappedBLIds : undefined,
    };

    try {
      const [inserted] = await db.insert(projects).values(projectData).$returningId();
      scoreProjectAsync(inserted.id, "GOV");
      totalNewProjects++;
      console.log(`[GOV] New project: ${govProject.name} (${govProject.value}, ${govProject.state})`);

      // Auto-discover and enrich contacts for this new project
      try {
        const contactResults = await generateAndEnrichContacts(
          inserted.id,
          reportId,
          govProject.name,
          govProject.owner,
          [{ name: govProject.owner, status: "confirmed" }],
          govProject.sector
        );
        if (contactResults.length > 0) {
          console.log(`[GOV] Auto-enriched ${contactResults.length} contacts for ${govProject.name}`);
        }
      } catch (enrichErr) {
        console.warn(`[GOV] Contact enrichment failed for ${govProject.name}:`, enrichErr instanceof Error ? enrichErr.message : String(enrichErr));
      }
    } catch (insertErr) {
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
      errors.push(`Insert "${govProject.name}": ${msg}`);
      totalErrors++;
    }
  }

  // Update report stats
  if (totalNewProjects > 0) {
    const allProjects = await db.select().from(projects).where(eq(projects.reportId, reportId));
    const hot = allProjects.filter(p => p.priority === "hot").length;
    const warm = allProjects.filter(p => p.priority === "warm").length;
    const cold = allProjects.filter(p => p.priority === "cold").length;

    await db.update(reports).set({
      totalProjects: allProjects.length,
      hotProjects: hot,
      warmProjects: warm,
      coldProjects: cold,
      newProjectsCount: totalNewProjects,
    }).where(eq(reports.id, reportId));
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`[GOV] Scrape complete in ${duration}s: ${totalNewProjects} new, ${totalDuplicates} duplicates, ${totalSkipped} skipped`);

  return {
    totalFetched,
    totalNewProjects,
    totalDuplicates,
    totalSkipped,
    totalErrors,
    errors,
    duration,
  };
}

// ── Exported helpers for testing ──

export const _testing = {
  matchBusinessLines,
  mapPriority,
  mapCapexGrade,
  mapOpportunityRoute,
  ALL_GOV_PROJECTS,
  INFRA_AUSTRALIA_PROJECTS,
  NREPL_PROJECTS,
};
