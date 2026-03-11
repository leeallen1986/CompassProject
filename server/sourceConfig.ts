/**
 * Source Configuration — Three-Role Architecture
 *
 * All intelligence sources are categorised into three roles:
 *
 * 1. PRIMARY DISCOVERY — Sources used to detect new projects.
 *    Reliable feeds and sites where projects are clearly announced.
 *
 * 2. SECONDARY CONFIRMATION — Sources used to confirm or enrich
 *    already-identified projects with additional detail.
 *
 * 3. ENRICHMENT — Sources used primarily to identify stakeholders,
 *    contractors, and detailed project information.
 */

export type SourceRole = "primary_discovery" | "secondary_confirmation" | "enrichment";

export interface SourceConfig {
  id: string;
  name: string;
  role: SourceRole;
  description: string;
  /** How often this source should be queried */
  frequency: "daily" | "weekly" | "on_demand";
  /** Day of week for weekly sources (0=Sun, 1=Mon, ..., 6=Sat) */
  weekday?: number;
  /** Whether this source is currently active */
  active: boolean;
  /** Whether this source requires authentication */
  requiresAuth: boolean;
  /** Base URL for the source */
  baseUrl: string;
  /** What this source provides */
  provides: string[];
  /** Limitations or caveats */
  limitations: string[];
}

// ── PRIMARY DISCOVERY SOURCES ──
// Used to detect new projects. These are the first line of intelligence.

const primaryDiscoverySources: SourceConfig[] = [
  {
    id: "rss_feeds",
    name: "RSS Feed Network",
    role: "primary_discovery",
    description: "20+ Australian industry RSS feeds covering mining, energy, infrastructure, defence, and construction. Primary mechanism for detecting new project announcements.",
    frequency: "daily",
    active: true,
    requiresAuth: false,
    baseUrl: "various",
    provides: [
      "New project announcements",
      "Contract awards",
      "Drilling campaigns",
      "Industry news and trends",
    ],
    limitations: [
      "Requires AI extraction to convert articles to structured data",
      "Some feeds have low signal-to-noise ratio",
      "Coverage depends on publisher RSS availability",
    ],
  },
  {
    id: "austender",
    name: "AusTender OCDS API",
    role: "primary_discovery",
    description: "Australian Government open contracting data. Structured API returning federal procurement contracts with values, suppliers, and UNSPSC codes.",
    frequency: "weekly",
    weekday: 4, // Thursday
    active: true,
    requiresAuth: false,
    baseUrl: "https://api.tenders.gov.au/ocds",
    provides: [
      "Federal government contracts",
      "Contract values and suppliers",
      "Procurement categories (UNSPSC)",
      "Tender dates and award dates",
    ],
    limitations: [
      "Federal only — no state/territory tenders",
      "Many contracts are services/IT, not construction",
      "Requires keyword + UNSPSC filtering for relevance",
    ],
  },
  {
    id: "dmirs",
    name: "DMIRS MINEDEX API",
    role: "primary_discovery",
    description: "WA Department of Mines, Industry Regulation and Safety. Public JSON API with mining tenement and project data for Western Australia.",
    frequency: "weekly",
    weekday: 3, // Wednesday
    active: true,
    requiresAuth: false,
    baseUrl: "https://services.dmp.wa.gov.au/geoservices",
    provides: [
      "WA mining project details",
      "Operator and tenement holder",
      "Commodity and deposit type",
      "Project status and location",
    ],
    limitations: [
      "WA only — no coverage of other states",
      "Limited contractor information",
      "No CAPEX or timeline data",
    ],
  },
  {
    id: "asx_monitoring",
    name: "ASX Targeted Monitoring",
    role: "primary_discovery",
    description: "Monitors ASX announcements from a watchlist of major miners, energy companies, and infrastructure developers. Filters for project development activity.",
    frequency: "daily",
    active: true,
    requiresAuth: false,
    baseUrl: "https://www.asx.com.au/asx/v2/statistics/announcements.json",
    provides: [
      "Project development announcements",
      "Capital investment decisions",
      "Contract awards",
      "Expansion and construction updates",
    ],
    limitations: [
      "Requires keyword filtering to discard financial-only announcements",
      "Announcement PDFs need parsing for detail",
      "Rate-limited API",
    ],
  },
];

