/**
 * Send Monday digests to the 5 target reps using the force-send path.
 * Uses the sendWeeklyDigestToUser function with forceOverride=true.
 * Sends sequentially — stops and reports if any rep fails.
 */
import dotenv from 'dotenv';
dotenv.config();

const TARGET_REPS = [
  { id: 2340043, name: "Ryan Pemberton", email: "ryan.pemberton@atlascopco.com" },
  { id: 2550006, name: "Brett Hansen", email: "brett.hansen@sykesgroup.com" },
  { id: 2820073, name: "Daniel Zec", email: "daniel.zec@atlascopco.com" },
  { id: 3630009, name: "Dan Day", email: "dan.day@atlascopco.com" },
  { id: 3870014, name: "Amit Bhargava", email: "amit.bhargava@atlascopco.com" },
];

// We need to call the server's sendWeeklyDigestToUser function directly
// Since this is a standalone script, we'll make HTTP calls to the deployed tRPC endpoint
// But we don't have admin auth cookies in this script context.
// 
// Alternative: import the function directly from the server code.
// The emailDigest module exports sendWeeklyDigestToUser.

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║       LIVE MONDAY DIGEST SEND — 5 TARGET REPS              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`EMAIL_DIGESTS_ENABLED: ${process.env.EMAIL_DIGESTS_ENABLED}`);
  console.log(`RESEND_API_KEY: ${process.env.RESEND_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`EMAIL_FROM_ADDRESS: ${process.env.EMAIL_FROM_ADDRESS}\n`);

  // Dynamic import of the emailDigest module
  const { sendWeeklyDigestToUser } = await import("../server/emailDigest.ts");

  const results = [];

  for (const rep of TARGET_REPS) {
    console.log(`\n━━━ Sending to ${rep.name} (${rep.email}) ━━━`);
    const startTime = new Date();
    
    try {
      const result = await sendWeeklyDigestToUser(rep.id, true); // forceOverride = true
      const endTime = new Date();
      
      const entry = {
        name: rep.name,
        email: rep.email,
        userId: rep.id,
        status: result?.status || (result?.sent ? 'sent' : 'unknown'),
        timestamp: endTime.toISOString(),
        duration: `${((endTime - startTime) / 1000).toFixed(1)}s`,
        itemCount: result?.itemCount || result?.items || 'N/A',
        error: result?.error || null,
      };
      
      results.push(entry);
      console.log(`  Status: ${entry.status}`);
      console.log(`  Items: ${entry.itemCount}`);
      console.log(`  Duration: ${entry.duration}`);
      
      if (entry.status === 'failed' || entry.error) {
        console.error(`\n⚠ STOPPING: ${rep.name} failed with error: ${entry.error}`);
        console.log("\n=== RESULTS SO FAR ===");
        console.log(JSON.stringify(results, null, 2));
        process.exit(1);
      }
    } catch (error) {
      const endTime = new Date();
      const entry = {
        name: rep.name,
        email: rep.email,
        userId: rep.id,
        status: 'exception',
        timestamp: endTime.toISOString(),
        duration: `${((endTime - startTime) / 1000).toFixed(1)}s`,
        itemCount: 0,
        error: error.message || String(error),
      };
      results.push(entry);
      console.error(`\n⚠ STOPPING: ${rep.name} threw exception: ${error.message}`);
      console.log("\n=== RESULTS SO FAR ===");
      console.log(JSON.stringify(results, null, 2));
      process.exit(1);
    }
  }

  console.log("\n\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                    ALL 5 SENDS COMPLETE                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
