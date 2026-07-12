/**
 * outreachEmail.ts — AI-powered personalised outreach email generator
 * 
 * Generates tailored sales emails based on:
 * - Campaign collateral (product/solution being promoted)
 * - Contact info (name, title, company, role)
 * - Project details (name, sector, location, value, equipment signals)
 * - Atlas Copco Power Technique product/solution knowledge
 * - User's preferred tone (professional, consultative, direct)
 * 
 * The email generator is collateral-aware: it adapts its product knowledge,
 * role-specific hooks, and messaging rules based on the campaign's linked
 * collateral item (e.g., XAVS1800 compressor vs CDR desiccant dryers).
 */
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { outreachEmails, pipelineClaims } from "../drizzle/schema";
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
  senderBusinessLines?: string[];

  // Campaign collateral context
  collateralName?: string;
  collateralDescription?: string;

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

// ─────────────────────────────────────────────────────────────────────────────
// COLLATERAL KNOWLEDGE BASE
// Each entry maps a collateral pattern to its product knowledge, role hooks,
// and messaging rules. The generator picks the best match based on the
// campaign's collateralName field.
// ─────────────────────────────────────────────────────────────────────────────

export interface CollateralProfile {
  /** Pattern to match against campaign.collateralName (case-insensitive) */
  pattern: RegExp;
  /** Product knowledge block injected into the LLM prompt */
  knowledge: string;
  /** Role-specific hooks keyed by role bucket */
  roleHooks: Record<string, {
    kpis: string[];
    painPoints: string[];
    messagingAngle: string;
    productHook: string;
  }>;
  /** Product-specific prompt rules (replaces the generic XAVS1800 rules) */
  productRules: string;
  /** System prompt product description */
  systemProductDesc: string;
  /** Commercial rules (rental language, CAPEX vs OPEX, etc.) */
  commercialRules: string;
}

