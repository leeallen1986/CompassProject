/**
 * Pain-Point & Persona Coaching Service
 *
 * Provides pre-call preparation for sales reps:
 * 1. Segment-specific pain-point libraries (mining contractor, civil, pipeline, energy, defence)
 * 2. Role-specific persona libraries (procurement, engineering, operations, project management)
 * 3. Per-project+stakeholder coaching: talk tracks, discovery questions, objection handling
 *
 * This is the "pre-call assistant" — gives the rep confidence before picking up the phone.
 */
import { getDb } from "./db";
import { projects, contacts, projectBusinessLineScores } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

// ── Pain-Point Libraries ──

export interface PainPoint {
  pain: string;
  context: string;
  atlasCopcoBridge: string; // How Atlas Copco solves this
  relevantBLs: string[];
}

export interface SegmentPainLibrary {
  segment: string;
  segmentLabel: string;
  painPoints: PainPoint[];
}

const SEGMENT_PAIN_LIBRARIES: SegmentPainLibrary[] = [
  {
    segment: "mining",
    segmentLabel: "Mining & Resources",
    painPoints: [
      {
        pain: "Unplanned compressor downtime during critical production phases",
        context: "Mining operations run 24/7. A compressor failure can halt drilling, blasting, or material handling for hours, costing $50K-$500K per shift in lost production.",
        atlasCopcoBridge: "Atlas Copco's portable air fleet with remote monitoring and predictive maintenance reduces unplanned downtime by up to 40%. Rental options provide immediate backup capacity.",
        relevantBLs: ["Portable Air", "Service Potential", "Rental Influence"],
      },
      {
        pain: "Dewatering challenges in deep open-pit or underground operations",
        context: "Water ingress increases with depth. Inadequate dewatering delays blasting schedules and creates safety hazards. Pump failures in remote locations are costly to resolve.",
        atlasCopcoBridge: "Atlas Copco dewatering pumps are designed for harsh mining environments with high solids handling. Mobile pump stations can be deployed rapidly to new pit levels.",
        relevantBLs: ["Pump/Dewatering", "Rental Influence"],
      },
      {
        pain: "Rising energy costs and pressure to reduce diesel consumption",
        context: "Mining companies face ESG pressure and rising fuel costs. Diesel-powered equipment is a major cost centre, especially in remote locations with expensive fuel logistics.",
        atlasCopcoBridge: "BESS (Battery Energy Storage Systems) and hybrid power solutions reduce diesel dependency by 30-60%. Generators with smart load management optimise fuel consumption.",
        relevantBLs: ["BESS", "Generators"],
      },
      {
        pain: "Nitrogen supply for tyre inflation and blasting in remote locations",
        context: "Large haul truck tyres require nitrogen inflation for safety and longevity. Remote mine sites can't rely on bulk nitrogen delivery — on-site generation is essential.",
        atlasCopcoBridge: "Atlas Copco nitrogen generators produce on-site N2 from compressed air, eliminating supply chain dependency. Mobile units can move between sites as needed.",
        relevantBLs: ["Nitrogen", "Portable Air"],
      },
      {
        pain: "Contractor mobilisation timelines for new pit development",
        context: "When a new pit area is opened, contractors need compressed air, power, and dewatering within weeks. Long procurement cycles delay project timelines.",
        atlasCopcoBridge: "Atlas Copco's rental fleet enables rapid mobilisation with short-term hire agreements. Full-service packages include delivery, commissioning, and maintenance.",
        relevantBLs: ["Rental Influence", "Portable Air", "Generators"],
      },
    ],
  },
  {
    segment: "oil_gas",
    segmentLabel: "Oil & Gas / Pipeline",
    painPoints: [
      {
        pain: "Pipeline shutdown windows are tight — equipment must be reliable and available",
        context: "Planned shutdowns have strict timelines. Any equipment failure extends the shutdown, costing millions in lost production and penalties.",
        atlasCopcoBridge: "Atlas Copco provides dedicated shutdown packages with redundant equipment, 24/7 on-site support, and pre-tested units to eliminate commissioning delays.",
        relevantBLs: ["Portable Air", "Booster", "Service Potential"],
      },
      {
        pain: "High-pressure air and nitrogen for pipeline testing and purging",
        context: "Pipeline commissioning requires high-pressure air for hydrotesting and nitrogen for purging. Sourcing reliable high-pressure equipment in remote locations is challenging.",
        atlasCopcoBridge: "Atlas Copco boosters deliver up to 350 bar for hydrotesting. On-site nitrogen generation eliminates bulk gas logistics for purging operations.",
        relevantBLs: ["Booster", "Nitrogen", "Portable Air"],
      },
      {
        pain: "Temporary power for remote wellhead and pipeline construction",
        context: "Construction sites along pipeline routes need reliable temporary power, often in locations with no grid connection and difficult access.",
        atlasCopcoBridge: "Atlas Copco generators and BESS provide scalable temporary power solutions. Containerised units are designed for rapid deployment to remote locations.",
        relevantBLs: ["Generators", "BESS"],
      },
      {
        pain: "Environmental compliance for flaring and emissions",
        context: "Regulators are tightening flaring limits. Operators need solutions to capture or use associated gas rather than flaring it.",
        atlasCopcoBridge: "Atlas Copco gas compression solutions can capture associated gas for reinjection or power generation, reducing flaring and improving environmental compliance.",
        relevantBLs: ["Portable Air", "Booster"],
      },
    ],
  },
  {
    segment: "infrastructure",
    segmentLabel: "Civil & Infrastructure",
    painPoints: [
      {
        pain: "Tunnelling projects need continuous high-volume compressed air",
        context: "Tunnel boring machines and pneumatic tools require uninterrupted compressed air supply. Any disruption stops the TBM and delays the entire project schedule.",
        atlasCopcoBridge: "Atlas Copco's high-capacity portable compressors with redundancy configurations ensure continuous air supply for tunnelling operations. 24/7 service support minimises downtime risk.",
        relevantBLs: ["Portable Air", "PAL", "Service Potential"],
      },
      {
        pain: "Concrete curing and shotcrete application in variable conditions",
        context: "Infrastructure projects require compressed air for shotcrete application and concrete curing, especially in tunnels and underground structures where conditions vary significantly.",
        atlasCopcoBridge: "Atlas Copco provides application-specific compressor configurations optimised for shotcrete and curing operations, with variable pressure and flow capabilities.",
        relevantBLs: ["Portable Air", "PAL"],
      },
      {
        pain: "Temporary power for construction sites with no grid connection",
        context: "Large infrastructure projects (bridges, highways, rail) often start before permanent power is available. Reliable temporary power is critical for construction equipment and site facilities.",
        atlasCopcoBridge: "Atlas Copco's generator range from 20kVA to 1500kVA covers all construction site power needs. Smart load management and fuel optimisation reduce operating costs.",
        relevantBLs: ["Generators", "BESS"],
      },
      {
        pain: "Dewatering for foundation and excavation work",
        context: "Deep foundations, caissons, and excavations below the water table require continuous dewatering. Pump reliability is critical — a failure can flood the excavation in hours.",
        atlasCopcoBridge: "Atlas Copco wellpoint and submersible pumps are designed for continuous dewatering operations. Automated monitoring ensures early warning of any issues.",
        relevantBLs: ["Pump/Dewatering"],
      },
    ],
  },
  {
    segment: "energy",
    segmentLabel: "Energy & Renewables",
    painPoints: [
      {
        pain: "Intermittent power from renewables creates grid stability challenges",
        context: "Solar and wind farms produce variable output. Grid operators and project owners need energy storage to smooth supply and meet contractual obligations.",
        atlasCopcoBridge: "Atlas Copco BESS solutions provide grid-scale energy storage for renewable energy projects, enabling peak shaving, load shifting, and grid stabilisation.",
        relevantBLs: ["BESS", "Generators"],
      },
      {
        pain: "Construction-phase power before permanent grid connection",
        context: "Renewable energy projects (wind farms, solar parks) need temporary power during construction, often in remote locations months before the project generates its own power.",
        atlasCopcoBridge: "Atlas Copco hybrid power solutions combine generators with BESS to provide efficient temporary power during construction, reducing fuel consumption and emissions.",
        relevantBLs: ["Generators", "BESS", "Rental Influence"],
      },
      {
        pain: "Compressed air for geothermal and hydrogen projects",
        context: "Emerging energy technologies (geothermal drilling, hydrogen production) require specialised compressed air and gas handling equipment.",
        atlasCopcoBridge: "Atlas Copco's range of compressors and boosters can be configured for geothermal drilling support and hydrogen compression applications.",
        relevantBLs: ["Portable Air", "Booster"],
      },
    ],
  },
  {
    segment: "defence",
    segmentLabel: "Defence & Government",
    painPoints: [
      {
        pain: "Rapid deployment of power and air to forward operating bases",
        context: "Military and government operations require equipment that can be deployed quickly, operates reliably in extreme conditions, and is easy to maintain with limited technical support.",
        atlasCopcoBridge: "Atlas Copco's containerised and skid-mounted solutions are designed for rapid deployment. Rugged construction and simplified maintenance reduce logistics burden.",
        relevantBLs: ["Portable Air", "Generators", "BESS"],
      },
      {
        pain: "Long procurement cycles and compliance requirements",
        context: "Government procurement follows strict processes with long lead times. Equipment must meet specific standards and certifications.",
        atlasCopcoBridge: "Atlas Copco has extensive experience with government procurement processes and maintains relevant certifications. Pre-qualified supplier status accelerates procurement.",
        relevantBLs: ["Portable Air", "Generators"],
      },
    ],
  },
];

