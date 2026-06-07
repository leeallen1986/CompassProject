/**
 * Generate a dry-run preview of Brett and Ryan's Monday digest content.
 * Does NOT send any emails — just returns the digest data for review.
 */
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { sendWeeklyDigestsForUser } from "../server/emailDigest";

const db = await getDb();
if (!db) { console.error("❌ DB unavailable"); process.exit(1); }

const reps = await db.select({ id: users.id, name: users.name, email: users.email })
  .from(users)
  .where(inArray(users.email, ["brett.hansen@sykesgroup.com", "ryan.pemberton@atlascopco.com"]));

if (!reps.length) { console.error("❌ Reps not found"); process.exit(1); }

for (const rep of reps) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📧 DRY-RUN PREVIEW: ${rep.name} (${rep.email}) [userId=${rep.id}]`);
  console.log("=".repeat(70));
  try {
    const result = await sendWeeklyDigestsForUser(rep.id);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`❌ Error for ${rep.name}:`, err instanceof Error ? err.message : String(err));
  }
}

process.exit(0);