const COLLATERAL_PROFILES: CollateralProfile[] = [
  // ── CDR PORTABLE DESICCANT DRYERS ──────────────────────────────────────
  {
    pattern: /cdr|desiccant|dryer|air\s*treatment|moisture/i,
    knowledge: `
THIS CAMPAIGN FOCUSES ON THE CDR PORTABLE DESICCANT DRYER RANGE:

CDR 850 / CDR 1200 / CDR 1700 — Portable Desiccant Air Dryers
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Three models: CDR 850 (24 m³/min / 850 cfm), CDR 1200 (34 m³/min / 1200 cfm), CDR 1700 (48 m³/min / 1700 cfm)
• Working pressure: 7–16 bar (100–230 psi)
• Pressure dew point: -40°C / -40°F — consistent, reliable moisture removal
• Twin tower desiccant design for continuous dry air supply
• Pneumatically controlled — NO external electricity required
• Ambient temperature range: -25°C to 50°C (-10°F to 122°F)
• Corrosion-resistant, weather-resistant frame for harsh environments
• Quick-connect couplings for rapid deployment
• Compact, mobile design — easy to transport and set up
• Integrates seamlessly with Atlas Copco mobile compressors, nitrogen generators, and boosters

WHY IT MATTERS:
Moisture in compressed air causes corrosion damage, blast quality failures, instrument malfunctions,
pipeline contamination, and coating adhesion problems. The CDR dryers deliver a consistent -40°C dew
point to eliminate these issues, protecting downstream equipment and ensuring quality-critical processes
run without interruption.

IDEAL APPLICATIONS:
- Pipeline drying and purging (oil & gas, water infrastructure)
- Abrasive blasting (dry air = better blast quality, less rework)
- Offshore and shipyard operations
- Drilling operations (RC drilling, waterwell, exploration)
- Instrument air supply
- Backup air systems
- Rental fleet operations
- Mining operations (dust suppression, pneumatic tools)
- Material handling and conveying

KEY DIFFERENTIATORS vs. COMPETITORS:
1. No electricity required — pneumatic controller operates independently in remote locations
2. Three sizes (850/1200/1700 cfm) to match any air volume requirement
3. Built for extreme conditions — desert heat, coastal humidity, arctic cold
4. Consistent -40°C dew point across all operating conditions
5. Compact footprint — easy to pair with existing compressor fleet
6. Simple operation — minimal training, maximum uptime
7. Atlas Copco global service network and genuine parts availability
`,
    roleHooks: {
      procurement: {
        kpis: ["Total cost of ownership (TCO)", "Fleet utilisation rate", "Supplier consolidation", "Contract compliance", "Revenue per asset"],
        painPoints: ["Customers demanding dry air but current fleet can't deliver", "Losing rental contracts to competitors with dryer capability", "High maintenance costs on ageing dryer fleet", "Managing multiple equipment vendors for air treatment"],
        messagingAngle: "Focus on fleet revenue potential: adding CDR dryers to the rental fleet opens up higher-value contracts (pipeline, blasting, instrument air) that require dry air. Emphasise TCO advantage — no electricity costs, low maintenance, three sizes to match demand.",
        productHook: "Adding CDR dryers to your fleet opens up premium rental contracts — pipeline drying, instrument air, quality-critical blasting — that competitors without dryer capability can't service. Three sizes (850/1200/1700 cfm) mean you right-size for every job, and the pneumatic controller eliminates generator costs on remote sites.",
      },
      engineering: {
        kpis: ["Air quality specifications (dew point)", "Equipment reliability", "System integration", "Compliance standards", "Technical performance"],
        painPoints: ["Moisture-related equipment failures on site", "Inconsistent dew point from competitor dryers", "Difficulty integrating dryers with existing compressor fleet", "Spec compliance for pipeline and instrument air applications"],
        messagingAngle: "Lead with technical credibility — consistent -40°C dew point, 7-16 bar operating range, twin tower design for continuous supply. Show how CDR integrates with existing Atlas Copco compressors and highlight the pneumatic controller for electricity-free operation.",
        productHook: "The CDR range delivers a consistent -40°C pressure dew point across the full 7-16 bar operating range — critical for pipeline drying, instrument air, and quality-sensitive blasting. The twin tower design ensures continuous dry air supply with no interruption during regeneration cycles.",
      },
      operations: {
        kpis: ["Equipment uptime", "Job completion rate", "Customer satisfaction", "Fleet availability", "Mobilisation speed"],
        painPoints: ["Moisture complaints from rental customers on blasting jobs", "Dryer breakdowns causing job delays", "Needing external power for dryers on remote sites", "Complex setup and training requirements for field staff"],
        messagingAngle: "Emphasise simplicity and reliability: pneumatic controller means no generator needed, quick-connect couplings for fast setup, and rugged construction for harsh sites. CDR dryers just work — deploy, connect, and forget.",
        productHook: "Your field teams will appreciate the CDR's simplicity — pneumatic controller means no generator to haul, quick-connect couplings for 15-minute setup, and a rugged frame that handles anything from Pilbara heat to coastal salt air. When a customer needs dry air on a remote site, the CDR just works.",
      },
      fleet: {
        kpis: ["Fleet utilisation rate", "Revenue per asset", "Maintenance cost per unit", "Fleet age and replacement cycle", "Asset availability"],
        painPoints: ["Ageing dryer fleet with increasing maintenance costs", "Limited dryer capacity losing premium rental contracts", "Too many different dryer brands complicating parts and training", "Customers requesting dry air capability that current fleet can't provide"],
        messagingAngle: "Talk fleet modernisation — CDR dryers are purpose-built for rental fleets with low maintenance, no electricity requirement, and three sizes to match any job. Consolidating to Atlas Copco dryers simplifies parts, training, and service across the fleet.",
        productHook: "Consolidating your dryer fleet to CDR units simplifies everything — one parts catalogue, one service provider, one training programme. Three sizes (850/1200/1700 cfm) cover every job from small instrument air to large pipeline drying, and the pneumatic controller eliminates the generator dependency that drives up your cost per hire.",
      },
      executive: {
        kpis: ["Revenue growth", "Market share", "EBITDA margin", "Customer retention", "Strategic partnerships"],
        painPoints: ["Competitors winning premium contracts with better dryer capability", "Capital allocation decisions for fleet expansion", "Customer churn due to equipment quality issues", "Market demand for dry air solutions outpacing fleet capacity"],
        messagingAngle: "Elevate to strategic fleet investment — CDR dryers unlock premium rental segments (pipeline, offshore, instrument air) that drive higher margins. Position Atlas Copco as a strategic equipment partner for fleet modernisation.",
        productHook: "The rental market is shifting — customers increasingly demand dry air for pipeline, offshore, and quality-critical applications. Adding CDR dryers to your fleet positions you to capture these premium contracts at higher margins, while the no-electricity pneumatic design keeps your operating costs low.",
      },
      maintenance: {
        kpis: ["Mean time between failures", "Maintenance cost per operating hour", "Parts availability", "Planned vs unplanned maintenance ratio"],
        painPoints: ["Sourcing parts for multiple dryer brands", "Complex electrical systems failing in harsh conditions", "Moisture-related corrosion in dryer internals", "Lack of OEM support for older dryer models"],
        messagingAngle: "Highlight reliability and serviceability — pneumatic controller eliminates electrical failure points, corrosion-resistant construction reduces maintenance, and Atlas Copco's parts network ensures availability. CDR dryers are designed to minimise workshop time.",
        productHook: "The CDR's pneumatic controller eliminates the most common failure point in portable dryers — the electrical system. No circuit boards, no wiring harnesses, no generator dependency. Combined with corrosion-resistant construction and Atlas Copco's parts availability, your workshop time per unit drops significantly.",
      },
      project_management: {
        kpis: ["On-time project delivery", "Budget adherence", "Equipment availability", "Stakeholder satisfaction"],
        painPoints: ["Dryer failures causing project delays", "Coordinating separate dryer and compressor suppliers", "Budget overruns from ad-hoc dryer sourcing", "Quality issues from inadequate air treatment"],
        messagingAngle: "Position CDR as a reliability partner — consistent dry air supply, rapid deployment, and single-vendor simplification with Atlas Copco compressors. One call, one supplier, one service agreement.",
        productHook: "On a pipeline drying or blasting project, the last thing you need is a dryer failure halting the entire crew. The CDR delivers consistent -40°C dew point from a single compact unit that deploys in minutes — and if you're already running Atlas Copco compressors, it's one vendor, one service agreement, one call when you need support.",
      },
      construction: {
        kpis: ["Daily productivity", "Site setup time", "Equipment mobilisation", "Quality compliance"],
        painPoints: ["Moisture in blast air causing coating adhesion failures", "Dryer setup complexity on tight-turnaround jobs", "Remote sites without power for electric dryers", "Multiple equipment vendors complicating site logistics"],
        messagingAngle: "Focus on site productivity — CDR dryers eliminate moisture-related rework on blasting and coating jobs, deploy in minutes with quick-connect couplings, and need no external power. One less thing to coordinate on site.",
        productHook: "Moisture in your blast air means rework — failed coatings, flash rust, and missed deadlines. The CDR removes that risk with a consistent -40°C dew point, and the pneumatic controller means you don't need a generator just to run your dryer. Quick-connect couplings get you operational in minutes, not hours.",
      },
      other: {
        kpis: ["Operational efficiency", "Equipment reliability", "Cost management", "Compliance"],
        painPoints: ["Moisture-related equipment issues", "Dryer reliability concerns", "Cost pressures on air treatment"],
        messagingAngle: "Take a broad value approach — CDR dryers as reliable, simple, electricity-free air treatment backed by Atlas Copco's service network.",
        productHook: "The CDR range delivers consistent -40°C dew point air treatment without external electricity, in a compact, rugged package built for harsh Australian conditions — backed by Atlas Copco's national service network.",
      },
    },
    productRules: `11. CDR PRODUCT EMBED: You MUST include 2-3 specific CDR dryer specs naturally in the email body that are relevant to the recipient's role. For example: "The CDR 1200 delivers 34 m³/min of -40°C dew point air — eliminating moisture issues that cause coating failures" or "With no external electricity required, the CDR deploys on remote sites where other dryers can't." The specs should feel like you're solving their specific problem, not reading a brochure. Mention that you can share the full CDR product range overview if they'd like more detail.`,
    systemProductDesc: "CDR portable desiccant air dryers (CDR 850/1200/1700) for rental companies and project-driven industries",
    commercialRules: `12. COMMERCIAL LANGUAGE: This campaign targets RENTAL COMPANIES. You ARE allowed to use the word "rental" when referring to the recipient's business (e.g., "your rental fleet", "rental customers", "rental contracts"). However, position Atlas Copco as a CAPEX equipment supplier — the recipient BUYS CDR dryers from Atlas Copco to ADD to their rental fleet. Use "fleet investment", "equipment purchase", or "fleet addition" when referring to the Atlas Copco transaction. Never position Atlas Copco as a rental company.`,
  },

  // ── CP TRUCK AIR (CHICAGO PNEUMATIC) ──────────────────────────────────
  {
    pattern: /cp\s*truck|chicago\s*pneumatic|truck\s*air|vehicle.mount/i,
    knowledge: `
THIS CAMPAIGN FOCUSES ON CP TRUCK AIR — CHICAGO PNEUMATIC VEHICLE-MOUNTED COMPRESSORS:

CP Truck Air — Compact Air for Utility Vehicles
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Air output range: 75 to 250 CFM
• Working pressure: 7 bar (102 PSI)
• Engine: Kubota diesel — proven reliability, parts availability across Australia
• Mounting: Direct vehicle mount — no trailer required, stackable up to 3 units
• Service: Spin-on oil filter change in just 30 minutes
• Corrosion protection: Heavy-duty corrosion-resistant sheet metal
• Filtration: Heavy-duty air and fuel filters
• Control system: Ruggedized and simple control panel
• External fuel filling for convenience
• Single-side service access for tight vehicle builds

WHY IT MATTERS FOR TRUCK BUILDERS:
Truck and module builders need compressors that integrate seamlessly into their vehicle builds
without compromising cargo space, serviceability, or reliability. The CP Truck Air range is
designed specifically for this — compact enough to stack up to 3 units, with single-side service
access for tight installations, and a Kubota diesel engine that their end customers already trust.

IDEAL APPLICATIONS:
- Service truck builds (mining, construction, utilities)
- Mobile workshop vehicles
- Module builds for mining and resources
- Utility vehicle fit-outs
- Fleet vehicle standardisation
- Custom truck body builds requiring on-board compressed air

KEY DIFFERENTIATORS vs. COMPETITORS:
1. Stackable design — up to 3 units on a single vehicle for higher CFM without a trailer
2. Compact footprint maximises remaining cargo space on the vehicle
3. 30-minute oil filter service — minimal downtime for end users
4. Kubota diesel engine — trusted, proven, with national parts availability
5. Corrosion-resistant construction for harsh Australian conditions
6. 125 years of Chicago Pneumatic engineering heritage
7. Single-side service access — critical for tight vehicle installations

IMPORTANT BRAND NOTE:
This product is branded CHICAGO PNEUMATIC, which is part of the Atlas Copco Group.
Always refer to the product as "Chicago Pneumatic" or "CP Truck Air" — NOT as "Atlas Copco".
The sender represents Chicago Pneumatic (part of Atlas Copco Group).
`,
    roleHooks: {
      executive: {
        kpis: ["Revenue per vehicle build", "Customer retention rate", "Build margin optimisation", "Market differentiation", "Warranty claim reduction"],
        painPoints: ["Compressor integration issues delaying vehicle deliveries", "Warranty claims from unreliable compressor components", "Losing builds to competitors with better-integrated air solutions", "End customers demanding more compact, reliable on-board air"],
        messagingAngle: "Position CP Truck Air as a competitive advantage — the compressor that helps win more builds by offering superior integration, reliability, and space efficiency.",
        productHook: "When your customers compare truck builds, the compressor integration can be a deal-maker. CP Truck Air's stackable, vehicle-mount design means you can offer more CFM without sacrificing cargo space — and the Kubota diesel engine means fewer warranty headaches down the line.",
      },
      procurement: {
        kpis: ["Component cost per build", "Supplier reliability & lead times", "Warranty claim rates", "Standardisation across builds", "Volume pricing"],
        painPoints: ["Inconsistent compressor quality across suppliers", "Long lead times disrupting build schedules", "Managing multiple compressor brands across different builds", "Price pressure from competitors using cheaper components"],
        messagingAngle: "Focus on supply reliability, volume pricing, and standardisation benefits. One compressor platform across all builds simplifies procurement and reduces risk.",
        productHook: "Standardising on CP Truck Air across your builds simplifies your supply chain — one supplier, consistent quality, and volume pricing that improves your margin per build. Plus, the 30-minute service interval means your customers aren't coming back with complaints.",
      },
      engineering: {
        kpis: ["Integration time per build", "Space utilisation on vehicle", "Serviceability for end users", "Noise and vibration specs", "Reliability in field conditions"],
        painPoints: ["Compressors that don't fit tight vehicle layouts", "Complex mounting systems adding build time", "End users struggling to service compressors in tight spaces", "Corrosion failures in harsh environments"],
        messagingAngle: "Lead with technical integration benefits — compact footprint, single-side service access, stackable design, and ruggedized construction.",
        productHook: "The CP Truck Air mounts directly onto the vehicle with a compact footprint and single-side service access — so your builds stay tight and your end users can do a filter change in 30 minutes without pulling half the tray apart. Stack up to 3 units when the job needs more CFM.",
      },
      operations: {
        kpis: ["Build throughput (vehicles per month)", "Rework rate", "Component availability", "Installation time per unit", "Customer satisfaction scores"],
        painPoints: ["Compressor installation bottlenecks slowing build throughput", "Rework from poor-fitting compressor components", "Parts delays holding up vehicle deliveries", "Training new staff on multiple compressor brands"],
        messagingAngle: "Emphasise installation simplicity and build efficiency — CP Truck Air integrates seamlessly into the build process, reducing installation time and rework.",
        productHook: "CP Truck Air's simple mounting system integrates seamlessly into your build process — no custom fabrication, no complex plumbing. That means faster builds, less rework, and more vehicles out the door each month.",
      },
      fleet: {
        kpis: ["Fleet standardisation", "Maintenance cost per unit", "Uptime across fleet", "Parts commonality", "Total cost of ownership"],
        painPoints: ["Mixed compressor brands across the fleet complicating maintenance", "Downtime from compressor failures on service trucks", "Difficulty sourcing parts for older or obscure compressor brands", "End users not servicing compressors properly due to complexity"],
        messagingAngle: "Talk fleet standardisation — one compressor platform across all vehicles means simpler maintenance, common parts, and lower total cost of ownership.",
        productHook: "Standardising your fleet on CP Truck Air means one set of filters, one service procedure, and Kubota parts available at any dealer across Australia. The 30-minute spin-on oil filter change means your operators actually do the maintenance instead of putting it off.",
      },
      construction: {
        kpis: ["Vehicle uptime on site", "Air tool productivity", "Service turnaround time", "Equipment reliability in harsh conditions"],
        painPoints: ["Compressor failures shutting down service trucks on remote sites", "Insufficient CFM for the tools being run", "Corrosion damage from dust, water, and harsh conditions", "Difficulty getting compressor service in remote locations"],
        messagingAngle: "Focus on reliability and serviceability in harsh conditions — CP Truck Air is built for Australian conditions with corrosion-resistant construction and simple maintenance.",
        productHook: "On a remote site, the last thing your operators need is a compressor that's hard to service or prone to corrosion. CP Truck Air's corrosion-resistant construction and 30-minute filter service keeps your service trucks running — and if you need more air, stack up to 3 units on one vehicle.",
      },
      other: {
        kpis: ["Equipment reliability", "Cost efficiency", "Ease of integration", "Serviceability"],
        painPoints: ["Finding a compressor that fits the vehicle build", "Reliability concerns in harsh conditions", "Service complexity for end users"],
        messagingAngle: "Take a broad value approach — CP Truck Air as a reliable, compact, easy-to-integrate compressor solution for vehicle builds.",
        productHook: "CP Truck Air delivers 75–250 CFM from a compact, vehicle-mounted package with corrosion-resistant construction and a Kubota diesel engine — designed specifically for Australian truck builders who need reliability without compromising space.",
      },
    },
    productRules: `11. CP TRUCK AIR PRODUCT EMBED: You MUST include 2-3 specific CP Truck Air specs naturally in the email body that are relevant to the recipient's role. For example: "The CP Truck Air delivers up to 250 CFM from a compact vehicle-mount package — stackable up to 3 units when your builds need more air" or "With a 30-minute spin-on oil filter change, your end customers spend less time on maintenance and more time on the job." The specs should feel like you're solving their specific problem, not reading a brochure. Mention that you can share the full CP Truck Air product range overview if they'd like more detail.`,
    systemProductDesc: "CP Truck Air vehicle-mounted compressors (75–250 CFM) by Chicago Pneumatic for truck builders and module builders",
    commercialRules: `12. BRAND & COMMERCIAL LANGUAGE: This campaign is for CHICAGO PNEUMATIC (part of Atlas Copco Group). Always use "Chicago Pneumatic" or "CP" branding — NOT "Atlas Copco". The target audience is TRUCK BUILDERS and MODULE BUILDERS who integrate compressors into their vehicle builds. Position CP Truck Air as a component they BUY to integrate into their builds and RESELL as part of the finished vehicle. Use language like "integrate into your builds", "offer your customers", "competitive edge for your builds". Never position this as rental equipment.`,
  },

  // ── DRILLAIR RANGE (X1350, Y1260, X-Air+ etc.) ─────────────────────────
  {
    pattern: /drillair|drill\s*air|x1350|y1260|x-?air\+?\s*\d|xr[vx]s\s*1[0-5]|25\s*bar.*compressor|35\s*bar.*compressor|truck.deck.*compressor|short.package/i,
    knowledge: `
THIS CAMPAIGN FOCUSES ON THE DRILLAIR RANGE — HIGH-PRESSURE COMPRESSORS FOR DRILLING:

DrillAir X1350 — Short-Package 25 Bar Truck-Deck Compressor
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• ~1,350 cfm at 25 bar (363 psi) working pressure
• Short-package frame designed to mount on the truck deck alongside the drill rig
• Dynamic Flow Boost: additional 10% air flow during flushing and drill stem refill
• Extended Pressure Range (XPR): adjust working pressure downwards to prevent soil cavitation
• AirXpert 2.0 performance management system — real-time flow/pressure optimisation
• Smart Xc2003 controller with user-friendly interface and remote monitoring
• Available with Caterpillar or Scania engines (Stage V / Tier 4 Final compliant)
• Compact design: one truck carries both compressor and drilling rig — saves on transport
• ECO mode for fuel savings during lower-demand drilling phases
• PACE (Pressure Adjusted through Cognitive Electronics) for automatic pressure optimisation

WHY IT MATTERS FOR DRILLING CONTRACTORS:
Drilling is a high-pressure business — every foot drilled costs money, so the faster the holes
can be drilled, the more profitable the operation. The DrillAir X1350 delivers the air volume
and pressure that RC, waterwell, and blast hole drilling rigs demand, in a compact package
that fits on the same truck as the rig. Dynamic Flow Boost gives 10% extra air during flushing
and refill, cutting cycle times. XPR lets operators dial pressure down for overburden drilling
without cavitation risk.

IDEAL APPLICATIONS:
- RC (Reverse Circulation) drilling — grade control, resource definition, exploration
- Waterwell and bore drilling — agricultural, municipal, mining camp water supply
- Blast hole drilling — open pit mining, quarrying
- Geothermal drilling — ground source heat pump installations
- Foundation drilling — piling, anchoring, ground engineering
- Exploration drilling — mineral exploration, coal seam gas
- DTH (Down-The-Hole) hammer drilling

KEY DIFFERENTIATORS vs. COMPETITORS:
1. Short-package frame fits on the truck deck — no separate trailer needed
2. Dynamic Flow Boost delivers 10% extra air when you need it most (flushing/refill)
3. XPR technology prevents soil cavitation during overburden drilling
4. AirXpert 2.0 optimises performance in real-time based on drilling conditions
5. Fuel-efficient ECO mode reduces operating costs during lower-demand phases
6. Smart controller with remote monitoring — track fleet performance from anywhere
7. Atlas Copco global service network and genuine parts availability
`,
    roleHooks: {
      procurement: {
        kpis: ["Total cost of ownership (TCO)", "Cost per metre drilled", "Fleet standardisation", "Parts availability & lead times", "Fuel cost per operating hour"],
        painPoints: ["Running mismatched compressor fleet across multiple drill rigs", "High fuel costs from oversized or inefficient compressors", "Long lead times on parts for non-standard brands", "Transport costs for separate compressor trailers"],
        messagingAngle: "Focus on TCO and fleet standardisation: the DrillAir X1350 reduces transport costs (no trailer), cuts fuel with ECO mode, and standardises parts across the fleet.",
        productHook: "Running a separate compressor trailer to every drill site adds transport cost and logistics complexity. The DrillAir X1350 mounts directly on the truck deck alongside the rig — one truck, one mobilisation. With ECO mode cutting fuel during lower-demand phases and Dynamic Flow Boost delivering 10% extra air when you need it, your cost per metre drilled drops.",
      },
      engineering: {
        kpis: ["Air volume at working pressure", "Drilling productivity (metres/hour)", "Equipment reliability", "Noise & emission compliance", "Pressure control precision"],
        painPoints: ["Insufficient air volume causing slow flushing and poor sample recovery", "Soil cavitation during overburden drilling from fixed-pressure compressors", "Compressor performance degradation in extreme heat", "Spec mismatches between compressor output and rig requirements"],
        messagingAngle: "Lead with technical credibility — 1,350 cfm at 25 bar, Dynamic Flow Boost for 10% extra during flushing, XPR for adjustable pressure to prevent cavitation, and AirXpert 2.0 for real-time optimisation.",
        productHook: "When your RC rig needs maximum flushing velocity, the DrillAir X1350 delivers 1,350 cfm at 25 bar — and Dynamic Flow Boost adds 10% extra air during flushing and drill stem refill. XPR lets you dial pressure down for overburden drilling without cavitation risk, and AirXpert 2.0 optimises flow and pressure in real-time based on actual drilling conditions.",
      },
      operations: {
        kpis: ["Metres drilled per shift", "Equipment availability %", "Mobilisation time", "Fuel consumption per shift", "Rig utilisation rate"],
        painPoints: ["Compressor breakdowns halting the drill rig", "Slow flushing extending drill cycle times", "Mobilisation delays from separate compressor transport", "Fuel costs eating into project margins on remote sites"],
        messagingAngle: "Emphasise productivity and uptime: truck-deck mounting eliminates trailer logistics, Dynamic Flow Boost cuts flushing time, ECO mode saves fuel, and remote monitoring via the smart controller keeps the fleet visible.",
        productHook: "Every minute your drill rig waits for air is a metre you're not drilling. The DrillAir X1350 mounts on the truck deck — no trailer, no separate mobilisation — and Dynamic Flow Boost delivers 10% extra air during flushing so your cycle times drop. ECO mode saves fuel during lower-demand phases, and the smart controller lets you monitor the fleet remotely.",
      },
      fleet: {
        kpis: ["Fleet utilisation rate", "Cost per operating hour", "Fleet age & replacement cycle", "Standardisation across rigs", "Resale value"],
        painPoints: ["Mixed compressor brands complicating maintenance and parts", "Ageing compressor fleet with increasing breakdown frequency", "Oversized compressors wasting fuel on smaller rigs", "Tracking maintenance schedules across a dispersed fleet"],
        messagingAngle: "Talk fleet modernisation and standardisation — one compressor platform across all rigs, remote monitoring for fleet visibility, and Atlas Copco's service network for parts anywhere in Australia.",
        productHook: "Standardising your drill fleet on DrillAir X1350 means one set of parts, one service provider, and remote monitoring across every rig. The short-package design fits on the truck deck regardless of rig type, and ECO mode adapts fuel consumption to actual demand — so you're not burning diesel you don't need.",
      },
      executive: {
        kpis: ["EBITDA / margin improvement", "Capital allocation efficiency", "Fleet ROI", "Contract win rate", "Market competitiveness"],
        painPoints: ["Drilling costs eroding project margins", "Losing tenders to competitors with more efficient equipment", "Capital tied up in ageing, inefficient compressor fleet", "ESG pressure to reduce emissions from diesel equipment"],
        messagingAngle: "Elevate to strategic fleet investment — the DrillAir X1350 improves margins through fuel efficiency, transport savings, and drilling productivity, while Stage V compliance supports ESG targets.",
        productHook: "Consolidating your compressor fleet to the DrillAir X1350 platform reduces your cost per metre drilled through three levers: no trailer transport costs, ECO mode fuel savings, and Dynamic Flow Boost cutting flushing time. Stage V engine compliance supports your ESG commitments, and the short-package design means one truck per rig — not two.",
      },
      construction: {
        kpis: ["Daily metres drilled", "Site setup time", "Equipment mobilisation speed", "Safety & environmental compliance", "Drill programme completion rate"],
        painPoints: ["Tight drill programmes where delays cascade into project overruns", "Mobilisation complexity with separate compressor trailers", "Noise and emission restrictions near communities", "Compressor reliability on remote or difficult-access sites"],
        messagingAngle: "Focus on drilling productivity and mobilisation speed: truck-deck mounting, Dynamic Flow Boost for faster flushing, and Stage V compliance for noise/emission-sensitive sites.",
        productHook: "On a tight drill programme, mobilisation speed matters. The DrillAir X1350 mounts on the truck deck — one vehicle, one mobilisation, straight to the drill pad. Dynamic Flow Boost gives 10% extra air during flushing so you complete more metres per shift, and Stage V compliance means you can drill near communities without emission issues.",
      },
      maintenance: {
        kpis: ["Mean time between failures (MTBF)", "Maintenance cost per operating hour", "Parts availability", "Planned vs. unplanned maintenance ratio"],
        painPoints: ["Sourcing parts for non-standard compressor brands on remote sites", "Complex maintenance procedures requiring specialist technicians", "Dust and heat degrading compressor performance in mining environments", "Lack of remote diagnostics for early fault detection"],
        messagingAngle: "Highlight serviceability and reliability — smart controller with remote diagnostics, Atlas Copco's national parts network, and robust construction for harsh Australian conditions.",
        productHook: "The DrillAir X1350's smart Xc2003 controller provides remote monitoring and diagnostics — so you can spot issues before they become breakdowns. Atlas Copco's national parts network means genuine parts availability even on remote sites, and the robust construction handles Pilbara heat and Goldfields dust without missing a beat.",
      },
      other: {
        kpis: ["Operational efficiency", "Cost management", "Equipment reliability", "Compliance"],
        painPoints: ["Equipment reliability concerns on drilling projects", "Cost pressures on drilling operations", "Compressor-rig compatibility issues"],
        messagingAngle: "Take a broad value approach — the DrillAir X1350 as a reliable, efficient, truck-deck-mounted drilling compressor backed by Atlas Copco's service network.",
        productHook: "The DrillAir X1350 delivers ~1,350 cfm at 25 bar from a short-package frame that mounts directly on the truck deck. Dynamic Flow Boost, XPR pressure adjustment, and ECO mode optimise every drilling operation — backed by Atlas Copco's 24/7 service network across Australia.",
      },
    },
    productRules: `11. DRILLAIR PRODUCT EMBED: You MUST include 2-3 specific DrillAir specs naturally in the email body that are relevant to the recipient's role. For example: "The DrillAir X1350 delivers ~1,350 cfm at 25 bar — and Dynamic Flow Boost adds 10% extra air during flushing to cut your cycle times" or "The short-package frame mounts directly on the truck deck alongside the rig — one truck, one mobilisation, straight to the drill pad." The specs should feel like you're solving their specific drilling problem, not reading a brochure. Mention that you can share the full DrillAir product range overview if they'd like more detail.`,
    systemProductDesc: "DrillAir X1350 short-package 25 bar truck-deck compressor for RC drilling, waterwell, blast hole, and exploration drilling operations",
    commercialRules: `12. ABSOLUTELY NO RENTAL/HIRE LANGUAGE: Never use the words "rental", "hire", "rent", "lease", "OPEX", "hire-purchase", or "rent-to-own". All messaging must be CAPEX/purchase focused. Use "service agreement", "fleet investment", or "equipment partnership" instead. Position Atlas Copco as a long-term equipment partner for drilling contractors.`,
  },

  // ── XAVS1800 COMPRESSOR (EXPLICIT MATCH ONLY — not a catch-all default) ────
  {
    pattern: /xavs|1800|abrasive\s*blast|surface\s*prep/i,
    knowledge: `
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
`,
    roleHooks: {
      procurement: {
        kpis: ["Total cost of ownership (TCO)", "Supplier consolidation", "Contract compliance", "On-time delivery", "Cost savings vs. budget"],
        painPoints: ["Managing multiple equipment vendors across shutdowns", "Unpredictable maintenance costs blowing budgets", "Long lead times on parts delaying projects", "Running 2-3 smaller compressors instead of one right-sized unit"],
        messagingAngle: "Focus on TCO savings: one XAVS1800 replaces 2-3 smaller units, reducing fleet complexity and maintenance overhead. Emphasise service agreements that lock in parts pricing and response times.",
        productHook: "Running multiple smaller compressors on a blasting job drives up your total cost — more maintenance, more fuel, more logistics. The XAVS1800 consolidates that into one unit delivering 1,800 cfm with a 975L tank for full-shift runtime, backed by a service agreement that locks in your costs.",
      },
      engineering: {
        kpis: ["Equipment uptime & reliability", "Technical spec compliance", "Safety standards", "Noise compliance", "Air quality at the nozzle"],
        painPoints: ["Nozzle pressure drop across long hose runs", "Spec mismatches discovered on-site during blasting", "Noise restrictions near communities or occupied facilities", "Moisture in air supply causing blast quality issues"],
        messagingAngle: "Lead with technical credibility — specific CFM ratings at both 7 and 14 bar, nozzle capacity calculations, aftercooler for air quality, and 80 dB(A) noise level.",
        productHook: "Every 1 psi lost below 100 psi at the nozzle costs ~1.5% in blasting efficiency. The XAVS1800 delivers 1,800 cfm at 7 bar with an aftercooler fitted as standard — so your crews maintain consistent nozzle pressure across 4 simultaneous 11mm setups, with cleaner, drier air for better blast quality.",
      },
      operations: {
        kpis: ["Blasting metres²/hour", "Equipment availability %", "Fuel consumption per shift", "Shift utilisation without refuelling stops", "Multi-operator productivity"],
        painPoints: ["Compressor downtime halting the entire blasting crew", "Refuelling interruptions breaking shift momentum", "Running out of air pressure with 3+ nozzles operating", "Remote site logistics for multiple smaller units"],
        messagingAngle: "Emphasise uptime and productivity: 975L fuel tank means full-shift runtime, one unit supports 4 operators simultaneously, and FleetLink telematics gives real-time monitoring.",
        productHook: "When your blasting crew is running 3-4 nozzles and the compressor can't keep up, everyone stops. The XAVS1800 is sized for exactly this — 1,800 cfm sustaining 4× 11mm setups simultaneously, with a 975L tank so you don't break shift for refuelling.",
      },
      project_management: {
        kpis: ["On-time project delivery", "Budget adherence", "Resource utilisation", "Stakeholder satisfaction", "Risk mitigation"],
        painPoints: ["Equipment delays pushing back shutdown milestones", "Blasting scope creep when undersized compressors slow the crew", "Coordinating multiple equipment vendors on a tight shutdown window"],
        messagingAngle: "Position Atlas Copco as a reliability partner — guaranteed delivery timelines, a single point of contact for air supply, and equipment that's right-sized.",
        productHook: "On a tight shutdown window, the last thing you need is the blasting crew waiting for air. The XAVS1800 is right-sized for multi-operator blasting — one unit, one vendor, one service agreement — so your shutdown stays on schedule.",
      },
      maintenance: {
        kpis: ["Mean time between failures (MTBF)", "Planned vs. unplanned maintenance ratio", "Parts availability", "Maintenance cost per operating hour"],
        painPoints: ["Sourcing genuine parts quickly for remote sites", "Ageing compressor fleet with increasing breakdown frequency", "Moisture and heat issues degrading compressor performance"],
        messagingAngle: "Highlight genuine parts availability, preventive maintenance programs, and service agreements. The XAVS1800's aftercooler and bunding reduce maintenance headaches.",
        productHook: "The XAVS1800 comes with an aftercooler fitted as standard and full bunding — reducing moisture issues and environmental risk. Backed by a service agreement with guaranteed response times and genuine parts availability, even for remote sites.",
      },
      fleet: {
        kpis: ["Fleet utilisation rate", "Cost per operating hour", "Fleet age & replacement cycle", "Fuel efficiency across fleet", "Compliance & certification currency"],
        painPoints: ["Running 2-3 smaller compressors where one larger unit would do", "Ageing fleet driving up repair costs", "Fleet complexity making logistics harder", "Tracking certification across too many units"],
        messagingAngle: "Talk fleet consolidation — one XAVS1800 replaces multiple smaller units, reducing fleet size, maintenance overhead, and logistics complexity.",
        productHook: "If you're running 2-3 smaller compressors on blasting jobs, you're paying for extra fuel, extra maintenance, and extra logistics. One XAVS1800 delivers 1,800 cfm from a single footprint — consolidating your fleet and cutting your cost per operating hour.",
      },
      executive: {
        kpis: ["EBITDA / margin improvement", "Capital allocation efficiency", "ESG / sustainability targets", "Shareholder value", "Strategic partnerships"],
        painPoints: ["Equipment fleet costs eroding project margins", "Pressure to demonstrate ESG progress", "Finding strategic equipment partners, not just transactional vendors"],
        messagingAngle: "Elevate to strategic partnership — fleet investment that improves margins through consolidation, sustainability credentials, and single-vendor simplification.",
        productHook: "Consolidating from multiple smaller compressors to the XAVS1800 platform across your project portfolio reduces fleet complexity, lowers fuel consumption per cfm delivered, and simplifies vendor management — directly improving your project margins.",
      },
      construction: {
        kpis: ["Daily blasting m²/hour", "Site setup time", "Equipment mobilisation speed", "Safety & environmental compliance", "Multi-crew coordination"],
        painPoints: ["Tight shutdown windows where blasting delays cascade", "Noise and emission restrictions near occupied facilities", "Running out of air pressure when multiple nozzles are operating"],
        messagingAngle: "Focus on blasting productivity: the XAVS1800 supports 4 simultaneous nozzle setups from one unit, 80 dB(A) for noise-sensitive sites, and full bunding for environmental compliance.",
        productHook: "On a blasting job with 3-4 nozzles running, you need consistent air pressure at every nozzle — not a patchwork of smaller units. The XAVS1800 delivers 1,800 cfm from one fully bunded unit at 80 dB(A), so you meet noise compliance and keep all operators blasting.",
      },
      other: {
        kpis: ["Operational efficiency", "Cost management", "Risk reduction", "Compliance"],
        painPoints: ["Equipment reliability concerns on critical projects", "Cost pressures on compressed air supply", "Vendor management complexity"],
        messagingAngle: "Take a broad value approach — the XAVS1800 as a reliable, right-sized solution backed by Atlas Copco's service network.",
        productHook: "The XAVS1800 delivers 1,800 cfm at 7 bar with dual pressure capability, a 975L fuel tank for full-shift runtime, and aftercooler fitted as standard — backed by Atlas Copco's 24/7 service network across Australia.",
      },
    },
    productRules: `11. XAVS1800 PRODUCT EMBED: You MUST include 2-3 specific XAVS1800 specs naturally in the email body that are relevant to the recipient's role. For example: "The XAVS1800 delivers 1,800 cfm at 7 bar — enough to sustain 4 simultaneous 11mm nozzle setups" or "With a 975L fuel tank, your crew runs a full shift without refuelling interruptions." The specs should feel like you're solving their specific problem, not reading a brochure. Also mention that you can share the full product flyer if they'd like more detail.`,
    systemProductDesc: "XAVS1800 high-volume portable air compressor for abrasive blasting operations",
    commercialRules: `12. ABSOLUTELY NO RENTAL/HIRE LANGUAGE: Never use the words "rental", "hire", "rent", "lease", "OPEX", "hire-purchase", or "rent-to-own". All messaging must be CAPEX/purchase focused. Use "service agreement", "fleet investment", or "equipment partnership" instead.`,
  },
];