// ── Role Persona Libraries ──

export interface RolePersona {
  role: string;
  roleLabel: string;
  typicalTitles: string[];
  cares_about: string[];
  doesnt_care_about: string[];
  communication_style: string;
  decision_influence: string;
  objection_patterns: string[];
}

const ROLE_PERSONAS: RolePersona[] = [
  {
    role: "procurement",
    roleLabel: "Procurement / Supply Chain",
    typicalTitles: ["Procurement Manager", "Supply Chain Manager", "Contracts Manager", "Purchasing Officer", "Category Manager"],
    cares_about: [
      "Total cost of ownership, not just unit price",
      "Supplier reliability and delivery track record",
      "Contract flexibility (rental vs purchase vs lease)",
      "Compliance with company procurement policies",
      "Multiple supplier options for competitive pricing",
    ],
    doesnt_care_about: [
      "Technical specifications (they rely on engineering for this)",
      "Brand prestige — they want value for money",
      "Long-term relationship unless it delivers measurable savings",
    ],
    communication_style: "Data-driven, formal, process-oriented. They want clear pricing, delivery timelines, and contractual terms. Avoid technical jargon — speak in commercial terms.",
    decision_influence: "Strong influence on vendor selection and contract terms. They shortlist suppliers but rarely make the final technical decision alone.",
    objection_patterns: [
      "\"We already have a preferred supplier\" → Offer a competitive comparison or pilot project",
      "\"Your pricing is too high\" → Shift to total cost of ownership including downtime, fuel, maintenance",
      "\"We need three quotes\" → Provide a detailed proposal quickly to be one of the three",
      "\"Lead times are too long\" → Highlight rental fleet availability for immediate needs",
    ],
  },
  {
    role: "engineering",
    roleLabel: "Engineering / Technical",
    typicalTitles: ["Engineering Manager", "Project Engineer", "Mechanical Engineer", "Technical Manager", "Design Engineer", "Chief Engineer"],
    cares_about: [
      "Technical specifications and performance data",
      "Equipment reliability and failure rates",
      "Integration with existing systems and infrastructure",
      "Safety certifications and compliance",
      "Innovation and technology advantages",
    ],
    doesnt_care_about: [
      "Pricing details (they specify, procurement buys)",
      "Commercial terms and contract structure",
      "Brand marketing — they want technical substance",
    ],
    communication_style: "Technical, detail-oriented, evidence-based. They want spec sheets, case studies, and performance data. Be prepared to discuss technical details in depth.",
    decision_influence: "Strong influence on technical specification and equipment selection. Their recommendation carries significant weight with project management and procurement.",
    objection_patterns: [
      "\"We've always used [competitor]\" → Present technical comparison data and case studies",
      "\"Your specs don't match our requirements\" → Offer to customise or provide application engineering support",
      "\"We need to test it first\" → Propose a trial or demonstration on their site",
      "\"Our standard specifies [competitor brand]\" → Work to get Atlas Copco added to approved vendor list",
    ],
  },
  {
    role: "operations",
    roleLabel: "Operations / Site Management",
    typicalTitles: ["Operations Manager", "Site Manager", "Plant Manager", "Mine Manager", "Production Manager", "General Manager Operations"],
    cares_about: [
      "Equipment uptime and reliability",
      "Ease of operation and maintenance",
      "Safety performance and incident prevention",
      "Production targets and schedule adherence",
      "Total operating cost per unit of output",
    ],
    doesnt_care_about: [
      "Procurement process details",
      "Technical specifications beyond what affects operations",
      "Long-term strategic partnerships (they need results now)",
    ],
    communication_style: "Practical, results-focused, time-poor. They want to know: will it work, will it be reliable, and how fast can you get it here? Keep it concise and action-oriented.",
    decision_influence: "Ultimate decision maker for operational equipment. They approve budgets, sign off on purchases, and can override both engineering and procurement recommendations.",
    objection_patterns: [
      "\"I don't have time for a meeting\" → Offer a brief site visit or phone call, lead with the problem you solve",
      "\"We're happy with our current setup\" → Ask about their biggest operational challenge — there's always one",
      "\"Budget is locked for this year\" → Propose rental or lease options that fit operational budgets",
      "\"I need it yesterday\" → Highlight rental fleet availability and rapid mobilisation capability",
    ],
  },
  {
    role: "project_management",
    roleLabel: "Project Management",
    typicalTitles: ["Project Manager", "Project Director", "Construction Manager", "Program Manager", "EPCM Manager"],
    cares_about: [
      "Schedule adherence — equipment delivery on time",
      "Budget control — no cost surprises",
      "Risk mitigation — backup plans and redundancy",
      "Single-source solutions to reduce coordination complexity",
      "Contractor management and accountability",
    ],
    doesnt_care_about: [
      "Deep technical specifications (they delegate this)",
      "Long-term service agreements (project has an end date)",
      "Brand loyalty — they want the best solution for this project",
    ],
    communication_style: "Schedule and risk focused. They think in milestones, critical paths, and contingencies. Frame everything in terms of project timeline impact and risk reduction.",
    decision_influence: "Controls project budget and schedule. Can fast-track procurement decisions when schedule is at risk. Often the person who triggers urgent equipment needs.",
    objection_patterns: [
      "\"We've already specified equipment\" → Offer to be the backup supplier or provide rental for peak demand",
      "\"Your delivery timeline doesn't work\" → Explore rental fleet for immediate needs while purchased units are manufactured",
      "\"We need a fixed price\" → Provide a comprehensive package price including delivery, commissioning, and support",
      "\"The contractor handles equipment\" → Offer to work with the contractor directly, or provide a competitive alternative",
    ],
  },
];

