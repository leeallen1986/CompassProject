import 'dotenv/config';
import { getDb } from './server/db';
import { users, userProfiles, projects, contacts, contactProjects, projectValidationGates, weeklyReports } from './drizzle/schema';
import { eq, inArray, and, desc } from 'drizzle-orm';
import { sendWeeklyDigests } from './server/emailDigest';

async function main() {
  const db = await getDb();
  if (!db) { console.error('No DB'); process.exit(1); }

  // Confirm all 5 gated projects
  const gated = await db.select({
    projectId: projectValidationGates.projectId,
    digestSafe: projectValidationGates.digestSafe,
  }).from(projectValidationGates).where(eq(projectValidationGates.digestSafe, true));

  console.log(`\n=== GATED DIGEST-SAFE PROJECTS (${gated.length} total) ===`);
  if (gated.length > 0) {
    const gatedIds = gated.map(g => g.projectId);
    const gatedProjects = await db.select({ id: projects.id, name: projects.name, projectState: projects.projectState, priority: projects.priority })
      .from(projects).where(inArray(projects.id, gatedIds));
    for (const p of gatedProjects) {
      console.log(`  ✓ ID ${p.id}: ${p.name} | state=${p.projectState} | priority=${p.priority}`);
    }
  }

  // Run dry-run for both WA users
  console.log('\n=== RUNNING FINAL DRY-RUN PREVIEW ===');
  const result = await sendWeeklyDigests({ dryRun: true, territory: 'WA' });

  console.log(`\nDry-run complete: sent=${result.sent}, skipped=${result.skipped}, failed=${result.failed}`);

  if (result.previews && result.previews.length > 0) {
    for (const preview of result.previews) {
      const userId = (preview as any).userId;
      const subject = (preview as any).subject || '';
      const mustActItems: string[] = (preview as any).mustActItems || [];
      const closingSoonItems: string[] = (preview as any).closingSoonItems || [];
      const waitingItems: string[] = (preview as any).waitingItems || [];
      const allProjectNames: string[] = (preview as any).allProjectNames || [];

      // Load user name
      const userRow = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      const userName = userRow[0]?.name || `User ${userId}`;

      // Load user profile
      const profileRow = await db.select({
        assignedBusinessLines: userProfiles.assignedBusinessLines,
        ptLaneFocus: userProfiles.ptLaneFocus,
        territories: userProfiles.territories,
      }).from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
      const profile = profileRow[0];

      console.log(`\n${'='.repeat(70)}`);
      console.log(`USER: ${userName} (ID ${userId})`);
      console.log(`BL: ${JSON.stringify(profile?.assignedBusinessLines)} | Lane: ${profile?.ptLaneFocus} | Territory: ${JSON.stringify(profile?.territories)}`);
      console.log(`Subject: ${subject}`);
      console.log(`\n--- MUST ACT THIS WEEK ---`);
      if (mustActItems.length === 0) {
        // Parse from HTML content
        const html = (preview as any).html || '';
        const mustActMatches = html.match(/Must Act This Week[\s\S]*?(?=Closing Soon|Waiting on|$)/i);
        if (mustActMatches) {
          // Extract project names from the section
          const projectNameMatches = mustActMatches[0].match(/<h[23][^>]*>([^<]{10,80})<\/h[23]>/g);
          if (projectNameMatches) {
            projectNameMatches.forEach((m: string) => {
              const name = m.replace(/<[^>]+>/g, '').trim();
              if (name && name.length > 5) console.log(`  • ${name}`);
            });
          }
        }
      } else {
        mustActItems.forEach(i => console.log(`  • ${i}`));
      }

      console.log(`\n--- CLOSING SOON ---`);
      if (closingSoonItems.length === 0) {
        const html = (preview as any).html || '';
        const closingMatches = html.match(/Closing Soon[\s\S]*?(?=Waiting on|Must Act|$)/i);
        if (closingMatches) {
          const projectNameMatches = closingMatches[0].match(/<strong>([^<]{10,80})<\/strong>/g);
          if (projectNameMatches) {
            projectNameMatches.slice(0, 5).forEach((m: string) => {
              const name = m.replace(/<[^>]+>/g, '').trim();
              if (name && name.length > 5) console.log(`  • ${name}`);
            });
          }
        }
      } else {
        closingSoonItems.forEach(i => console.log(`  • ${i}`));
      }

      console.log(`\n--- WAITING ON CONTACT DISCOVERY ---`);
      if (waitingItems.length === 0) {
        const html = (preview as any).html || '';
        const waitingMatches = html.match(/Waiting on Contact Discovery[\s\S]*?(?=<\/table>|$)/i);
        if (waitingMatches) {
          const projectNameMatches = waitingMatches[0].match(/<strong>([^<]{10,80})<\/strong>/g);
          if (projectNameMatches) {
            projectNameMatches.slice(0, 5).forEach((m: string) => {
              const name = m.replace(/<[^>]+>/g, '').trim();
              if (name && name.length > 5) console.log(`  • ${name}`);
            });
          }
        }
      } else {
        waitingItems.forEach(i => console.log(`  • ${i}`));
      }

      // Territory contamination check
      const html = (preview as any).html || '';
      const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const nswContam = /\bNSW\b/.test(textContent) || /New South Wales/i.test(textContent);
      const vicContam = /\bVIC\b/.test(textContent) || /Victoria(?! University| St| Ave| Rd| Street)/i.test(textContent);
      const nationalContam = /\bNational\b.*(?:portfolio|partnering|program)/i.test(textContent);
      const bannedSections = /Discovery Needed|Top 3 Priority Projects This Week|New Stakeholder Discoveries/i.test(textContent);

      console.log(`\n--- TERRITORY CONTAMINATION CHECKS ---`);
      console.log(`  NSW contamination: ${nswContam ? '❌ FOUND' : '✓ CLEAN'}`);
      console.log(`  VIC contamination: ${vicContam ? '❌ FOUND' : '✓ CLEAN'}`);
      console.log(`  National portfolio contamination: ${nationalContam ? '❌ FOUND' : '✓ CLEAN'}`);
      console.log(`  Banned sections present: ${bannedSections ? '❌ FOUND' : '✓ CLEAN'}`);

      // Save HTML for inspection
      const fs = await import('fs');
      const outPath = `/tmp/final-preview-${userId}.html`;
      fs.writeFileSync(outPath, html);
      console.log(`  HTML saved to: ${outPath}`);
    }
  } else {
    // No previews array — parse from result
    console.log('No previews array in result. Full result:', JSON.stringify(result, null, 2).slice(0, 2000));
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