const ATLAS_COPCO_BASE_KNOWLEDGE = `
Atlas Copco Power Technique — Portable Air Division, Australia.

COMPANY POSITIONING:
Atlas Copco is a global leader in compressed air and power solutions. The Portable Air division
provides equipment sales, long-term service agreements, and fleet solutions for project-driven
industries across Australia and globally.

OTHER ATLAS COPCO PT BUSINESS LINES (mention only if relevant):
- Portable Air: XAVS, XAS, XATS series compressors (250–1800+ cfm)
- Air Treatment: CDR/CDR+ portable desiccant dryers (850–1700 cfm)
- Power & Lighting: QAS/QIS/QES generators (8–1500+ kVA), HiLight LED towers
- BESS: ZenergiZe battery energy storage, hybrid diesel+battery solutions
- Pumps: WEDA submersible, PAS centrifugal — mine dewatering, flood control
- Nitrogen: portable nitrogen generation with membrane technology
`;

// ── GENERIC NO-COLLATERAL PROFILE ─────────────────────────────────────────
// Used when no campaign collateral is linked. Keeps emails solution/outcome-
// focused without referencing any specific product model.
const GENERIC_NO_COLLATERAL_PROFILE: CollateralProfile = {
  pattern: /^$/, // never matched directly — used only as fallback
  knowledge: `
NO SPECIFIC PRODUCT COLLATERAL IS LINKED TO THIS OUTREACH.

Do NOT reference any specific product model number (e.g. XAVS1800, CDR, DrillAir X1350).
Instead, write an outcome-focused email that:
- References Atlas Copco Power Technique's broad capability (compressed air, power, air treatment, BESS, pumps)
- Focuses on the recipient's project, role, and business challenges
- Positions Atlas Copco as a solutions partner, not a product vendor
- Mentions that you can share relevant product information once you understand their specific requirements

ATLAS COPCO POWER TECHNIQUE CAPABILITY SUMMARY:
- Portable Air: High-volume compressors (250–1800+ cfm) for blasting, drilling, construction, mining
- Air Treatment: Portable desiccant dryers for pipeline, offshore, instrument air, quality-critical blasting
- Power & Lighting: Generators (8–1500+ kVA) and LED lighting towers for remote and project sites
- BESS: ZenergiZe battery energy storage and hybrid diesel+battery solutions for off-grid and ESG-driven projects
- Pumps: Submersible and centrifugal pumps for mine dewatering, flood control, and water management
- Nitrogen: Portable nitrogen generation for pipeline purging, inerting, and specialty applications
`,
  roleHooks: {
    procurement: {
      kpis: ["Total cost of ownership (TCO)", "Supplier consolidation", "Contract compliance", "On-time delivery", "Cost savings vs. budget"],
      painPoints: ["Managing multiple equipment vendors across projects", "Unpredictable maintenance costs", "Long lead times on equipment", "Vendor qualification complexity"],
      messagingAngle: "Position Atlas Copco as a single-source equipment partner that simplifies vendor management, reduces TCO, and delivers across multiple product categories.",
      productHook: "Atlas Copco Power Technique covers compressed air, power, air treatment, and pumping from a single supplier — simplifying your vendor list and giving you one service agreement across your project equipment needs.",
    },
    engineering: {
      kpis: ["Equipment reliability", "Technical spec compliance", "Safety standards", "Energy efficiency", "System integration"],
      painPoints: ["Equipment spec mismatches discovered on-site", "Noise and emission compliance on sensitive sites", "Integrating equipment from multiple vendors", "Reliability in harsh Australian conditions"],
      messagingAngle: "Lead with technical credibility — Atlas Copco's engineering heritage, compliance credentials, and the breadth of solutions available for complex project requirements.",
      productHook: "Atlas Copco Power Technique equipment is engineered for Australian conditions — from the Pilbara to offshore — with compliance-ready specs and a service network that backs every unit in the field.",
    },
    operations: {
      kpis: ["Equipment uptime", "Productivity per shift", "Fuel efficiency", "Mobilisation speed", "Multi-site coordination"],
      painPoints: ["Equipment downtime halting crews", "Slow mobilisation to remote sites", "Managing equipment from multiple vendors", "Fuel and logistics costs on remote projects"],
      messagingAngle: "Emphasise uptime, reliability, and Atlas Copco's national service network — equipment that shows up ready and keeps running.",
      productHook: "Atlas Copco's national service network means parts and support are available wherever your project is — from metropolitan shutdowns to remote mine sites. One call covers compressed air, power, and pumping.",
    },
    project_management: {
      kpis: ["On-time project delivery", "Budget adherence", "Risk mitigation", "Vendor coordination", "Stakeholder satisfaction"],
      painPoints: ["Equipment delays pushing back project milestones", "Coordinating multiple equipment vendors on tight schedules", "Budget overruns from ad-hoc equipment sourcing", "Equipment failures cascading into programme delays"],
      messagingAngle: "Position Atlas Copco as a reliability partner — one vendor, one service agreement, equipment that arrives on time and performs as specified.",
      productHook: "On a tight project schedule, equipment reliability is non-negotiable. Atlas Copco Power Technique provides compressed air, power, and ancillary equipment under a single service agreement — one vendor to coordinate, one point of contact when you need support.",
    },
    maintenance: {
      kpis: ["Mean time between failures", "Planned vs. unplanned maintenance ratio", "Parts availability", "Maintenance cost per operating hour"],
      painPoints: ["Sourcing genuine parts quickly for remote sites", "Ageing equipment fleet with increasing breakdowns", "Managing multiple equipment brands and service providers", "Unplanned downtime disrupting maintenance schedules"],
      messagingAngle: "Highlight Atlas Copco's genuine parts availability, preventive maintenance programmes, and service agreements with guaranteed response times.",
      productHook: "Atlas Copco's service agreements lock in response times and genuine parts pricing — reducing unplanned downtime and giving your maintenance team predictable costs across compressed air, power, and pumping equipment.",
    },
    fleet: {
      kpis: ["Fleet utilisation rate", "Cost per operating hour", "Fleet age & replacement cycle", "Fuel efficiency", "Compliance currency"],
      painPoints: ["Mixed equipment brands driving up maintenance complexity", "Ageing fleet with increasing repair costs", "Tracking certification and compliance across too many units", "Fleet logistics for remote project sites"],
      messagingAngle: "Talk fleet simplification — consolidating to Atlas Copco across compressed air, power, and ancillary equipment reduces complexity and total cost.",
      productHook: "Consolidating your project equipment fleet to Atlas Copco Power Technique simplifies parts, training, and service — one provider across compressed air, power, and pumping, with national coverage for remote sites.",
    },
    executive: {
      kpis: ["EBITDA / margin improvement", "Capital allocation efficiency", "ESG / sustainability targets", "Strategic partnerships", "Shareholder value"],
      painPoints: ["Equipment fleet costs eroding project margins", "Pressure to demonstrate ESG progress on projects", "Finding strategic equipment partners, not transactional vendors", "Capital allocation decisions for project equipment"],
      messagingAngle: "Elevate to strategic partnership — Atlas Copco as a long-term equipment partner that improves margins, supports ESG credentials, and simplifies vendor management.",
      productHook: "Atlas Copco Power Technique offers a strategic equipment partnership across compressed air, power, BESS, and pumping — with service agreements that lock in costs, ESG-aligned hybrid solutions, and a national network that supports your projects wherever they are.",
    },
    construction: {
      kpis: ["Daily productivity", "Site setup time", "Equipment mobilisation", "Safety & environmental compliance", "Multi-crew coordination"],
      painPoints: ["Equipment mobilisation delays on tight-turnaround projects", "Noise and emission restrictions near occupied facilities", "Coordinating multiple equipment vendors on site", "Equipment reliability on critical-path activities"],
      messagingAngle: "Focus on reliability and mobilisation speed — Atlas Copco equipment that arrives ready, performs to spec, and is backed by a national service network.",
      productHook: "Atlas Copco Power Technique equipment is built for Australian construction and project sites — compliant, reliable, and backed by a service network that covers everything from compressed air to power and pumping.",
    },
    other: {
      kpis: ["Operational efficiency", "Cost management", "Risk reduction", "Compliance"],
      painPoints: ["Equipment reliability concerns on critical projects", "Vendor management complexity", "Cost pressures on project equipment"],
      messagingAngle: "Take a broad value approach — Atlas Copco Power Technique as a reliable, full-capability equipment partner backed by a national service network.",
      productHook: "Atlas Copco Power Technique provides compressed air, power, air treatment, BESS, and pumping solutions for project-driven industries across Australia — backed by a national service and parts network.",
    },
  },
  productRules: `11. NO SPECIFIC PRODUCT MODEL: Do NOT mention any specific Atlas Copco product model number (e.g. XAVS1800, CDR 850, DrillAir X1350, QAS 150). Instead, reference Atlas Copco Power Technique's capability broadly (e.g. "high-volume portable compressors", "portable air treatment", "battery energy storage"). Mention that you can share relevant product details once you understand their specific requirements. The email should feel like a capability introduction, not a product pitch.`,
  systemProductDesc: "Atlas Copco Power Technique full capability — portable air, power, air treatment, BESS, and pumping solutions for project-driven industries in Australia",
  commercialRules: `12. COMMERCIAL LANGUAGE: Position Atlas Copco as a solutions partner. Use outcome-focused language (e.g. "reliable compressed air supply", "on-site power solutions", "air treatment for quality-critical applications"). Avoid rental/hire language unless the recipient is clearly a rental company. Do NOT reference specific product pricing or model-specific commercial terms.`,
};

