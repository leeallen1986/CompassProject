/**
 * Run enrichment on the 4 zero-contact top projects.
 * Uses the same discoverAndSaveStakeholders function as the enrichProject endpoint.
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { discoverAndSaveStakeholders } from "../server/webStakeholderDiscovery";
import { generateAndSaveLLMContacts } from "../server/llmContactFallback";

const TARGET_IDS = [690023, 690026, 690028, 690030];

async function main() {
  const db = await getDb();

  // Get project details
  const [projects] = await db.execute(sql`
    SELECT id, reportId, name, owner, contractors, sector, location, value, stage, projectState
    FROM projects
    WHERE id IN (${sql.raw(TARGET_IDS.join(","))})
  `);

  console.log(`Found ${(projects as any[]).length} projects to enrich\n`);

  for (const project of projects as any[]) {
    console.log(`\n${"═".repeat(80)}`);
    console.log(`ENRICHING: ${project.name} (ID: ${project.id})`);
    console.log(`  Owner: ${project.owner || "Unknown"} | State: ${project.projectState || "Unknown"} | Sector: ${project.sector}`);
    console.log(`${"═".repeat(80)}`);

    // Parse contractors
    let contractorsList: { name: string; status: string }[] = [];
    try {
      const raw = typeof project.contractors === "string" ? JSON.parse(project.contractors) : (project.contractors || []);
      contractorsList = Array.isArray(raw) ? raw : [];
    } catch { contractorsList = []; }

    // Step 1: Web stakeholder discovery
    let webContactCount = 0;
    try {
      const webResult = await discoverAndSaveStakeholders({
        id: project.id,
        reportId: project.reportId,
        name: project.name,
        owner: project.owner || "Unknown",
        contractors: contractorsList,
        sector: project.sector || "infrastructure",
        location: project.location || project.projectState || "Australia",
        value: project.value || undefined,
        stage: project.stage || undefined,
      });
      webContactCount = webResult.contacts.length;
      console.log(`  ✅ Web discovery: ${webContactCount} contacts found`);
      for (const c of webResult.contacts.slice(0, 5)) {
        console.log(`     - ${c.name}, ${c.title} @ ${c.company} [${c.contactTrustTier || "unknown"}]`);
      }
    } catch (err: any) {
      console.log(`  ❌ Web discovery failed: ${err.message}`);
    }

    // Step 2: If web search returned 0, try LLM fallback
    if (webContactCount === 0) {
      console.log(`  → Trying LLM fallback...`);
      try {
        const llmResult = await generateAndSaveLLMContacts(
          project.id,
          project.reportId,
          project.name,
          project.owner || "Unknown",
          contractorsList,
          project.sector || "infrastructure",
          project.value || "Unknown",
          project.location || project.projectState || "Australia",
          project.stage || undefined,
          null, // no preferred roles
        );
        console.log(`  ✅ LLM fallback: ${llmResult.contactsGenerated} contacts generated`);
        if (llmResult.note) console.log(`     Note: ${llmResult.note}`);
        for (const c of llmResult.contacts.slice(0, 5)) {
          console.log(`     - ${c.name}, ${c.title} [confidence: ${c.confidence}]`);
        }
      } catch (llmErr: any) {
        console.log(`  ❌ LLM fallback also failed: ${llmErr.message}`);
      }
    }
  }

  // Final check: verify contacts now exist
  console.log(`\n\n${"═".repeat(80)}`);
  console.log(`POST-ENRICHMENT CONTACT CHECK`);
  console.log(`${"═".repeat(80)}`);

  const [postCheck] = await db.execute(sql`
    SELECT p.id, p.name,
      COUNT(c.id) as totalContacts,
      SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as sendReady,
      SUM(CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1 ELSE 0 END) as namedUnverified
    FROM projects p
    LEFT JOIN contacts c ON LOWER(c.project) = LOWER(p.name) AND c.contactTrustTier IN ('send_ready', 'named_unverified')
    WHERE p.id IN (${sql.raw(TARGET_IDS.join(","))})
    GROUP BY p.id, p.name
  `);

  for (const r of postCheck as any[]) {
    const status = Number(r.sendReady) > 0 ? "✅ SEND_READY" : Number(r.totalContacts) > 0 ? "⚠️ NAMED_UNVERIFIED" : "❌ NO_CONTACT";
    console.log(`  ${status} | ${r.name} — ${r.totalContacts} contacts (${r.sendReady} send_ready, ${r.namedUnverified} named_unverified)`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
