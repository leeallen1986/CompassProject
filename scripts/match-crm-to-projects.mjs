/**
 * Fuzzy-match CRM contacts to tracked projects by company name.
 * Creates contactProjects junction records for matched contacts.
 * 
 * Strategy:
 * 1. Get all unique companies from CRM contacts
 * 2. Get all projects with their owner/contractor companies
 * 3. Normalize and fuzzy-match company names
 * 4. Create contactProjects links for matches
 * 5. Update contact priority to "warm" when matched to a hot/warm project
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// ── Company name normalization ──
function normalizeCompany(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\[s\]\s*-\s*/g, "")
    .replace(/\s*p\/l\s*/g, " ")
    .replace(/\s*pty\.?\s*ltd\.?\s*/g, " ")
    .replace(/\s*ltd\.?\s*/g, " ")
    .replace(/\s*limited\s*/g, " ")
    .replace(/\s*inc\.?\s*/g, " ")
    .replace(/\s*corp\.?\s*/g, " ")
    .replace(/\s*group\s*/g, " ")
    .replace(/\s*australia\s*/g, " ")
    .replace(/\s*operations?\s*/g, " ")
    .replace(/\s*services?\s*/g, " ")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Simple token-based similarity (Jaccard)
function tokenSimilarity(a, b) {
  const tokensA = new Set(a.split(/\s+/).filter(t => t.length > 1));
  const tokensB = new Set(b.split(/\s+/).filter(t => t.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

// Check if one company name contains the core of another
function containsCore(a, b) {
  // Extract the "core" name (first 2-3 significant tokens)
  const coreA = a.split(/\s+/).filter(t => t.length > 2).slice(0, 2).join(" ");
  const coreB = b.split(/\s+/).filter(t => t.length > 2).slice(0, 2).join(" ");
  if (coreA.length < 3 || coreB.length < 3) return false;
  return a.includes(coreB) || b.includes(coreA);
}

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);
  console.log("Connected to database");

  // Get all unique CRM companies with their contact IDs
  console.log("Loading CRM contacts...");
  const [crmContacts] = await conn.execute(
    "SELECT id, company, name, priority FROM contacts WHERE source = 'crm'"
  );
  console.log(`Loaded ${crmContacts.length} CRM contacts`);

  // Build company → contact IDs map
  const companyContacts = new Map();
  for (const c of crmContacts) {
    const norm = normalizeCompany(c.company);
    if (!norm) continue;
    if (!companyContacts.has(norm)) {
      companyContacts.set(norm, { original: c.company, contactIds: [] });
    }
    companyContacts.get(norm).contactIds.push(c.id);
  }
  console.log(`${companyContacts.size} unique normalized CRM companies`);

  // Get all projects with their companies
  console.log("Loading projects...");
  const [projects] = await conn.execute(
    "SELECT id, name, owner, contractors, priority FROM projects"
  );
  console.log(`Loaded ${projects.length} projects`);

  // Build project company → project map (owner + contractor)
  const projectCompanies = new Map(); // normalized → { projectId, projectName, priority, original }
  for (const p of projects) {
    const companies = [];
    if (p.owner) companies.push(p.owner);

    // contractors is a JSON array of contractor names
    if (p.contractors) {
      try {
        const arr = typeof p.contractors === 'string' ? JSON.parse(p.contractors) : p.contractors;
        if (Array.isArray(arr)) {
          for (const c of arr) {
            if (typeof c === 'string') companies.push(c);
            else if (c && c.name) companies.push(c.name);
          }
        }
      } catch (e) { /* ignore parse errors */ }
    }
    
    // Also extract companies from project name (e.g., "BHP Olympic Dam")
    for (const co of companies) {
      // Split on "/" or "," for multiple companies
      const parts = co.split(/[\/,]/).map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        const norm = normalizeCompany(part);
        if (norm && norm.length > 2) {
          if (!projectCompanies.has(norm)) {
            projectCompanies.set(norm, []);
          }
          projectCompanies.get(norm).push({
            projectId: p.id,
            projectName: p.name,
            priority: p.priority,
            original: part,
          });
        }
      }
    }
  }
  console.log(`${projectCompanies.size} unique normalized project companies`);

  // Match CRM companies to project companies
  let matchCount = 0;
  let contactsLinked = 0;
  const matchedPairs = [];

  const projectCompanyKeys = [...projectCompanies.keys()];

  for (const [crmNorm, crmData] of companyContacts) {
    // Exact match first
    if (projectCompanies.has(crmNorm)) {
      const projectEntries = projectCompanies.get(crmNorm);
      for (const pe of projectEntries) {
        matchedPairs.push({
          crmCompany: crmData.original,
          projectName: pe.projectName,
          projectId: pe.projectId,
          projectPriority: pe.priority,
          contactIds: crmData.contactIds,
          matchType: "exact",
        });
      }
      matchCount++;
      contactsLinked += crmData.contactIds.length;
      continue;
    }

    // Fuzzy match — token similarity + containment
    for (const projNorm of projectCompanyKeys) {
      const sim = tokenSimilarity(crmNorm, projNorm);
      const contains = containsCore(crmNorm, projNorm);
      
      if (sim >= 0.6 || contains) {
        const projectEntries = projectCompanies.get(projNorm);
        for (const pe of projectEntries) {
          matchedPairs.push({
            crmCompany: crmData.original,
            projectName: pe.projectName,
            projectId: pe.projectId,
            projectPriority: pe.priority,
            contactIds: crmData.contactIds,
            matchType: sim >= 0.6 ? `fuzzy(${sim.toFixed(2)})` : "contains",
          });
        }
        matchCount++;
        contactsLinked += crmData.contactIds.length;
        break; // Take first fuzzy match
      }
    }
  }

  console.log(`\n=== MATCHING RESULTS ===`);
  console.log(`Companies matched: ${matchCount}`);
  console.log(`Contacts linked: ${contactsLinked}`);
  console.log(`Unique project links: ${matchedPairs.length}`);

  // Show top matches
  console.log(`\nTop 30 matches:`);
  const sortedMatches = matchedPairs.sort((a, b) => b.contactIds.length - a.contactIds.length);
  for (const m of sortedMatches.slice(0, 30)) {
    console.log(`  ${m.crmCompany} → ${m.projectName} (${m.contactIds.length} contacts, ${m.matchType})`);
  }

  // Insert contactProjects links
  console.log("\nInserting contact-project links...");
  const INSERT_SQL = "INSERT INTO contactProjects (contactId, projectId, projectName, relevance) VALUES ?";
  const BATCH_SIZE = 500;
  let batch = [];
  let totalInserted = 0;

  // Get existing links to avoid duplicates
  const [existingLinks] = await conn.execute("SELECT contactId, projectId FROM contactProjects");
  const existingSet = new Set(existingLinks.map(l => `${l.contactId}-${l.projectId}`));

  for (const m of matchedPairs) {
    for (const contactId of m.contactIds) {
      const key = `${contactId}-${m.projectId}`;
      if (existingSet.has(key)) continue;
      existingSet.add(key);
      
      batch.push([contactId, m.projectId, m.projectName, "secondary"]);
      
      if (batch.length >= BATCH_SIZE) {
        await conn.query(INSERT_SQL, [batch]);
        totalInserted += batch.length;
        batch = [];
      }
    }
  }

  if (batch.length > 0) {
    await conn.query(INSERT_SQL, [batch]);
    totalInserted += batch.length;
  }

  console.log(`Inserted ${totalInserted} contact-project links`);

  // Update priority for contacts matched to hot/warm projects
  console.log("\nUpdating contact priorities based on project matches...");
  const [updated] = await conn.execute(`
    UPDATE contacts c
    INNER JOIN contactProjects cp ON c.id = cp.contactId
    INNER JOIN projects p ON cp.projectId = p.id
    SET c.priority = CASE 
      WHEN p.priority = 'hot' THEN 'hot'
      WHEN p.priority = 'warm' AND c.priority = 'cold' THEN 'warm'
      ELSE c.priority
    END
    WHERE c.source = 'crm' AND c.priority = 'cold'
  `);
  console.log(`Updated ${updated.affectedRows} contact priorities`);

  // Final summary
  const [summary] = await conn.execute(`
    SELECT 
      COUNT(DISTINCT cp.contactId) as linked_contacts,
      COUNT(DISTINCT cp.projectId) as linked_projects,
      COUNT(*) as total_links
    FROM contactProjects cp
    INNER JOIN contacts c ON cp.contactId = c.id
    WHERE c.source = 'crm'
  `);
  console.log(`\n=== FINAL SUMMARY ===`);
  console.log(`CRM contacts linked to projects: ${summary[0].linked_contacts}`);
  console.log(`Projects with CRM contacts: ${summary[0].linked_projects}`);
  console.log(`Total contact-project links: ${summary[0].total_links}`);

  await conn.end();
  console.log("\nDone!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
