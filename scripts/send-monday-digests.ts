/**
 * Send Monday digests to the 5 target reps using the force-send path.
 * Uses sendWeeklyDigestToUser with forceOverride=true.
 * Sends sequentially — stops and reports if any rep fails.
 */
import "dotenv/config";
import { sendWeeklyDigestToUser } from "../server/emailDigest";

const TARGET_REPS = [
  { id: 2340043, name: "Ryan Pemberton", email: "ryan.pemberton@atlascopco.com" },
  { id: 2550006, name: "Brett Hansen", email: "brett.hansen@sykesgroup.com" },
  { id: 2820073, name: "Daniel Zec", email: "daniel.zec@atlascopco.com" },
  { id: 3630009, name: "Dan Day", email: "dan.day@atlascopco.com" },
  { id: 3870014, name: "Amit Bhargava", email: "amit.bhargava@atlascopco.com" },
];

interface SendResult {
  name: string;
  email: string;
  userId: number;
  status: string;
  timestamp: string;
  digestType: string;
  itemCount: string | number;
  error: string | null;
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║       LIVE MONDAY DIGEST SEND — 5 TARGET REPS              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`EMAIL_DIGESTS_ENABLED: ${process.env.EMAIL_DIGESTS_ENABLED}`);
  console.log(`RESEND_API_KEY: ${process.env.RESEND_API_KEY ? "SET" : "NOT SET"}`);
  console.log(`EMAIL_FROM_ADDRESS: ${process.env.EMAIL_FROM_ADDRESS}\n`);

  if (process.env.EMAIL_DIGESTS_ENABLED !== "true") {
    console.error("ABORT: EMAIL_DIGESTS_ENABLED is not 'true'. Cannot send.");
    process.exit(1);
  }

  const results: SendResult[] = [];

  for (const rep of TARGET_REPS) {
    console.log(`\n━━━ Sending to ${rep.name} (${rep.email}) ━━━`);
    const startTime = Date.now();

    try {
      const result = await sendWeeklyDigestToUser(rep.id, true); // forceOverride = true
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(1);

      if (!result) {
        const entry: SendResult = {
          name: rep.name,
          email: rep.email,
          userId: rep.id,
          status: "null_response",
          timestamp: new Date().toISOString(),
          digestType: "monday",
          itemCount: 0,
          error: "sendWeeklyDigestToUser returned null (user not found or no report)",
        };
        results.push(entry);
        console.error(`  ⚠ STOPPING: ${rep.name} returned null`);
        console.log("\n=== RESULTS SO FAR ===");
        console.log(JSON.stringify(results, null, 2));
        process.exit(1);
      }

      const entry: SendResult = {
        name: rep.name,
        email: rep.email,
        userId: rep.id,
        status: result.sent ? "sent" : "failed",
        timestamp: new Date().toISOString(),
        digestType: "monday",
        itemCount: "N/A", // The function doesn't return itemCount directly
        error: result.error || null,
      };

      results.push(entry);
      console.log(`  Status: ${entry.status}`);
      console.log(`  Subject: ${result.subject}`);
      console.log(`  Duration: ${duration}s`);

      if (!result.sent) {
        console.error(`\n⚠ STOPPING: ${rep.name} failed — ${result.error || "sent=false"}`);
        console.log("\n=== RESULTS SO FAR ===");
        console.log(JSON.stringify(results, null, 2));
        process.exit(1);
      }
    } catch (error: any) {
      const entry: SendResult = {
        name: rep.name,
        email: rep.email,
        userId: rep.id,
        status: "exception",
        timestamp: new Date().toISOString(),
        digestType: "monday",
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

  // Now verify the userEmailSendLog rows
  console.log("\n━━━ VERIFYING userEmailSendLog ━━━");
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL!, connectTimeout: 5000 });
  const userIds = TARGET_REPS.map(r => r.id);
  const [logs] = await conn.query(
    `SELECT userId, status, sentAt, itemCount, dryRun, weekKey 
     FROM userEmailSendLog 
     WHERE userId IN (?) AND digestType='monday' AND sentDate = CURDATE()
     ORDER BY sentAt DESC`,
    [userIds]
  ) as any;

  console.log("\nFinal userEmailSendLog rows for today:");
  for (const log of logs) {
    const repName = TARGET_REPS.find(r => r.id === log.userId)?.name || "Unknown";
    console.log(`  ${repName} (${log.userId}): status=${log.status}, items=${log.itemCount}, dryRun=${log.dryRun}, weekKey=${log.weekKey}, sentAt=${log.sentAt}`);
  }

  await conn.end();
  process.exit(0);
}

main();