// ── Pre-Call Coaching Generator ──

export interface PreCallCoaching {
  projectId: number;
  projectName: string;
  contactId?: number;
  contactName?: string;
  contactTitle?: string;
  // Segment pain points relevant to this project
  relevantPainPoints: PainPoint[];
  // Role persona for the target contact
  persona: RolePersona | null;
  // Generated coaching
  talkTrack: string[];
  discoveryQuestions: string[];
  objectionRisks: string[];
  openingLine: string;
  closingAsk: string;
  // Context
  segment: string;
  matchedRole: string;
}

// In-memory cache
const coachingCache = new Map<string, { data: PreCallCoaching; expiresAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function clearPersonaCache(): void {
  coachingCache.clear();
}

/**
 * Get pre-call coaching for a specific project + optional contact
 */
export async function getPreCallCoaching(
  projectId: number,
  contactId?: number
): Promise<PreCallCoaching> {
  const cacheKey = `${projectId}-${contactId || "general"}`;
  const cached = coachingCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Fetch project
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error(`Project ${projectId} not found`);

  // Fetch contact if specified
  let contact: any = null;
  if (contactId) {
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    contact = c || null;
  }

  // Fetch BL scores
  const blScores = await db
    .select()
    .from(projectBusinessLineScores)
    .where(eq(projectBusinessLineScores.projectId, projectId));

  const topBLs = blScores
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.scoringDimension);

  // Match segment
  const segmentLibrary = SEGMENT_PAIN_LIBRARIES.find(s => s.segment === project.sector)
    || SEGMENT_PAIN_LIBRARIES[0]; // Default to mining

  // Filter pain points by relevant BLs
  const relevantPainPoints = segmentLibrary.painPoints.filter(pp =>
    pp.relevantBLs.some(bl => topBLs.includes(bl))
  );

  // Match role persona
  const persona = matchPersona(contact?.title, contact?.roleBucket);

  // Generate talk track and discovery questions
  const { talkTrack, discoveryQuestions, objectionRisks, openingLine, closingAsk } =
    generateCoachingContent(project, contact, relevantPainPoints, persona, topBLs);

  const coaching: PreCallCoaching = {
    projectId,
    projectName: project.name,
    contactId: contact?.id,
    contactName: contact?.name,
    contactTitle: contact?.title,
    relevantPainPoints: relevantPainPoints.slice(0, 4),
    persona,
    talkTrack,
    discoveryQuestions,
    objectionRisks,
    openingLine,
    closingAsk,
    segment: segmentLibrary.segment,
    matchedRole: persona?.role || "general",
  };

  coachingCache.set(cacheKey, { data: coaching, expiresAt: Date.now() + CACHE_TTL_MS });
  return coaching;
}

