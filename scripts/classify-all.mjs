import 'dotenv/config';
import { classifyAllProjects, getTierDistribution } from '../server/tierClassification.ts';

try {
  console.log("Starting bulk classification...");
  const result = await classifyAllProjects();
  console.log("Classification complete:");
  console.log(JSON.stringify(result, null, 2));
  
  console.log("\nTier distribution:");
  const dist = await getTierDistribution();
  console.log(JSON.stringify(dist, null, 2));
} catch (err) {
  console.error("Error:", err);
}
process.exit(0);