/** Find the best collateral profile for a given collateral name */
export function getCollateralProfile(collateralName?: string): CollateralProfile {
  if (collateralName) {
    for (const profile of COLLATERAL_PROFILES) {
      if (profile.pattern.test(collateralName)) {
        return profile;
      }
    }
  }
  // No collateral linked — use the generic outcome-focused profile
  // (does NOT default to XAVS1800 or any other specific product)
  return GENERIC_NO_COLLATERAL_PROFILE;
}

/** Get the best role-KPI match for a contact's role bucket within a collateral profile */
function getRoleHooks(roleBucket: string, profile: CollateralProfile): typeof profile.roleHooks[string] {
  const normalised = roleBucket.toLowerCase().replace(/[\s_-]+/g, "_");
  // Try exact match first
  if (profile.roleHooks[normalised]) return profile.roleHooks[normalised];
  // Try partial match
  for (const [key, value] of Object.entries(profile.roleHooks)) {
    if (normalised.includes(key) || key.includes(normalised)) return value;
  }
  return profile.roleHooks.other;
}

export async function generateOutreachEmail(input: OutreachInput): Promise<OutreachResult> {
  // Resolve the collateral profile based on the campaign's collateral name
  const profile = getCollateralProfile(input.collateralName);

  const toneGuide: Record<string, string> = {
    professional: "Write in a formal, professional tone. Use proper business language. Be respectful of the recipient's time. Focus on value proposition and credibility.",
    consultative: "Write in a warm, consultative tone. Position yourself as a trusted advisor who understands their challenges. Ask thoughtful questions. Show genuine interest in their project success.",
    direct: "Write in a concise, direct tone. Get straight to the point. Lead with the specific value you can deliver. Include a clear call-to-action. Keep it under 150 words.",
    contractor_focused: "Write specifically for a CONTRACTOR audience (EPC, construction company, mining contractor). They care about: equipment reliability on-site, mobilisation speed, service response times, and total cost of ownership. Reference their role as the contractor delivering the project — they need equipment that won't let them down.",
    owner_epc_focused: "Write specifically for a PROJECT OWNER or EPC audience. They care about: project timeline adherence, budget control, vendor consolidation, and ESG/sustainability credentials. Position Atlas Copco as a strategic partner, not just a vendor.",
    procurement_led: "Write specifically for a PROCUREMENT audience. They care about: competitive pricing, contract terms, TCO analysis, vendor qualification, and supply chain reliability. Lead with commercial value.",
    engineering_led: "Write specifically for an ENGINEERING audience. They care about: technical specifications, compliance standards, energy efficiency, noise/emission levels, and system integration. Lead with technical credibility.",
    first_touch: "This is a FIRST-TOUCH cold outreach. The recipient has never heard from you. Be brief (under 120 words), lead with a specific observation about their company or market that shows you've done your homework, and make a very low-commitment ask (e.g., 'Would it be worth a quick chat?' or 'Happy to share a one-page overview'). Do NOT pitch products heavily in the first email — focus on establishing relevance and curiosity. The goal is to get a reply, not close a deal.",
  };

  const businessLineContext = input.matchedBusinessLines.length > 0
    ? `This outreach is relevant to: ${input.matchedBusinessLines.join(", ")}. Focus your pitch on the products and solutions from these specific business lines.`
    : "Identify which Atlas Copco Power Technique products would be most relevant based on the context.";

  const equipmentContext = input.equipmentSignals && input.equipmentSignals.length > 0
    ? `Equipment signals detected: ${input.equipmentSignals.join(", ")}. Reference these specific needs in your email.`
    : "";

  // Get role-specific hooks from the collateral profile
  const roleHooks = getRoleHooks(input.contactRoleBucket, profile);
  const roleContext = `
ROLE-SPECIFIC PERSONALISATION (CRITICAL — this is what makes the email resonate):
The recipient is a "${input.contactRoleBucket}" persona. Their key KPIs are:
${roleHooks.kpis.map((k, i) => `  ${i + 1}. ${k}`).join("\n")}

Their typical pain points are:
${roleHooks.painPoints.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}

Messaging strategy: ${roleHooks.messagingAngle}

PRODUCT HOOK FOR THIS ROLE (use this as inspiration for how to position the product):
${roleHooks.productHook}

You MUST weave at least 2 of their KPIs or pain points into the email body naturally.
Do NOT list KPIs — instead, demonstrate understanding of their world.
`;

  // Build the campaign description context
  const campaignContext = input.collateralDescription
    ? `\nCAMPAIGN DESCRIPTION: ${input.collateralDescription}\n`
    : "";

  const prompt = `You are a sales email copywriter for Atlas Copco Power Technique. Generate a personalised outreach email.

${ATLAS_COPCO_BASE_KNOWLEDGE}
${profile.knowledge}

RECIPIENT:
- Name: ${input.contactName}
- Title: ${input.contactTitle}
- Company: ${input.contactCompany}
- Role type: ${input.contactRoleBucket}
${roleContext}

CONTEXT:
- Company: ${input.contactCompany}
- Industry: ${input.projectSector}
- Location: ${input.projectLocation}
${input.projectOverview ? `- Overview: ${input.projectOverview}` : ""}
${campaignContext}
${equipmentContext}
${businessLineContext}

SENDER: ${input.senderName}${input.senderTitle ? `, ${input.senderTitle}` : ""}${input.senderCompany ? ` at ${input.senderCompany}` : " at Atlas Copco Australia - Power Technique"}
${input.senderBusinessLines && input.senderBusinessLines.length > 0 ? `SENDER'S PRODUCT FOCUS: The sender specialises in ${input.senderBusinessLines.join(", ")}.` : ""}

TONE: ${toneGuide[input.tone]}

RULES:
1. The email MUST feel deeply personalised — reference the recipient's company, their role, and at least 2 of their role-specific KPIs or pain points
2. Lead with value for THEIR business, not a product pitch — show you understand what keeps them up at night
3. Reference specific Atlas Copco PT products/solutions that match the campaign's collateral
4. Include a clear, low-commitment call-to-action (e.g., "Would a 15-minute call this week work?" or "Happy to share a one-page overview")
5. Keep the email concise — 3-4 short paragraphs maximum
6. Do NOT use generic phrases like "I hope this email finds you well" or "I wanted to reach out"
7. Do NOT include [placeholder] brackets — use real product names and specific details
8. Do NOT include a signature block (no name, title, company, or email at the end). The recipient's email client will add their own signature automatically. End the email after the call-to-action or a brief closing line like "Looking forward to hearing from you" — nothing more.
9. Do NOT include any "Reminder: Please attach..." notes or attachment instructions. Attachments are handled automatically by the system.
10. The subject line should reference the recipient's company or market and be compelling
11. ALWAYS start the email with "Hi [FirstName]," (e.g., "Hi Chris,") — Australians expect a friendly "Hi" greeting. Never start with just the name, "Dear", or skip the greeting entirely. The first paragraph after the greeting should hook them by referencing something specific about their company, market, or role — NOT a self-introduction
${profile.productRules}
${profile.commercialRules}
${input.senderName && input.senderName.toLowerCase().includes("tim") && input.senderName.toLowerCase().includes("shaw") ? `14. SENDER-SPECIFIC SIGN-OFF (MANDATORY for Tim O'Neil Shaw): Because Tim is the Communications Manager (not a direct sales rep), the email MUST close with a line like: "If you're interested, just reply to this email and I'll organise your local Atlas Copco sales representative to visit or share more details." This positions Tim as the connector, not the salesperson. Vary the exact wording naturally but always convey: reply → I'll arrange local sales to follow up.` : `14. Include a natural closing line before the sign-off (e.g., "Looking forward to hearing from you" or "Happy to chat further").`}
15. AUSTRALIAN ENGLISH: Use Australian spelling (e.g., "optimise" not "optimize", "colour" not "color", "programme" not "program" for project programmes).

Return your response as JSON with this exact structure:
{
  "subject": "Email subject line",
  "body": "Full email body text (use \\n for line breaks between paragraphs)",
  "keyPoints": ["Key selling point 1", "Key selling point 2", "Key selling point 3"]
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: `You are an expert B2B sales email copywriter specialising in industrial compressed air and air treatment equipment for project-driven industries in Australia. You are writing about ${profile.systemProductDesc}. You write emails that get responses because they demonstrate genuine understanding of the recipient's specific role, their company, and how Atlas Copco's products solve their particular pain points. You use Australian English spelling. You weave specific product specs into the email naturally, making them feel like solutions to the recipient's problems rather than a product brochure.` },
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
  contactId?: number | null;
  contactName: string;
  contactEmail?: string | null;
  projectId?: number | null;
  projectName?: string | null;
  claimId?: number | null;
  sourceAccountId?: number | null;
  subject: string;
  body: string;
  tone:
    | "professional"
    | "consultative"
    | "direct"
    | "contractor_focused"
    | "owner_epc_focused"
    | "procurement_led"
    | "engineering_led"
    | "first_touch";
  status: "drafted" | "opened_in_email" | "sent";
}): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let resolvedSourceAccountId =
    params.sourceAccountId ?? null;

  if (
    params.claimId !== undefined &&
    params.claimId !== null
  ) {
    const [claim] = await db
      .select({
        id: pipelineClaims.id,
        userId: pipelineClaims.userId,
        sourceAccountId:
          pipelineClaims.sourceAccountId,
      })
      .from(pipelineClaims)
      .where(eq(pipelineClaims.id, params.claimId))
      .limit(1);

    if (!claim) {
      throw new Error("Pipeline claim not found");
    }
    if (claim.userId !== params.userId) {
      throw new Error(
        "Cannot attach outreach to another user's " +
        "pipeline claim",
      );
    }
    if (
      resolvedSourceAccountId !== null &&
      claim.sourceAccountId !==
        resolvedSourceAccountId
    ) {
      throw new Error(
        "sourceAccountId does not match " +
        "the pipeline claim",
      );
    }
    resolvedSourceAccountId =
      claim.sourceAccountId;
  } else if (resolvedSourceAccountId !== null) {
    throw new Error(
      "sourceAccountId requires a linked pipeline claim",
    );
  }

  const now = new Date();
  const result = await db
    .insert(outreachEmails)
    .values({
      userId: params.userId,
      contactId: params.contactId ?? null,
      contactName: params.contactName.trim(),
      contactEmail:
        params.contactEmail?.trim() || null,
      projectId: params.projectId ?? null,
      projectName:
        params.projectName?.trim() || null,
      claimId: params.claimId ?? null,
      sourceAccountId: resolvedSourceAccountId,
      subject: params.subject.trim(),
      body: params.body,
      tone: params.tone,
      status: params.status,
      sentAt:
        params.status === "sent" ? now : null,
      openedInEmailAt:
        params.status === "opened_in_email"
          ? now
          : null,
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
