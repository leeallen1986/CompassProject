/**
 * run-demoted-slates.mjs
 *
 * Generates candidate slates and runs Hunter verification for the 13 demoted projects.
 * Run: node run-demoted-slates.mjs
 */

import "dotenv/config";
import { createConnection } from "mysql2/promise";

// ── Connect ──
const connection = await createConnection(process.env.DATABASE_URL);

// Schema is accessed via raw SQL in this script (avoids TS import issues in plain node)

// ── Step 1: Find the 13 demoted projects ──
// These are projects that were demoted from send_ready_contact to named_contact_no_email
// by the demote-unsafe-projects.mjs script. We identify them by:
//   - discoveryStatus = 'named_contact_no_email'
//   - priority IN ('hot','warm')
//   - no current send_ready contact linked

const [demotedRows] = await connection.execute(`
  SELECT DISTINCT p.id, p.name, p.priority, p.sector, p.projectState as state
  FROM projects p
  WHERE p.discoveryStatus = 'named_contact_no_email'
    AND p.priority IN ('hot', 'warm')
  ORDER BY
    CASE p.priority WHEN 'hot' THEN 1 ELSE 2 END,
    p.name
  LIMIT 20
`);

const demotedProjects = Array.isArray(demotedRows) ? demotedRows : [];
console.log(`\n=== Found ${demotedProjects.length} demoted projects ===\n`);
demotedProjects.forEach((p, i) => {
  console.log(`  ${i + 1}. [${p.priority.toUpperCase()}] ${p.name} (ID: ${p.id}) — ${p.state || "?"}`);
});

if (demotedProjects.length === 0) {
  console.log("No demoted projects found. Exiting.");
  await connection.end();
  process.exit(0);
}

const projectIds = demotedProjects.map(p => p.id);

// ── Step 2: For each project, count existing contacts by tier ──
console.log("\n=== Contact coverage before slate generation ===\n");
for (const p of demotedProjects) {
  const [rows] = await connection.execute(`
    SELECT c.contactTrustTier, COUNT(*) as cnt
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    WHERE cp.projectId = ?
    GROUP BY c.contactTrustTier
  `, [p.id]);
  const tierMap = {};
  (Array.isArray(rows) ? rows : []).forEach(r => { tierMap[r.contactTrustTier] = r.cnt; });
  console.log(`  ${p.name}: send_ready=${tierMap.send_ready||0} named_unverified=${tierMap.named_unverified||0} llm=${tierMap.llm_inferred||0}`);
}

// ── Step 3: Generate slates ──
console.log("\n=== Generating candidate slates ===\n");

