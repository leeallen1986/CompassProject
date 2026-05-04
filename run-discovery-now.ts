/**
 * Run the discovery queue directly for hot/warm projects.
 * Uses tsx to handle TypeScript imports.
 */
import 'dotenv/config';
import { processDiscoveryQueue } from './server/discoveryQueue';

async function main() {
  console.log('[Sweep] Starting targeted discovery sweep for priority A projects...');
  console.log('[Sweep] Batch size: 50, priority filter: A (hot projects)');
  console.log('[Sweep] This will call LinkedIn People Search + Apollo for each project...\n');
  
  try {
    const result = await processDiscoveryQueue({ priorityFilter: 'A', maxBatch: 50 });
    
    console.log('\n=== DISCOVERY SWEEP RESULTS ===');
    console.log(`Processed: ${result.processed} projects`);
    console.log(`Priority A: ${result.priorityA}, B: ${result.priorityB}, C: ${result.priorityC}`);
    console.log(`New send-ready: ${result.newSendReady}`);
    console.log(`Named (no email): ${result.newNamedNoEmail}`);
    console.log(`Role only: ${result.newRoleOnly}`);
    console.log(`Blocked: ${result.blocked}`);
    console.log(`Failed: ${result.failed}`);
    
    // Show per-project detail
    console.log('\n--- Per-Project Results ---');
    for (const r of result.results) {
      const status = r.error ? `ERROR: ${r.error}` : r.newStatus;
      const providers = r.providersUsed?.join(', ') || 'none';
      console.log(`  #${r.projectId} ${r.projectName?.substring(0, 50)} → ${status} (providers: ${providers})`);
    }
  } catch (err: any) {
    console.error('[Sweep] Fatal error:', err.message);
    console.error(err.stack);
  }
  
  process.exit(0);
}

main();
