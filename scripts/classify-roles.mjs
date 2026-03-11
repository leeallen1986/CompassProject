import { classifyAllContactRelevance, getRoleRelevanceDistribution } from '../server/roleRelevance.ts';

async function main() {
  console.log('Starting bulk role relevance classification...');
  
  const result = await classifyAllContactRelevance();
  console.log(`Classification complete:`);
  console.log(`  Total contacts: ${result.total}`);
  console.log(`  Classified: ${result.classified}`);
  console.log(`  High relevance: ${result.highCount}`);
  console.log(`  Medium relevance: ${result.mediumCount}`);
  console.log(`  Low relevance: ${result.lowCount}`);
  
  console.log('\nDistribution check:');
  const dist = await getRoleRelevanceDistribution();
  console.log(`  High: ${dist.high}`);
  console.log(`  Medium: ${dist.medium}`);
  console.log(`  Low: ${dist.low}`);
  console.log(`  Unclassified: ${dist.unclassified}`);
  console.log(`  Total: ${dist.total}`);
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
