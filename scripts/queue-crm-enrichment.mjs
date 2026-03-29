/**
 * Queue CRM contacts for priority Apollo enrichment.
 * 
 * Strategy:
 * 1. Find CRM contacts linked to hot/warm projects (highest priority)
 * 2. Find CRM contacts tagged as sector-relevant (mining, oil_gas, drilling, infrastructure)
 * 3. Set enrichmentPriority = "high" for project-linked sector contacts
 * 4. Set enrichmentPriority = "medium" for sector-relevant but not project-linked
 * 5. Leave the rest as "low" (general industrial)
 * 
 * The daily pipeline's Apollo gap-fill will pick these up automatically.
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);
  console.log("Connected to database");

  // Step 1: Set HIGH priority for CRM contacts linked to hot/warm projects
  console.log("\n=== Step 1: High priority — CRM contacts linked to hot/warm projects ===");
  const [highResult] = await conn.execute(`
    UPDATE contacts c
    INNER JOIN contactProjects cp ON c.id = cp.contactId
    INNER JOIN projects p ON cp.projectId = p.id
    SET c.enrichmentPriority = 'high'
    WHERE c.source = 'crm'
      AND c.enrichmentPriority != 'high'
      AND p.priority IN ('hot', 'warm')
      AND c.sectorTag IN ('mining', 'oil_gas', 'drilling', 'infrastructure', 'water')
  `);
  console.log(`Set ${highResult.affectedRows} contacts to HIGH priority (project-linked + sector-relevant)`);

  // Step 2: Set MEDIUM priority for sector-relevant CRM contacts not yet high
  console.log("\n=== Step 2: Medium priority — sector-relevant CRM contacts ===");
  const [medResult] = await conn.execute(`
    UPDATE contacts
    SET enrichmentPriority = 'medium'
    WHERE source = 'crm'
      AND enrichmentPriority NOT IN ('high', 'medium')
      AND sectorTag IN ('mining', 'oil_gas', 'drilling', 'infrastructure', 'water')
  `);
  console.log(`Set ${medResult.affectedRows} contacts to MEDIUM priority (sector-relevant)`);

  // Step 3: Set MEDIUM priority for CRM contacts linked to any project (even cold)
  console.log("\n=== Step 3: Medium priority — CRM contacts linked to any project ===");
  const [projLinkedResult] = await conn.execute(`
    UPDATE contacts c
    INNER JOIN contactProjects cp ON c.id = cp.contactId
    SET c.enrichmentPriority = 'medium'
    WHERE c.source = 'crm'
      AND c.enrichmentPriority NOT IN ('high', 'medium')
  `);
  console.log(`Set ${projLinkedResult.affectedRows} additional contacts to MEDIUM priority (project
-linked)`);

  // Final summary
  console.log("\n=== ENRICHMENT QUEUE SUMMARY ===");
  const [summary] = await conn.execute(`
    SELECT 
      enrichmentPriority,
      COUNT(*) as count,
      SUM(CASE WHEN sectorTag IN ('mining', 'oil_gas', 'drilling', 'infrastructure', 'water') THEN 1 ELSE 0 END) as sector_relevant,
      SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as has_email,
      SUM(CASE WHEN title IS NOT NULL AND title != '' THEN 1 ELSE 0 END) as has_title,
      SUM(CASE WHEN linkedin IS NOT NULL AND linkedin != '' THEN 1 ELSE 0 END) as has_linkedin,
      SUM(CASE WHEN enrichedAt IS NOT NULL THEN 1 ELSE 0 END) as already_enriched
    FROM contacts
    WHERE source = 'crm'
    GROUP BY enrichmentPriority
    ORDER BY FIELD(enrichmentPriority, 'high', 'medium', 'low')
  `);

  console.log("\nPriority | Count | Sector | Has Email | Has Title | Has LinkedIn | Already Enriched");
  console.log("---------|-------|--------|-----------|-----------|-------------|------------------");
  for (const row of summary) {
    console.log(
      `${String(row.enrichmentPriority).padEnd(8)} | ${String(row.count).padStart(5)} | ${String(row.sector_relevant).padStart(6)} | ${String(row.has_email).padStart(9)} | ${String(row.has_title).padStart(9)} | ${String(row.has_linkedin).padStart(11)} | ${String(row.already_enriched).padStart(16)}`
    );
  }

  // Show top companies in high priority queue
  console.log("\n=== TOP HIGH-PRIORITY COMPANIES (for Apollo enrichment) ===");
  const [topCompanies] = await conn.execute(`
    SELECT company, COUNT(*) as contact_count,
      SUM(CASE WHEN title IS NULL OR title = '' THEN 1 ELSE 0 END) as missing_title,
      SUM(CASE WHEN linkedin IS NULL OR linkedin = '' THEN 1 ELSE 0 END) as missing_linkedin
    FROM contacts
    WHERE source = 'crm' AND enrichmentPriority = 'high'
    GROUP BY company
    ORDER BY contact_count DESC
    LIMIT 30
  `);

  console.log("\nCompany | Contacts | Missing Title | Missing LinkedIn");
  console.log("--------|----------|---------------|------------------");
  for (const row of topCompanies) {
    console.log(
      `${String(row.company).substring(0, 40).padEnd(40)} | ${String(row.contact_count).padStart(8)} | ${String(row.missing_title).padStart(13)} | ${String(row.missing_linkedin).padStart(16)}`
    );
  }

  // Show which projects have the most CRM contacts ready for enrichment
  console.log("\n=== TOP PROJECTS WITH HIGH-PRIORITY CRM CONTACTS ===");
  const [topProjects] = await conn.execute(`
    SELECT p.name as project_name, p.priority, COUNT(DISTINCT c.id) as crm_contacts,
      SUM(CASE WHEN c.title IS NULL OR c.title = '' THEN 1 ELSE 0 END) as needs_title,
      SUM(CASE WHEN c.linkedin IS NULL OR c.linkedin = '' THEN 1 ELSE 0 END) as needs_linkedin
    FROM contacts c
    INNER JOIN contactProjects cp ON c.id = cp.contactId
    INNER JOIN projects p ON cp.projectId = p.id
    WHERE c.source = 'crm' AND c.enrichmentPriority = 'high'
    GROUP BY p.id, p.name, p.priority
    ORDER BY crm_contacts DESC
    LIMIT 20
  `);

  console.log("\nProject | Priority | CRM Contacts | Needs Title | Needs LinkedIn");
  console.log("--------|----------|--------------|-------------|----------------");
  for (const row of topProjects) {
    console.log(
      `${String(row.project_name).substring(0, 45).padEnd(45)} | ${String(row.priority).padEnd(8)} | ${String(row.crm_contacts).padStart(12)} | ${String(row.needs_title).padStart(11)} | ${String(row.needs_linkedin).padStart(14)}`
    );
  }

  await conn.end();
  console.log("\nDone! CRM contacts are now queued for Apollo enrichment.");
  console.log("The daily pipeline will pick up high-priority contacts first.");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