// ── SECONDARY CONFIRMATION SOURCES ──
// Used to confirm or enrich already-identified projects.

const secondaryConfirmationSources: SourceConfig[] = [
  {
    id: "icn_gateway",
    name: "ICN Gateway",
    role: "secondary_confirmation",
    description: "Industry Capability Network project database. Used to validate known projects, identify contractors, and confirm procurement stage. Not a primary crawler.",
    frequency: "on_demand",
    active: true,
    requiresAuth: false,
    baseUrl: "https://gateway.icn.org.au",
    provides: [
      "Contractor information",
      "Work package details",
      "Capability requirements",
      "Procurement stage confirmation",
    ],
    limitations: [
      "JavaScript-rendered — requires curated project list",
      "No public API",
      "Project search requires manual URL construction",
    ],
  },
  {
    id: "gov_major_projects",
    name: "Government Major Projects",
    role: "secondary_confirmation",
    description: "Infrastructure Australia Priority List and National Renewable Energy Priority List. Confirms project significance and government backing.",
    frequency: "weekly",
    weekday: 2, // Tuesday
    active: true,
    requiresAuth: false,
    baseUrl: "https://www.infrastructureaustralia.gov.au",
    provides: [
      "Government priority classification",
      "Project stage (planning, construction, etc.)",
      "Estimated value ranges",
      "State and sector classification",
    ],
    limitations: [
      "Curated list — not real-time",
      "Limited contractor detail",
      "Updated quarterly, not weekly",
    ],
  },
  {
    id: "aemo",
    name: "AEMO Generation Information",
    role: "secondary_confirmation",
    description: "Australian Energy Market Operator generation project data. Confirms energy project status, capacity, and connection dates.",
    frequency: "weekly",
    weekday: 5, // Friday
    active: true,
    requiresAuth: false,
    baseUrl: "https://aemo.com.au/energy-systems/electricity/national-electricity-market-nem/nem-forecasting-and-planning/forecasting-and-planning-data/generation-information",
    provides: [
      "Energy project capacity (MW)",
      "Connection dates",
      "Technology type (solar, wind, BESS, gas)",
      "Project status in NEM pipeline",
    ],
    limitations: [
      "Energy sector only",
      "Curated list — limited contractor data",
      "403 on direct page access — uses curated data",
    ],
  },
];

// ── ENRICHMENT SOURCES ──
// Used primarily to identify stakeholders, contractors, and detailed project information.

const enrichmentSources: SourceConfig[] = [
  {
    id: "projectory",
    name: "Projectory",
    role: "enrichment",
    description: "Premium Australian project database with detailed delivery chain information. Authenticated access via login credentials. Used to extract contractors, consultants, timelines, and project stage.",
    frequency: "on_demand",
    active: true,
    requiresAuth: true,
    baseUrl: "https://www.projectory.com.au",
    provides: [
      "Contractor and subcontractor lists",
      "Design consultants",
      "Project timelines (planning → tender → award → construction)",
      "Project stage updates",
      "CAPEX estimates",
      "Proponent/owner details",
    ],
    limitations: [
      "Requires paid subscription",
      "Session cookies expire after ~2 hours",
      "Rate limiting required (1.5s between requests)",
      "Not all projects have full delivery chain data",
    ],
  },
  {
    id: "apollo",
    name: "Apollo.io",
    role: "enrichment",
    description: "Contact enrichment platform. Used selectively for high-priority projects to find verified email addresses and stakeholder details.",
    frequency: "on_demand",
    active: true,
    requiresAuth: true,
    baseUrl: "https://api.apollo.io/api/v1",
    provides: [
      "Verified email addresses",
      "Job titles and seniority",
      "LinkedIn profile URLs",
      "Company information",
    ],
    limitations: [
      "Credit-based — budget constraints",
      "Reserved for hot/claimed projects",
      "Not all contacts have verified emails",
    ],
  },
  {
    id: "llm_contacts",
    name: "LLM Contact Generation",
    role: "enrichment",
    description: "AI-powered contact generation using project context. Generates likely stakeholders with inferred email patterns and LinkedIn search URLs.",
    frequency: "on_demand",
    active: true,
    requiresAuth: false,
    baseUrl: "internal",
    provides: [
      "AI-suggested contacts with confidence scores",
      "Inferred email patterns",
      "LinkedIn search URLs",
      "Role-based targeting",
    ],
    limitations: [
      "Contacts require verification",
      "Email patterns are inferred, not verified",
      "Confidence varies by project type",
    ],
  },
];

