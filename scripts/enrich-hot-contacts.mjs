/**
 * Trigger Apollo enrichment for all Hot tier campaign contacts.
 * Runs in batches of 50 to stay within rate limits.
 */
import 'dotenv/config';

const BASE_URL = `http://localhost:3000`;

// We need to call the enrichCampaignContacts endpoint via tRPC
// The endpoint is: campaign.enrichContacts (adminProcedure)
// We'll call it directly via the campaign service instead

async function main() {
  // Dynamic import of the campaign service
  const { enrichCampaignContacts } = await import('../server/campaignService.ts');
  
  const campaignId = 2;
  const batchSize = 50;
  let totalEnriched = 0;
  let totalNotFound = 0;
  let totalFailed = 0;
  let totalCredits = 0;
  let batch = 1;
  
  console.log(`\n🔍 Starting Apollo enrichment for Hot tier contacts (campaign ${campaignId})...\n`);
  
  while (true) {
    console.log(`--- Batch ${batch} (max ${batchSize} contacts) ---`);
    
    try {
      const result = await enrichCampaignContacts(campaignId, {
        maxContacts: batchSize,
        userId: 1,
        userName: 'system_enrichment',
      });
      
      console.log(`  Enriched: ${result.enriched}`);
      console.log(`  Not found: ${result.notFound}`);
      console.log(`  Failed: ${result.failed}`);
      console.log(`  Credits used: ${result.creditsUsed}`);
      
      totalEnriched += result.enriched;
      totalNotFound += result.notFound;
      totalFailed += result.failed;
      totalCredits += result.creditsUsed;
      
      // If no contacts were processed, we're done
      if (result.enriched + result.notFound + result.failed === 0) {
        console.log(`\n✅ No more pending contacts. Enrichment complete.`);
        break;
      }
      
      batch++;
      
      // Safety limit — don't exceed 300 contacts total
      if (totalEnriched + totalNotFound + totalFailed >= 300) {
        console.log(`\n⚠ Safety limit reached (300 contacts processed).`);
        break;
      }
      
      // Pause between batches
      console.log(`  Pausing 2s before next batch...\n`);
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ❌ Batch ${batch} failed:`, err.message);
      break;
    }
  }
  
  console.log(`\n========== ENRICHMENT SUMMARY ==========`);
  console.log(`Total enriched:   ${totalEnriched}`);
  console.log(`Total not found:  ${totalNotFound}`);
  console.log(`Total failed:     ${totalFailed}`);
  console.log(`Total credits:    ${totalCredits}`);
  console.log(`=========================================\n`);
  
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
