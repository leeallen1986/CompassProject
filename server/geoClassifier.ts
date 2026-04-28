/**
 * Geography Classifier — Australia Location Guard
 *
 * Derives projectCountry, projectState, and locationConfidence from project data.
 * Separates project geography from company/contact nationality.
 *
 * Rules:
 *  1. An Australian company or contact does NOT make the project Australian.
 *  2. An Australian news source does NOT make the project Australian.
 *  3. Only explicit location evidence in the project text determines geography.
 *  4. If location is ambiguous, classify as "blocked_location_unclear".
 */

import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq, isNull, and, or } from "drizzle-orm";

// ── Australian state/territory patterns ──
// Each entry: canonical code → list of keywords that confirm the project is in that state.
const AU_STATE_PATTERNS: Record<string, string[]> = {
  WA: [
    "western australia", "perth", "pilbara", "kalgoorlie", "karratha",
    "port hedland", "newman", "geraldton", "bunbury", "broome", "esperance",
    "collie", "kwinana", "mandurah", "albany", "dampier", "tom price",
    "paraburdoo", "telfer", "norseman", "meekatharra", "leonora", "laverton",
    "wiluna", "leinster", "kambalda", "coolgardie", "southern cross",
    "boddington", "greenbushes", "ravensthorpe", "onslow", "exmouth",
    "carnarvon", "hedland", "goldfields", "mid-west", "gascoyne",
    "kimberley", "peel region", "south west wa",
  ],
  QLD: [
    "queensland", "brisbane", "townsville", "mackay", "gladstone",
    "rockhampton", "cairns", "bowen basin", "moranbah", "emerald",
    "mount isa", "cloncurry", "charters towers", "bundaberg", "hervey bay",
    "toowoomba", "ipswich", "gold coast", "sunshine coast", "weipa",
    "surat basin", "galilee basin", "isaac region", "fitzroy",
  ],
  NSW: [
    "new south wales", "sydney", "newcastle", "hunter valley", "wollongong",
    "broken hill", "orange", "dubbo", "mudgee", "lithgow", "cessnock",
    "singleton", "muswellbrook", "gunnedah", "narrabri", "cobar",
    "parkes", "cadia", "tomingley", "mcphillamys",
  ],
  VIC: [
    "victoria", "melbourne", "geelong", "ballarat", "bendigo",
    "latrobe valley", "gippsland", "mildura", "shepparton", "wodonga",
    "stawell", "ararat",
  ],
  SA: [
    "south australia", "adelaide", "olympic dam", "whyalla", "port augusta",
    "port pirie", "roxby downs", "ceduna", "prominent hill", "carrapateena",
    "woomera", "leigh creek",
  ],
  NT: [
    "northern territory", "darwin", "alice springs", "tennant creek",
    "katherine", "nhulunbuy", "jabiru", "pine creek", "mcarthur river",
    "groote eylandt", "arafura",
  ],
  TAS: [
    "tasmania", "hobart", "launceston", "burnie", "devonport",
    "queenstown tas", "rosebery", "savage river",
  ],
  ACT: [
    "australian capital territory", "canberra",
  ],
  OFFSHORE_AU: [
    "north west shelf", "nw shelf", "browse basin", "carnarvon basin",
    "timor sea", "bass strait", "gippsland basin", "scarborough",
    "barossa", "ichthys", "prelude", "pluto", "gorgon", "wheatstone",
    "australian offshore", "au offshore",
  ],
};

