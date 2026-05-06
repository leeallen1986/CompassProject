import { sendWeeklyDigests } from "./server/emailDigest";
import * as fs from "fs";

async function main() {
  const results = await sendWeeklyDigests(false, true);
  const waUser = (results.previews ?? []).find(p => (p.subject ?? "").includes("| WA "));
  if (!waUser) { console.log("No WA user found"); process.exit(0); }
  const content = waUser.contentSnippet ?? "";
  const lines = content.split("\n");
  const vicLines: string[] = [];
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes("vic")) {
      vicLines.push(`Line ${i}: ${line}`);
    }
  });
  console.log("=== VIC occurrences in WA digest ===");
  vicLines.forEach(l => console.log(l));
  if (vicLines.length === 0) console.log("(none found)");
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
