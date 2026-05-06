import "dotenv/config";
import { getDb } from "./server/db";
import { projects } from "./drizzle/schema";
import { eq } from "drizzle-orm";
import { inferDomain, classifyOwnerType } from "./server/apolloEnrichment";

async function main() {
  const db = await getDb();

  for (const id of [660052, 690069]) {
    const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) { console.log(`Project ${id} not found`); continue; }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Project: ${project.name} (ID: ${id})`);
    console.log(`  owner: "${project.owner}"`);
    console.log(`  contractor: "${project.contractor}"`);
    console.log(`  contractors field (raw):`, (project as any).contractors);
    console.log(`  enrichmentBlockedReason: ${(project as any).enrichmentBlockedReason}`);

    const ownerType = classifyOwnerType(project.owner || "");
    const ownerDomain = inferDomain(project.owner || "");
    console.log(`  ownerType: ${ownerType}`);
    console.log(`  ownerDomain: ${ownerDomain}`);

    // Simulate the companies array building
    const companies: { name: string; domain: string }[] = [];
    if (ownerType === "private" && ownerDomain) {
      companies.push({ name: project.owner!, domain: ownerDomain });
      console.log(`  → Added owner to companies: ${project.owner} / ${ownerDomain}`);
    } else {
      console.log(`  → Owner blocked: type=${ownerType}, domain=${ownerDomain}`);
    }

    const contractorsRaw = (project as any).contractors;
    if (contractorsRaw) {
      const contractorList = Array.isArray(contractorsRaw) ? contractorsRaw : JSON.parse(contractorsRaw);
      console.log(`  contractors parsed:`, contractorList);
      for (const c of contractorList) {
        if (c.name && !companies.find(co => co.name === c.name)) {
          const domain = inferDomain(c.name);
          if (domain) {
            companies.push({ name: c.name, domain });
            console.log(`  → Added contractor: ${c.name} / ${domain}`);
          } else {
            console.log(`  → Contractor domain failed: ${c.name}`);
          }
        }
      }
    } else {
      console.log(`  → No contractors field`);
    }

    console.log(`  TOTAL companies to search: ${companies.length}`);
    if (companies.length === 0) {
      console.log(`  ⚠ Will return early with 0 results — no companies to search`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
