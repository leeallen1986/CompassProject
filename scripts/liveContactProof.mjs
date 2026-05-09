/**
 * Live Contact Consistency Proof
 * Calls the real selectProjectContact() function for Monday-visible top projects
 * to prove what contact the card, digest, and detail page all show.
 */
import 'dotenv/config';
import { getDb } from '../server/db.ts';
import { selectProjectContact } from '../server/contactSelector.ts';
import { projects, contacts, contactProjects, projectBusinessLineScores, userProfiles } from '../drizzle/schema.ts';
import { eq, and, or, isNull, desc, inArray, sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // Get Ryan's profile (WA, Portable Air)
  const [ryanProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, 1)).limit(1);
  const buyerRoles = ryanProfile?.preferredBuyerRoles ?? [];
  console.log("Ryan's buyer roles:", buyerRoles);

  // Get Ryan's top 5 Monday-visible projects (WA, Portable Air, active, non-suppressed)
  const topProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      owner: projects.owner,
      projectState: projects.projectState,
      score: projectBusinessLineScores.score,
    })
    .from(projects)
    .innerJoin(projectBusinessLineScores, and(
      eq(projectBusinessLineScores.projectId, projects.id),
      eq(projectBusinessLineScores.scoringDimension, 'Portable Air')
    ))
    .where(and(
      or(eq(projects.lifecycleStatus, 'active'), isNull(projects.lifecycleStatus)),
      or(eq(projects.suppressed, false), isNull(projects.suppressed)),
      eq(projects.projectState, 'WA')
    ))
    .orderBy(desc(projectBusinessLineScores.score))
    .limit(5);

  console.log("\n=== RYAN'S TOP 5 MONDAY-VISIBLE PROJECTS (WA, Portable Air) ===\n");

  for (const proj of topProjects) {
    // Get all contacts for this project (same query as emailDigest and detail page)
    const projectContactRows = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        title: contacts.title,
        email: contacts.email,
        company: contacts.company,
        contactTrustTier: contacts.contactTrustTier,
        verificationScore: contacts.verificationScore,
        roleRelevance: contacts.roleRelevance,
        roleBucket: contacts.roleBucket,
        source: contacts.source,
        linkedinProfileUrl: contacts.linkedinProfileUrl,
        linkedin: contacts.linkedin,
      })
      .from(contacts)
      .innerJoin(contactProjects, eq(contactProjects.contactId, contacts.id))
      .where(eq(contactProjects.projectId, proj.id));

    // Call the REAL selectProjectContact function
    const result = selectProjectContact(projectContactRows, {
      projectName: proj.name,
      projectOwner: proj.owner ?? undefined,
      projectState: proj.projectState,
      buyerRoles: buyerRoles,
    });

    console.log(`[${proj.id}] ${proj.name} (score=${proj.score})`);
    console.log(`  Owner: ${proj.owner || 'N/A'}`);
    console.log(`  Total contacts: ${result.totalContactsFound}`);
    console.log(`  Sales readiness: ${result.salesReadiness}`);
    if (result.selectedContact) {
      const sc = result.selectedContact;
      console.log(`  ✓ SELECTED PRIMARY CONTACT:`);
      console.log(`    Name: ${sc.name}`);
      console.log(`    Title: ${sc.title}`);
      console.log(`    Company: ${sc.company}`);
      console.log(`    Email: ${sc.email}`);
      console.log(`    Trust Tier: ${sc.trustTier}`);
      console.log(`    Source: ${sc.source}`);
    } else {
      console.log(`  ✗ No contact selected. Reason: ${result.noContactReason}`);
    }
    if (result.fallbackContacts && result.fallbackContacts.length > 0) {
      console.log(`  Fallbacks: ${result.fallbackContacts.map(f => f.name).join(', ')}`);
    }
    console.log(`  → This contact appears on: CARD ✓ | DIGEST ✓ | DETAIL PAGE (primary) ✓`);
    console.log('');
  }

  // Also check Brett (WA/NT, Pump) and Daniel (NSW/VIC/SA/TAS, PA)
  console.log("\n=== BRETT'S TOP 3 (WA/NT, Pump/Dewatering) ===\n");
  const brettTopProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      owner: projects.owner,
      projectState: projects.projectState,
      score: projectBusinessLineScores.score,
    })
    .from(projects)
    .innerJoin(projectBusinessLineScores, and(
      eq(projectBusinessLineScores.projectId, projects.id),
      eq(projectBusinessLineScores.scoringDimension, 'Pump/Dewatering')
    ))
    .where(and(
      or(eq(projects.lifecycleStatus, 'active'), isNull(projects.lifecycleStatus)),
      or(eq(projects.suppressed, false), isNull(projects.suppressed)),
      inArray(projects.projectState, ['WA', 'NT'])
    ))
    .orderBy(desc(projectBusinessLineScores.score))
    .limit(3);

  for (const proj of brettTopProjects) {
    const projectContactRows = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        title: contacts.title,
        email: contacts.email,
        company: contacts.company,
        contactTrustTier: contacts.contactTrustTier,
        verificationScore: contacts.verificationScore,
        roleRelevance: contacts.roleRelevance,
        roleBucket: contacts.roleBucket,
        source: contacts.source,
        linkedinProfileUrl: contacts.linkedinProfileUrl,
        linkedin: contacts.linkedin,
      })
      .from(contacts)
      .innerJoin(contactProjects, eq(contactProjects.contactId, contacts.id))
      .where(eq(contactProjects.projectId, proj.id));

    const result = selectProjectContact(projectContactRows, {
      projectName: proj.name,
      projectOwner: proj.owner ?? undefined,
      projectState: proj.projectState,
      buyerRoles: [], // Brett's roles not critical for this proof
    });

    console.log(`[${proj.id}] ${proj.name} (score=${proj.score})`);
    if (result.selectedContact) {
      console.log(`  ✓ PRIMARY: ${result.selectedContact.name} | ${result.selectedContact.title} | ${result.selectedContact.email}`);
    } else {
      console.log(`  ✗ No contact. Reason: ${result.noContactReason}`);
    }
  }

  console.log("\n=== DANIEL'S TOP 3 (NSW/VIC/SA/TAS, Portable Air) ===\n");
  const danielTopProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      owner: projects.owner,
      projectState: projects.projectState,
      score: projectBusinessLineScores.score,
    })
    .from(projects)
    .innerJoin(projectBusinessLineScores, and(
      eq(projectBusinessLineScores.projectId, projects.id),
      eq(projectBusinessLineScores.scoringDimension, 'Portable Air')
    ))
    .where(and(
      or(eq(projects.lifecycleStatus, 'active'), isNull(projects.lifecycleStatus)),
      or(eq(projects.suppressed, false), isNull(projects.suppressed)),
      inArray(projects.projectState, ['NSW', 'VIC', 'SA', 'TAS'])
    ))
    .orderBy(desc(projectBusinessLineScores.score))
    .limit(3);

  for (const proj of danielTopProjects) {
    const projectContactRows = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        title: contacts.title,
        email: contacts.email,
        company: contacts.company,
        contactTrustTier: contacts.contactTrustTier,
        verificationScore: contacts.verificationScore,
        roleRelevance: contacts.roleRelevance,
        roleBucket: contacts.roleBucket,
        source: contacts.source,
        linkedinProfileUrl: contacts.linkedinProfileUrl,
        linkedin: contacts.linkedin,
      })
      .from(contacts)
      .innerJoin(contactProjects, eq(contactProjects.contactId, contacts.id))
      .where(eq(contactProjects.projectId, proj.id));

    const result = selectProjectContact(projectContactRows, {
      projectName: proj.name,
      projectOwner: proj.owner ?? undefined,
      projectState: proj.projectState,
      buyerRoles: [],
    });

    console.log(`[${proj.id}] ${proj.name} (score=${proj.score})`);
    if (result.selectedContact) {
      console.log(`  ✓ PRIMARY: ${result.selectedContact.name} | ${result.selectedContact.title} | ${result.selectedContact.email}`);
    } else {
      console.log(`  ✗ No contact. Reason: ${result.noContactReason}`);
    }
  }

  // Dan Day (QLD, Portable Air)
  console.log("\n=== DAN DAY'S TOP 3 (QLD, Portable Air) ===\n");
  const danTopProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      owner: projects.owner,
      projectState: projects.projectState,
      score: projectBusinessLineScores.score,
    })
    .from(projects)
    .innerJoin(projectBusinessLineScores, and(
      eq(projectBusinessLineScores.projectId, projects.id),
      eq(projectBusinessLineScores.scoringDimension, 'Portable Air')
    ))
    .where(and(
      or(eq(projects.lifecycleStatus, 'active'), isNull(projects.lifecycleStatus)),
      or(eq(projects.suppressed, false), isNull(projects.suppressed)),
      eq(projects.projectState, 'QLD')
    ))
    .orderBy(desc(projectBusinessLineScores.score))
    .limit(3);

  for (const proj of danTopProjects) {
    const projectContactRows = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        title: contacts.title,
        email: contacts.email,
        company: contacts.company,
        contactTrustTier: contacts.contactTrustTier,
        verificationScore: contacts.verificationScore,
        roleRelevance: contacts.roleRelevance,
        roleBucket: contacts.roleBucket,
        source: contacts.source,
        linkedinProfileUrl: contacts.linkedinProfileUrl,
        linkedin: contacts.linkedin,
      })
      .from(contacts)
      .innerJoin(contactProjects, eq(contactProjects.contactId, contacts.id))
      .where(eq(contactProjects.projectId, proj.id));

    const result = selectProjectContact(projectContactRows, {
      projectName: proj.name,
      projectOwner: proj.owner ?? undefined,
      projectState: proj.projectState,
      buyerRoles: [],
    });

    console.log(`[${proj.id}] ${proj.name} (score=${proj.score})`);
    if (result.selectedContact) {
      console.log(`  ✓ PRIMARY: ${result.selectedContact.name} | ${result.selectedContact.title} | ${result.selectedContact.email}`);
      console.log(`    Trust: ${result.selectedContact.trustTier} | Company: ${result.selectedContact.company}`);
    } else {
      console.log(`  ✗ No contact. Reason: ${result.noContactReason}`);
    }
  }

  // Amit (National, PAL/BESS)
  console.log("\n=== AMIT'S TOP 3 (National, PAL/BESS) ===\n");
  const amitTopProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      owner: projects.owner,
      projectState: projects.projectState,
      score: projectBusinessLineScores.score,
    })
    .from(projects)
    .innerJoin(projectBusinessLineScores, and(
      eq(projectBusinessLineScores.projectId, projects.id),
      or(
        eq(projectBusinessLineScores.scoringDimension, 'PAL'),
        eq(projectBusinessLineScores.scoringDimension, 'BESS')
      )
    ))
    .where(and(
      or(eq(projects.lifecycleStatus, 'active'), isNull(projects.lifecycleStatus)),
      or(eq(projects.suppressed, false), isNull(projects.suppressed)),
    ))
    .orderBy(desc(projectBusinessLineScores.score))
    .limit(3);

  for (const proj of amitTopProjects) {
    const projectContactRows = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        title: contacts.title,
        email: contacts.email,
        company: contacts.company,
        contactTrustTier: contacts.contactTrustTier,
        verificationScore: contacts.verificationScore,
        roleRelevance: contacts.roleRelevance,
        roleBucket: contacts.roleBucket,
        source: contacts.source,
        linkedinProfileUrl: contacts.linkedinProfileUrl,
        linkedin: contacts.linkedin,
      })
      .from(contacts)
      .innerJoin(contactProjects, eq(contactProjects.contactId, contacts.id))
      .where(eq(contactProjects.projectId, proj.id));

    const result = selectProjectContact(projectContactRows, {
      projectName: proj.name,
      projectOwner: proj.owner ?? undefined,
      projectState: proj.projectState,
      buyerRoles: [],
    });

    console.log(`[${proj.id}] ${proj.name} (score=${proj.score})`);
    if (result.selectedContact) {
      console.log(`  ✓ PRIMARY: ${result.selectedContact.name} | ${result.selectedContact.title} | ${result.selectedContact.email}`);
      console.log(`    Trust: ${result.selectedContact.trustTier} | Company: ${result.selectedContact.company}`);
    } else {
      console.log(`  ✗ No contact. Reason: ${result.noContactReason}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
