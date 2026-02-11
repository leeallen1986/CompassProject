/**
 * Run AI extraction on all queued articles in batches
 */
import 'dotenv/config';

const { runExtractionPipeline } = await import('./server/aiExtractor.ts');

const startTime = Date.now();
let totalExtracted = 0;
let totalProcessed = 0;
let totalDuplicates = 0;
let totalFailed = 0;
let pass = 0;

console.log("=== RUNNING AI EXTRACTION ON ALL QUEUED ARTICLES ===\n");

while (pass < 50) {  // Max 50 passes to process all 234
  pass++;
  try {
    const r = await runExtractionPipeline();
    totalProcessed += r.processed;
    totalExtracted += r.extracted;
    totalDuplicates += r.duplicates;
    totalFailed += r.failed;
    
    console.log(`Pass ${pass}: processed=${r.processed}, extracted=${r.extracted}, duplicates=${r.duplicates}, failed=${r.failed}, credits=${r.creditsUsed}`);
    
    if (r.processed === 0) {
      console.log("No more queued articles. Done.");
      break;
    }
  } catch (e) {
    console.error(`Pass ${pass} failed: ${e.message}`);
    // Wait a bit and retry
    await new Promise(r => setTimeout(r, 5000));
  }
}

const duration = Math.round((Date.now() - startTime) / 1000);
console.log(`\n=== EXTRACTION COMPLETE in ${duration}s ===`);
console.log(`Total passes: ${pass}`);
console.log(`Total processed: ${totalProcessed}`);
console.log(`Total extracted: ${totalExtracted}`);
console.log(`Total duplicates: ${totalDuplicates}`);
console.log(`Total failed: ${totalFailed}`);

process.exit(0);