// ── Combined Configuration ──

export const ALL_SOURCES: SourceConfig[] = [
  ...primaryDiscoverySources,
  ...secondaryConfirmationSources,
  ...enrichmentSources,
];

export function getSourcesByRole(role: SourceRole): SourceConfig[] {
  return ALL_SOURCES.filter(s => s.role === role && s.active);
}

export function getSourceById(id: string): SourceConfig | undefined {
  return ALL_SOURCES.find(s => s.id === id);
}

export function getActiveSources(): SourceConfig[] {
  return ALL_SOURCES.filter(s => s.active);
}

export function getDiscoverySources(): SourceConfig[] {
  return getSourcesByRole("primary_discovery");
}

export function getConfirmationSources(): SourceConfig[] {
  return getSourcesByRole("secondary_confirmation");
}

export function getEnrichmentSources(): SourceConfig[] {
  return getSourcesByRole("enrichment");
}

/** Get sources scheduled for a given day of week (0=Sun..6=Sat) */
export function getSourcesForDay(dayOfWeek: number): SourceConfig[] {
  return ALL_SOURCES.filter(s => s.active && s.frequency === "weekly" && s.weekday === dayOfWeek);
}

/** Summary for admin dashboard */
export function getSourceSummary() {
  const active = getActiveSources();
  return {
    total: active.length,
    primaryDiscovery: active.filter(s => s.role === "primary_discovery").length,
    secondaryConfirmation: active.filter(s => s.role === "secondary_confirmation").length,
    enrichment: active.filter(s => s.role === "enrichment").length,
    daily: active.filter(s => s.frequency === "daily").length,
    weekly: active.filter(s => s.frequency === "weekly").length,
    onDemand: active.filter(s => s.frequency === "on_demand").length,
    authenticated: active.filter(s => s.requiresAuth).length,
  };
}

// ── ASX Company Watchlist ──
// Major miners, energy companies, and infrastructure developers to monitor