// ── Explicit non-Australian location patterns ──
// If any of these appear in the project text, it's NOT Australian.
const FOREIGN_COUNTRY_PATTERNS: Array<{ country: string; code: string; patterns: string[] }> = [
  { country: "United States", code: "US", patterns: [
    "california", "alaska", "texas", "nevada", "arizona", "utah", "colorado",
    "wyoming", "montana", "new mexico", "oklahoma", "louisiana", "florida",
    "ohio", "pennsylvania", "west virginia", "kentucky", "virginia",
    "new york", "michigan", "minnesota", "wisconsin", "illinois", "iowa",
    "missouri", "north dakota", "south dakota", "nebraska", "kansas",
    "oregon", "washington state", "idaho", "hawaii",
    "united states", "usa", " us ", "u.s.a", "u.s.",
    "permian basin", "marcellus", "bakken", "eagle ford", "gulf of mexico",
    "appalachia", "san francisco", "los angeles", "houston", "denver",
    "phoenix", "las vegas", "seattle", "portland", "salt lake",
  ]},
  { country: "Canada", code: "CA", patterns: [
    "canada", "canadian", "alberta", "british columbia", "ontario",
    "quebec", "saskatchewan", "manitoba", "newfoundland", "nova scotia",
    "yukon", "nunavut", "northwest territories",
    "toronto", "vancouver", "calgary", "edmonton", "montreal", "ottawa",
    "oil sands", "athabasca", "fort mcmurray",
  ]},
  { country: "Indonesia", code: "ID", patterns: [
    "indonesia", "indonesian", "jakarta", "java", "sumatra", "kalimantan",
    "sulawesi", "papua indonesia", "borneo",
  ]},
  { country: "Papua New Guinea", code: "PG", patterns: [
    "papua new guinea", "png", "port moresby", "lae", "wafi-golpu",
    "porgera", "ok tedi", "lihir",
  ]},
  { country: "Chile", code: "CL", patterns: [
    "chile", "chilean", "santiago", "atacama", "antofagasta", "escondida",
    "chuquicamata", "codelco",
  ]},
  { country: "Peru", code: "PE", patterns: [
    "peru", "peruvian", "lima", "cerro verde", "las bambas", "antamina",
  ]},
  { country: "Brazil", code: "BR", patterns: [
    "brazil", "brazilian", "minas gerais", "carajás", "vale s.a.",
  ]},
  { country: "South Africa", code: "ZA", patterns: [
    "south africa", "south african", "johannesburg", "cape town", "pretoria",
    "bushveld", "witwatersrand", "mpumalanga",
  ]},
  { country: "Mongolia", code: "MN", patterns: [
    "mongolia", "mongolian", "ulaanbaatar", "oyu tolgoi", "tavan tolgoi",
  ]},
  { country: "Philippines", code: "PH", patterns: [
    "philippines", "filipino", "manila", "mindanao", "cebu",
  ]},
  { country: "New Zealand", code: "NZ", patterns: [
    "new zealand", "nz", "auckland", "wellington", "christchurch",
  ]},
  { country: "United Kingdom", code: "GB", patterns: [
    "united kingdom", "england", "scotland", "wales", "london", "uk",
  ]},
  { country: "India", code: "IN", patterns: [
    "india", "indian", "mumbai", "delhi", "kolkata", "chennai", "rajasthan",
    "jharkhand", "odisha", "chhattisgarh",
  ]},
  { country: "China", code: "CN", patterns: [
    "china", "chinese", "beijing", "shanghai", "inner mongolia",
  ]},
  { country: "Saudi Arabia", code: "SA_COUNTRY", patterns: [
    "saudi arabia", "saudi", "riyadh", "jeddah", "neom", "aramco",
  ]},
  { country: "United Arab Emirates", code: "AE", patterns: [
    "uae", "dubai", "abu dhabi", "emirates",
  ]},
  { country: "Africa (generic)", code: "AF_GENERIC", patterns: [
    "democratic republic of congo", "drc", "zambia", "zimbabwe", "ghana",
    "mali", "burkina faso", "guinea", "tanzania", "mozambique", "namibia",
    "botswana", "ivory coast", "senegal", "cameroon", "nigeria",
    "sierra leone", "liberia", "eritrea", "ethiopia", "kenya", "uganda",
    "madagascar",
  ]},
];

// ── Explicit "Australia" confirmation patterns ──
const AUSTRALIA_CONFIRM_PATTERNS = [
  "australia", "australian",
];

