/**
 * Preview the Monday digest for user 1 (Lee) to see what it would contain
 * with the new contacts from the sweep.
 */
import 'dotenv/config';
import { sendWeeklyDigestsForUser } from './server/emailDigest';

async function main() {
  console.log('[Digest Preview] Generating Monday digest preview for Lee (userId: 1)...\n');
  
  try {
    const result = await sendWeeklyDigestsForUser(1);
    console.log('=== DIGEST PREVIEW RESULT ===');
    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('[Digest Preview] Error:', err.message);
    console.error(err.stack);
  }
  
  process.exit(0);
}

main();
