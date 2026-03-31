/**
 * outreachEmail.ts — AI-powered personalised outreach email generator
 * 
 * Generates tailored sales emails based on:
 * - Project details (name, sector, location, value, equipment signals)
 * - Contact info (name, title, company, role)
 * - Atlas Copco Power Technique product/solution knowledge
 * - User's preferred tone (professional, consultative, direct)
 */
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { outreachEmails } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

export interface OutreachInput {
  // Contact info
  contactName: string;
  contactTitle: string;
  contactCompany: string;
  contactEmail: string;
  contactRoleBucket: string;

  // Project info
  projectName: string;
  projectLocation: string;
  projectValue: string;
  projectSector: string;
  projectStage: string | null;
  projectOverview: string | null;
  equipmentSignals: string[] | null;
  opportunityRoute: string;
  matchedBusinessLines: string[];

  // Sender info
  senderName: string;
  senderTitle?: string;
  senderCompany?: string;
  senderBusinessLines?: string[]; // User's assigned BLs — used to focus the outreach on their products

  // Tone / Style
  tone: "professional" | "consultative" | "direct" | "contractor_focused" | "owner_epc_focused" | "procurement_led" | "engineering_led" | "first_touch";
  style?: "standard" | "contractor_focused" | "owner_epc_focused" | "procurement_led" | "engineering_led" | "first_touch";
}

export interface OutreachResult {
  subject: string;
  body: string;
  toneUsed: string;
  keyPoints: string[];
}

const ATLAS_COPCO_PT_KNOWLEDGE = `
Atlas Copco Power Technique — Portable Air Division, Australia.

COMPANY POSITIONING:
Atlas Copco is a global leader in compressed air and power solutions. The Portable Air division
focuses on CAPEX equipment sales and long-term service agreements for project-driven industries
across Western Australia and nationally. We are NOT a rental company — we sell equipment and
back it with industry-leading service and parts support.

THIS CAMPAIGN FOCUSES ON THE XAVS1800 PLATFORM:

XAVS1800 — High-Volume Air for Demanding Abrasive Blasting
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 1,800 cfm at 7 bar / 1,500 cfm at 14 bar (dual pressure capability)
• Supports up to 4× 11mm nozzle setups or 3× 12.5mm setups simultaneously
• 975L fuel tank — designed for full-shift runtime without refuelling interruptions
• 80 dB(A) at 7m — meets noise compliance for urban and sensitive sites
• Aftercooler fitted as standard — cleaner, drier air for better blast quality
• Fully bunded — environmental compliance built in
• Available as single axle, skid mount, or support mount configurations

WHY IT MATTERS (the physics):
Every 1 psi lost below 100 psi at the nozzle reduces blasting efficiency by ~1.5%.
The XAVS1800 is sized to maintain consistent nozzle pressure across multiple operators,
so crews blast faster, with less rework, and finish jobs on schedule.

IDEAL APPLICATIONS:
- Large-scale abrasive blasting and surface preparation
- Shutdown/turnaround maintenance (mining, oil & gas, LNG)
- Pipeline coating and structural steel preparation
- Shipyard and dry dock maintenance
- Tank blasting and corrosion protection
- Multi-operator blasting crews on major projects

KEY DIFFERENTIATORS vs. COMPETITORS:
1. Highest cfm-per-footprint ratio in its class — fewer units on site
2. Dual pressure flexibility (7 bar for volume, 14 bar for specialty work)
3. Proven reliability in harsh Australian conditions (Pilbara, Goldfields, offshore)
4. 24/7 service and genuine parts availability across Australia
5. FleetLink telematics for real-time monitoring and predictive maintenance
6. Service agreements that lock in response times and parts pricing

OTHER ATLAS COPCO PT BUSINESS LINES (mention only if relevant to the project):
- Power & Lighting: QAS/QIS/QES generators (8–1500+ kVA), HiLight LED towers
- BESS: ZenergiZe battery energy storage, hybrid diesel+battery solutions
- Pumps: WEDA submersible, PAS centrifugal — mine dewatering, flood control

CRITICAL COMMERCIAL RULES:
- NEVER mention rental, hire, or OPEX options. All messaging is CAPEX/purchase focused.
- NEVER say "hire-purchase" or "rent-to-own" — use "service agreement" or "fleet investment".
- Position Atlas Copco as a strategic equipment partner, not a vendor or rental house.
- Focus on total cost of ownership, not just purchase price.
`;

