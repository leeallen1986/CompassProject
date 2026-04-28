/**
 * Corrected ICN Commercial Audit
 * Uses ACTUAL rep territory + business-line scopes (not guessed).
 * Applies strict contact relevance, honest action-readiness, and real bucket classification.
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const REP_SCOPES: Record<string, { territories: string[]; businessLines: string[]; national: boolean }> = {
  "Leo Williams":     { territories: [],                              businessLines: ["Portable Air"],                          national: true },
  "Ryan Pemberton":   { territories: ["WA"],                          businessLines: ["Portable Air"],                          national: false },
  "Daniel Zec":       { territories: ["NSW","VIC","SA","TAS","ACT"],   businessLines: ["Portable Air"],                          national: false },
  "Dan Day":          { territories: ["NSW","VIC","SA","TAS","ACT"],   businessLines: ["Pump (Flow)"],                           national: false },
  "Amit Bhargava":    { territories: [],                              businessLines: ["PAL","BESS"],                             national: true },
  "Egor Ivanov":      { territories: [],                              businessLines: ["BESS","Portable Air","PAL","Pump (Flow)"], national: true },
  "Brett Hansen":     { territories: ["WA","NT"],                     businessLines: ["Pump (Flow)"],                            national: false },
};

// Map state abbreviations to full names and common DB patterns
const STATE_PATTERNS: Record<string, string[]> = {
  "WA":  ["Western Australia", "WA", "Pilbara", "Kalgoorlie", "Perth", "Karratha", "Port Hedland", "Geraldton", "Bunbury"],
  "NSW": ["New South Wales", "NSW", "Sydney", "Newcastle", "Wollongong", "Hunter Valley"],
  "VIC": ["Victoria", "VIC", "Melbourne", "Gippsland", "Geelong"],
  "SA":  ["South Australia", "SA", "Adelaide", "Osborne", "Port Augusta", "Olympic Dam", "Whyalla"],
  "TAS": ["Tasmania", "TAS", "Hobart", "Launceston"],
  "ACT": ["Australian Capital Territory", "ACT", "Canberra"],
  "QLD": ["Queensland", "QLD", "Brisbane", "Gladstone", "Townsville", "Mackay", "Bowen Basin"],
  "NT":  ["Northern Territory", "NT", "Darwin", "Alice Springs", "Tindal", "Pine Gap"],
};

// BL ID mapping from businessLines table
const BL_ID_MAP: Record<string, number[]> = {
  "Portable Air": [1],
  "PAL":          [3],
  "BESS":         [30002],
  "Pump (Flow)":  [30001],
};

function matchesTerritory(project: any, territories: string[], national: boolean): { matches: boolean; matchedState: string | null } {
  if (national) return { matches: true, matchedState: "NATIONAL" };
  
  const location = (project.location || "").toLowerCase();
  const name = (project.name || "").toLowerCase();
  const overview = (project.overview || "").toLowerCase();
  const combined = `${location} ${name} ${overview}`;
  
  for (const state of territories) {
    const patterns = STATE_PATTERNS[state] || [state];
    for (const pat of patterns) {
      if (combined.includes(pat.toLowerCase())) {
        return { matches: true, matchedState: state };
      }
    }
  }
  return { matches: false, matchedState: null };
}

function matchesBusinessLine(project: any, repBLs: string[]): { matches: boolean; matchedBL: string | null } {
  // matchedBusinessLines is stored as JSON array of integer IDs, mysql2 auto-parses it
  let projectBLIds: number[] = [];
  if (project.matchedBusinessLines) {
    if (Array.isArray(project.matchedBusinessLines)) {
      projectBLIds = project.matchedBusinessLines.map(Number);
    } else if (typeof project.matchedBusinessLines === "string") {
      try { projectBLIds = JSON.parse(project.matchedBusinessLines).map(Number); } catch { projectBLIds = []; }
    }
  }
  
  for (const repBL of repBLs) {
    const targetIds = BL_ID_MAP[repBL] || [];
    for (const tid of targetIds) {
      if (projectBLIds.includes(tid)) {
        return { matches: true, matchedBL: repBL };
      }
    }
  }
  return { matches: false, matchedBL: null };
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  // ── 1. Get all ICN projects ──
  const [icnRows] = await conn.execute(
    `SELECT p.id, p.name, p.location, p.overview, p.priority, p.stage,
            p.matchedBusinessLines, p.contractors, p.opportunityNote,
            p.capexGrade, p.lastActivityAt, p.lastIcnSeenAt, p.projectCountry
     FROM projects p
     WHERE p.lastIcnSeenAt IS NOT NULL
     ORDER BY p.priority DESC, p.name`
  ) as any[];
  
  console.log(`\n${"=".repeat(80)}`);
  console.log(`CORRECTED ICN COMMERCIAL AUDIT — ${new Date().toISOString().slice(0,10)}`);
  console.log(`${"=".repeat(80)}`);
  console.log(`\nICN projects in database: ${icnRows.length}`);
  
  // ── 2. Get ALL contacts linked to ICN projects ──
  const icnIds = icnRows.map((r: any) => r.id);
  let contactsByProject: Record<number, any[]> = {};
  
  if (icnIds.length > 0) {
    const placeholders = icnIds.map(() => "?").join(",");
    const [contactRows] = await conn.execute(
      `SELECT cp.projectId, c.id as contactId, c.name, c.title, c.company, 
              c.email, c.linkedin, c.roleBucket, c.source
       FROM contactProjects cp
       JOIN contacts c ON c.id = cp.contactId
       WHERE cp.projectId IN (${placeholders})`,
      icnIds
    ) as any[];
    
    for (const c of contactRows) {
      if (!contactsByProject[c.projectId]) contactsByProject[c.projectId] = [];
      contactsByProject[c.projectId].push(c);
    }
  }
  
  // ── 3. Per-project analysis ──
  console.log(`\n${"─".repeat(80)}`);
  console.log("SECTION 1: ICN PROJECT STATE");
  console.log(`${"─".repeat(80)}\n`);
  
  let actionReady = 0;
  let discoveryNeeded = 0;
  let monitorOnly = 0;
  let digestEligible = 0;
  let thisWeekEligible = 0;
  let accountAttack = 0;
  
  const projectAnalysis: any[] = [];
  
  for (const p of icnRows) {
    const contacts = contactsByProject[p.id] || [];
    const totalContacts = contacts.length;
    
    // High-relevance: has a title suggesting decision-maker or technical buyer
    const highRelevanceRoles = ["manager", "director", "superintendent", "engineer", "procurement", "buyer", "head of", "chief", "vp", "vice president", "general manager", "project manager"];
    const highRelevance = contacts.filter((c: any) => {
      const title = (c.title || "").toLowerCase();
      return highRelevanceRoles.some(r => title.includes(r));
    });
    
    // Send-ready: has email
    const sendReady = contacts.filter((c: any) => c.email && c.email.includes("@"));
    
    // BL match
    let projectBLs: string[] = [];
    if (p.matchedBusinessLines) {
      projectBLs = Array.isArray(p.matchedBusinessLines) ? p.matchedBusinessLines : 
        (typeof p.matchedBusinessLines === "string" ? (function() { try { return JSON.parse(p.matchedBusinessLines); } catch { return []; } })() : []);
    }
    
    // Contractor data
    let contractors: any[] = [];
    if (p.contractors) {
      contractors = Array.isArray(p.contractors) ? p.contractors :
        (typeof p.contractors === "string" ? (function() { try { return JSON.parse(p.contractors); } catch { return []; } })() : []);
    }
    
    // Days since last activity
    const daysSinceActivity = p.lastActivityAt ? Math.floor((Date.now() - new Date(p.lastActivityAt).getTime()) / 86400000) : 999;
    
    // Bucket classification (strict)
    let bucket: string;
    const hasBL = projectBLs.length > 0;
    const hasHighRelevanceContacts = highRelevance.length > 0;
    const hasSendReadyContacts = sendReady.length > 0;
    const hasContractorDetail = contractors.length > 0;
    const isHot = p.priority === "hot";
    const isWarm = p.priority === "warm";
    
    if (hasBL && hasHighRelevanceContacts && hasSendReadyContacts && (isHot || isWarm)) {
      bucket = "ACTION-READY";
      actionReady++;
    } else if (hasBL && totalContacts === 0) {
      bucket = "DISCOVERY-NEEDED";
      discoveryNeeded++;
    } else if (!hasBL || daysSinceActivity > 60) {
      bucket = "MONITOR-ONLY";
      monitorOnly++;
    } else {
      bucket = "DISCOVERY-NEEDED";
      discoveryNeeded++;
    }
    
    // Digest eligibility (strict): must have BL match + be active within 30 days
    const isDigestEligible = hasBL && daysSinceActivity <= 30;
    if (isDigestEligible) digestEligible++;
    
    // This Week eligibility: action-ready + hot/warm
    const isThisWeek = bucket === "ACTION-READY" && (isHot || isWarm);
    if (isThisWeek) thisWeekEligible++;
    
    // Account Attack: action-ready + hot + high-value contractors + multiple send-ready contacts
    const isAccountAttack = bucket === "ACTION-READY" && isHot && sendReady.length >= 2 && hasContractorDetail;
    if (isAccountAttack) accountAttack++;
    
    projectAnalysis.push({
      id: p.id,
      name: p.name,
      location: p.location,
      priority: p.priority,
      stage: p.stage,
      businessLines: projectBLs,
      matchedBusinessLines: p.matchedBusinessLines,
      totalContacts,
      highRelevance: highRelevance.length,
      sendReady: sendReady.length,
      contractors: contractors.length,
      daysSinceActivity,
      bucket,
      isDigestEligible,
      isThisWeek,
      isAccountAttack,
      contacts,
      opportunityNote: p.opportunityNote,
    });
  }
  
  console.log(`| Bucket | Count |`);
  console.log(`|--------|-------|`);
  console.log(`| Action-Ready | ${actionReady} |`);
  console.log(`| Discovery-Needed | ${discoveryNeeded} |`);
  console.log(`| Monitor-Only | ${monitorOnly} |`);
  console.log(`| Digest-Eligible | ${digestEligible} |`);
  console.log(`| This Week | ${thisWeekEligible} |`);
  console.log(`| Account Attack | ${accountAttack} |`);
  
  // ── 4. Per-rep analysis ──
  console.log(`\n${"─".repeat(80)}`);
  console.log("SECTION 2: PER-REP ICN SCOPE (CORRECTED)");
  console.log(`${"─".repeat(80)}`);
  
  for (const [repName, scope] of Object.entries(REP_SCOPES)) {
    console.log(`\n### ${repName} — ${scope.national ? "NATIONAL" : scope.territories.join(", ")} — ${scope.businessLines.join(", ")}`);
    console.log("");
    
    const inScope: any[] = [];
    
    for (const pa of projectAnalysis) {
      const terrMatch = matchesTerritory(pa, scope.territories, scope.national);
      const blMatch = matchesBusinessLine(pa, scope.businessLines);
      
      if (terrMatch.matches && blMatch.matches) {
        // Now compute rep-specific contact relevance
        const repContacts = pa.contacts;
        const repHighRelevance = repContacts.filter((c: any) => {
          const title = (c.title || "").toLowerCase();
          const highRelevanceRoles = ["manager", "director", "superintendent", "engineer", "procurement", "buyer", "head of", "chief", "vp", "vice president", "general manager", "project manager"];
          return highRelevanceRoles.some((r: string) => title.includes(r));
        });
        const repSendReady = repContacts.filter((c: any) => c.email && c.email.includes("@"));
        
        // Best contacts for this rep's lane
        const bestContacts = repHighRelevance.slice(0, 3).map((c: any) => 
          `${c.name} (${c.title || "?"}, ${c.company || "?"})${c.email ? " ✉" : ""}`
        );
        
        // Rep-specific action readiness
        let repBucket: string;
        if (repHighRelevance.length > 0 && repSendReady.length > 0 && (pa.priority === "hot" || pa.priority === "warm")) {
          repBucket = "ACTION-READY";
        } else if (repContacts.length === 0) {
          repBucket = "DISCOVERY-NEEDED";
        } else if (repHighRelevance.length === 0) {
          repBucket = "DISCOVERY-NEEDED (contacts exist but no relevant decision-makers)";
        } else {
          repBucket = "MONITOR";
        }
        
        inScope.push({
          project: pa.name,
          location: pa.location,
          priority: pa.priority,
          matchedState: terrMatch.matchedState,
          matchedBL: blMatch.matchedBL,
          totalContacts: repContacts.length,
          highRelevance: repHighRelevance.length,
          sendReady: repSendReady.length,
          bestContacts,
          repBucket,
        });
      }
    }
    
    if (inScope.length === 0) {
      console.log("  ⚠ NO ICN projects in scope for this rep.");
      continue;
    }
    
    console.log(`  In-scope ICN projects: ${inScope.length}`);
    console.log("");
    console.log(`  | Project | Location | Priority | Territory | BL | Total Contacts | High-Relevance | Send-Ready | Rep Status |`);
    console.log(`  |---------|----------|----------|-----------|-----|----------------|----------------|------------|------------|`);
    
    for (const s of inScope) {
      console.log(`  | ${s.project.substring(0, 40).padEnd(40)} | ${(s.location || "?").substring(0, 15).padEnd(15)} | ${s.priority.padEnd(8)} | ${(s.matchedState || "?").padEnd(9)} | ${(s.matchedBL || "?").padEnd(15)} | ${String(s.totalContacts).padEnd(14)} | ${String(s.highRelevance).padEnd(14)} | ${String(s.sendReady).padEnd(10)} | ${s.repBucket} |`);
    }
    
    // Best contacts for this rep
    const allBestContacts = inScope.flatMap(s => s.bestContacts).filter(Boolean);
    if (allBestContacts.length > 0) {
      console.log(`\n  Best contacts for ${repName}:`);
      for (const bc of allBestContacts.slice(0, 5)) {
        console.log(`    → ${bc}`);
      }
    }
    
    // Summary
    const actionReadyCount = inScope.filter(s => s.repBucket === "ACTION-READY").length;
    const discoveryCount = inScope.filter(s => s.repBucket.startsWith("DISCOVERY")).length;
    const monitorCount = inScope.filter(s => s.repBucket === "MONITOR").length;
    console.log(`\n  Summary: ${actionReadyCount} action-ready, ${discoveryCount} discovery-needed, ${monitorCount} monitor`);
  }
  
  // ── 5. Contact inflation explanation ──
  console.log(`\n${"─".repeat(80)}`);
  console.log("SECTION 3: CONTACT COUNT INFLATION EXPLANATION");
  console.log(`${"─".repeat(80)}\n`);
  
  // Find the projects with the most contacts
  const sorted = [...projectAnalysis].sort((a, b) => b.totalContacts - a.totalContacts);
  console.log("Top 5 projects by raw contact count:");
  for (const p of sorted.slice(0, 5)) {
    console.log(`\n  ${p.name} (ID: ${p.id}): ${p.totalContacts} total contacts`);
    console.log(`    High-relevance: ${p.highRelevance}`);
    console.log(`    Send-ready (has email): ${p.sendReady}`);
    
    // Show source breakdown
    const sourceBreakdown: Record<string, number> = {};
    for (const c of p.contacts) {
      const src = c.source || "unknown";
      sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
    }
    console.log(`    Source breakdown: ${JSON.stringify(sourceBreakdown)}`);
    
    // Show role breakdown
    const roleBreakdown: Record<string, number> = {};
    for (const c of p.contacts) {
      const role = c.roleBucket || "unknown";
      roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
    }
    console.log(`    Role breakdown: ${JSON.stringify(roleBreakdown)}`);
    
    // Show company breakdown (top 5)
    const companyBreakdown: Record<string, number> = {};
    for (const c of p.contacts) {
      const company = c.company || "unknown";
      companyBreakdown[company] = (companyBreakdown[company] || 0) + 1;
    }
    const topCompanies = Object.entries(companyBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`    Top companies: ${topCompanies.map(([k, v]) => `${k}(${v})`).join(", ")}`);
  }
  
  // ── 6. Per-project detail for the 8 high-value projects ──
  console.log(`\n${"─".repeat(80)}`);
  console.log("SECTION 4: HIGH-VALUE PROJECT DEEP DIVE");
  console.log(`${"─".repeat(80)}\n`);
  
  const highValueNames = [
    "AUKUS", "BAE Hunter", "Sydney Metro", "North East Link",
    "Snowy", "Western Sydney Airport", "Cross River Rail", "Olympic Dam"
  ];
  
  for (const hvn of highValueNames) {
    const pa = projectAnalysis.find(p => p.name.toLowerCase().includes(hvn.toLowerCase()));
    if (!pa) {
      console.log(`  ${hvn}: NOT FOUND in ICN projects`);
      continue;
    }
    
    console.log(`\n  ### ${pa.name}`);
    console.log(`  Location: ${pa.location || "?"}`);
    console.log(`  Priority: ${pa.priority}`);
    console.log(`  Stage: ${pa.stage || "?"}`);
    console.log(`  Business Lines: ${pa.businessLines.join(", ") || "none"}`);
    console.log(`  Total Contacts: ${pa.totalContacts}`);
    console.log(`  High-Relevance: ${pa.highRelevance}`);
    console.log(`  Send-Ready: ${pa.sendReady}`);
    console.log(`  Contractors: ${pa.contractors}`);
    console.log(`  Days Since Activity: ${pa.daysSinceActivity}`);
    console.log(`  Bucket: ${pa.bucket}`);
    console.log(`  Digest: ${pa.isDigestEligible ? "YES" : "NO"}`);
    console.log(`  This Week: ${pa.isThisWeek ? "YES" : "NO"}`);
    console.log(`  Account Attack: ${pa.isAccountAttack ? "YES" : "NO"}`);
    console.log(`  Opportunity: ${pa.opportunityNote || "none"}`);
    
    // Which reps is this in scope for?
    const repMatches: string[] = [];
    for (const [repName, scope] of Object.entries(REP_SCOPES)) {
      const terrMatch = matchesTerritory(pa, scope.territories, scope.national);
      const blMatch = matchesBusinessLine(pa, scope.businessLines);
      if (terrMatch.matches && blMatch.matches) {
        repMatches.push(`${repName} (${terrMatch.matchedState}/${blMatch.matchedBL})`);
      }
    }
    console.log(`  In scope for: ${repMatches.length > 0 ? repMatches.join(", ") : "NO REPS"}`);
    
    // Top 3 contacts
    if (pa.contacts.length > 0) {
      const top = pa.contacts
        .filter((c: any) => {
          const title = (c.title || "").toLowerCase();
          return ["manager", "director", "superintendent", "engineer", "procurement", "buyer", "head of", "chief", "vp", "general manager", "project manager"].some(r => title.includes(r));
        })
        .slice(0, 3);
      if (top.length > 0) {
        console.log(`  Top contacts:`);
        for (const c of top) {
          console.log(`    → ${c.name} | ${c.title} | ${c.company} | ${c.email ? "✉ " + c.email : "no email"} | ${c.linkedin ? "LI" : "no LI"}`);
        }
      } else {
        console.log(`  Top contacts: none with relevant titles`);
      }
    } else {
      console.log(`  Top contacts: NONE`);
    }
  }
  
  await conn.end();
  console.log(`\n${"=".repeat(80)}`);
  console.log("END OF CORRECTED AUDIT");
  console.log(`${"=".repeat(80)}`);
}

main().catch(console.error);