/**
 * Get the pain-point library for a given segment
 */
export function getSegmentPainLibrary(segment: string): SegmentPainLibrary | null {
  return SEGMENT_PAIN_LIBRARIES.find(s => s.segment === segment) || null;
}

/**
 * Get all segment pain libraries
 */
export function getAllSegmentPainLibraries(): SegmentPainLibrary[] {
  return SEGMENT_PAIN_LIBRARIES;
}

/**
 * Get a role persona by role key
 */
export function getRolePersona(role: string): RolePersona | null {
  return ROLE_PERSONAS.find(r => r.role === role) || null;
}

/**
 * Get all role personas
 */
export function getAllRolePersonas(): RolePersona[] {
  return ROLE_PERSONAS;
}

// ── Internal Helpers ──

function matchPersona(title?: string | null, roleBucket?: string | null): RolePersona | null {
  if (!title && !roleBucket) return null;

  const text = `${title || ""} ${roleBucket || ""}`.toLowerCase();

  // Check each persona's typical titles
  for (const persona of ROLE_PERSONAS) {
    for (const t of persona.typicalTitles) {
      if (text.includes(t.toLowerCase())) return persona;
    }
  }

  // Keyword matching
  if (/procure|supply|purchas|contract|buy|category/i.test(text)) {
    return ROLE_PERSONAS.find(r => r.role === "procurement") || null;
  }
  if (/engineer|technical|design|mechanical|electrical/i.test(text)) {
    return ROLE_PERSONAS.find(r => r.role === "engineering") || null;
  }
  if (/operat|site.*manag|plant.*manag|mine.*manag|production|general.*manag/i.test(text)) {
    return ROLE_PERSONAS.find(r => r.role === "operations") || null;
  }
  if (/project|construct|program|epcm|director/i.test(text)) {
    return ROLE_PERSONAS.find(r => r.role === "project_management") || null;
  }

  return null;
}