const slateResults = [];
for (const p of demotedProjects) {
  // Score contacts for this project
  const [contactRows] = await connection.execute(`
    SELECT c.id, c.name, c.title, c.company, c.email, c.linkedin,
           c.enrichmentSource, c.contactTrustTier, c.confidenceScore, c.roleRelevance
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    WHERE cp.projectId = ?
  `, [p.id]);

  const contacts = Array.isArray(contactRows) ? contactRows : [];

  if (contacts.length === 0) {
    console.log(`  ⚠️  ${p.name}: no contacts found — slate empty`);
    slateResults.push({ project: p, slate: null, contactCount: 0 });
    continue;
  }

  // Score each contact
  const scored = contacts.map(c => {
    const title = (c.title || "").toLowerCase();
    let roleLane = "backup";
    const PRIMARY_KW = ["project manager","project director","site manager","construction manager","project superintendent","site superintendent","project lead","general manager","operations director","managing director","executive","vp ","vice president","director"];
    const COMMERCIAL_KW = ["procurement","commercial","contracts manager","contract manager","purchasing","supply chain","category manager","sourcing","tendering","bid manager","estimator","cost manager"];
    const TECHNICAL_KW = ["operations manager","operations","maintenance manager","maintenance","project engineer","site engineer","engineering manager","plant manager","equipment manager","fleet manager","hire manager","rental manager","mechanical engineer","electrical engineer","process engineer","technical manager","asset manager"];

    for (const kw of COMMERCIAL_KW) { if (title.includes(kw)) { roleLane = "commercial"; break; } }
    if (roleLane === "backup") {
      for (const kw of PRIMARY_KW) { if (title.includes(kw)) { roleLane = "primary"; break; } }
    }
    if (roleLane === "backup") {
      for (const kw of TECHNICAL_KW) { if (title.includes(kw)) { roleLane = "technical"; break; } }
    }

    const tierScore = c.contactTrustTier === "send_ready" ? 40 : c.contactTrustTier === "named_unverified" ? 20 : 0;
    const emailScore = c.email ? 20 : 0;
    const linkedinScore = c.linkedin ? 10 : 0;
    const confScore = c.confidenceScore === "high" ? 15 : c.confidenceScore === "medium" ? 8 : 3;
    const relScore = c.roleRelevance === "high" ? 15 : c.roleRelevance === "medium" ? 8 : 3;
    const laneBonus = roleLane === "primary" ? 10 : roleLane === "commercial" ? 5 : roleLane === "technical" ? 5 : 0;

    return { ...c, roleLane, compositeScore: tierScore + emailScore + linkedinScore + confScore + relScore + laneBonus };
  });

  const allSorted = [...scored].sort((a, b) => b.compositeScore - a.compositeScore);
  const primaryLane = allSorted.filter(c => c.roleLane === "primary");
  const commercialLane = allSorted.filter(c => c.roleLane === "commercial");
  const technicalLane = allSorted.filter(c => c.roleLane === "technical");

  const usedIds = new Set();
  const primary = primaryLane[0] || allSorted[0] || null;
  if (primary) usedIds.add(primary.id);
  const commercial = commercialLane.find(c => !usedIds.has(c.id)) || null;
  if (commercial) usedIds.add(commercial.id);
  const technical = technicalLane.find(c => !usedIds.has(c.id)) || null;
  if (technical) usedIds.add(technical.id);
  const backupPool = allSorted.filter(c => !usedIds.has(c.id));
  const backup1 = backupPool[0] || null;
  if (backup1) usedIds.add(backup1.id);
  const backup2 = backupPool[1] || null;

  const filled = [primary, backup1, backup2, commercial, technical].filter(Boolean);
  const sendReadySlots = filled.filter(c => c.contactTrustTier === "send_ready").length;
  const namedUnverifiedSlots = filled.filter(c => c.contactTrustTier === "named_unverified").length;
  const llmSlots = filled.filter(c => c.contactTrustTier === "llm_inferred").length;

  // Upsert slate in DB
  await connection.execute(`
    DELETE FROM contactCandidateSlates WHERE projectId = ?
  `, [p.id]);

  const toSnap = (c, lane) => c ? JSON.stringify({
    contactId: c.id, name: c.name, title: c.title, company: c.company,
    email: c.email, linkedin: c.linkedin, enrichmentSource: c.enrichmentSource || "unknown",
    contactTrustTier: c.contactTrustTier, confidenceScore: c.confidenceScore || "medium",
    roleRelevance: c.roleRelevance || "medium", roleLane: lane,
  }) : null;

  await connection.execute(`
    INSERT INTO contactCandidateSlates
      (projectId, primaryContactId, backup1ContactId, backup2ContactId,
       commercialContactId, technicalContactId,
       primarySnapshot, backup1Snapshot, backup2Snapshot,
       commercialSnapshot, technicalSnapshot,
       totalSlotsFilled, sendReadySlots, namedUnverifiedSlots, llmSlots,
       sourcesUsed, generatedAt, generatedBy, isStale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'waterfall_engine', 0)
  `, [
    p.id,
    primary?.id || null, backup1?.id || null, backup2?.id || null,
    commercial?.id || null, technical?.id || null,
    toSnap(primary, "primary"), toSnap(backup1, "backup"), toSnap(backup2, "backup"),
    toSnap(commercial, "commercial"), toSnap(technical, "technical"),
    filled.length, sendReadySlots, namedUnverifiedSlots, llmSlots,
    JSON.stringify([...new Set(filled.map(c => c.enrichmentSource || "unknown"))]),
  ]);

  const slotSummary = `primary=${primary?.name||"—"} (${primary?.contactTrustTier||"none"}) | commercial=${commercial?.name||"—"} | technical=${technical?.name||"—"} | backup1=${backup1?.name||"—"} | backup2=${backup2?.name||"—"}`;
  console.log(`  ✓ ${p.name}: ${filled.length} slots filled (send_ready=${sendReadySlots} named_unverified=${namedUnverifiedSlots} llm=${llmSlots})`);
  console.log(`    ${slotSummary}`);

  slateResults.push({ project: p, slate: { primary, backup1, backup2, commercial, technical, sendReadySlots, namedUnverifiedSlots, llmSlots }, contactCount: contacts.length });
}