// ── Australian owner patterns (secondary signal) ──
// These are inherently Australian entities. If the owner matches AND the location
// field has an AU state, this provides corroborating evidence.
// IMPORTANT: This does NOT override foreign project location — it only helps
// resolve the "vague location + AU state" ambiguity.
const AU_OWNER_PATTERNS = [
  // Government — federal
  "department of defence", "department of defense", "department of industry",
  "department of climate change", "department of infrastructure",
  "department of foreign affairs", "department of biodiversity",
  "department of communities", "department of education",
  "department of health", "department of home affairs",
  "department of agriculture", "department of water",
  "department of planning", "department of transport",
  "department of energy", "department of environment",
  "department of finance", "department of treasury",
  "department of resources", "department of mines",
  "australian centre for international",
  "infrastructure australia", "federal government",
  // Government — state
  "nsw gov", "qld gov", "wa gov", "vic gov", "sa gov", "nt gov", "tas gov",
  "main roads", "waternsw", "water nsw", "transport for nsw",
  "roads and maritime", "vicroads", "queensland rail",
  "water corporation", "sa water", "melbourne water", "hunter water",
  "seqwater", "sunwater", "icon water",
  // Energy — networks & utilities
  "transgrid", "ausnet", "powerlink", "western power", "energex",
  "synergy", "horizon power", "ausgrid", "endeavour energy",
  "essential energy", "electranet", "tasnetworks", "ergon",
  "energyco", "aemo", "aemc", "aer",
  // Energy — generators & retailers
  "cs energy", "stanwell", "snowy hydro", "agl", "origin energy",
  "energyaustralia", "alinta energy", "delta electricity",
  "infigen", "tilt renewables", "windlab", "squadron energy",
  // Oil & gas
  "santos", "woodside", "bhp", "south32", "beach energy",
  "cooper energy", "senex", "ampol", "viva energy",
  // Mining
  "rio tinto", "fortescue", "newcrest", "northern star",
  "evolution mining", "gold road", "pilbara minerals",
  "mineral resources", "lynas", "iluka", "oz minerals",
  "sandfire", "regis resources", "saracen", "ramelius",
  "chalice mining", "de grey mining", "bellevue gold",
  "capricorn metals", "red 5", "westgold", "silver lake",
  // Defence
  "asc pty", "bae systems australia", "thales australia",
  "raytheon australia", "lockheed martin australia",
  // Infrastructure & construction
  "transurban", "lendlease", "cimic", "downer", "john holland",
  "cpb contractors", "georgiou", "macmahon", "perenti",
  "thiess", "monadelphous", "nrw", "decmil",
  "fulton hogan", "boral", "holcim australia",
  "laing o'rourke", "built", "multiplex", "probuild",
  // Utilities — gas & water
  "jemena", "apa group", "agn", "atco australia",
  // Telecoms & other
  "nbn co", "telstra", "optus",
  // Research
  "csiro", "geoscience australia", "ga ",
  // Renewables developers
  "edify energy", "neoen", "goldwind", "vestas australia",
  "pacific partnerships", "acen australia",
  // Defence-specific
  "australian submarine agency",
  // Suffixes that indicate AU entity
  "(asx:", "asx:",
  // Explicit AU markers in owner name
  "australia", "australian",
];

export interface GeoClassification {
  projectCountry: string | null;   // ISO 3166-1 alpha-2 (AU, US, CA, etc.)
  projectState: string | null;     // e.g. WA, QLD, NSW, or foreign region
  locationConfidence: number;      // 0.0–1.0
  geoBlockedReason: "blocked_non_australian_project" | "blocked_location_unclear" | "blocked_cross_border_signal" | null;
}

/**
 * Classify a project's geography from its text fields.
 * This is a deterministic rules-based classifier — no LLM required.
 *
 * Priority order:
 *  1. Explicit foreign location → blocked_non_australian_project
 *  2. Explicit AU state/territory → AU + state, confidence 0.9+
 *  3. "Australia" mentioned + no foreign signal → AU + unknown state, confidence 0.7
 *  4. Location field contains an AU state abbreviation → AU + state, confidence 0.8
 *  5. Unknown/ambiguous → blocked_location_unclear
 */
