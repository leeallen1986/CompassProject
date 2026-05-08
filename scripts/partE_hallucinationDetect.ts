/**
 * Part E — Hallucinated Contact Detection and Removal
 * 
 * Detects contacts where the name appears to be derived from the project name
 * (a known LLM hallucination pattern). Also detects:
 * - Names that match project/mine/location names
 * - Names with no LinkedIn URL and no email (pure fabrications)
 * - Names that are generic role descriptions (e.g., "Project Manager", "Mine Manager")
 * - Names with suspicious patterns (e.g., "John Smith" for "Smith Mine")
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { contacts, contactProjects, projects } from "../drizzle/schema";
import { eq, sql, inArray } from "drizzle-orm";

async function detectHallucinations() {
  const db = await getDb();
  if (!db) { console.error("DB unavailable"); process.exit(1); }

  console.log("=== Part E: Hallucinated Contact Detection ===\n");

  // Step 1: Get all contacts linked to WA high-PA projects with their project names
  const contactsWithProjects = await db.execute(sql.raw(`
    SELECT 
      c.id as contactId, c.name as contactName, c.title as contactTitle,
      c.email, c.linkedin, c.enrichmentSource, c.roleBucket,
      p.id as projectId, p.name as projectName, p.owner as projectOwner,
      COALESCE(pbs.score, 0) as paScore
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    JOIN projects p ON p.id = cp.projectId
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
    WHERE (p.projectCountry = 'Australia' OR p.location LIKE '%WA%' OR p.location LIKE '%Western Australia%')
      AND p.lifecycleStatus = 'active'
      AND (p.suppressed = false OR p.suppressed IS NULL)
    ORDER BY paScore DESC, p.name, c.name
  `)) as unknown as any[];

  const rows = (Array.isArray(contactsWithProjects[0]) ? contactsWithProjects[0] : contactsWithProjects) as any[];
  console.log(`Total WA contacts to audit: ${rows.length}\n`);

  const hallucinatedIds: number[] = [];
  const suspiciousIds: number[] = [];
  const hallucinationLog: string[] = [];

  for (const row of rows) {
    const contactName = (row.contactName || "").trim();
    const projectName = (row.projectName || "").toLowerCase();
    const projectOwner = (row.projectOwner || "").toLowerCase();
    const contactNameLower = contactName.toLowerCase();

    // Pattern 1: Contact name is a pure role description (no actual name)
    const roleOnlyPatterns = [
      /^(project|mine|site|operations|general|senior|chief|executive|managing)\s+(manager|director|engineer|superintendent|supervisor)$/i,
      /^(ceo|cfo|coo|cto|gm|vp|svp|evp)$/i,
      /^(unknown|n\/a|tbd|contact|person|individual)$/i,
    ];
    if (roleOnlyPatterns.some(p => p.test(contactName))) {
      hallucinatedIds.push(row.contactId);
      hallucinationLog.push(`[ROLE_ONLY] "${contactName}" on "${row.projectName}"`);
      continue;
    }

    // Pattern 2: Name derived from project/mine name
    // Extract key words from project name (3+ chars, not common words)
    const stopWords = new Set(["the", "and", "for", "with", "from", "into", "gold", "mine", "mining", "project", "development", "stage", "phase", "western", "australia", "underground", "open", "cut", "pit"]);
    const projectWords = projectName.split(/[\s\-_\/]+/)
      .filter(w => w.length >= 4 && !stopWords.has(w))
      .map(w => w.replace(/[^a-z]/g, ""));

    const ownerWords = projectOwner.split(/[\s\-_\/]+/)
      .filter(w => w.length >= 4 && !stopWords.has(w))
      .map(w => w.replace(/[^a-z]/g, ""));

    // Check if contact's surname matches a distinctive project word
    const nameParts = contactNameLower.split(/\s+/);
    const surname = nameParts[nameParts.length - 1] || "";
    
    const matchesProjectWord = projectWords.some(pw => 
      pw.length >= 5 && (surname.includes(pw) || pw.includes(surname))
    );

    const matchesOwnerWord = ownerWords.some(ow =>
      ow.length >= 5 && (surname.includes(ow) || ow.includes(surname))
    );

    // Pattern 3: No email AND no LinkedIn AND enrichmentSource is 'llm_fallback' or 'ai_generated'
    const isLLMOnly = ['llm_fallback', 'ai_generated', 'llm', 'gpt'].includes((row.enrichmentSource || "").toLowerCase());
    const hasNoVerification = !row.email && !row.linkedin;

    if (isLLMOnly && hasNoVerification && (matchesProjectWord || matchesOwnerWord)) {
      hallucinatedIds.push(row.contactId);
      hallucinationLog.push(`[NAME_DERIVED] "${contactName}" on "${row.projectName}" (matched word in project/owner name, LLM-only, no email/LinkedIn)`);
      continue;
    }

    // Pattern 4: Suspicious but not certain — flag for review
    if (isLLMOnly && hasNoVerification) {
      suspiciousIds.push(row.contactId);
    }
  }

  console.log(`Confirmed hallucinations to remove: ${hallucinatedIds.length}`);
  console.log(`Suspicious (LLM-only, no verification): ${suspiciousIds.length}\n`);

  if (hallucinationLog.length > 0) {
    console.log("=== Hallucinated Contacts ===");
    hallucinationLog.forEach(log => console.log(`  ${log}`));
    console.log();
  }

  // Step 2: Show suspicious contacts for manual review
  if (suspiciousIds.length > 0) {
    console.log("=== Suspicious Contacts (LLM-only, no email, no LinkedIn) ===");
    const suspiciousContacts = rows.filter((r: any) => suspiciousIds.includes(r.contactId));
    suspiciousContacts.slice(0, 20).forEach((r: any) => {
      console.log(`  "${r.contactName}" (${r.contactTitle || 'no title'}) on "${r.projectName}"`);
      console.log(`    Source: ${r.enrichmentSource || 'unknown'} | Email: ${r.email || 'none'} | LinkedIn: ${r.linkedinUrl ? 'yes' : 'none'}`);
    });
    console.log();
  }

  // Step 3: Remove confirmed hallucinations
  if (hallucinatedIds.length > 0) {
    // Remove from contactProjects first (FK constraint)
    const uniqueHalluIds = [...new Set(hallucinatedIds)];
    
    for (const contactId of uniqueHalluIds) {
      await db.delete(contactProjects).where(eq(contactProjects.contactId, contactId));
      await db.delete(contacts).where(eq(contacts.id, contactId));
    }
    console.log(`✓ Removed ${uniqueHalluIds.length} hallucinated contacts`);
  } else {
    console.log("✓ No confirmed hallucinations found — contact data appears clean");
  }

  // Step 4: Check for the known "Hamish Silver" type hallucination specifically
  const knownHallucinations = await db.execute(sql.raw(`
    SELECT c.id, c.name, c.title, c.email, c.enrichmentSource, p.name as projectName
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    JOIN projects p ON p.id = cp.projectId
    WHERE (
      -- Hamish Silver (Elizabeth Hill Silver Project)
      (c.name LIKE '%Silver%' AND p.name LIKE '%Silver%')
      -- Any contact where surname exactly matches a key project word
      OR (c.name LIKE '%Murchison%' AND p.name LIKE '%Murchison%')
      OR (c.name LIKE '%Walyering%' AND p.name LIKE '%Walyering%')
      OR (c.name LIKE '%Gruyere%' AND p.name LIKE '%Gruyere%')
      OR (c.name LIKE '%Tropicana%' AND p.name LIKE '%Tropicana%')
      OR (c.name LIKE '%Havieron%' AND p.name LIKE '%Havieron%')
      OR (c.name LIKE '%Bellevue%' AND p.name LIKE '%Bellevue%')
      OR (c.name LIKE '%Thunderbird%' AND p.name LIKE '%Thunderbird%')
    )
    LIMIT 20
  `)) as unknown as any[];

  const knownRows = (Array.isArray(knownHallucinations[0]) ? knownHallucinations[0] : knownHallucinations) as any[];
  
  if (knownRows.length > 0) {
    console.log("\n=== Known Hallucination Pattern Matches ===");
    knownRows.forEach((r: any) => {
      console.log(`  HALLUCINATED: "${r.name}" (${r.title || 'no title'}) on "${r.projectName}"`);
      console.log(`    Source: ${r.enrichmentSource || 'unknown'} | Email: ${r.email || 'none'}`);
    });

    // Remove these too
    const knownHalluIds = knownRows.map((r: any) => r.id);
    for (const contactId of knownHalluIds) {
      await db.delete(contactProjects).where(eq(contactProjects.contactId, contactId));
      await db.delete(contacts).where(eq(contacts.id, contactId));
    }
    console.log(`✓ Removed ${knownHalluIds.length} known-pattern hallucinated contacts`);
  } else {
    console.log("\n✓ No known-pattern hallucinations found (Hamish Silver, etc.)");
  }

  // Step 5: Summary stats
  const finalStats = await db.execute(sql.raw(`
    SELECT 
      COUNT(DISTINCT c.id) as totalContacts,
      COUNT(DISTINCT CASE WHEN c.email IS NOT NULL AND c.email != '' THEN c.id END) as withEmail,
      COUNT(DISTINCT CASE WHEN c.linkedin IS NOT NULL AND c.linkedin != '' THEN c.id END) as withLinkedIn,
      COUNT(DISTINCT CASE WHEN c.enrichmentSource IN ('llm', 'web_search') AND c.email IS NULL AND c.linkedin IS NULL THEN c.id END) as llmOnlyNoVerification
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    JOIN projects p ON p.id = cp.projectId
    WHERE (p.projectCountry = 'Australia' OR p.location LIKE '%WA%' OR p.location LIKE '%Western Australia%')
      AND p.lifecycleStatus = 'active'
  `)) as unknown as any[];

  const statsRow = (Array.isArray(finalStats[0]) ? finalStats[0] : finalStats)[0] as any;
  console.log("\n=== Final WA Contact Quality Stats ===");
  console.log(`  Total contacts: ${statsRow?.totalContacts || 0}`);
  console.log(`  With email: ${statsRow?.withEmail || 0}`);
  console.log(`  With LinkedIn: ${statsRow?.withLinkedIn || 0}`);
  console.log(`  LLM-only (no email, no LinkedIn): ${statsRow?.llmOnlyNoVerification || 0}`);

  console.log("\n=== Part E Complete ===");
  process.exit(0);
}

detectHallucinations().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
