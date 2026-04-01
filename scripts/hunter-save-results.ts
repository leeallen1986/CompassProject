/**
 * Re-run Hunter.io enrichment on Hot contacts and save results with connection pool.
 * Uses connection pool instead of single connection to avoid timeout issues.
 */

import "dotenv/config";
import mysql from "mysql2/promise";

const HUNTER_API_BASE = "https://api.hunter.io/v2";
const API_KEY = process.env.HUNTER_API_KEY!;
const DB_URL = process.env.DATABASE_URL!;
const CALL_TIMEOUT = 15000;
const RATE_LIMIT_MS = 300;

interface Contact {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string;
  reviewedCompanyName: string | null;
}

interface EnrichResult {
  contactId: number;
  email: string;
  confidence: number;
  position: string | null;
  linkedin: string | null;
  verificationStatus: string | null;
  source: string;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // Use connection pool to avoid timeout issues
  const pool = mysql.createPool({
    uri: DB_URL,
    waitForConnections: true,
    connectionLimit: 5,
    idleTimeout: 60000,
  });

  // Get Hot tier contacts that are still not_found
  const [rows] = await pool.execute(
    `SELECT id, firstName, lastName, email, company, reviewedCompanyName 
     FROM campaignContacts 
     WHERE tier = 'tier1_hot' AND enrichmentStatus = 'not_found' 
     ORDER BY score DESC`
  ) as any;

  const contacts: Contact[] = rows;
  console.log(`\n🔥 Found ${contacts.length} Hot tier contacts still needing enrichment\n`);

  if (contacts.length === 0) {
    console.log("Nothing to enrich.");
    await pool.end();
    return;
  }

  // Group by domain
  const domainGroups = new Map<string, Contact[]>();
  const noDomain: Contact[] = [];

  for (const c of contacts) {
    let domain: string | null = null;
    if (c.email) {
      const m = c.email.match(/@(.+)/);
      if (m) domain = m[1].toLowerCase();
    }
    if (domain) {
      if (!domainGroups.has(domain)) domainGroups.set(domain, []);
      domainGroups.get(domain)!.push(c);
    } else {
      noDomain.push(c);
    }
  }

  const domains = Array.from(domainGroups.keys());
  console.log(`📧 ${domains.length} unique domains\n`);

  const results: EnrichResult[] = [];
  const matchedIds = new Set<number>();
  let domainSearchCount = 0;
  let emailFinderCount = 0;

  // ── Phase 1: Domain Search ──
  console.log(`═══ Phase 1: Domain Search (${domains.length} domains) ═══`);

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    const domainContacts = domainGroups.get(domain)!;

    try {
      const params = new URLSearchParams({
        api_key: API_KEY,
        domain,
        type: "personal",
        limit: "100",
      });

      const res = await fetchWithTimeout(`${HUNTER_API_BASE}/domain-search?${params}`, CALL_TIMEOUT);
      domainSearchCount++;

      if (!res.ok) continue;

      const json = await res.json();
      const emails = json.data?.emails || [];

      let matched = 0;
      for (const contact of domainContacts) {
        const cFirst = (contact.firstName || "").toLowerCase().trim();
        const cLast = (contact.lastName || "").toLowerCase().trim();
        if (!cFirst && !cLast) continue;

        for (const he of emails) {
          const hFirst = (he.first_name || "").toLowerCase().trim();
          const hLast = (he.last_name || "").toLowerCase().trim();
          const emailLower = (he.value || "").toLowerCase();

          const exactMatch = hFirst === cFirst && hLast === cLast;
          const partialMatch = hFirst === cFirst && hLast && cLast && hLast[0] === cLast[0];
          const patternMatch = cFirst && cLast && (
            emailLower.includes(`${cFirst}.${cLast}`) ||
            emailLower.includes(`${cFirst}${cLast}`) ||
            emailLower.includes(`${cFirst[0]}.${cLast}`) ||
            emailLower.includes(`${cFirst[0]}${cLast}`)
          );

          if (exactMatch || partialMatch || patternMatch) {
            results.push({
              contactId: contact.id,
              email: he.value,
              confidence: he.confidence || 0,
              position: he.position || null,
              linkedin: he.linkedin || null,
              verificationStatus: he.verification?.status || null,
              source: "domain_search",
            });
            matchedIds.add(contact.id);
            matched++;
            break;
          }
        }
      }

      if ((i + 1) % 20 === 0) console.log(`  [${i + 1}/${domains.length}] ${matched > 0 ? `${matched} matched` : "..."}`);
    } catch (err: any) {
      // skip
    }

    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  const domainMatches = results.length;
  console.log(`\n✅ Domain Search: ${domainMatches} matched from ${domainSearchCount} searches\n`);