export function classifyProjectGeography(project: {
  name: string;
  location: string;
  owner: string;
  overview: string | null;
  sources: Array<{ label: string; url: string; date?: string }> | null;
  sector: string;
}): GeoClassification {
  // Combine all project text for analysis (NOT owner — owner nationality is separate)
  const projectText = [
    project.name,
    project.location,
    project.overview ?? "",
  ].join(" ").toLowerCase();

  // Also check source URLs for geography hints
  const sourceUrls = (project.sources ?? []).map(s => s.url.toLowerCase()).join(" ");
  const sourceLabels = (project.sources ?? []).map(s => s.label.toLowerCase()).join(" ");

  // ── Step 0: Project-name-level overrides ──
  // Some project names contain inherently Australian programs that mention foreign countries
  const projectNameLower = project.name.toLowerCase();
  const AU_PROJECT_NAME_OVERRIDES = [
    "aukus",           // AUKUS is AU-UK-US but the project is in Australia
    "anzac",           // ANZAC programs are AU/NZ but primarily AU-based
    "australian aid",  // Australian aid programs — AU government, foreign recipients
  ];
  const isAuProjectOverride = AU_PROJECT_NAME_OVERRIDES.some(p => projectNameLower.includes(p));

  // ── Step 1: Check for explicit foreign location ──
  let foreignMatch: { country: string; code: string } | null = null;
  for (const fc of FOREIGN_COUNTRY_PATTERNS) {
    for (const pattern of fc.patterns) {
      if (projectText.includes(pattern)) {
        foreignMatch = { country: fc.country, code: fc.code };
        break;
      }
    }
    if (foreignMatch) break;
  }

  // ── Step 2: Check for explicit Australian state/territory ──
  let auStateMatch: string | null = null;
  let auStateConfidence = 0;
  for (const [state, patterns] of Object.entries(AU_STATE_PATTERNS)) {
    for (const pattern of patterns) {
      if (projectText.includes(pattern)) {
        auStateMatch = state;
        // Higher confidence for specific town/city names vs generic state names
        auStateConfidence = pattern.length > 4 ? 0.95 : 0.85;
        break;
      }
    }
    if (auStateMatch) break;
  }

  // ── Step 3: Check for generic "Australia" mention ──
  const hasAustraliaKeyword = AUSTRALIA_CONFIRM_PATTERNS.some(p => projectText.includes(p));

  // ── Step 4: Check location field for AU state abbreviations ──
  const locationUpper = project.location.toUpperCase().trim();
  const auStateAbbrevs = ["WA", "QLD", "NSW", "VIC", "SA", "NT", "TAS", "ACT"];
  let locationFieldState: string | null = null;
  for (const abbr of auStateAbbrevs) {
    // Match patterns like "Perth, WA" or "Unknown, WA" or just "WA"
    if (
      locationUpper === abbr ||
      locationUpper.endsWith(`, ${abbr}`) ||
      locationUpper.endsWith(` ${abbr}`) ||
      locationUpper.startsWith(`${abbr},`) ||
      locationUpper.startsWith(`${abbr} `)
    ) {
      locationFieldState = abbr;
      break;
    }
  }

  // ── Decision logic ──

  // Case A: Both foreign AND Australian signals → cross-border conflict
  if (foreignMatch && (auStateMatch || hasAustraliaKeyword || locationFieldState)) {
    // A0: If the project name is an AU program override (AUKUS, ANZAC), suppress foreign match
    if (isAuProjectOverride) {
      const state = auStateMatch ?? locationFieldState;
      return {
        projectCountry: "AU",
        projectState: state,
        locationConfidence: 0.85,
        geoBlockedReason: null,
      };
    }
    // If the AU signal is a specific state/city, trust it over a vague foreign mention
    if (auStateMatch && auStateConfidence >= 0.9) {
      return {
        projectCountry: "AU",
        projectState: auStateMatch,
        locationConfidence: 0.7, // Lower confidence due to conflict
        geoBlockedReason: null,  // Allow but flag
      };
    }
    // A2: If AU owner + AU state in location field, trust as AU (e.g. CSIRO + NSW)
    const ownerLowerA = project.owner.toLowerCase();
    const hasAuOwnerA = AU_OWNER_PATTERNS.some(p => ownerLowerA.includes(p));
    if (hasAuOwnerA && (auStateMatch || locationFieldState)) {
      return {
        projectCountry: "AU",
        projectState: auStateMatch ?? locationFieldState,
        locationConfidence: 0.65,
        geoBlockedReason: null,
      };
    }
    return {
      projectCountry: null,
      projectState: null,
      locationConfidence: 0.3,
      geoBlockedReason: "blocked_cross_border_signal",
    };
  }

  // Case B: Explicit foreign location, no AU signal → block
  if (foreignMatch && !auStateMatch && !hasAustraliaKeyword) {
    return {
      projectCountry: foreignMatch.code.length === 2 ? foreignMatch.code : null,
      projectState: null,
      locationConfidence: 0.9,
      geoBlockedReason: "blocked_non_australian_project",
    };
  }

  // Case C: Explicit AU state match → confirmed Australian
  if (auStateMatch) {
    return {
      projectCountry: "AU",
      projectState: auStateMatch,
      locationConfidence: auStateConfidence,
      geoBlockedReason: null,
    };
  }

  // Case D: Location field has AU state abbreviation
  // Two sub-cases:
  //   D1: Specific location name + state (e.g. "Biloela, QLD", "Cooper Basin, SA")
  //       → trust it, the pipeline identified a real place name
  //   D2: "Unknown, STATE" or "National" + state → suspicious, need corroboration
  if (locationFieldState) {
    const locationLower = project.location.toLowerCase().trim();
    const isVagueLocation = locationLower.startsWith("unknown") ||
      locationLower.startsWith("national") ||
      locationLower.startsWith("various") ||
      locationLower.startsWith("tbc") ||
      locationLower.startsWith("tba") ||
      locationLower === locationFieldState.toLowerCase(); // Just the state code alone

    const overviewText = (project.overview ?? "").toLowerCase();
    const hasAuEvidenceInOverview = AUSTRALIA_CONFIRM_PATTERNS.some(p => overviewText.includes(p)) ||
      Object.values(AU_STATE_PATTERNS).flat().some(p => overviewText.includes(p));

    if (!isVagueLocation) {
      // D1: Specific place name — trust the pipeline's state assignment
      return {
        projectCountry: "AU",
        projectState: locationFieldState,
        locationConfidence: hasAuEvidenceInOverview ? 0.85 : 0.7,
        geoBlockedReason: null,
      };
    }

    // D2: Vague location — need corroborating evidence from overview OR owner
    const ownerLower = project.owner.toLowerCase();
    const hasAuOwner = AU_OWNER_PATTERNS.some(p => ownerLower.includes(p));

    if (hasAuEvidenceInOverview || hasAustraliaKeyword || hasAuOwner) {
      return {
        projectCountry: "AU",
        projectState: locationFieldState,
        locationConfidence: hasAuOwner ? 0.75 : 0.7,
        geoBlockedReason: null,
      };
    }

    // Vague location + no AU evidence in overview or owner → unclear
    return {
      projectCountry: null,
      projectState: null,
      locationConfidence: 0.3,
      geoBlockedReason: "blocked_location_unclear",
    };
  }

  // Case E: Generic "Australia" mention but no specific state
  if (hasAustraliaKeyword) {
    return {
      projectCountry: "AU",
      projectState: null,
      locationConfidence: 0.7,
      geoBlockedReason: null,
    };
  }

  // Case F: No text-based geography signal — check if owner is a known AU entity
  const ownerLowerF = project.owner.toLowerCase();
  const hasAuOwnerF = AU_OWNER_PATTERNS.some(p => ownerLowerF.includes(p));
  if (hasAuOwnerF) {
    return {
      projectCountry: "AU",
      projectState: null,
      locationConfidence: 0.6,
      geoBlockedReason: null,
    };
  }

  // Case G: No geography signal at all → unclear
  return {
    projectCountry: null,
    projectState: null,
    locationConfidence: 0.1,
    geoBlockedReason: "blocked_location_unclear",
  };
}

