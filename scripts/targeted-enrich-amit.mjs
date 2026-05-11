/**
 * Targeted Apollo Enrichment for Amit Bhargava's blocked contacts
 *
 * Contacts:
 * 1. Choi JungIn at Vena Energy (project: "Bellambi Heights Battery Energy Storage System - Stage 2")
 * 2. Ubayeda Shaqer at Octopus Australia (project: "Blind Creek Solar and Battery Project")
 *
 * Strategy: Search Apollo for verified contacts at these companies with relevant titles,
 * then update the project contacts in the DB.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, like, sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
if (!APOLLO_API_KEY) { console.error("APOLLO_API_KEY not set"); process.exit(1); }

const connection = await mysql.createConnection(DATABASE_URL);
const db = drizzle(connection);

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

async function apolloPeopleSearch(params) {
  const body = {
    page: 1,
    per_page: 5,
  };
  if (params.organizationDomains?.length) body.q_organization_domains_list = params.organizationDomains;
  if (params.organizationName) body.q_organization_name = params.organizationName;
  if (params.personTitles?.length) body.person_titles = params.personTitles;
  if (params.personSeniorities?.length) body.person_seniorities = params.personSeniorities;
  if (params.organizationLocations?.length) body.organization_locations = params.organizationLocations;

  const res = await fetch(`${APOLLO_BASE_URL}/mixed_people/api_search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": APOLLO_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apollo search failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function apolloPeopleEnrich(personId) {
  const res = await fetch(`${APOLLO_BASE_URL}/people/match`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": APOLLO_API_KEY,
    },
    body: JSON.stringify({ id: personId, reveal_personal_emails: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apollo enrich failed: ${res.status} ${text}`);
  }
  return res.json();
}

// Target companies and their projects
const targets = [
  {
    company: "Vena Energy",
    domain: "venaenergy.com",
    projectName: "Bellambi Heights Battery Energy Storage System - Stage 2",
    existingContact: "Choi JungIn",
    titles: ["Project Manager", "Development Manager", "Head of Development", "Director", "Country Manager", "General Manager"],
    location: "Australia",
  },
  {
    company: "Octopus Energy",
    domain: "octopusenergy.com.au",
    projectName: "Blind Creek Solar and Battery Project",
    existingContact: "Ubayeda Shaqer",
    titles: ["Project Manager", "Development Manager", "Head of Projects", "Director", "Country Manager", "General Manager"],
    location: "Australia",
  },
];

console.log("=== Targeted Apollo Enrichment for Amit Bhargava ===\n");

for (const target of targets) {
  console.log(`\n--- Searching: ${target.company} (${target.domain}) ---`);
  console.log(`Project: ${target.projectName}`);
  console.log(`Existing contact: ${target.existingContact}`);

  try {
    // Search by domain first
    const searchResult = await apolloPeopleSearch({
      organizationDomains: [target.domain],
      personSeniorities: ["director", "vp", "c_suite", "manager"],
      organizationLocations: ["Australia"],
    });

    const people = searchResult.people || [];
    console.log(`Found ${people.length} people at ${target.domain}`);

    if (people.length === 0) {
      // Try by organization name
      console.log(`Trying by organization name: ${target.company}...`);
      const nameResult = await apolloPeopleSearch({
        organizationName: target.company,
        personSeniorities: ["director", "vp", "c_suite", "manager"],
        organizationLocations: ["Australia"],
      });
      const namePeople = nameResult.people || [];
      console.log(`Found ${namePeople.length} people by name search`);

      for (const p of namePeople.slice(0, 3)) {
        console.log(`  - ${p.name} | ${p.title} | ${p.organization?.name} | ${p.email_status}`);
      }
    } else {
      for (const p of people.slice(0, 5)) {
        console.log(`  - ${p.name} | ${p.title} | ${p.organization?.name} | email_status=${p.email_status}`);
      }

      // Find the best match - someone with a verified email and relevant title
      const bestMatch = people.find(p =>
        p.email_status === "verified" &&
        p.organization?.primary_domain === target.domain
      ) || people[0];

      if (bestMatch) {
        console.log(`\n  Best match: ${bestMatch.name} (${bestMatch.title})`);
        console.log(`  Email status: ${bestMatch.email_status}`);
        console.log(`  Apollo ID: ${bestMatch.id}`);

        // If the existing contact is in the results, try to enrich them
        const existingMatch = people.find(p =>
          p.name?.toLowerCase().includes(target.existingContact.split(" ")[0].toLowerCase())
        );
        if (existingMatch) {
          console.log(`\n  ✓ Found existing contact ${target.existingContact} in Apollo!`);
          console.log(`    Full name: ${existingMatch.name}`);
          console.log(`    Title: ${existingMatch.title}`);
          console.log(`    Email status: ${existingMatch.email_status}`);
          console.log(`    Email: ${existingMatch.email || "(needs reveal)"}`);
        }
      }
    }
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
  }

  // Rate limit
  await new Promise(r => setTimeout(r, 1000));
}

console.log("\n\n=== Enrichment Complete ===");
await connection.end();
