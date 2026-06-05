/**
 * Targeted enrichment for zero-contact specialty air projects
 * Projects: Ichthys LNG Project Operations (1200065), Browse LNG (1290001), Ichthys LNG Export Terminal (1680001)
 */
import { execSync } from 'child_process';
import { createRequire } from 'module';

const projectIds = [1200065, 1290001, 1680001];

// Use the app's enrichment endpoint via HTTP
const BASE_URL = 'http://localhost:3000';
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;

if (!PIPELINE_SECRET) {
  console.error('PIPELINE_SECRET not set');
  process.exit(1);
}

for (const projectId of projectIds) {
  console.log(`\nTriggering enrichment for project ${projectId}...`);
  try {
    const res = await fetch(`${BASE_URL}/api/admin/enrich-project`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pipeline-secret': PIPELINE_SECRET,
      },
      body: JSON.stringify({ projectId }),
    });
    const data = await res.json();
    console.log(`Project ${projectId}:`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Failed for project ${projectId}:`, err.message);
  }
}
