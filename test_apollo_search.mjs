import { config } from "dotenv";
config();

// Manually test the Apollo People Search for a few drilling companies
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
if (!APOLLO_API_KEY) {
  console.error("No APOLLO_API_KEY found");
  process.exit(1);
}

const testCompanies = ["Ausdrill", "Boart Longyear", "DDH1 Drilling", "Swick Mining", "Action Drill & Blast"];

for (const company of testCompanies) {
  console.log(`\n=== Searching: ${company} ===`);
  try {
    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": APOLLO_API_KEY,
      },
      body: JSON.stringify({
        page: 1,
        per_page: 5,
        q_organization_name: company,
        organization_locations: ["Australia"],
        person_titles: ["Operations Manager", "General Manager", "Managing Director", "Fleet Manager", "Drill Manager"],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.log(`  ERROR ${res.status}: ${errText.substring(0, 200)}`);
      continue;
    }

    const data = await res.json();
    console.log(`  People found: ${data.people?.length ?? 0}`);
    console.log(`  Pagination total: ${data.pagination?.total_entries ?? "N/A"}`);
    if (data.people?.length > 0) {
      for (const p of data.people.slice(0, 3)) {
        console.log(`  - ${p.first_name} ${p.last_name || "(obfuscated)"} | ${p.title || "no title"} | ${p.organization?.name || "?"}`);
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  } catch (err) {
    console.log(`  FETCH ERROR: ${err.message}`);
  }
}
