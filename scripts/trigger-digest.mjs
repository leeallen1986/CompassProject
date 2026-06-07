/**
 * Trigger the Monday digest via the tRPC admin endpoint.
 * Uses the PIPELINE_SECRET for admin authentication.
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';

config({ path: '.env' });

const BASE_URL = 'http://localhost:3000';
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;

if (!PIPELINE_SECRET) {
  console.error('❌ PIPELINE_SECRET not found in .env');
  process.exit(1);
}

console.log('🚀 Triggering Monday digest via tRPC admin endpoint...');
console.log(`   Base URL: ${BASE_URL}`);

// First check freshness
const freshnessRes = await fetch(`${BASE_URL}/api/trpc/digest.getScheduleStatus`, {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'x-pipeline-secret': PIPELINE_SECRET,
  },
});

if (freshnessRes.ok) {
  const freshnessData = await freshnessRes.json();
  console.log('📊 Freshness status:', JSON.stringify(freshnessData?.result?.data?.pipelineFreshness ?? freshnessData, null, 2));
}

// Trigger the digest
const res = await fetch(`${BASE_URL}/api/trpc/digest.sendNow`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-pipeline-secret': PIPELINE_SECRET,
  },
  body: JSON.stringify({}),
});

const text = await res.text();
console.log(`\n📧 Response status: ${res.status}`);

try {
  const data = JSON.parse(text);
  console.log('📧 Digest result:', JSON.stringify(data?.result?.data ?? data, null, 2));
} catch {
  console.log('📧 Raw response:', text.slice(0, 500));
}
