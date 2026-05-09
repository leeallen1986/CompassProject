import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { classifyRoleRelevance } from "../server/roleRelevance";

async function main() {
  const db = await getDb();

  // Get all high-relevance contacts
  const [allHigh] = await db.execute(
    sql`SELECT id, title, roleBucket FROM contacts WHERE roleRelevance = 'high'`
  );

  const toLow: number[] = [];
  const toMedium: number[] = [];

  for (const c of allHigh as any[]) {
    const newRelevance = classifyRoleRelevance(c.title, c.roleBucket || "");
    if (newRelevance === "low") {
      toLow.push(c.id);
    } else if (newRelevance === "medium") {
      toMedium.push(c.id);
    }
  }

  console.log(`Total high-relevance contacts: ${(allHigh as any[]).length}`);
  console.log(`Reclassify to low: ${toLow.length}`);
  console.log(`Reclassify to medium: ${toMedium.length}`);

  // Apply in batches
  if (toLow.length > 0) {
    for (let i = 0; i < toLow.length; i += 200) {
      const batch = toLow.slice(i, i + 200);
      await db.execute(
        sql.raw(`UPDATE contacts SET roleRelevance = 'low' WHERE id IN (${batch.join(",")})`)
      );
    }
    console.log(`Applied ${toLow.length} downgrades to low`);
  }

  if (toMedium.length > 0) {
    for (let i = 0; i < toMedium.length; i += 200) {
      const batch = toMedium.slice(i, i + 200);
      await db.execute(
        sql.raw(`UPDATE contacts SET roleRelevance = 'medium' WHERE id IN (${batch.join(",")})`)
      );
    }
    console.log(`Applied ${toMedium.length} downgrades to medium`);
  }

  console.log("Done");
  process.exit(0);
}

main();
