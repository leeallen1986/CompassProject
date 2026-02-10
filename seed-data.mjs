/**
 * Seed script — populates the database with the initial week's intelligence data.
 * Uses mysql2 directly to avoid drizzle prepared statement issues.
 * Run with: node seed-data.mjs
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const pool = mysql.createPool(process.env.DATABASE_URL);

async function run() {
  const conn = await pool.getConnection();
  try {
    // ── Report ──
    const [reportResult] = await conn.query(
      `INSERT INTO reports (weekEnding, generatedTime, totalProjects, hotProjects, warmProjects, coldProjects, confirmedContractors, predictedContractors, capexOpportunities, totalContacts, sourcesSearched, newProjectsCount, executiveSummaryMain, executiveSummaryChanges, actionItems, researchPasses, sourceCategories)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "Feb 10, 2026", "7:00 AM AWST",
        28, 5, 11, 12, 12, 18, 15, 35, "20+", 8,
        "This week's intelligence sweep identified 28 deduplicated projects from 55 raw signals across 8 research passes and 20+ industry sources. The pipeline shows strong activity in Western Australia's Pilbara region and Queensland's Bowen Basin, with several high-value contract awards creating immediate opportunities for portable air equipment.",
        "New this week: 8 projects are new or updated since last report. Change from prior week: Thiess Mount Pleasant expansion confirmed ($900M+ fleet CAPEX signal). Hazel Creek copper-gold drilling campaign announced for March 2026. Two pumped hydro projects declared Critical State Infrastructure in NSW ($7.1B combined).",
        JSON.stringify([
          "NRW Civil & Mining has $270M+ in new civil contracts requiring bulk earthworks — contact procurement immediately.",
          "Monadelphous secured $300M Rio Tinto maintenance — shutdown air needs imminent.",
          "Golding Meandu $750M MSA is in 6-month mobilisation — fleet CAPEX window open now.",
          "BW Opal FPSO commissioning in Darwin — high-volume compressed air and nitrogen demand.",
          "Logan & Gold Coast Faster Rail $5.75B awarded to ActivUs consortium — major earthworks starting H1 2026.",
        ]),
        JSON.stringify([
          { pass: "A", focus: "Contract Awards & Appointments", rawProjects: 12, keySources: "ASX Releases, NRW, Monadelphous, Thiess, PV Magazine" },
          { pass: "B", focus: "Mobilisation & Commencement Signals", rawProjects: 6, keySources: "Mining Technology, WattClarity, Industry QLD" },
          { pass: "C", focus: "Oil & Gas / LNG Projects", rawProjects: 4, keySources: "Santos, Woodside, Energy News Bulletin" },
          { pass: "D", focus: "Mining Expansion & New Mines", rawProjects: 10, keySources: "Mining.com, ABC News, Rio Tinto, Agnico Eagle" },
          { pass: "E", focus: "Infrastructure & Construction Mega-Projects", rawProjects: 4, keySources: "ACCIONA, Australian Defence Magazine, Water Power Magazine" },
          { pass: "F", focus: "Shutdown, Turnaround & Maintenance", rawProjects: 4, keySources: "Energy News Bulletin, WattClarity, S&P Global" },
          { pass: "G", focus: "Drilling & Exploration Campaigns", rawProjects: 8, keySources: "Mining.com.au, Upstream, Proactive Investors, Junior Mining Network" },
          { pass: "H", focus: "Queensland & NSW Specific", rawProjects: 7, keySources: "Industry QLD, Mining Weekly, QLD DETSI, Transport NSW" },
        ]),
        JSON.stringify([
          { name: "ASX Releases (NRW, Monadelphous, Santos, Woodside)", type: "asx" },
          { name: "International Mining (im-mining.com)", type: "industry" },
          { name: "Mining Technology (mining-technology.com)", type: "industry" },
          { name: "Mining Weekly (miningweekly.com)", type: "industry" },
          { name: "Mining.com & Mining.com.au", type: "industry" },
          { name: "Upstream Online (upstreamonline.com)", type: "industry" },
          { name: "Energy News Bulletin", type: "industry" },
          { name: "WattClarity (power market)", type: "industry" },
          { name: "Proactive Investors", type: "industry" },
          { name: "Junior Mining Network", type: "industry" },
          { name: "Investing News", type: "industry" },
          { name: "PV Magazine (renewables)", type: "industry" },
          { name: "Water Power Magazine", type: "industry" },
          { name: "Australian Defence Magazine", type: "news" },
          { name: "ABC News Australia", type: "news" },
          { name: "TipRanks (company announcements)", type: "news" },
          { name: "QLD DETSI (environmental authority)", type: "govt" },
          { name: "Transport NSW", type: "govt" },
          { name: "NSW Government (energy policy)", type: "govt" },
          { name: "ACS Group / Thiess releases", type: "asx" },
          { name: "ACCIONA corporate releases", type: "asx" },
          { name: "S&P Global (commodities)", type: "industry" },
          { name: "Industry QLD", type: "industry" },
        ]),
      ]
    );
    const reportId = reportResult.insertId;
    console.log(`Created report ID: ${reportId}`);

    // ── Projects ──
    const projectsData = [
      ["wasp-bulk-earthworks", "West Angelas Sustaining Project (WASP) — Bulk Earthworks", "Pilbara, WA", "$295M", "Rio Tinto", "hot", "A", "Direct CAPEX", "mining", true, "Awarded, work commenced Jan 2026", "Major bulk earthworks and infrastructure at West Angelas iron ore hub. Includes haul road construction, concrete overpass arch, and access to five new satellite pits at Deposit H.", JSON.stringify(["Bulk earthworks — compressed air for pneumatic tools", "Concrete works (overpass arch) — air for vibrators", "Haul road construction — drilling and blasting potential", "Remote site — portable air essential, no mains"]), JSON.stringify([{ name: "NRW Civil & Mining", status: "confirmed", detail: "$175M bulk earthworks (Deposit H)" }, { name: "Decmil (Macmahon)", status: "confirmed", detail: "$120M heavy haulage roads (Western Hill)" }]), "Both contractors will need portable air for pneumatic tools, concrete vibrators, drilling support.", JSON.stringify([{ label: "NRW Holdings ASX Release", url: "https://nrw.com.au/nrw-civil-mining-secures-over-250m-in-civil-contract-awards/", date: "Feb 3, 2026" }, { label: "International Mining", url: "https://im-mining.com/2026/01/19/decmil-to-construct-infrastructure-for-rio-tinto-led-west-angelas-sustaining-project/", date: "Jan 19, 2026" }]), null, "2027"],
      ["mnd-rio-tinto-maintenance", "Monadelphous Rio Tinto Pilbara Maintenance Services", "Pilbara, WA", "$300M", "Rio Tinto", "hot", "A", "Direct CAPEX", "mining", false, "Awarded Jan 2026", "Five-year fixed plant maintenance and scheduled shutdown services across Rio Tinto's Pilbara iron ore operations.", JSON.stringify(["Shutdown services — high-pressure air for cleaning, testing", "Fixed plant maintenance — instrument air, pneumatic tools", "Crusher/conveyor maintenance — portable air for remote pits"]), JSON.stringify([{ name: "Monadelphous Group", status: "confirmed", detail: "$300M (5-year term)" }]), null, JSON.stringify([{ label: "Monadelphous ASX Release", url: "https://www.monadelphous.com.au/", date: "Jan 14, 2026" }]), "5-year term", null],
      ["golding-meandu", "Golding Meandu Coal Mine MSA", "South Burnett, QLD", "$750M", "TEC Coal / Stanwell", "hot", "A", "Fleet CAPEX", "mining", true, "Mobilisation commenced Jan 2026", "5.5-year mining services agreement covering whole-of-mine management at Meandu coal mine.", JSON.stringify(["Dragline operations — compressed air for maintenance", "Processing plant — instrument air systems", "Drill & blast — portable air for drilling rigs", "Fleet maintenance — pneumatic tools, 600+ CFM"]), JSON.stringify([{ name: "Golding Contractors (NRW Holdings)", status: "confirmed", detail: "$750M MSA" }, { name: "Action Drill & Blast (NRW)", status: "predicted", confidence: 0.7, detail: "drilling/blasting" }]), "Golding mobilising 3 heavy fleets. Dragline + processing plant = ongoing air demand.", JSON.stringify([{ label: "Mining Technology", url: "https://www.mining-technology.com/news/nrw-secures-502m-mining-services-contract-from-tec-coal/", date: "Jan 19, 2026" }]), "Jul 2026 – Dec 2031", null],
      ["bw-opal-barossa", "BW Opal FPSO / Barossa LNG Commissioning", "Darwin, NT", "$4.7B", "Santos / BW Offshore", "hot", "B", "Direct CAPEX", "oil_gas", false, "Commissioning, first LNG cargo Jan 2026", "The BW Opal FPSO is in active commissioning for the Barossa gas field.", JSON.stringify(["FPSO commissioning — high-volume compressed air (600+ CFM)", "Nitrogen generation/purging — boosters, 10-35 bar", "Pipeline commissioning — high-pressure air testing"]), JSON.stringify([{ name: "BW Offshore Australia", status: "confirmed", detail: "FPSO operations" }, { name: "Monadelphous", status: "predicted", confidence: 0.7 }]), null, JSON.stringify([{ label: "Santos Q4 2025 Report", url: "https://www.santos.com/news/2025-fourth-quarter-report/", date: "Jan 22, 2026" }]), null, "Mid-2026"],
      ["thiess-mt-pleasant", "Thiess Mount Pleasant Operation Expansion", "Hunter Valley, NSW", "$900M+", "MACH Energy", "hot", "A", "Fleet CAPEX", "mining", true, "Awarded, Jan 2026", "Thiess secured a 6-year contract to expand operations at Mount Pleasant coal mine.", JSON.stringify(["Drilling & blasting — high-pressure air for drill rigs", "Loading & hauling — fleet maintenance air", "Expanded fleet — additional portable units needed"]), JSON.stringify([{ name: "Thiess (CIMIC Group)", status: "confirmed", detail: "6-year mining services" }]), "Thiess expanding fleet for D&B + load/haul. Major portable air demand.", JSON.stringify([{ label: "Thiess/ACS Group Release", url: "https://www.grupoacs.com/", date: "Jan 12, 2026" }]), "6 years", null],
      ["logan-gc-faster-rail", "Logan & Gold Coast Faster Rail", "Brisbane-Gold Coast, QLD", "$5.75B", "QLD/Federal Govt", "warm", "B", "Direct CAPEX", "infrastructure", false, "Awarded", "Major rail project. Track duplication, station upgrades, level crossing removals.", JSON.stringify(["Earthmoving, drilling & blasting for cuttings", "Pneumatic tools for rail construction"]), JSON.stringify([{ name: "ActivUs (ACCIONA, CPB, UGL, SMEC, WSP)", status: "confirmed" }]), null, JSON.stringify([{ label: "ACCIONA", url: "https://www.acciona.com.au/", date: "Feb 6, 2026" }]), null, null],
      ["woodside-scarborough", "Woodside Scarborough Energy Project", "Offshore WA / Karratha", "$12.5B", "Woodside", "warm", "B", "Direct CAPEX", "oil_gas", false, "94% complete, FPU arrived Jan 2026", "FPU arrived Jan 2026. 94% complete. First LNG H2 2026.", JSON.stringify(["FPU commissioning air, nitrogen, instrument air", "Pipeline tie-in high-pressure testing"]), JSON.stringify([{ name: "Monadelphous, Worley", status: "predicted", confidence: 0.7 }]), null, JSON.stringify([{ label: "Woodside Energy", url: "https://www.woodside.com/", date: "Jan 2026" }]), null, null],
      ["shell-prelude", "Shell Prelude FLNG Turnaround 2026", "Offshore WA", "Undisclosed", "Shell", "warm", "Unknown", "OPEX/Monitor", "oil_gas", false, "Turnaround scheduled 2026", "Major maintenance blitz and workforce overhaul of Prelude FLNG.", JSON.stringify(["LNG turnaround — high-pressure air, nitrogen purging", "Shutdown services — portable air for maintenance"]), JSON.stringify([{ name: "Turnaround contractors TBD", status: "unknown" }]), null, JSON.stringify([{ label: "Energy News Bulletin", url: "https://www.energynewsbulletin.net/", date: "Mar 2025" }]), null, null],
      ["orchard-hills-defence", "Orchard Hills Defence Establishment Upgrade", "Western Sydney, NSW", "$508M", "Dept of Defence", "warm", "B", "Direct CAPEX", "defence", false, "Awarded", "GWEO plan upgrade. New explosive ordnance storage, base facility redevelopment.", JSON.stringify(["Construction air, dryers, pneumatic tools", "Specialised storage construction"]), JSON.stringify([{ name: "Hansen Yuncken, ADCO Constructions", status: "confirmed" }]), null, JSON.stringify([{ label: "Australian Defence Magazine", url: "https://www.australiandefence.com.au/", date: "Jan 28, 2026" }]), null, null],
      ["gold-duke", "Gold Duke Project — Pre-Mining Works", "Wiluna, WA", "$6.75M", "Western Gold Resources", "warm", "B", "Fleet CAPEX", "mining", false, "Early works, first gold Q1 2026", "Mining approved at Gold Duke. SSH Mining awarded pre-mining works.", JSON.stringify(["Open-pit drill & blast, haul road construction", "Site establishment portable air"]), JSON.stringify([{ name: "SSH Mining Australia", status: "confirmed" }, { name: "Delta Consultancy & Drilling", status: "confirmed" }]), null, JSON.stringify([{ label: "TipRanks", url: "https://www.tipranks.com/", date: "Feb 8, 2026" }]), null, null],
      ["bowen-basin-coking", "Bowen Basin Coking Coal Operations Extension", "Bowen Basin, QLD", "$900M", "Various", "warm", "B", "Fleet CAPEX", "mining", false, "Contract extension", "Major contract extension for coking coal operations.", JSON.stringify(["Drill & blast, fleet maintenance air"]), JSON.stringify([{ name: "Contract details pending", status: "unknown" }]), null, JSON.stringify([{ label: "Projectory", url: "https://www.projectory.com.au/", date: "Feb 2026" }]), null, null],
      ["csa-copper-revamp", "CSA Copper Mine Revamp", "Cobar, NSW", "Undisclosed", "Harmony Gold", "warm", "Unknown", "Direct CAPEX", "mining", false, "2-year revamp commenced", "2-year revamp to de-risk and de-bottleneck the mine.", JSON.stringify(["Underground compressed air, drilling, ventilation"]), JSON.stringify([{ name: "Revamp contractors pending", status: "unknown" }]), null, JSON.stringify([{ label: "Mining Weekly", url: "https://www.miningweekly.com/", date: "Feb 10, 2026" }]), null, null],
      ["callide-c-outage", "Callide C Power Station Outage", "Biloela, QLD", "Undisclosed", "CS Energy", "warm", "Unknown", "OPEX/Monitor", "energy", false, "Major outage/maintenance", "Major outage/maintenance at Callide C power station.", JSON.stringify(["Shutdown air, cleaning, pneumatic tools"]), JSON.stringify([{ name: "KAEFER, Monadelphous", status: "predicted", confidence: 0.6 }]), null, JSON.stringify([{ label: "WattClarity", url: "https://wattclarity.com.au/", date: "Jan 16, 2026" }]), null, null],
      ["gladstone-shutdown", "Gladstone LNG Shutdown Season", "Gladstone, QLD", "Undisclosed", "Various LNG operators", "warm", "Unknown", "OPEX/Monitor", "oil_gas", false, "Scheduled H1 2026", "Annual shutdown season for Gladstone LNG facilities.", JSON.stringify(["LNG turnaround air, nitrogen purging, pneumatic tools"]), JSON.stringify([{ name: "KAEFER, UGL, Monadelphous", status: "predicted", confidence: 0.6 }]), null, JSON.stringify([{ label: "S&P Global", url: "https://www.spglobal.com/", date: "Jan 2026" }]), null, null],
      ["eva-copper", "Eva Copper Mine Project", "Cloncurry, QLD", "Undisclosed", "Harmony Gold", "warm", "Unknown", "Direct CAPEX", "mining", false, "Environmental authority amendment", "Environmental authority amendment to extend mine life.", JSON.stringify(["Drilling, blasting, processing plant air"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "QLD DETSI", url: "https://www.detsi.qld.gov.au/", date: "Feb 9, 2026" }]), null, null],
      ["dampier-link-bridge", "Dampier Link Bridge Stage 2", "Dampier, WA", "$49M", "Pilbara Ports", "warm", "B", "Fleet CAPEX", "infrastructure", false, "Design phase", "New wharf structure. NRW/Brady Marine 50:50 JV.", JSON.stringify(["Marine piling air, concrete vibrators, portable tooling"]), JSON.stringify([{ name: "NRW + Brady Marine JV", status: "confirmed" }]), null, JSON.stringify([{ label: "NRW ASX", url: "https://nrw.com.au/", date: "Feb 3, 2026" }]), null, null],
      ["nsw-bess", "NSW Long-Duration Energy Storage (6 BESS Projects)", "Various, NSW", "Multi-billion", "NSW Govt", "cold", "Unknown", "OPEX/Monitor", "energy", false, "Planning/approved", "6 battery projects totalling 1.17 GW / 12 GWh.", JSON.stringify(["Civil construction air for earthworks, electrical installation"]), JSON.stringify([{ name: "Various, TBD", status: "unknown" }]), null, JSON.stringify([{ label: "NSW Government", url: "https://www.nsw.gov.au/", date: "Jan 2026" }]), null, null],
      ["western-sydney-pumped-hydro", "Western Sydney Pumped Hydro", "Lake Burragorang, NSW", "$3.5B", "ZEN Energy", "cold", "Unknown", "Direct CAPEX", "energy", false, "Critical State Infrastructure declared", "1GW pumped hydro. Critical State Infrastructure.", JSON.stringify(["Tunnel boring air, drilling & blasting, dam construction"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "NSW Government", url: "https://www.nsw.gov.au/", date: "Jan 2026" }]), null, null],
      ["yarrabin-pumped-hydro", "Yarrabin (Phoenix) Pumped Hydro", "Mudgee, NSW", "$3.6B", "ACEN Australia", "cold", "Unknown", "Direct CAPEX", "energy", false, "Critical State Infrastructure declared", "800MW pumped hydro in Central-West Orana REZ.", JSON.stringify(["Tunnelling, drilling & blasting, earthworks air"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "NSW Government", url: "https://www.nsw.gov.au/", date: "Jan 2026" }]), null, null],
      ["omega-taroom", "Omega/Elixir Taroom Trough Drilling", "Taroom Trough, QLD", "Undisclosed", "Omega Oil & Gas", "cold", "Unknown", "Direct CAPEX", "oil_gas", false, "Rig mobilisation May 2026", "Extensive drilling campaign. Rig mobilisation May 2026.", JSON.stringify(["Drilling rig compressed air, well testing"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "Upstream Online", url: "https://www.upstreamonline.com/", date: "Jan 2026" }]), null, null],
      ["beach-cooper-basin", "Beach Energy Cooper Basin Western Flank Drilling", "Cooper Basin, SA", "Undisclosed", "Beach Energy", "cold", "Unknown", "Direct CAPEX", "oil_gas", false, "Mobilising H2 FY26", "Drilling campaign on Western Flank.", JSON.stringify(["Drilling rig air, well completion"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "Investing News", url: "https://investingnews.com/", date: "Jan 2026" }]), null, null],
      ["conocophillips-otway", "ConocoPhillips Otway Basin Exploration", "Offshore VIC", "Undisclosed", "ConocoPhillips", "cold", "Unknown", "OPEX/Monitor", "oil_gas", false, "Ongoing to 2028", "Ongoing exploration drilling using Transocean Equinox rig.", JSON.stringify(["Offshore drilling support air"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "ConocoPhillips", url: "https://conocophillipsaustralia.mysocialpinpoint.com/", date: "Jan 2026" }]), null, null],
      ["mulga-tank", "Mulga Tank Drilling Campaign", "Eastern Goldfields, WA", "$180K grant", "Western Mines Group", "cold", "Unknown", "Direct CAPEX", "mining", false, "Commenced Jan 2026", "Diamond + RC drilling restarted Jan 2026.", JSON.stringify(["Diamond & RC drilling compressed air"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "Mining.com.au", url: "https://mining.com.au/", date: "Jan 2026" }]), null, null],
      ["novo-wyloo", "Novo Resources Wyloo Project", "Southern Pilbara, WA", "Undisclosed", "Novo Resources", "cold", "Unknown", "Direct CAPEX", "mining", false, "RC drilling planned June Q 2026", "Maiden RC drilling campaign planned June Q 2026.", JSON.stringify(["RC drilling compressed air"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "Proactive Investors", url: "https://ca.proactiveinvestors.com/", date: "Jan 2026" }]), null, null],
      ["hazel-creek", "Hazel Creek Copper-Gold Drilling", "QLD", "Undisclosed", "Breakthrough Minerals", "cold", "Unknown", "Direct CAPEX", "mining", true, "Diamond Mar 2026, RC Apr 2026", "Diamond drilling March 2026, RC drilling April 2026.", JSON.stringify(["Diamond & RC drilling compressed air"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "Kapitales", url: "https://www.kapitales.com.au/", date: "Feb 10, 2026" }]), null, null],
      ["kincora-nevertire", "Kincora/AngloGold Nevertire Drilling", "Macquarie Arc, NSW", "Undisclosed", "Kincora Copper", "cold", "Unknown", "Direct CAPEX", "mining", false, "Recommenced Feb 2026", "Diamond + mud-rotary drilling recommenced Feb 2026.", JSON.stringify(["Diamond drilling compressed air"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "Junior Mining Network", url: "https://www.juniorminingnetwork.com/", date: "Feb 2026" }]), null, null],
      ["rhodes-ridge", "Rhodes Ridge Iron Ore Feasibility", "Pilbara, WA", "$294M study", "Rio Tinto / Mitsui", "cold", "Unknown", "Direct CAPEX", "mining", false, "Feasibility study", "$294M feasibility study for 40-50 Mtpa mine.", JSON.stringify(["Feasibility drilling, future mine development"]), JSON.stringify([{ name: "TBD", status: "unknown" }]), null, JSON.stringify([{ label: "Rio Tinto", url: "https://www.riotinto.com/", date: "Jan 2026" }]), null, null],
      ["toodyay-road", "Toodyay Road Reconstruction", "WA", "$46M", "Main Roads WA", "cold", "Unknown", "OPEX/Monitor", "infrastructure", false, "Awarded", "Road reconstruction and realignment. NRW awarded.", JSON.stringify(["Road construction pneumatic tools"]), JSON.stringify([{ name: "NRW Civil & Mining", status: "confirmed" }]), null, JSON.stringify([{ label: "NRW ASX", url: "https://nrw.com.au/", date: "Feb 3, 2026" }]), null, null],
    ];

    for (const p of projectsData) {
      await conn.query(
        `INSERT INTO projects (reportId, projectKey, name, location, value, owner, priority, capexGrade, opportunityRoute, sector, isNew, stage, overview, equipmentSignals, contractors, opportunityNote, sources, timeline, completion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, ...p]
      );
    }
    console.log(`Inserted ${projectsData.length} projects`);

    // ── Contacts ──
    const contactsData = [
      ["Yogesh Prajapati", "GM Procurement & Logistics", "NRW Holdings", "WASP Deposit H", "hot", "Procurement", "yogesh.prajapati@nrw.com.au", "https://www.linkedin.com/search/results/all/?keywords=Yogesh+Prajapati+NRW", null],
      ["Jules Pemberton", "CEO & Managing Director", "NRW Holdings", "WASP / Meandu", "hot", "Operations", "info@nrw.com.au", "https://www.linkedin.com/search/results/all/?keywords=Jules+Pemberton+NRW", null],
      ["Kim Hyman", "CFO", "NRW Holdings", "WASP / Meandu", "hot", "Finance", null, "https://www.linkedin.com/search/results/all/?keywords=Kim+Hyman+NRW", null],
      ["Michael Finnegan", "Managing Director & CEO", "Macmahon (Decmil)", "WASP Western Hill", "hot", "Operations", "info@macmahon.com.au", "https://www.linkedin.com/search/results/all/?keywords=Michael+Finnegan+Macmahon", null],
      ["Zoran Bebic", "Managing Director", "Monadelphous Group", "Rio Tinto Maintenance", "hot", "Operations", "zoran.bebic@monadelphous.com.au", "https://www.linkedin.com/search/results/all/?keywords=Zoran+Bebic+Monadelphous", null],
      ["Paul Thomas", "Contracts & Procurement Mgr", "Monadelphous Group", "Rio Tinto Maintenance", "hot", "Procurement", "paul.thomas@monadelphous.com.au", "https://www.linkedin.com/search/results/all/?keywords=Paul+Thomas+Monadelphous", null],
      ["James Bolton", "Site Manager", "Monadelphous Group", "Rio Tinto Maintenance", "hot", "Operations", "james.bolton@monadelphous.com.au", null, null],
      ["Alex Longworth", "Project Manager", "Monadelphous Group", "Barossa FPSO", "hot", "Project", "alex.longworth@monadelphous.com.au", null, null],
      ["Michael Gray", "CEO", "Thiess", "Mt Pleasant Expansion", "hot", "Operations", null, "https://www.linkedin.com/search/results/all/?keywords=Michael+Gray+Thiess", null],
      ["Sean Munroe", "Procurement Director", "Thiess", "Mt Pleasant Expansion", "hot", "Procurement", null, "https://www.linkedin.com/search/results/all/?keywords=Sean+Munroe+Thiess+Procurement", null],
      ["Kevin Gallagher", "MD & CEO", "Santos", "Barossa / BW Opal", "hot", "Operations", "info@santos.com", null, null],
      ["John Howarth", "Senior Director Procurement", "Worley", "Scarborough / Barossa", "warm", "Procurement", "john.howarth@worley.com", "https://www.linkedin.com/search/results/all/?keywords=John+Howarth+Worley", null],
      ["Murali Jagadeesan", "Principal Expeditor", "Worley", "Scarborough", "warm", "Procurement", "murali.jagadeesan@worley.com", null, null],
      ["Prasad Vannemreddy", "Engineering Manager", "Worley", "Scarborough", "warm", "Engineering", "prasad.vannemreddy@worley.com", null, null],
      ["Treeve Andrew", "Engineering Manager", "Worley", "Scarborough", "warm", "Engineering", "treeve.andrew@worley.com", null, null],
      ["Ross Greenwood", "Supply Chain Coordinator", "KBR", "General", "warm", "Procurement", "ross.greenwood@kbr.com", null, null],
      ["Bree Thompson", "Procurement & Contracts Lead", "KBR", "General", "warm", "Procurement", "bree.thompson@kbr.com", null, null],
      ["Otavio Da Silva Martins", "Senior Supply Chain Analyst", "KBR", "General", "warm", "Procurement", "otavio.martins@kbr.com", null, null],
      ["Paulina Leibovitch", "Senior Procurement Admin", "KBR", "General", "warm", "Procurement", "paulina.leibovitch@kbr.com", null, null],
      ["Naveen Sebastian", "IT Project Manager", "Monadelphous", "BW Opal FPSO", "hot", "Project", "naveen.sebastian@monadelphous.com.au", null, null],
      ["Patrick Minchin", "Procurement Manager", "Clough", "General", "warm", "Procurement", "patrick.minchin@clough.com.au", null, null],
      ["Hansen Yuncken Procurement", "Procurement Team", "Hansen Yuncken", "Orchard Hills Defence", "warm", "Procurement", null, "https://www.linkedin.com/company/hansen-yuncken/", null],
      ["ADCO Constructions Procurement", "Procurement Team", "ADCO Constructions", "Orchard Hills Defence", "warm", "Procurement", null, "https://www.linkedin.com/company/adco-constructions/", null],
      ["ACCIONA Procurement", "Procurement Team", "ACCIONA Infrastructure", "Logan-GC Faster Rail", "warm", "Procurement", null, "https://www.linkedin.com/company/acciona-infrastructure-australia/", null],
      ["CPB Contractors Procurement", "Procurement Team", "CPB Contractors", "Logan-GC Faster Rail", "warm", "Procurement", null, "https://www.linkedin.com/company/cpb-contractors/", null],
      ["UGL Procurement", "Procurement Team", "UGL", "Logan-GC Faster Rail", "warm", "Procurement", null, "https://www.linkedin.com/company/ugl-limited/", null],
      ["SSH Mining Contact", "Operations", "SSH Mining Australia", "Gold Duke", "warm", "Operations", null, "https://www.linkedin.com/company/ssh-mining/", null],
      ["Brady Marine Contact", "Operations", "Brady Marine & Civil", "Dampier Link Bridge", "warm", "Operations", null, "https://www.linkedin.com/company/brady-marine-&-civil/", null],
      ["Delta Drilling Contact", "Operations", "Delta Consultancy & Drilling", "Gold Duke", "warm", "Operations", null, "https://www.linkedin.com/search/results/all/?keywords=Delta+Consultancy+Drilling", null],
      ["CS Energy Procurement", "Procurement Team", "CS Energy", "Callide C Outage", "warm", "Procurement", null, "https://www.linkedin.com/company/cs-energy/", null],
      ["KAEFER Procurement", "Procurement Team", "KAEFER", "Gladstone Shutdown", "warm", "Procurement", null, "https://www.linkedin.com/company/kaefer/", null],
      ["Keith Mclean", "Operations Manager - Civil", "MACA", "General WA", "cold", "Operations", null, null, "+61000000000"],
      ["Vibeena Jeyaraj", "People & Culture Manager", "DDH1 Drilling", "General Drilling", "cold", "Operations", "vibeena.jeyaraj@ddh1.com.au", null, null],
      ["Omega Oil & Gas Contact", "Operations", "Omega Oil & Gas", "Taroom Trough", "cold", "Operations", null, "https://www.linkedin.com/company/omega-oil-and-gas/", null],
    ];

    for (const c of contactsData) {
      await conn.query(
        `INSERT INTO contacts (reportId, name, title, company, project, priority, roleBucket, email, linkedin, phone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, ...c]
      );
    }
    console.log(`Inserted ${contactsData.length} contacts`);

    // ── Drilling campaigns ──
    const drillingData = [
      ["Mulga Tank", "Western Mines Group", "E. Goldfields, WA", "Diamond + RC", "Commenced Jan 2026", "600-1200 CFM", "Mining.com.au", "https://mining.com.au/"],
      ["Taroom Trough", "Omega Oil & Gas", "QLD", "Oil & Gas wells", "May 2026", "High-pressure", "Upstream", "https://www.upstreamonline.com/"],
      ["Wyloo Project", "Novo Resources", "S. Pilbara, WA", "RC", "June Q 2026", "600-1200 CFM", "Proactive", "https://ca.proactiveinvestors.com/"],
      ["Hazel Creek Cu-Au", "Breakthrough Minerals", "QLD", "Diamond (Mar) + RC (Apr)", "Mar-Apr 2026", "200-1200 CFM", "Kapitales", "https://www.kapitales.com.au/"],
      ["Cooper Basin W. Flank", "Beach Energy", "Cooper Basin, SA", "Oil & Gas wells", "H2 FY26", "High-pressure", "Investing News", "https://investingnews.com/"],
      ["Otway Basin", "ConocoPhillips", "Offshore VIC", "Exploration wells", "Ongoing to 2028", "Offshore rig air", "ConocoPhillips", "https://conocophillipsaustralia.mysocialpinpoint.com/"],
      ["Nevertire", "Kincora / AngloGold", "Macquarie Arc, NSW", "Diamond + mud-rotary", "Recommenced Feb 2026", "200-400 CFM", "JMN", "https://www.juniorminingnetwork.com/"],
      ["Gold Duke", "Western Gold / Delta", "Wiluna, WA", "RC + blast hole", "Q1 2026", "600-1200 CFM", "TipRanks", "https://www.tipranks.com/"],
    ];

    for (const d of drillingData) {
      await conn.query(
        `INSERT INTO drillingCampaigns (reportId, campaign, operator, location, drillType, timing, airRequirement, sourceLabel, sourceUrl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, ...d]
      );
    }
    console.log(`Inserted ${drillingData.length} drilling campaigns`);

    // ── Awarded projects ──
    const awardedData = [
      ["WASP Deposit H", "$175M", "NRW Civil & Mining", "Pilbara, WA", "Work commenced", "Direct", "NRW ASX", "https://nrw.com.au/"],
      ["WASP Western Hill", "$120M", "Decmil (Macmahon)", "Pilbara, WA", "Work commenced", "Direct", "Int'l Mining", "https://im-mining.com/"],
      ["Rio Tinto Maintenance", "$300M", "Monadelphous", "Pilbara, WA", "Awarded", "Direct", "MND ASX", "https://www.monadelphous.com.au/"],
      ["Meandu Coal MSA", "$750M", "Golding (NRW)", "S. Burnett, QLD", "Mobilising", "Fleet", "Mining Tech", "https://www.mining-technology.com/"],
      ["Mt Pleasant Expansion", "$900M+", "Thiess (CIMIC)", "Hunter Valley, NSW", "Awarded", "Fleet", "ACS Group", "https://www.grupoacs.com/"],
      ["Logan-GC Faster Rail", "$5.75B", "ActivUs (ACCIONA, CPB, UGL)", "QLD", "Awarded", "Direct", "ACCIONA", "https://www.acciona.com.au/"],
      ["Orchard Hills Defence", "$508M", "Hansen Yuncken, ADCO", "W. Sydney, NSW", "Awarded", "Direct", "ADM", "https://www.australiandefence.com.au/"],
      ["Gold Duke Pre-Mining", "$6.75M", "SSH Mining, Delta Drilling", "Wiluna, WA", "Early works", "Fleet", "TipRanks", "https://www.tipranks.com/"],
      ["Dampier Link Bridge", "$49M", "NRW + Brady Marine JV", "Dampier, WA", "Design phase", "Fleet", "NRW ASX", "https://nrw.com.au/"],
      ["Toodyay Road", "$46M", "NRW Civil & Mining", "WA", "Awarded", "Monitor", "NRW ASX", "https://nrw.com.au/"],
    ];

    for (const a of awardedData) {
      await conn.query(
        `INSERT INTO awardedProjects (reportId, project, value, winningContractor, location, stage, opportunity, sourceLabel, sourceUrl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, ...a]
      );
    }
    console.log(`Inserted ${awardedData.length} awarded projects`);

    console.log("\n✅ Database seeded successfully!");
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