// ── Step 4: Hunter verification on named_unverified contacts ──
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
if (!HUNTER_API_KEY) {
  console.log("\n⚠️  HUNTER_API_KEY not set — skipping Hunter verification step");
} else {
  console.log("\n=== Running Hunter verification on named_unverified contacts ===\n");
  let totalPromoted = 0, totalEmailsFound = 0, totalSkipped = 0;

  for (const p of demotedProjects) {
    const [unverifiedRows] = await connection.execute(`
      SELECT c.id, c.name, c.title, c.company, c.email
      FROM contacts c
      JOIN contactProjects cp ON cp.contactId = c.id
      WHERE cp.projectId = ?
        AND c.contactTrustTier = 'named_unverified'
        AND (c.enrichmentSource != 'llm' OR c.enrichmentSource IS NULL)
      ORDER BY
        CASE c.roleRelevance WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
      LIMIT 5
    `, [p.id]);

    const unverified = Array.isArray(unverifiedRows) ? unverifiedRows : [];
    if (unverified.length === 0) {
      console.log(`  ${p.name}: no named_unverified contacts to verify`);
      continue;
    }

    console.log(`  ${p.name}: verifying ${unverified.length} contacts...`);

    for (const c of unverified) {
      await new Promise(r => setTimeout(r, 600)); // rate limit

      // If contact already has email, just verify it
      if (c.email) {
        try {
          const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(c.email)}&api_key=${HUNTER_API_KEY}`;
          const res = await fetch(url);
          const data = await res.json();
          const status = data?.data?.status;
          const score = data?.data?.score;

          if (status === "valid" || (score && score >= 70)) {
            await connection.execute(`
              UPDATE contacts SET contactTrustTier = 'send_ready', emailVerified = 1 WHERE id = ?
            `, [c.id]);
            console.log(`    ✓ ${c.name} (${c.email}): verified → promoted to send_ready (score=${score})`);
            totalPromoted++;
          } else {
            console.log(`    ✗ ${c.name} (${c.email}): status=${status} score=${score} — kept named_unverified`);
            totalSkipped++;
          }
        } catch (err) {
          console.log(`    ✗ ${c.name}: Hunter verifier error — ${err.message}`);
        }
      } else if (c.company) {
        // No email — try Hunter email finder
        try {
          const nameParts = (c.name || "").trim().split(/\s+/);
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";
          // Extract domain from company name (best effort)
          const companySlug = (c.company || "").toLowerCase()
            .replace(/\s+(pty|ltd|limited|inc|corp|group|australia|au)\b.*/g, "")
            .replace(/[^a-z0-9]+/g, "")
            .trim();

          if (!firstName || !lastName || !companySlug) {
            console.log(`    ⚠️  ${c.name}: insufficient data for Hunter finder — skipping`);
            totalSkipped++;
            continue;
          }

          const url = `https://api.hunter.io/v2/email-finder?company=${encodeURIComponent(c.company)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${HUNTER_API_KEY}`;
          const res = await fetch(url);
          const data = await res.json();
          const email = data?.data?.email;
          const score = data?.data?.score;

          if (email && score && score >= 70) {
            await connection.execute(`
              UPDATE contacts SET email = ?, emailVerified = 1, contactTrustTier = 'send_ready' WHERE id = ?
            `, [email, c.id]);
            console.log(`    ✓ ${c.name}: found email ${email} (score=${score}) → promoted to send_ready`);
            totalEmailsFound++;
            totalPromoted++;
          } else if (email) {
            await connection.execute(`
              UPDATE contacts SET email = ? WHERE id = ?
            `, [email, c.id]);
            console.log(`    ~ ${c.name}: found email ${email} (score=${score}) — low confidence, kept named_unverified`);
            totalSkipped++;
          } else {
            console.log(`    ✗ ${c.name}: no email found by Hunter`);
            totalSkipped++;
          }
        } catch (err) {
          console.log(`    ✗ ${c.name}: Hunter finder error — ${err.message}`);
        }
      }
    }
  }

  console.log(`\n  Hunter summary: promoted=${totalPromoted} emails_found=${totalEmailsFound} skipped/failed=${totalSkipped}`);
}

// ── Step 5: Final coverage report ──
console.log("\n=== Final coverage after slate generation + Hunter ===\n");
let totalSendReady = 0, totalNamedUnverified = 0, totalLlm = 0;
for (const p of demotedProjects) {
  const [rows] = await connection.execute(`
    SELECT c.contactTrustTier, COUNT(*) as cnt
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    WHERE cp.projectId = ?
    GROUP BY c.contactTrustTier
  `, [p.id]);
  const tierMap = {};
  (Array.isArray(rows) ? rows : []).forEach(r => { tierMap[r.contactTrustTier] = r.cnt; });
  const sr = tierMap.send_ready || 0;
  const nu = tierMap.named_unverified || 0;
  const llm = tierMap.llm_inferred || 0;
  totalSendReady += sr;
  totalNamedUnverified += nu;
  totalLlm += llm;
  const status = sr > 0 ? "✓ HAS SEND_READY" : nu > 0 ? "~ named_unverified only" : "✗ no contacts";
  console.log(`  ${p.name}: ${status} (send_ready=${sr} named_unverified=${nu} llm=${llm})`);
}
console.log(`\n  TOTALS: send_ready=${totalSendReady} named_unverified=${totalNamedUnverified} llm=${totalLlm}`);
console.log("\n=== Done ===\n");

await connection.end();
