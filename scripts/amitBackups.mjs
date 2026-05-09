import 'dotenv/config';
import { getDb, getActiveProjects, getAllContacts } from '../server/db.ts';
import { users, userProfiles } from '../drizzle/schema.ts';
import { eq } from 'drizzle-orm';
import { selectProjectContact } from '../server/contactSelector.ts';
import { scoreAndFilterProjects } from '../server/emailDigest.ts';

async function main() {
  const db = await getDb();
  
  // Get Amit's profile
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, 3870014));
  if (!profile) { console.log("No profile for Amit"); process.exit(1); }
  
  const allProjects = await getActiveProjects();
  const allContacts = await getAllContacts();
  
  // Score and filter for Amit
  const scored = await scoreAndFilterProjects(allProjects, allContacts, profile);
  
  console.log("=== AMIT'S TOP 10 SCORED PROJECTS (with contact info) ===");
  const top10 = scored.slice(0, 10);
  
  for (let i = 0; i < top10.length; i++) {
    const p = top10[i];
    const projectContacts = allContacts.filter(c => c.project === p.name);
    const result = selectProjectContact(projectContacts, {
      projectName: p.name,
      projectOwner: p.owner || undefined,
      projectState: p.state || null,
      buyerRoles: profile.buyerRoles || undefined,
    });
    const selected = result.selectedContact;
    
    // Check domain defensibility
    let domainStatus = "N/A";
    if (selected && selected.email) {
      const domain = selected.email.split("@")[1];
      const ownerNorm = (p.owner || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const domainPrefix = domain.split(".")[0].toLowerCase();
      
      // isTruncatedDomain check
      let isTruncated = false;
      if (ownerNorm && ownerNorm.includes(domainPrefix) && domainPrefix.length < ownerNorm.length && domainPrefix.length > 5) {
        isTruncated = true;
      }
      if (!isTruncated && domainPrefix.length >= ownerNorm.length - 4 && domainPrefix.length < ownerNorm.length && ownerNorm) {
        let oi = 0, di = 0;
        while (oi < ownerNorm.length && di < domainPrefix.length) {
          if (ownerNorm[oi] === domainPrefix[di]) di++;
          oi++;
        }
        if (di === domainPrefix.length) isTruncated = true;
      }
      domainStatus = isTruncated ? "FAILS (truncated)" : "PASSES";
    }
    
    console.log(`  ${i+1}. [${p.id}] ${p.name}`);
    console.log(`     Owner: ${p.owner || "N/A"} | Score: ${p.relevanceScore || "N/A"}`);
    console.log(`     Contact: ${selected ? selected.name : "NONE"} | Trust: ${selected ? selected.trustTier : "N/A"}`);
    console.log(`     Email: ${selected ? selected.email : "N/A"} | Domain: ${domainStatus}`);
    console.log(`     Title: ${selected ? selected.title : "N/A"}`);
    console.log(`     Company: ${selected ? selected.company : "N/A"}`);
    console.log("");
  }
  
  process.exit(0);
}
main();