/**
 * Role-KPI mapping: maps each role bucket to the KPIs, pain points, and
 * messaging angles that resonate most with that persona.
 */
const ROLE_KPI_MAP: Record<string, {
  kpis: string[];
  painPoints: string[];
  messagingAngle: string;
  xavs1800Hook: string;
}> = {
  procurement: {
    kpis: ["Total cost of ownership (TCO)", "Supplier consolidation", "Contract compliance", "On-time delivery", "Cost savings vs. budget"],
    painPoints: ["Managing multiple equipment vendors across shutdowns", "Unpredictable maintenance costs blowing budgets", "Long lead times on parts delaying projects", "Running 2-3 smaller compressors instead of one right-sized unit"],
    messagingAngle: "Focus on TCO savings: one XAVS1800 replaces 2-3 smaller units, reducing fleet complexity and maintenance overhead. Emphasise service agreements that lock in parts pricing and response times. Single-vendor simplification across the project.",
    xavs1800Hook: "Running multiple smaller compressors on a blasting job drives up your total cost — more maintenance, more fuel, more logistics. The XAVS1800 consolidates that into one unit delivering 1,800 cfm with a 975L tank for full-shift runtime, backed by a service agreement that locks in your costs.",
  },
  engineering: {
    kpis: ["Equipment uptime & reliability", "Technical spec compliance", "Safety standards", "Noise compliance", "Air quality at the nozzle"],
    painPoints: ["Nozzle pressure drop across long hose runs", "Spec mismatches discovered on-site during blasting", "Noise restrictions near communities or occupied facilities", "Moisture in air supply causing blast quality issues"],
    messagingAngle: "Lead with technical credibility — specific CFM ratings at both 7 and 14 bar, nozzle capacity calculations (4× 11mm or 3× 12.5mm setups), aftercooler for air quality, and 80 dB(A) noise level. Show you understand the physics of maintaining nozzle pressure.",
    xavs1800Hook: "Every 1 psi lost below 100 psi at the nozzle costs ~1.5% in blasting efficiency. The XAVS1800 delivers 1,800 cfm at 7 bar with an aftercooler fitted as standard — so your crews maintain consistent nozzle pressure across 4 simultaneous 11mm setups, with cleaner, drier air for better blast quality.",
  },
  operations: {
    kpis: ["Blasting metres²/hour", "Equipment availability %", "Fuel consumption per shift", "Shift utilisation without refuelling stops", "Multi-operator productivity"],
    painPoints: ["Compressor downtime halting the entire blasting crew", "Refuelling interruptions breaking shift momentum", "Running out of air pressure with 3+ nozzles operating", "Remote site logistics for multiple smaller units"],
    messagingAngle: "Emphasise uptime and productivity: 975L fuel tank means full-shift runtime, one unit supports 4 operators simultaneously, and FleetLink telematics gives real-time monitoring. 24/7 service coverage even at remote Pilbara or Goldfields sites.",
    xavs1800Hook: "When your blasting crew is running 3-4 nozzles and the compressor can't keep up, everyone stops. The XAVS1800 is sized for exactly this — 1,800 cfm sustaining 4× 11mm setups simultaneously, with a 975L tank so you don't break shift for refuelling.",
  },
  project_management: {
    kpis: ["On-time project delivery", "Budget adherence", "Resource utilisation", "Stakeholder satisfaction", "Risk mitigation"],
    painPoints: ["Equipment delays pushing back shutdown milestones", "Blasting scope creep when undersized compressors slow the crew", "Coordinating multiple equipment vendors on a tight shutdown window", "Budget overruns from running extra units to compensate for undersized air"],
    messagingAngle: "Position Atlas Copco as a reliability partner — guaranteed delivery timelines, a single point of contact for air supply, and equipment that's right-sized so the blasting crew hits their daily targets without delays.",
    xavs1800Hook: "On a tight shutdown window, the last thing you need is the blasting crew waiting for air. The XAVS1800 is right-sized for multi-operator blasting — one unit, one vendor, one service agreement — so your shutdown stays on schedule.",
  },
  maintenance: {
    kpis: ["Mean time between failures (MTBF)", "Planned vs. unplanned maintenance ratio", "Parts availability", "Maintenance cost per operating hour"],
    painPoints: ["Sourcing genuine parts quickly for remote sites", "Ageing compressor fleet with increasing breakdown frequency", "Lack of OEM support when a unit goes down in the Pilbara", "Moisture and heat issues degrading compressor performance"],
    messagingAngle: "Highlight genuine parts availability, preventive maintenance programs, and service agreements that lock in response times. The XAVS1800's aftercooler and bunding are designed to reduce maintenance headaches in harsh conditions.",
    xavs1800Hook: "The XAVS1800 comes with an aftercooler fitted as standard and full bunding — reducing moisture issues and environmental risk. Backed by a service agreement with guaranteed response times and genuine parts availability, even for remote sites.",
  },
  fleet: {
    kpis: ["Fleet utilisation rate", "Cost per operating hour", "Fleet age & replacement cycle", "Fuel efficiency across fleet", "Compliance & certification currency"],
    painPoints: ["Running 2-3 smaller compressors where one larger unit would do", "Ageing fleet driving up repair costs on blasting jobs", "Fleet complexity making logistics harder on multi-site operations", "Tracking certification and compliance across too many units"],
    messagingAngle: "Talk fleet consolidation — one XAVS1800 replaces multiple smaller units, reducing fleet size, maintenance overhead, and logistics complexity. FleetLink telematics for utilisation tracking and lifecycle cost modelling to justify the investment.",
    xavs1800Hook: "If you're running 2-3 smaller compressors on blasting jobs, you're paying for extra fuel, extra maintenance, and extra logistics. One XAVS1800 delivers 1,800 cfm from a single footprint — consolidating your fleet and cutting your cost per operating hour.",
  },
  executive: {
    kpis: ["EBITDA / margin improvement", "Capital allocation efficiency", "ESG / sustainability targets", "Shareholder value", "Strategic partnerships"],
    painPoints: ["Equipment fleet costs eroding project margins", "Pressure to demonstrate ESG progress on site operations", "Finding strategic equipment partners, not just transactional vendors", "Capital allocation decisions on fleet investment vs. project-by-project procurement"],
    messagingAngle: "Elevate the conversation to strategic partnership — fleet investment that improves margins through consolidation, sustainability credentials (lower fuel per cfm, noise compliance), and a portfolio-level relationship with Atlas Copco.",
    xavs1800Hook: "Consolidating from multiple smaller compressors to the XAVS1800 platform across your project portfolio reduces fleet complexity, lowers fuel consumption per cfm delivered, and simplifies vendor management — directly improving your project margins.",
  },
  construction: {
    kpis: ["Daily blasting m²/hour", "Site setup time", "Equipment mobilisation speed", "Safety & environmental compliance", "Multi-crew coordination"],
    painPoints: ["Tight shutdown windows where blasting delays cascade into other trades", "Noise and emission restrictions near occupied facilities", "Running out of air pressure when multiple nozzles are operating", "Coordinating multiple compressor units and fuel deliveries on site"],
    messagingAngle: "Focus on blasting productivity: the XAVS1800 supports 4 simultaneous nozzle setups from one unit, 80 dB(A) for noise-sensitive sites, and full bunding for environmental compliance. One unit, rapid mobilisation, fewer site logistics headaches.",
    xavs1800Hook: "On a blasting job with 3-4 nozzles running, you need consistent air pressure at every nozzle — not a patchwork of smaller units. The XAVS1800 delivers 1,800 cfm from one fully bunded unit at 80 dB(A), so you meet noise compliance and keep all operators blasting.",
  },
  other: {
    kpis: ["Operational efficiency", "Cost management", "Risk reduction", "Compliance"],
    painPoints: ["Equipment reliability concerns on critical projects", "Cost pressures on compressed air supply", "Vendor management complexity across multiple sites"],
    messagingAngle: "Take a broad value approach — the XAVS1800 as a reliable, right-sized solution backed by Atlas Copco's service network and genuine parts availability.",
    xavs1800Hook: "The XAVS1800 delivers 1,800 cfm at 7 bar with dual pressure capability, a 975L fuel tank for full-shift runtime, and aftercooler fitted as standard — backed by Atlas Copco's 24/7 service network across Australia.",
  },
};

