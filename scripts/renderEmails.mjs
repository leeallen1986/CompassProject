/**
 * renderEmails.mjs — v2 (post-fix)
 * Uses the now-exported buildEmailSignals with all 6 fixes applied.
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
process.chdir(projectRoot);
import dotenv from "dotenv";
dotenv.config({ path: join(projectRoot, ".env") });

const {
  sendWeeklyDigestsForUser,
  scoreAndFilterProjects,
  classifyBriefReadiness,
  buildEmailSignals,
} = await import("../server/emailDigest.ts");
const { buildDigestEmailHtml, buildDigestEmailText } = await import("../server/emailTemplate.ts");
const { getDb, getActiveProjects, getAllContacts, getLatestReport, getLatestPipelineRun } = await import("../server/db.ts");
const { resolveTerritories } = await import("../server/canonicalMappings.ts");

const OUTPUT_DIR = join(projectRoot, "docs", "email-renders");
mkdirSync(OUTPUT_DIR, { recursive: true });

const REPS = [
  { name: "Ryan_Pemberton",  userId: 2340043 },
  { name: "Brett_Hansen",    userId: 2550006 },
  { name: "Daniel_Zec",      userId: 2820073 },
  { name: "Dan_Day",         userId: 3630009 },
  { name: "Amit_Bhargava",   userId: 3870014 },
];

console.log("=== Email Render Script v2 (post-fix) ===\n");

const allProjects = await getActiveProjects();
const allContacts = await getAllContacts();
const report = await getLatestReport();
const latestRun = await getLatestPipelineRun();
const db = await getDb();
const { users: usersTable, userProfiles: userProfilesTable } = await import("../drizzle/schema.ts");
const { eq } = await import("drizzle-orm");

console.log(`Loaded: ${allProjects.length} projects, ${allContacts.length} contacts`);
console.log(`Report week: ${report?.weekEnding}`);

const summary = [];

for (const rep of REPS) {
  console.log(`\n--- Processing ${rep.name} (userId=${rep.userId}) ---`);
  try {
    // Admin preview (markdown)
    const preview = await sendWeeklyDigestsForUser(rep.userId);
    if (!preview) { console.warn(`  ⚠ No preview for ${rep.name}`); continue; }
    console.log(`  ✓ Subject: ${preview.subject}`);
    writeFileSync(join(OUTPUT_DIR, `${rep.name}-preview.txt`),
      `SUBJECT: ${preview.subject}\n\nADMIN PREVIEW (markdown shown in <pre>)\n${"=".repeat(60)}\n\n${preview.content}`, "utf8");

    // Build real HTML email
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, rep.userId));
    const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, rep.userId));
    if (!user || !profile) { console.warn(`  ⚠ Missing user/profile`); continue; }

    const matchedProjects = await scoreAndFilterProjects(allProjects, {
      territories: profile.territories,
      industries: profile.industries,
      offerCategories: profile.offerCategories,
      customerTypes: profile.customerTypes,
      dealSizeMin: profile.dealSizeMin,
      dealSizeMax: profile.dealSizeMax,
      assignedBusinessLines: profile.assignedBusinessLines,
      salesMotion: profile.salesMotion ?? null,
    });

    const contactProjectNames = new Set(allContacts.map(c => c.project).filter(Boolean));
    const matchedContacts = allContacts.filter(c => new Set(matchedProjects.map(p => p.name)).has(c.project));

    const annotatedProjects = matchedProjects.map(p => {
      const hasNoContacts = !contactProjectNames.has(p.name);
      const projectContacts = matchedContacts
        .filter(c =>
          c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
          p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
        )
        .map(c => ({
          name: c.name, title: c.title, company: c.company, project: c.project,
          priority: c.priority, email: c.email,
          roleRelevance: c.roleRelevance ?? null,
          linkedin: c.linkedinProfileUrl ?? c.linkedin ?? null,
          contactTrustTier: c.contactTrustTier ?? null,
          source: c.source ?? null,
          verificationScore: c.verificationScore ?? null,
        }));
      const { readiness, bestContact } = classifyBriefReadiness({ ...p, hasNoContacts }, projectContacts);
      return { ...p, hasNoContacts, briefReadiness: readiness, bestContact };
    });

    const territories = resolveTerritories(profile.territories, profile.sectorFocus);
    const territoryLabel = territories.length > 0 ? territories.join("/") : "National";

    // Use the fixed buildEmailSignals (now exported)
    const emailSignals = buildEmailSignals(annotatedProjects, territories);

    const freshnessLine = latestRun?.completedAt
      ? `Data last refreshed: ${new Date(latestRun.completedAt).toUTCString().slice(0, 16)} UTC`
      : `Data as of: ${report.weekEnding}`;

    const actionReadyCount = emailSignals.filter(s => s.badge === "action_ready").length;
    const discoveryCount = emailSignals.filter(s => s.badge === "discovery_needed").length;
    const summaryParts = [];
    if (actionReadyCount > 0) summaryParts.push(`${actionReadyCount} action-ready opportunit${actionReadyCount === 1 ? "y" : "ies"}`);
    if (discoveryCount > 0) summaryParts.push(`${discoveryCount} need${discoveryCount === 1 ? "s" : ""} contact discovery`);
    const summaryLine = summaryParts.length > 0 ? summaryParts.join(" and ") + " this week." : "Here's your weekly intelligence update.";

    const emailData = {
      userName: (user.name || "Team Member").split(" ")[0],
      territory: territoryLabel,
      weekLabel: report.weekEnding,
      summaryLine,
      signals: emailSignals,
      dashboardUrl: "https://compasspt.manus.space",
    };

    const htmlContent = buildDigestEmailHtml(emailData);
    const textContent = buildDigestEmailText(emailData);

    writeFileSync(join(OUTPUT_DIR, `${rep.name}-email.html`), htmlContent, "utf8");
    writeFileSync(join(OUTPUT_DIR, `${rep.name}-email.txt`), textContent, "utf8");
    console.log(`  ✓ HTML + TXT saved`);

    summary.push({
      rep: rep.name,
      subject: preview.subject,
      territory: territoryLabel,
      actionReadyCount,
      discoveryCount,
      top3: emailSignals.slice(0, 3).map((s, i) => ({
        rank: i + 1,
        badge: s.badge,
        title: s.title,
        company: s.company,
        pitch: s.pitch,
        ctaAction: s.ctaAction,
        productTag: s.productTag,
      })),
    });

    emailSignals.slice(0, 3).forEach((s, i) => {
      console.log(`      ${i+1}. [${s.badge}] ${s.title}`);
      console.log(`         Tag: ${s.productTag}`);
      console.log(`         CTA: ${s.ctaAction}`);
    });

  } catch (err) {
    console.error(`  ✗ Error for ${rep.name}:`, err.message);
    console.error(err.stack?.split('\n').slice(0, 6).join('\n'));
  }
}

writeFileSync(join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
console.log(`\n✓ Summary + all files saved to docs/email-renders/`);
console.log("=== Done ===");
process.exit(0);