  // ── Phase 2: Email Finder ──
  const unmatchedWithDomain: Array<{ contact: Contact; domain: string }> = [];
  for (const [domain, domainContacts] of domainGroups.entries()) {
    for (const c of domainContacts) {
      if (!matchedIds.has(c.id) && c.firstName && c.lastName) {
        unmatchedWithDomain.push({ contact: c, domain });
      }
    }
  }
  for (const c of noDomain) {
    if (c.firstName && c.lastName) {
      unmatchedWithDomain.push({ contact: c, domain: "" });
    }
  }

  console.log(`═══ Phase 2: Email Finder (${unmatchedWithDomain.length} contacts) ═══`);

  for (let i = 0; i < unmatchedWithDomain.length; i++) {
    const { contact, domain } = unmatchedWithDomain[i];
    const company = contact.reviewedCompanyName || contact.company;

    try {
      const params = new URLSearchParams({
        api_key: API_KEY,
        first_name: contact.firstName!,
        last_name: contact.lastName!,
      });
      if (domain) params.set("domain", domain);
      else params.set("company", company);

      const res = await fetchWithTimeout(`${HUNTER_API_BASE}/email-finder?${params}`, CALL_TIMEOUT);
      emailFinderCount++;

      if (res.status === 404 || !res.ok) {
        if ((i + 1) % 25 === 0) console.log(`  [${i + 1}/${unmatchedWithDomain.length}] ...`);
        continue;
      }

      const json = await res.json();
      const data = json.data;

      if (data?.email && (data.score || 0) >= 30) {
        results.push({
          contactId: contact.id,
          email: data.email,
          confidence: data.score || 0,
          position: data.position || null,
          linkedin: data.linkedin_url || null,
          verificationStatus: data.verification?.status || null,
          source: "email_finder",
        });
        matchedIds.add(contact.id);
        console.log(`  [${i + 1}/${unmatchedWithDomain.length}] ✅ ${contact.firstName} ${contact.lastName} → ${data.email} (${data.score}%)`);
      } else {
        if ((i + 1) % 25 === 0) console.log(`  [${i + 1}/${unmatchedWithDomain.length}] ...`);
      }
    } catch (err: any) {
      // skip
    }

    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  const finderMatches = results.length - domainMatches;
  console.log(`\n✅ Email Finder: ${finderMatches} additional matches\n`);

  // ── Phase 3: Save to database (using pool for reliability) ──
  console.log(`═══ Phase 3: Saving ${results.length} results to database ═══`);

  let saved = 0;
  let saveFailed = 0;

  // Process in batches of 10 to avoid connection issues
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    try {
      await pool.execute(
        `UPDATE campaignContacts SET 
          enrichmentStatus = 'enriched',
          enrichmentSource_cc = 'hunter',
          enrichedEmail = ?,
          enrichedLinkedin = ?,
          hunterConfidence = ?,
          hunterVerificationStatus = ?,
          enrichedAt = NOW()
        WHERE id = ?`,
        [r.email, r.linkedin, r.confidence, r.verificationStatus, r.contactId]
      );
      saved++;
    } catch (err: any) {
      console.error(`  ❌ ID ${r.contactId}: ${err.message}`);
      saveFailed++;
    }
  }

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`🎯 HUNTER.IO ENRICHMENT SUMMARY`);
  console.log(`═══════════════════════════════════════════════`);
  console.log(`   Total Hot contacts processed: ${contacts.length}`);
  console.log(`   ✅ Enriched & saved: ${saved}`);
  console.log(`      📧 Via Domain Search: ${domainMatches}`);
  console.log(`      🔍 Via Email Finder: ${finderMatches}`);
  console.log(`   ❌ Still not found: ${contacts.length - saved}`);
  console.log(`   ⚠️  Save failures: ${saveFailed}`);
  console.log(`   📊 API calls: ${domainSearchCount} domain + ${emailFinderCount} finder`);
  console.log(`═══════════════════════════════════════════════\n`);

  // Show top results
  if (results.length > 0) {
    console.log(`📋 TOP 20 ENRICHED CONTACTS:`);
    const sorted = results.sort((a, b) => b.confidence - a.confidence).slice(0, 20);
    for (const r of sorted) {
      const contact = contacts.find(c => c.id === r.contactId);
      console.log(`   ${contact?.firstName} ${contact?.lastName} @ ${contact?.reviewedCompanyName || contact?.company}`);
      console.log(`     → ${r.email} (${r.confidence}% ${r.verificationStatus || "unverified"}, ${r.source})`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
