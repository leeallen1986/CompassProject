/**
 * Ryan Before/After: Compare the old contact selection (local scoring)
 * vs the new shared selector for his top WA projects.
 */
import { getDb, getActiveProjects, getAllContacts } from "../server/db";
import { selectProjectContact, type ContactInput } from "../server/contactSelector";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // Get Ryan's profile territories
  const [ryanRows] = await db.execute(sql`
    SELECT u.id, u.name, up.territories, up.assignedBusinessLines, up.buyerRoles
    FROM users u
    JOIN userProfiles up ON up.userId = u.id
    WHERE u.name LIKE '%Ryan%'
    LIMIT 1
  `);
  const ryanProfile = (ryanRows as any[])[0];
  console.log("Ryan profile:", JSON.stringify(ryanProfile, null, 2));

  // Get top 10 WA projects by PA score
  const [topRows] = await db.execute(sql`
    SELECT p.id, p.name, p.owner, p.projectState, p.location,
           pbs.score as paScore
    FROM projects p
    JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
    WHERE p.projectState = 'WA'
      AND p.lifecycleStatus = 'active'
      AND p.suppressed = 0
      AND pbs.scoringDimension = 'Portable Air'
      AND pbs.score >= 70
    ORDER BY pbs.score DESC
    LIMIT 10
  `);
  const topProjects = topRows as any[];

  console.log("\n=== RYAN TOP-10 WA PROJECTS: BEFORE vs AFTER ===\n");
  console.log("| # | PA | Project | OLD Contact (local scoring) | NEW Contact (shared selector) | Match? |");
  console.log("|---|---|---|---|---|---|");

  const allContacts = await getAllContacts();

  for (let i = 0; i < (topProjects as any[]).length; i++) {
    const p = (topProjects as any[])[i];

    // Get contacts for this project via junction table
    const [contactRows] = await db.execute(sql`
      SELECT c.* FROM contacts c
      JOIN contactProjects cp ON cp.contactId = c.id
      WHERE cp.projectId = ${p.id}
    `);
    const projectContacts = contactRows as any[];

    // OLD method: simple trust tier + first match
    const oldSendReady = (projectContacts as any[])
      .filter((c: any) => c.contactTrustTier === "send_ready" && (c.roleRelevance === "high" || c.roleRelevance === "medium"))
      .sort((a: any, b: any) => {
        const relOrder: Record<string, number> = { high: 2, medium: 1, low: 0 };
        return (relOrder[b.roleRelevance] ?? 0) - (relOrder[a.roleRelevance] ?? 0);
      });
    const oldContact = oldSendReady[0] ?? (projectContacts as any[]).find((c: any) => c.contactTrustTier === "send_ready") ?? null;

    // NEW method: shared selector
    const newResult = selectProjectContact(projectContacts as unknown as ContactInput[], {
      projectName: p.name,
      projectOwner: p.owner ?? "",
      projectState: p.projectState ?? null,
    });
    const newContact = newResult.selectedContact;

    const oldLabel = oldContact ? `${oldContact.name} (${oldContact.title ?? oldContact.roleBucket})` : "—";
    const newLabel = newContact ? `${newContact.name} (${newContact.title})` : "—";
    const match = (oldContact?.id === newContact?.id) ? "✓" : "✗ CHANGED";

    console.log(`| ${i + 1} | ${p.paScore} | ${p.name.substring(0, 40)} | ${oldLabel.substring(0, 35)} | ${newLabel.substring(0, 35)} | ${match} |`);
  }

  // Also show the whySelected and routeToBuy for changed contacts
  console.log("\n\n=== DETAILED CHANGES ===\n");
  for (let i = 0; i < (topProjects as any[]).length; i++) {
    const p = (topProjects as any[])[i];
    const [contactRows2] = await db.execute(sql`
      SELECT c.* FROM contacts c
      JOIN contactProjects cp ON cp.contactId = c.id
      WHERE cp.projectId = ${p.id}
    `);
    const projectContacts2 = contactRows2 as any[];

    const oldSendReady = (projectContacts2 as any[])
      .filter((c: any) => c.contactTrustTier === "send_ready" && (c.roleRelevance === "high" || c.roleRelevance === "medium"))
      .sort((a: any, b: any) => {
        const relOrder: Record<string, number> = { high: 2, medium: 1, low: 0 };
        return (relOrder[b.roleRelevance] ?? 0) - (relOrder[a.roleRelevance] ?? 0);
      });
    const oldContact = oldSendReady[0] ?? (projectContacts2 as any[]).find((c: any) => c.contactTrustTier === "send_ready") ?? null;

    const newResult = selectProjectContact(projectContacts2 as unknown as ContactInput[], {
      projectName: p.name,
      projectOwner: p.owner ?? "",
      projectState: p.projectState ?? null,
    });
    const newContact = newResult.selectedContact;

    if (oldContact?.id !== newContact?.id) {
      console.log(`\n[${p.name}]`);
      console.log(`  OLD: ${oldContact ? `${oldContact.name}, ${oldContact.title} @ ${oldContact.company}` : "none"}`);
      console.log(`  NEW: ${newContact ? `${newContact.name}, ${newContact.title} @ ${newContact.company}` : "none"}`);
      console.log(`  WHY: ${newResult.whySelected}`);
      console.log(`  ROUTE: ${newResult.routeToBuy}`);
      console.log(`  READINESS: ${newResult.salesReadiness}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
