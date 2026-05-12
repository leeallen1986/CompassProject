/**
 * Live proof pack query for Brett Hansen (userId 2550006) and Dan Day (userId 3630009)
 * Runs the same scoring logic as thisWeekService but outputs raw proof data.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

async function getTopPumpProjects(userId, territories, businessLines) {
  // Get projects scored for Pump/Dewatering in the rep's territories
  const territoryList = territories.map(t => `'${t}'`).join(",");
  
  // Get top pump-scored projects in territory
  const [projects] = await conn.execute(`
    SELECT 
      p.id,
      p.name,
      p.location,
      p.stage,
      p.projectType,
      p.owner,
      p.contractors,
      pbl.score as pumpScore,
      pbl.explanation as pumpExplanation,
      pbl.scoringDimension
    FROM projects p
    JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id
    WHERE pbl.scoringDimension = 'Pump/Dewatering'
      AND pbl.score >= 40
      AND (p.suppressed IS NULL OR p.suppressed = 0)
      AND (p.projectType = 'opportunity' OR p.projectType IS NULL)
      AND (
        p.location LIKE '%WA%' OR p.location LIKE '%Western Australia%'
        OR p.location LIKE '%QLD%' OR p.location LIKE '%Queensland%'
        OR p.location LIKE '%NSW%' OR p.location LIKE '%SA%'
        OR p.location LIKE '%VIC%' OR p.location LIKE '%NT%'
      )
    ORDER BY pbl.score DESC
    LIMIT 20
  `);

  // Filter by territory
  const filtered = projects.filter(p => {
    const loc = (p.location || "").toUpperCase();
    return territories.some(t => loc.includes(t) || loc.includes(t.replace("WA", "WESTERN AUSTRALIA")));
  });

  return filtered.slice(0, 5);
}

async function getContactsForProject(projectId) {
  const [contacts] = await conn.execute(`
    SELECT 
      c.id,
      c.name,
      c.title,
      c.company,
      c.email,
      c.linkedin,
      c.contactTrustTier,
      c.rejectionReason
    FROM contacts c
    JOIN contactProjects pcj ON pcj.contactId = c.id
    WHERE pcj.projectId = ?
      AND c.rejectionReason IS NULL
    ORDER BY 
      CASE c.contactTrustTier
        WHEN 'send_ready' THEN 1
        WHEN 'named_unverified' THEN 2
        WHEN 'llm_inferred' THEN 3
        ELSE 4
      END,
      CASE 
        WHEN LOWER(c.title) LIKE '%dewater%' THEN 1
        WHEN LOWER(c.title) LIKE '%site manager%' THEN 2
        WHEN LOWER(c.title) LIKE '%site superintendent%' THEN 2
        WHEN LOWER(c.title) LIKE '%maintenance manager%' THEN 3
        WHEN LOWER(c.title) LIKE '%maintenance superintendent%' THEN 3
        WHEN LOWER(c.title) LIKE '%project manager%' THEN 4
        WHEN LOWER(c.title) LIKE '%project engineer%' THEN 4
        WHEN LOWER(c.title) LIKE '%operations manager%' THEN 5
        WHEN LOWER(c.title) LIKE '%general manager%' THEN 6
        WHEN LOWER(c.title) LIKE '%procurement%' THEN 8
        WHEN LOWER(c.title) LIKE '%commercial%' THEN 8
        ELSE 7
      END
    LIMIT 5
  `, [projectId]);
  return contacts;
}

async function getAccountPriorMatch(projectId) {
  const [rows] = await conn.execute(`
    SELECT ap.canonicalName, ap.priorityLevel, ap.scoreOutOf100, ap.segment
    FROM accountPriors ap
    WHERE (
      EXISTS (
        SELECT 1 FROM projects p 
        WHERE p.id = ? 
        AND (
          LOWER(p.owner) LIKE CONCAT('%', LOWER(ap.canonicalName), '%')
          OR LOWER(ap.canonicalName) LIKE CONCAT('%', LOWER(p.owner), '%')
          OR LOWER(p.contractors) LIKE CONCAT('%', LOWER(ap.canonicalName), '%')
        )
      )
    )
    ORDER BY ap.scoreOutOf100 DESC
    LIMIT 1
  `, [projectId]);
  return rows[0] || null;
}

function computePumpActionMode(pumpScore, contacts, accountPrior) {
  const hasSiteContact = contacts.some(c => {
    const t = (c.title || "").toLowerCase();
    return t.includes("dewater") || t.includes("site manager") || t.includes("site superintendent") ||
           t.includes("maintenance manager") || t.includes("maintenance superintendent");
  });
  const hasSendReadyContact = contacts.some(c => c.contactTrustTier === "send_ready");
  const hasAccountPrior = !!accountPrior;
  const priorityA = accountPrior?.priorityLevel?.startsWith("A");

  if (pumpScore >= 65 && (hasSendReadyContact || contacts.length === 0)) {
    if (hasAccountPrior && priorityA) return "direct_pursue";
    if (hasSiteContact) return "direct_pursue";
    return "find_site_contact";
  }
  if (pumpScore >= 65 && hasAccountPrior) return "map_package";
  if (pumpScore >= 65 && !hasSiteContact) return "find_site_contact";
  if (pumpScore >= 40 && hasAccountPrior) return "account_nurture";
  if (pumpScore >= 40) return "watch_incumbent";
  return "reference_only";
}

async function buildProof(userId, name, territories, businessLines) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`REP: ${name} (userId: ${userId})`);
  console.log(`Business Lines: ${businessLines}`);
  console.log(`Territories: ${territories.join(", ")}`);
  console.log(`isPumpLaneRep: ${businessLines.includes("Pump (Flow)") || businessLines.includes("Dewatering Pumps")}`);
  console.log(`${"=".repeat(60)}`);

  const projects = await getTopPumpProjects(userId, territories, businessLines);
  
  if (projects.length === 0) {
    console.log("⚠️  NO pump-scored projects found in territory. This is a data gap.");
    return [];
  }

  const results = [];
  for (let i = 0; i < Math.min(3, projects.length); i++) {
    const p = projects[i];
    const contacts = await getContactsForProject(p.id);
    const accountPrior = await getAccountPriorMatch(p.id);
    const pumpActionMode = computePumpActionMode(p.pumpScore, contacts, accountPrior);
    const bestContact = contacts[0] || null;

    console.log(`\n--- Project ${i + 1} ---`);
    console.log(`ID:           ${p.id}`);
    console.log(`Name:         ${p.name}`);
    console.log(`Location:     ${p.location}`);
    console.log(`Stage:        ${p.stage}`);
    console.log(`Owner:        ${p.owner || "unknown"}`);
    console.log(`Contractors:  ${p.contractors ? JSON.stringify(p.contractors).substring(0,120) : "unknown"}`);
    console.log(`Pump Score:   ${p.pumpScore}`);
    console.log(`Pump Expl:    ${p.pumpExplanation}`);
    console.log(`Action Mode:  ${pumpActionMode}`);
    console.log(`Account Prior: ${accountPrior ? `${accountPrior.canonicalName} (${accountPrior.priorityLevel}, score ${accountPrior.scoreOutOf100})` : "none"}`);
    console.log(`\nContacts (${contacts.length} total, rejectionReason IS NULL):`);
    if (contacts.length === 0) {
      console.log("  ⚠️  NO contacts — enrichment needed");
    } else {
      contacts.forEach((c, idx) => {
        const marker = idx === 0 ? "★ PRIMARY" : `  ${idx + 1}.`;
        console.log(`  ${marker} ${c.name} | ${c.title} | ${c.company}`);
        console.log(`         Trust: ${c.contactTrustTier} | Email: ${c.email || "none"} | LinkedIn: ${c.linkedin ? "yes" : "no"}`);
      });
    }

    results.push({ project: p, contacts, accountPrior, pumpActionMode, bestContact });
  }
  return results;
}

// Brett Hansen: WA + NT, Pump (Flow) + Dewatering Pumps + Portable Air
const brett = await buildProof(
  2550006, "Brett Hansen",
  ["WA", "NT"],
  ["Portable Air", "Pump (Flow)", "Dewatering Pumps"]
);

// Dan Day: SA + QLD + VIC + NSW + TAS, Pump (Flow) + Dewatering Pumps
const dan = await buildProof(
  3630009, "Dan Day",
  ["QLD", "NSW", "SA", "VIC", "TAS"],
  ["Pump (Flow)", "Dewatering Pumps"]
);

await conn.end();