function generateCoachingContent(
  project: any,
  contact: any,
  painPoints: PainPoint[],
  persona: RolePersona | null,
  topBLs: string[]
): {
  talkTrack: string[];
  discoveryQuestions: string[];
  objectionRisks: string[];
  openingLine: string;
  closingAsk: string;
} {
  const projectName = project.name;
  const contactName = contact?.name || "the stakeholder";
  const contactTitle = contact?.title || "decision maker";
  const sector = project.sector;
  const stage = project.stage || "active";
  const location = project.location;

  // Build talk track
  const talkTrack: string[] = [];

  // Opening context
  talkTrack.push(
    `Reference ${projectName} in ${location} — show you've done your homework on their ${stage} phase.`
  );

  // Pain-point bridge
  if (painPoints.length > 0) {
    const topPain = painPoints[0];
    talkTrack.push(
      `Lead with their likely pain: "${topPain.pain}". Bridge to Atlas Copco: ${topPain.atlasCopcoBridge}`
    );
  }

  // BL-specific value prop
  if (topBLs.length > 0) {
    talkTrack.push(
      `Highlight ${topBLs.slice(0, 2).join(" and ")} capabilities — these are the most relevant business lines for this project.`
    );
  }

  // Persona-specific angle
  if (persona) {
    talkTrack.push(
      `${contactName} is likely a ${persona.roleLabel} persona. They care about: ${persona.cares_about.slice(0, 2).join("; ")}. Frame your pitch accordingly.`
    );
    talkTrack.push(
      `Communication style: ${persona.communication_style}`
    );
  }

  // Discovery questions
  const discoveryQuestions: string[] = [];

  discoveryQuestions.push(
    `"What's your current compressed air / power / dewatering setup for ${projectName}?"`
  );
  discoveryQuestions.push(
    `"What's the biggest equipment challenge you're facing on this project right now?"`
  );

  if (persona?.role === "procurement") {
    discoveryQuestions.push(`"How are you currently evaluating suppliers for this project?"`);
    discoveryQuestions.push(`"What's your procurement timeline — when do you need equipment on site?"`);
  } else if (persona?.role === "engineering") {
    discoveryQuestions.push(`"What specifications have you set for compressed air / power equipment?"`);
    discoveryQuestions.push(`"Have you considered on-site nitrogen generation vs bulk delivery?"`);
  } else if (persona?.role === "operations") {
    discoveryQuestions.push(`"What's your biggest concern about equipment reliability on this project?"`);
    discoveryQuestions.push(`"How are you handling peak demand periods?"`);
  } else if (persona?.role === "project_management") {
    discoveryQuestions.push(`"What's the critical path for equipment procurement on this project?"`);
    discoveryQuestions.push(`"Do you have contingency plans if your primary equipment supplier can't deliver on time?"`);
  } else {
    discoveryQuestions.push(`"Who else is involved in equipment decisions for this project?"`);
    discoveryQuestions.push(`"What's your timeline for the next phase of ${projectName}?"`);
  }

  // Objection risks
  const objectionRisks: string[] = [];
  if (persona) {
    objectionRisks.push(...persona.objection_patterns.slice(0, 3));
  } else {
    objectionRisks.push(
      "\"We already have a supplier\" → Offer to be a backup or provide a competitive comparison",
      "\"Budget is tight\" → Propose rental options or phased procurement",
      "\"Not the right time\" → Ask about their project timeline and offer to follow up at the right moment"
    );
  }

  // Opening line
  const openingLine = persona
    ? `"Hi ${contactName}, I noticed ${projectName} in ${location} is moving into ${stage}. I work with ${persona.roleLabel.toLowerCase()}s in the ${formatSector(sector)} sector and wanted to share how we've helped similar projects with [specific pain point]."`
    : `"Hi ${contactName}, I came across ${projectName} in ${location} and thought Atlas Copco's ${topBLs[0] || "portable air"} solutions could be relevant for your ${stage} phase. Do you have 5 minutes to discuss?"`;

  // Closing ask
  const closingAsk = persona?.role === "procurement"
    ? `"Would it be helpful if I sent you a comparison of our rental vs purchase options with pricing for ${projectName}?"`
    : persona?.role === "engineering"
    ? `"Can I send you the technical specifications and a relevant case study for a similar project?"`
    : persona?.role === "operations"
    ? `"Would a brief site visit work so I can see your setup and suggest the best configuration?"`
    : `"Can we schedule a 15-minute call next week to discuss how Atlas Copco can support ${projectName}?"`;

  return { talkTrack, discoveryQuestions, objectionRisks, openingLine, closingAsk };
}

function formatSector(sector: string): string {
  const labels: Record<string, string> = {
    mining: "mining",
    oil_gas: "oil & gas",
    infrastructure: "infrastructure",
    energy: "energy",
    defence: "defence",
  };
  return labels[sector] || sector;
}
