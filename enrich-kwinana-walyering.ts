import "dotenv/config";
import { getLatestReport } from "./server/db";
import { enrichProjectContacts } from "./server/apolloEnrichment";

// Kwinana Gas Power Generation 2 (ID: 660052) — AGL owner, WA, HOT
// Walyering West-1 Gas Development (ID: 690069) — Strike Energy, WA, HOT
const TARGETS = [
  { id: 660052, name: "Kwinana Gas Power Generation 2 Project" },
  { id: 690069, name: "Walyering West-1 Gas Development" },
];

async function main() {
  const report = await getLatestReport();
  if (!report) throw new Error("No report found");
  console.log(`Using report ID: ${report.id} (${report.weekEnding})`);

  for (const target of TARGETS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Enriching: ${target.name} (ID: ${target.id})`);
    console.log("=".repeat(60));

    try {
      const result = await enrichProjectContacts(target.id, report.id, {
        enrichEmails: true,
        maxPerCompany: 5,
        targetTitles: [
          "Project Manager",
          "Procurement Manager",
          "Contracts Manager",
          "Site Manager",
          "Operations Manager",
          "Engineering Manager",
          "Maintenance Manager",
          "Construction Manager",
          "General Manager",
          "Director",
        ],
      });

      console.log(`\nResult for ${target.name}:`);
      console.log(`  Companies searched: ${result.companiesSearched || 0}`);
      console.log(`  Contacts found: ${result.contactsFound || 0}`);
      console.log(`  Contacts saved: ${result.contactsSaved || 0}`);
      console.log(`  Send-ready: ${result.sendReady || 0}`);
      console.log(`  Credits used: ${result.creditsUsed || 0}`);
      if (result.blockedReason) {
        console.log(`  Blocked: ${result.blockedReason}`);
      }
    } catch (err: any) {
      console.error(`  ERROR enriching ${target.name}: ${err.message}`);
    }
  }

  console.log("\n✓ Enrichment run complete");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
