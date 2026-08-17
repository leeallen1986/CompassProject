import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("Issue #104 release-controlled worker execution", () => {
  it("tracks a runner that logs before importing application pipeline code", () => {
    const text = read("pipeline-runner.ts");
    const boot = text.indexOf('launcherLog("runner_boot"');
    const importDaily = text.indexOf('await import("./server/dailyPipeline")');
    expect(boot).toBeGreaterThan(-1);
    expect(importDaily).toBeGreaterThan(boot);
    expect(text).toContain("finalizeOwnedPipelineRun");
    expect(text).toContain("heartbeatOwnedPipelineRun");
    expect(text).toContain("terminate_apollo_timeout");
  });

  it("tracks a cron wrapper with an OS process boundary and separate recovery mode", () => {
    const text = read("run-pipeline.sh");
    expect(text).toContain("/usr/bin/timeout --signal=TERM --kill-after=120s");
    expect(text).toContain('PROCESS_LIMIT="185m"');
    expect(text).toContain('PROCESS_LIMIT="75m"');
    expect(text).toContain('pipeline-runner.ts" "$MODE"');
    expect(text).toContain("pipeline-launcher.log");
  });

  it("keeps worker recovery out of contact, Apollo and Contractor enrichment", () => {
    const text = read("server/pipelineRecovery.ts");
    expect(text).toContain('triggeredBy: "self-healing-retry"');
    expect(text).toContain("harvestAllFeeds");
    expect(text).toContain("runExtractionPipeline");
    expect(text).toContain("classifyAllProjects");
    expect(text).toContain("markStaleProjects");
    expect(text).not.toContain("enrichProjectContacts");
    expect(text).not.toContain("runContractorEngine");
    expect(text).not.toContain("findEligibleProjects");
  });

  it("never prints protected environment contents from the tracked runner or wrapper", () => {
    const combined = `${read("pipeline-runner.ts")}\n${read("run-pipeline.sh")}`;
    expect(combined).not.toContain("cat .env");
    expect(combined).not.toContain("printenv");
    expect(combined).not.toContain("AI_EXTRACTION_API_KEY");
    expect(combined).not.toContain("DATABASE_URL=");
  });
});
