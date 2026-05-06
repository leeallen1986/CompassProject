/**
 * QTOL NT Subprocess Test Script
 * ================================
 * Run with: node --import tsx/esm test-qtol-subprocess.mjs
 * Or:       npx tsx test-qtol-subprocess.mjs
 *
 * Tests:
 *   1. Smoke test  — subprocess runs with default timeout, returns structured result
 *   2. Timeout test — subprocess is killed after 3s (forced short timeout), returns timed_out
 *   3. Disabled test — QTOL_NT_SUBPROCESS_ENABLED=false falls back to in-process
 */

import { runQtolNTIsolated, isSubprocessEnabled, getSubprocessTimeoutMs } from "./server/qtolNTSubprocess.ts";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ── Test 1: Smoke test (normal path) ──
console.log("\n=== Test 1: Smoke test (subprocess enabled, default timeout) ===");
{
  process.env.QTOL_NT_SUBPROCESS_ENABLED = "true";
  delete process.env.QTOL_NT_SUBPROCESS_TIMEOUT_MS;

  assert(isSubprocessEnabled() === true, "isSubprocessEnabled() returns true");
  assert(getSubprocessTimeoutMs() === 300000, "Default timeout is 300000ms (5 min)");

  console.log("  Running subprocess (may take up to 60s for live scrape)...");
  const t0 = Date.now();
  const result = await runQtolNTIsolated(0);
  const elapsed = Date.now() - t0;

  console.log(`  Result: status=${result.status}, durationMs=${result.durationMs}, elapsed=${elapsed}ms`);
  if (result.data) {
    console.log(`  Data: tendersFound=${result.data.tendersFound}, projectsCreated=${result.data.projectsCreated}, degraded=${result.data.degraded}`);
  }
  if (result.errorSummary) {
    console.log(`  Error: ${result.errorSummary}`);
  }

  assert(["success", "failed", "timed_out"].includes(result.status), "Result has valid status");
  assert(typeof result.durationMs === "number" && result.durationMs > 0, "durationMs is a positive number");
  assert(result.status !== "timed_out" || result.errorSummary?.includes("timeout"), "Timeout result has descriptive error");

  if (result.status === "success") {
    assert(result.data !== undefined, "Success result has data");
    assert(typeof result.data?.tendersFound === "number", "tendersFound is a number");
  }
}

// ── Test 2: Forced timeout test ──
console.log("\n=== Test 2: Forced timeout test (3s wall-clock kill) ===");
{
  process.env.QTOL_NT_SUBPROCESS_ENABLED = "true";
  process.env.QTOL_NT_SUBPROCESS_TIMEOUT_MS = "3000"; // 3 seconds — will kill before scrape completes

  assert(getSubprocessTimeoutMs() === 3000, "Timeout env var overrides default to 3000ms");

  console.log("  Running subprocess with 3s timeout (should be killed)...");
  const t0 = Date.now();
  const result = await runQtolNTIsolated(0);
  const elapsed = Date.now() - t0;

  console.log(`  Result: status=${result.status}, durationMs=${result.durationMs}, elapsed=${elapsed}ms`);
  if (result.errorSummary) console.log(`  Error: ${result.errorSummary}`);

  assert(result.status === "timed_out", "Status is timed_out after 3s");
  assert(elapsed >= 3000 && elapsed < 10000, `Elapsed time ${elapsed}ms is between 3s and 10s`);
  assert(result.errorSummary?.includes("timeout") || result.errorSummary?.includes("killed") || result.errorSummary?.includes("signal"), "Error summary mentions timeout or kill");

  // Restore
  delete process.env.QTOL_NT_SUBPROCESS_TIMEOUT_MS;
}

// ── Test 3: Subprocess disabled (in-process fallback) ──
console.log("\n=== Test 3: Subprocess disabled (QTOL_NT_SUBPROCESS_ENABLED=false) ===");
{
  process.env.QTOL_NT_SUBPROCESS_ENABLED = "false";

  assert(isSubprocessEnabled() === false, "isSubprocessEnabled() returns false when env=false");

  console.log("  Running in-process fallback (may take up to 60s)...");
  const t0 = Date.now();
  const result = await runQtolNTIsolated(0);
  const elapsed = Date.now() - t0;

  console.log(`  Result: status=${result.status}, durationMs=${result.durationMs}, elapsed=${elapsed}ms`);
  if (result.data) {
    console.log(`  Data: tendersFound=${result.data.tendersFound}, degraded=${result.data.degraded}`);
  }

  assert(["success", "failed"].includes(result.status), "In-process result is success or failed (not timed_out)");
  assert(typeof result.durationMs === "number" && result.durationMs > 0, "durationMs is a positive number");

  // Restore
  process.env.QTOL_NT_SUBPROCESS_ENABLED = "true";
}

// ── Summary ──
console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("SOME TESTS FAILED");
  process.exit(1);
} else {
  console.log("ALL TESTS PASSED");
  process.exit(0);
}