/** Get the best role-KPI match for a contact's role bucket */
function getRoleKPIs(roleBucket: string): typeof ROLE_KPI_MAP[string] {
  const normalised = roleBucket.toLowerCase().replace(/[\s_-]+/g, "_");
  // Try exact match first
  if (ROLE_KPI_MAP[normalised]) return ROLE_KPI_MAP[normalised];
  // Try partial match
  for (const [key, value] of Object.entries(ROLE_KPI_MAP)) {
    if (normalised.includes(key) || key.includes(normalised)) return value;
  }
  return ROLE_KPI_MAP.other;
}

export async function generateOutreachEmail(input: OutreachInput): Promise<OutreachResult> {
  const toneGuide: Record<string, string> = {
    professional: "Write in a formal, professional tone. Use proper business language. Be respectful of the recipient's time. Focus on value proposition and credibility.",
    consultative: "Write in a warm, consultative tone. Position yourself as a trusted advisor who understands their challenges. Ask thoughtful questions. Show genuine interest in their project success.",
    direct: "Write in a concise, direct tone. Get straight to the point. Lead with the specific value you can deliver. Include a clear call-to-action. Keep it under 150 words.",
    contractor_focused: "Write specifically for a CONTRACTOR audience (EPC, construction company, mining contractor). They care about: equipment reliability on-site, mobilisation speed, service response times, and total cost of ownership. Reference their role as the contractor delivering the project — they need equipment that won't let them down. Mention fleet support, 24/7 service, and service agreements. Their pain: equipment delays = liquidated damages. NEVER mention rental or hire.",
    owner_epc_focused: "Write specifically for a PROJECT OWNER or EPC audience. They care about: project timeline adherence, budget control, vendor consolidation, and ESG/sustainability credentials. Position Atlas Copco as a strategic partner, not just a vendor. Reference portfolio-level value, single-vendor simplification, and executive-level case studies. Their pain: managing multiple equipment vendors across a large project portfolio.",
    procurement_led: "Write specifically for a PROCUREMENT audience. They care about: competitive pricing, contract terms, TCO analysis, vendor qualification, and supply chain reliability. Lead with commercial value — bundled pricing, service agreements that lock in costs, and trade-in programs. Reference specific cost savings data. Their pain: price volatility, long lead times, and managing multiple vendor relationships. NEVER mention rental or hire.",
    engineering_led: "Write specifically for an ENGINEERING audience. They care about: technical specifications, compliance standards, energy efficiency, noise/emission levels, and system integration. Lead with technical credibility — specific CFM/kVA ratings, emission standards (Tier 4 Final / Stage V), noise levels in dB(A), and how Atlas Copco's engineering support de-risks their design. Reference technical documentation and site assessment capabilities. Their pain: spec mismatches discovered on-site.",
    first_touch: "This is a FIRST-TOUCH cold outreach. The recipient has never heard from you. Be brief (under 120 words), lead with a specific observation about their project that shows you've done your homework, and make a very low-commitment ask (e.g., 'Would it be worth a quick chat?' or 'Happy to share a one-page overview'). Do NOT pitch products in the first email — focus on establishing relevance and curiosity. The goal is to get a reply, not close a deal.",
  };

  const businessLineContext = input.matchedBusinessLines.length > 0
    ? `This project is relevant to: ${input.matchedBusinessLines.join(", ")}. Focus your pitch on the products and solutions from these specific business lines.`
    : "Identify which Atlas Copco Power Technique products would be most relevant based on the project details.";

  const equipmentContext = input.equipmentSignals && input.equipmentSignals.length > 0
    ? `Equipment signals detected: ${input.equipmentSignals.join(", ")}. Reference these specific needs in your email.`
    : "";

  // Get role-specific KPIs and pain points for deep personalisation
  const roleKPIs = getRoleKPIs(input.contactRoleBucket);
  const roleContext = `
ROLE-SPECIFIC PERSONALISATION (CRITICAL — this is what makes the email resonate):
The recipient is a "${input.contactRoleBucket}" persona. Their key KPIs are:
${roleKPIs.kpis.map((k, i) => `  ${i + 1}. ${k}`).join("\n")}

Their typical pain points are:
${roleKPIs.painPoints.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}

Messaging strategy: ${roleKPIs.messagingAngle}

XAVS1800 HOOK FOR THIS ROLE (use this as inspiration for how to position the product):
${roleKPIs.xavs1800Hook}

You MUST weave at least 2 of their KPIs or pain points into the email body naturally.
Do NOT list KPIs — instead, demonstrate understanding of their world.
For example, if they are a Procurement Manager, don't say "we can help with TCO" — instead say
"With ${input.projectName} moving into [stage], locking in a service agreement now could save
15-20% on maintenance costs over the project lifecycle compared to ad-hoc call-outs."
`;

  const prompt = `You are a sales email copywriter for Atlas Copco Power Technique. Generate a personalised outreach email.

${ATLAS_COPCO_PT_KNOWLEDGE}

RECIPIENT:
- Name: ${input.contactName}
- Title: ${input.contactTitle}
- Company: ${input.contactCompany}
- Role type: ${input.contactRoleBucket}
${roleContext}

PROJECT CONTEXT:
- Project: ${input.projectName}
- Location: ${input.projectLocation}
- Estimated value: ${input.projectValue}
- Sector: ${input.projectSector}
- Stage: ${input.projectStage || "Unknown"}
- Overview: ${input.projectOverview || "Not available"}
- Opportunity route: ${input.opportunityRoute}
${equipmentContext}
${businessLineContext}

SENDER: ${input.senderName}${input.senderTitle ? `, ${input.senderTitle}` : ""}${input.senderCompany ? ` at ${input.senderCompany}` : " at Atlas Copco Australia - Power Technique"}
${input.senderBusinessLines && input.senderBusinessLines.length > 0 ? `SENDER'S PRODUCT FOCUS: The sender specialises in ${input.senderBusinessLines.join(", ")}. Prioritise these business lines in the email while remaining relevant to the project needs. If the project is more relevant to other BLs, briefly mention the sender's products but focus on the best-fit solution.` : ""}

TONE: ${toneGuide[input.tone]}

RULES:
1. The email MUST feel deeply personalised — reference the specific project by name, the recipient's role, and at least 2 of their role-specific KPIs or pain points
2. Lead with value for THEIR project, not a product pitch — show you understand what keeps them up at night
3. Reference specific Atlas Copco PT products/solutions that match the project needs
4. Include a clear, low-commitment call-to-action (e.g., "Would a 15-minute call this week work?" or "Happy to share a site assessment")
5. Keep the email concise — 3-4 short paragraphs maximum
6. Do NOT use generic phrases like "I hope this email finds you well" or "I wanted to reach out"
7. Do NOT include [placeholder] brackets — use real product names and specific details
8. Sign off with the sender's full name, title, and company on separate lines. Use the SENDER information above for the signature. The signature MUST include: sender name, sender title, company name, and sender email address on separate lines.
9. The subject line should reference the project name and be compelling
10. The opening line should hook them by referencing something specific about their project or role — NOT a self-introduction
11. XAVS1800 PRODUCT EMBED: You MUST include 2-3 specific XAVS1800 specs naturally in the email body that are relevant to the recipient's role. For example: "The XAVS1800 delivers 1,800 cfm at 7 bar — enough to sustain 4 simultaneous 11mm nozzle setups" or "With a 975L fuel tank, your crew runs a full shift without refuelling interruptions." The specs should feel like you're solving their specific problem, not reading a brochure. Also mention that you can share the full product flyer if they'd like more detail.
12. ABSOLUTELY NO RENTAL/HIRE LANGUAGE: Never use the words "rental", "hire", "rent", "lease", "OPEX", "hire-purchase", or "rent-to-own". All messaging must be CAPEX/purchase focused. Use "service agreement", "fleet investment", or "equipment partnership" instead.
13. AUSTRALIAN ENGLISH: Use Australian spelling (e.g., "optimise" not "optimize", "colour" not "color", "programme" not "program" for project programmes).

Return your response as JSON with this exact structure:
{
  "subject": "Email subject line",
  "body": "Full email body text (use \\n for line breaks between paragraphs)",
  "keyPoints": ["Key selling point 1", "Key selling point 2", "Key selling point 3"]
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You are an expert B2B sales email copywriter specialising in industrial compressed air equipment for project-driven industries (mining, oil & gas, infrastructure, construction) in Australia. You write emails that get responses because they demonstrate genuine understanding of the recipient's specific role, their project, and how the XAVS1800 high-volume compressor solves their particular pain points. You NEVER mention rental, hire, or OPEX options. You use Australian English spelling. You weave specific product specs into the email naturally, making them feel like solutions to the recipient's problems rather than a product brochure." },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "outreach_email",
        strict: true,
        schema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Email subject line" },
            body: { type: "string", description: "Full email body with \\n for paragraph breaks" },
            keyPoints: {
              type: "array",
              items: { type: "string" },
              description: "3 key selling points used in the email",
            },
          },
          required: ["subject", "body", "keyPoints"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("LLM returned empty response for outreach email");
  }

  const parsed = JSON.parse(content) as OutreachResult;
  parsed.toneUsed = input.tone;
  return parsed;
}

/**
 * Save an outreach email to the database for tracking.
 */
export async function saveOutreachEmail(params: {
  userId: number;
  contactId?: number;
  contactName: string;
  contactEmail?: string;
  projectId?: number;
  projectName?: string;
  subject: string;
  body: string;
  tone: "professional" | "consultative" | "direct" | "contractor_focused" | "owner_epc_focused" | "procurement_led" | "engineering_led" | "first_touch";
  status: "drafted" | "opened_in_email" | "sent";
}): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(outreachEmails).values({
    userId: params.userId,
    contactId: params.contactId ?? null,
    contactName: params.contactName,
    contactEmail: params.contactEmail ?? null,
    projectId: params.projectId ?? null,
    projectName: params.projectName ?? null,
    subject: params.subject,
    body: params.body,
    tone: params.tone,
    status: params.status,
  });

  return { id: Number(result[0].insertId) };
}

/**
 * Get outreach history for a contact (most recent first).
 */
export async function getOutreachHistory(contactId: number): Promise<{
  id: number;
  userId: number;
  subject: string;
  tone: string;
  status: string;
  createdAt: Date;
}[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    id: outreachEmails.id,
    userId: outreachEmails.userId,
    subject: outreachEmails.subject,
    tone: outreachEmails.tone,
    status: outreachEmails.status,
    createdAt: outreachEmails.createdAt,
  })
    .from(outreachEmails)
    .where(eq(outreachEmails.contactId, contactId))
    .orderBy(desc(outreachEmails.createdAt));
}

/**
 * Get outreach history for a specific user + project combination.
 */
export async function getProjectOutreachHistory(userId: number, projectId: number): Promise<{
  id: number;
  contactName: string;
  contactEmail: string | null;
  subject: string;
  tone: string;
  status: string;
  createdAt: Date;
}[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    id: outreachEmails.id,
    contactName: outreachEmails.contactName,
    contactEmail: outreachEmails.contactEmail,
    subject: outreachEmails.subject,
    tone: outreachEmails.tone,
    status: outreachEmails.status,
    createdAt: outreachEmails.createdAt,
  })
    .from(outreachEmails)
    .where(and(eq(outreachEmails.userId, userId), eq(outreachEmails.projectId, projectId)))
    .orderBy(desc(outreachEmails.createdAt));
}

/**
 * Get a set of contact names that have been contacted by anyone on the team.
 * Used to show "Contacted" badges on the contacts table.
 */
export async function getContactedContactNames(): Promise<Map<string, { userId: number; userName: string | null; sentAt: Date }>> {
  const db = await getDb();
  if (!db) return new Map();

  const rows = await db.select({
    contactName: outreachEmails.contactName,
    contactId: outreachEmails.contactId,
    userId: outreachEmails.userId,
    createdAt: outreachEmails.createdAt,
  })
    .from(outreachEmails)
    .orderBy(desc(outreachEmails.createdAt));

  // Deduplicate: keep the most recent outreach per contact name
  const map = new Map<string, { userId: number; userName: string | null; sentAt: Date }>();
  for (const row of rows) {
    const key = row.contactName.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { userId: row.userId, userName: null, sentAt: row.createdAt });
    }
  }
  return map;
}

/**
 * Get contacted contact names as a simple list for the API.
 */
export async function getContactedContactList(): Promise<{
  contactName: string;
  contactId: number | null;
  userId: number;
  sentAt: Date;
}[]> {
  const db = await getDb();
  if (!db) return [];

  // Get the most recent outreach per contact name using a subquery approach
  const rows = await db.select({
    contactName: outreachEmails.contactName,
    contactId: outreachEmails.contactId,
    userId: outreachEmails.userId,
    sentAt: outreachEmails.createdAt,
  })
    .from(outreachEmails)
    .orderBy(desc(outreachEmails.createdAt));

  // Deduplicate by contact name (keep most recent)
  const seen = new Set<string>();
  const result: { contactName: string; contactId: number | null; userId: number; sentAt: Date }[] = [];
  for (const row of rows) {
    const key = row.contactName.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push({
        contactName: row.contactName,
        contactId: row.contactId,
        userId: row.userId,
        sentAt: row.sentAt,
      });
    }
  }
  return result;
}

/**
 * Get outreach leaderboard — count of emails per user in a given time window.
 */
export async function getOutreachLeaderboard(sinceDate?: Date): Promise<{
  userId: number;
  count: number;
}[]> {
  const db = await getDb();
  if (!db) return [];

  const { sql, count } = await import("drizzle-orm");
  
  let query;
  if (sinceDate) {
    query = db.select({
      userId: outreachEmails.userId,
      count: count(),
    })
      .from(outreachEmails)
      .where(sql`${outreachEmails.createdAt} >= ${sinceDate}`)
      .groupBy(outreachEmails.userId)
      .orderBy(desc(count()));
  } else {
    query = db.select({
      userId: outreachEmails.userId,
      count: count(),
    })
      .from(outreachEmails)
      .groupBy(outreachEmails.userId)
      .orderBy(desc(count()));
  }

  const rows = await query;
  return rows.map(r => ({ userId: r.userId, count: Number(r.count) }));
}

/**
 * Get all outreach emails sent by a user.
 */
export async function getUserOutreachHistory(userId: number): Promise<{
  id: number;
  contactName: string;
  contactEmail: string | null;
  projectName: string | null;
  subject: string;
  tone: string;
  status: string;
  createdAt: Date;
}[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    id: outreachEmails.id,
    contactName: outreachEmails.contactName,
    contactEmail: outreachEmails.contactEmail,
    projectName: outreachEmails.projectName,
    subject: outreachEmails.subject,
    tone: outreachEmails.tone,
    status: outreachEmails.status,
    createdAt: outreachEmails.createdAt,
  })
    .from(outreachEmails)
    .where(eq(outreachEmails.userId, userId))
    .orderBy(desc(outreachEmails.createdAt));
}
