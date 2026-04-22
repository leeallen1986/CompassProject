/**
 * previewMondayDigests.mjs
 * Generates Monday PT Capital Sales digest previews for all 3 pilot reps.
 * Validates: subject, PT wording, freshness, ACT codes, deep-links, contractor rendering.
 * Does NOT send any emails.
 */
import { register } from "tsx/esm/api";
register();

const { sendWeeklyDigestsForUser } = await import("../server/emailDigest.ts");

const PILOT_REPS = [
  { id: 840008,  name: "Leo Williams",    email: "leo.williams@atlascopco.com" },
  { id: 2340043, name: "Ryan Pemberton",  email: "ryan.pemberton@atlascopco.com" },
  { id: 3870014, name: "Amit Bhargava",   email: "amit.bhargava@atlascopco.com" },
];

const QC_CHECKS = [
  { key: "subject_no_portable_air",  label: "Subject: no 'Portable Air'",          test: (s, b) => !s.includes("Portable Air") },
  { key: "subject_pt_capital_sales", label: "Subject: 'PT Capital Sales' present",  test: (s, b) => s.includes("PT Capital Sales") },
  { key: "subject_weekly_brief",     label: "Subject: 'Weekly Intelligence Brief'", test: (s, b) => s.includes("Weekly Intelligence Brief") },
  { key: "freshness_line",           label: "Body: freshness line present",          test: (s, b) => /refreshed|Data freshness|Last updated|last refresh/i.test(b) },
  { key: "act_code",                 label: "Body: ACT- reference code present (if projects exist)", test: (s, b) => {
    // Only required if project blocks exist in the body
    const hasProjects = /ACT-|\*\*HOT\*\*|\*\*WARM\*\*|Priority:/i.test(b);
    if (!hasProjects) return true; // no projects = skip check
    return /ACT-\w+/i.test(b);
  }},
  { key: "deep_link",                label: "Body: /this-week deep-link present (if projects exist)", test: (s, b) => {
    const hasProjects = /ACT-|\*\*HOT\*\*|\*\*WARM\*\*|Priority:/i.test(b);
    if (!hasProjects) return true; // no projects = skip check
    return b.includes("/this-week");
  }},
  { key: "no_raw_html",              label: "Body: no raw HTML anchor tags",         test: (s, b) => !/<a\s+href/i.test(b) },
  { key: "no_raw_url",               label: "Body: no bare http:// URLs in contractor lines", test: (s, b) => {
    // Only flag if a contractor line contains a raw URL
    const contractorLines = b.split("\n").filter(l => /contractor|owner/i.test(l));
    return !contractorLines.some(l => /https?:\/\//.test(l));
  }},
];

const results = [];

for (const rep of PILOT_REPS) {
  console.log(`\n--- Generating preview for ${rep.name} (userId=${rep.id}) ---`);
  let preview;
  try {
    preview = await sendWeeklyDigestsForUser(rep.id, { dryRun: true });
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    results.push({ rep: rep.name, error: err.message, checks: [] });
    continue;
  }

  if (!preview) {
    console.log(`  SKIP: No digest generated (user may have no matching projects)`);
    results.push({ rep: rep.name, skipped: true, checks: [] });
    continue;
  }

  const subject = preview.subject || "";
  const body = preview.content || preview.body || preview.text || preview.html || "";

  console.log(`  Subject: ${subject}`);
  console.log(`  Body length: ${body.length} chars`);
  console.log(`  First 200 chars: ${body.slice(0, 200).replace(/\n/g, " ")}`);

  const checks = QC_CHECKS.map(c => {
    const pass = c.test(subject, body);
    console.log(`  ${pass ? "✅" : "❌"} ${c.label}`);
    return { key: c.key, label: c.label, pass };
  });

  const passed = checks.filter(c => c.pass).length;
  const failed = checks.filter(c => !c.pass).length;
  console.log(`  QC: ${passed}/${checks.length} passed`);

  results.push({ rep: rep.name, subject, bodyLength: body.length, checks, passed, failed });
}

console.log("\n=== PREVIEW QC SUMMARY ===");
for (const r of results) {
  if (r.error) {
    console.log(`${r.rep}: ERROR — ${r.error}`);
  } else if (r.skipped) {
    console.log(`${r.rep}: SKIPPED (no projects)`);
  } else {
    const status = r.failed === 0 ? "✅ PASS" : `❌ ${r.failed} FAIL`;
    console.log(`${r.rep}: ${status} (${r.passed}/${r.checks.length} checks)`);
    if (r.failed > 0) {
      r.checks.filter(c => !c.pass).forEach(c => console.log(`  ❌ ${c.label}`));
    }
  }
}

const allPassed = results.every(r => !r.error && !r.skipped && r.failed === 0);
console.log(`\n=== GO / NO-GO: ${allPassed ? "✅ GO — all previews clean" : "❌ NO-GO — fix failures before send"} ===\n`);
process.exit(allPassed ? 0 : 1);
