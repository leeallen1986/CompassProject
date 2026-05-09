/**
 * PART A1: For every active rep, identify their top 3 projects and return contact status.
 * Contact status: send_ready | named_unverified | no_contact
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { laneOpportunityGate } from "../server/laneScoring";

interface RepProfile {
  userId: string;
  name: string;
  email: string;
  territories: string[];
  primaryDimension: string;
}

interface ProjectWithContact {
  projectId: number;
  projectName: string;
  state: string;
  blScore: number;
  sector: string;
  route: string;
  bestContactName: string | null;
  bestContactTitle: string | null;
  bestContactCompany: string | null;
  bestContactTrustTier: string | null;
  bestContactEmail: string | null;
  bestContactLinkedin: string | null;
  contactStatus: "send_ready" | "named_unverified" | "no_contact";
}

async function main() {
  const db = await getDb();

  // Get all active reps with profiles
  const [reps] = await db.execute(sql`
    SELECT u.id, u.name, u.email, up.territories, up.assignedBusinessLines
    FROM users u
    JOIN userProfiles up ON u.id = up.userId
    WHERE u.role IN ('admin', 'user', 'distributor')
    ORDER BY u.name
  `);

  const repProfiles: RepProfile[] = (reps as any[]).map(r => {
    let territories: string[] = [];
    let businessLines: string[] = [];
    try {
      territories = typeof r.territories === "string" ? JSON.parse(r.territories) : (r.territories || []);
    } catch { territories = []; }
    try {
      businessLines = typeof r.assignedBusinessLines === "string" ? JSON.parse(r.assignedBusinessLines) : (r.assignedBusinessLines || []);
    } catch { businessLines = []; }

    // Determine primary dimension - check all business lines, prioritize PA > Pump > PAL
    let primaryDim = "portable_air";
    if (businessLines.length > 0) {
      const allBL = businessLines.map(b => b.toLowerCase()).join(" ");
      if (allBL.includes("portable air")) primaryDim = "portable_air";
      else if (allBL.includes("pump") || allBL.includes("flow") || allBL.includes("dewater")) primaryDim = "pump_dewatering";
      else if (allBL.includes("pal") || allBL.includes("generator") || allBL.includes("light") || allBL.includes("bess") || allBL.includes("battery")) primaryDim = "pal_bess";
      else primaryDim = "portable_air";
    }

    return {
      userId: r.id,
      name: r.name,
      email: r.email,
      territories,
      primaryDimension: primaryDim,
    };
  });

  console.log(`Found ${repProfiles.length} active reps\n`);

  // Get all hot/warm projects with BL scores
  const [projects] = await db.execute(sql`
    SELECT p.id, p.name, p.overview, p.sector, p.opportunityRoute, p.projectState,
           p.owner, p.stage, p.equipmentSignals,
           COALESCE(bls.score, 0) as blScore
    FROM projects p
    LEFT JOIN projectBusinessLineScores bls ON p.id = bls.projectId
    WHERE p.priority IN ('hot', 'warm')
    ORDER BY COALESCE(bls.score, 0) DESC
    LIMIT 200
  `);

  // Get all contacts grouped by project
  const [contacts] = await db.execute(sql`
    SELECT project, name, title, company, contactTrustTier, roleRelevance, email, linkedin
    FROM contacts
    WHERE contactTrustTier IN ('send_ready', 'named_unverified')
    AND roleRelevance IN ('high', 'medium')
    ORDER BY 
      CASE WHEN contactTrustTier = 'send_ready' THEN 0 ELSE 1 END,
      CASE WHEN roleRelevance = 'high' THEN 0 ELSE 1 END
  `);

  // Build contact map by project name
  const contactMap = new Map<string, any[]>();
  for (const c of contacts as any[]) {
    const key = (c.project || "").toLowerCase().trim();
    if (!contactMap.has(key)) contactMap.set(key, []);
    contactMap.get(key)!.push(c);
  }

  // State mapping for territory matching
  const stateMap: Record<string, string[]> = {
    "WA": ["WA", "Western Australia"],
    "NSW": ["NSW", "New South Wales"],
    "VIC": ["VIC", "Victoria"],
    "QLD": ["QLD", "Queensland"],
    "SA": ["SA", "South Australia"],
    "TAS": ["TAS", "Tasmania"],
    "NT": ["NT", "Northern Territory"],
    "ACT": ["ACT", "Australian Capital Territory"],
    "NATIONAL": [],
    "OFFSHORE_AU": ["Offshore"],
  };

  function matchesTerritory(projectState: string | null, territories: string[]): boolean {
    if (!territories || territories.length === 0) return true;
    if (territories.some(t => t.toUpperCase() === "NATIONAL" || t.toUpperCase() === "ALL STATES")) return true;
    if (!projectState) return true; // include projects with no state
    const ps = projectState.toUpperCase();
    for (const t of territories) {
      const tu = t.toUpperCase();
      if (ps.includes(tu)) return true;
      const aliases = stateMap[tu] || [];
      for (const a of aliases) {
        if (ps.toUpperCase().includes(a.toUpperCase())) return true;
      }
    }
    return false;
  }

  // For each rep, find their top 3 projects that pass the gate
  const results: { rep: RepProfile; topProjects: ProjectWithContact[] }[] = [];

  for (const rep of repProfiles) {
    const repProjects: ProjectWithContact[] = [];

    for (const p of projects as any[]) {
      if (!matchesTerritory(p.projectState, rep.territories)) continue;

      // Run gate
      const gateResult = laneOpportunityGate(
        { name: p.name, overview: p.overview || "", sector: p.sector || "", opportunityRoute: p.opportunityRoute || "", owner: p.owner || "", stage: p.stage || "", equipmentSignals: p.equipmentSignals || "" },
        rep.primaryDimension,
        Number(p.blScore) || 0
      );
      if (!gateResult.pass) continue;

      // Find best contact
      const projectKey = (p.name || "").toLowerCase().trim();
      const projectContacts = contactMap.get(projectKey) || [];
      
      let bestContact: any = null;
      let contactStatus: "send_ready" | "named_unverified" | "no_contact" = "no_contact";

      if (projectContacts.length > 0) {
        const sendReady = projectContacts.filter((c: any) => c.contactTrustTier === "send_ready");
        if (sendReady.length > 0) {
          bestContact = sendReady[0];
          contactStatus = "send_ready";
        } else {
          bestContact = projectContacts[0];
          contactStatus = "named_unverified";
        }
      }

      repProjects.push({
        projectId: p.id,
        projectName: p.name,
        state: p.projectState || "Unknown",
        blScore: Number(p.blScore) || 0,
        sector: p.sector || "",
        route: p.opportunityRoute || "",
        bestContactName: bestContact?.name || null,
        bestContactTitle: bestContact?.title || null,
        bestContactCompany: bestContact?.company || null,
        bestContactTrustTier: bestContact?.contactTrustTier || null,
        bestContactEmail: bestContact?.email ? "YES" : "NO",
        bestContactLinkedin: bestContact?.linkedin ? "YES" : "NO",
        contactStatus,
      });

      if (repProjects.length >= 5) break; // Get top 5 for national rep analysis
    }

    results.push({ rep, topProjects: repProjects });
  }

  // Output results
  console.log("=".repeat(120));
  console.log("PART A1: TOP PROJECTS PER REP WITH CONTACT STATUS");
  console.log("=".repeat(120));

  let zeroContactProjects: { repName: string; projectName: string; projectId: number }[] = [];

  for (const { rep, topProjects } of results) {
    console.log(`\n${"─".repeat(100)}`);
    console.log(`REP: ${rep.name} | Lane: ${rep.primaryDimension} | Territory: ${rep.territories.join(", ") || "NATIONAL"}`);
    console.log(`${"─".repeat(100)}`);

    if (topProjects.length === 0) {
      console.log("  ⚠️  NO PROJECTS PASS GATE");
      continue;
    }

    for (let i = 0; i < Math.min(5, topProjects.length); i++) {
      const p = topProjects[i];
      const contactIcon = p.contactStatus === "send_ready" ? "✅" : p.contactStatus === "named_unverified" ? "⚠️" : "❌";
      console.log(`  ${i + 1}. [${contactIcon} ${p.contactStatus.toUpperCase()}] ${p.projectName}`);
      console.log(`     State: ${p.state} | BL Score: ${p.blScore} | Route: ${p.route}`);
      if (p.bestContactName) {
        console.log(`     Contact: ${p.bestContactName}, ${p.bestContactTitle} @ ${p.bestContactCompany}`);
        console.log(`     Email: ${p.bestContactEmail} | LinkedIn: ${p.bestContactLinkedin} | Trust: ${p.bestContactTrustTier}`);
      } else {
        console.log(`     Contact: NONE AVAILABLE`);
      }

      if (p.contactStatus === "no_contact" && i < 3) {
        zeroContactProjects.push({ repName: rep.name, projectName: p.projectName, projectId: p.projectId });
      }
    }
  }

  console.log(`\n${"=".repeat(120)}`);
  console.log(`ZERO-CONTACT TOP-3 PROJECTS REQUIRING ENRICHMENT`);
  console.log(`${"=".repeat(120)}`);
  console.log(`Total: ${zeroContactProjects.length} projects across ${new Set(zeroContactProjects.map(p => p.repName)).size} reps\n`);
  for (const p of zeroContactProjects) {
    console.log(`  ${p.repName} → ${p.projectName} (ID: ${p.projectId})`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