export const ASX_WATCHLIST = [
  // Major Miners
  { code: "BHP", name: "BHP Group", sector: "mining" },
  { code: "RIO", name: "Rio Tinto", sector: "mining" },
  { code: "FMG", name: "Fortescue", sector: "mining" },
  { code: "MIN", name: "Mineral Resources", sector: "mining" },
  { code: "S32", name: "South32", sector: "mining" },
  { code: "NCM", name: "Newmont (Newcrest)", sector: "mining" },
  { code: "NST", name: "Northern Star Resources", sector: "mining" },
  { code: "EVN", name: "Evolution Mining", sector: "mining" },
  { code: "IGO", name: "IGO Limited", sector: "mining" },
  { code: "LYC", name: "Lynas Rare Earths", sector: "mining" },
  { code: "ILU", name: "Iluka Resources", sector: "mining" },
  { code: "SFR", name: "Sandfire Resources", sector: "mining" },
  { code: "WHC", name: "Whitehaven Coal", sector: "mining" },
  { code: "CRN", name: "Coronado Global Resources", sector: "mining" },
  { code: "PLS", name: "Pilbara Minerals", sector: "mining" },
  { code: "LTR", name: "Liontown Resources", sector: "mining" },
  { code: "DEG", name: "De Grey Mining", sector: "mining" },
  { code: "CMM", name: "Capricorn Metals", sector: "mining" },
  { code: "RED", name: "Red 5", sector: "mining" },
  { code: "GOR", name: "Gold Road Resources", sector: "mining" },
  // Energy Companies
  { code: "WDS", name: "Woodside Energy", sector: "energy" },
  { code: "STO", name: "Santos", sector: "energy" },
  { code: "ORG", name: "Origin Energy", sector: "energy" },
  { code: "AGL", name: "AGL Energy", sector: "energy" },
  { code: "APA", name: "APA Group", sector: "energy" },
  { code: "CEN", name: "Contact Energy", sector: "energy" },
  { code: "MEZ", name: "Meridian Energy", sector: "energy" },
  { code: "KAR", name: "Karoon Energy", sector: "energy" },
  { code: "BPT", name: "Beach Energy", sector: "energy" },
  { code: "VEA", name: "Viva Energy", sector: "energy" },
  // Infrastructure & Construction
  { code: "CIM", name: "CIMIC Group", sector: "infrastructure" },
  { code: "DOW", name: "Downer EDI", sector: "infrastructure" },
  { code: "MND", name: "Monadelphous Group", sector: "infrastructure" },
  { code: "NWH", name: "NRW Holdings", sector: "infrastructure" },
  { code: "MAH", name: "Macmahon Holdings", sector: "infrastructure" },
  { code: "PNI", name: "Pinnacle Investment Management", sector: "infrastructure" },
  { code: "GNG", name: "GR Engineering Services", sector: "infrastructure" },
  { code: "SXE", name: "Southern Cross Electrical Engineering", sector: "infrastructure" },
  { code: "LYL", name: "Lycopodium", sector: "infrastructure" },
  { code: "DDR", name: "Dicker Data", sector: "infrastructure" },
  // BESS & Renewables
  { code: "GNX", name: "Genex Power", sector: "energy" },
  { code: "NEE", name: "Neoen Australia (via ASX)", sector: "energy" },
  { code: "INF", name: "Infratil", sector: "energy" },
  { code: "SKI", name: "Spark Infrastructure", sector: "energy" },
] as const;

// ── ASX Announcement Keywords ──
// Only extract announcements matching these keywords

export const ASX_PROJECT_KEYWORDS = [
  // Project activity
  "project", "development", "construction", "expansion",
  "capital investment", "infrastructure", "contract award",
  "contract win", "preferred contractor", "EPC",
  // Mining specific
  "mine development", "mining services", "processing plant",
  "feasibility study", "definitive feasibility", "bankable feasibility",
  "mineral resource", "ore reserve", "production target",
  "mine life", "first production", "commissioning",
  // Energy specific
  "power station", "battery storage", "BESS", "wind farm",
  "solar farm", "gas plant", "hydrogen", "pumped hydro",
  // Infrastructure
  "tunnel", "bridge", "road", "rail", "port",
  "water treatment", "desalination", "pipeline",
  // Procurement signals
  "tender", "procurement", "awarded", "selected",
  "appointed", "mobilisation", "site works",
];

// Keywords that indicate purely financial announcements to discard
export const ASX_FINANCIAL_DISCARD_KEYWORDS = [
  "dividend", "share buyback", "capital raising", "placement",
  "rights issue", "annual report", "half year results",
  "quarterly report", "appendix 4c", "appendix 4d",
  "appendix 4e", "change of director", "director resignation",
  "company secretary", "AGM", "annual general meeting",
  "proxy form", "cleansing notice", "trading halt",
  "voluntary suspension", "cease trading", "delisting",
];