/**
 * Classify a single project and persist the result to the database.
 */
export async function classifyAndPersistProject(projectId: number): Promise<GeoClassification | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) return null;

  const sources = row.sources as Array<{ label: string; url: string; date?: string }> | null;
  const classification = classifyProjectGeography({
    name: row.name,
    location: row.location,
    owner: row.owner,
    overview: row.overview,
    sources,
    sector: row.sector,
  });

  await db.update(projects).set({
    projectCountry: classification.projectCountry,
    projectState: classification.projectState,
    locationConfidence: classification.locationConfidence,
    geoBlockedReason: classification.geoBlockedReason,
  }).where(eq(projects.id, projectId));

  return classification;
}

/**
 * Backfill all projects that haven't been classified yet.
 * Returns count of projects classified and blocked.
 */
export async function backfillGeoClassification(): Promise<{
  total: number;
  australian: number;
  blocked: number;
  unclear: number;
}> {
  const db = await getDb();
  if (!db) return { total: 0, australian: 0, blocked: 0, unclear: 0 };

  // Get all projects without a classification
  const unclassified = await db.select({
    id: projects.id,
    name: projects.name,
    location: projects.location,
    owner: projects.owner,
    overview: projects.overview,
    sources: projects.sources,
    sector: projects.sector,
  }).from(projects).where(
    and(
      isNull(projects.projectCountry),
      isNull(projects.geoBlockedReason),
    )
  );

  let australian = 0;
  let blocked = 0;
  let unclear = 0;

  for (const row of unclassified) {
    const sources = row.sources as Array<{ label: string; url: string; date?: string }> | null;
    const classification = classifyProjectGeography({
      name: row.name,
      location: row.location,
      owner: row.owner,
      overview: row.overview ?? null,
      sources,
      sector: row.sector,
    });

    await db.update(projects).set({
      projectCountry: classification.projectCountry,
      projectState: classification.projectState,
      locationConfidence: classification.locationConfidence,
      geoBlockedReason: classification.geoBlockedReason,
    }).where(eq(projects.id, row.id));

    if (classification.projectCountry === "AU") australian++;
    else if (classification.geoBlockedReason === "blocked_non_australian_project") blocked++;
    else unclear++;
  }

  return { total: unclassified.length, australian, blocked, unclear };
}

/**
 * Check if a project passes the Australia location guard.
 * Returns true if the project should appear in rep-facing views.
 */
export function isProjectAustralian(project: {
  projectCountry?: string | null;
  geoBlockedReason?: string | null;
}): boolean {
  // If explicitly blocked, exclude
  if (project.geoBlockedReason) return false;
  // If classified as AU, include
  if (project.projectCountry === "AU") return true;
  // If not yet classified (null country, no block), exclude by default (fail-safe)
  return false;
}
