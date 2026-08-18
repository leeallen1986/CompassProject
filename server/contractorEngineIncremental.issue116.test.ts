import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(new URL(`./${relative}`, import.meta.url), "utf8");

describe("Issue #116 contractor-engine integration", () => {
  it("routes both source and bundled subprocess workers through the incremental engine", () => {
    const worker = read("contractorEngineWorker.ts");
    const index = read("_core/index.ts");
    expect(worker).toContain('runIncrementalContractorEngine');
    expect(worker).toContain('contractor-engine-progress');
    expect(worker).not.toContain('runContractorEngine } from "./contractorEngine"');
    expect(index).toContain('await import("../contractorEngineIncremental")');
    expect(index).toContain('await runIncrementalContractorEngine(');
    expect(index).toContain('type: "contractor-engine-progress"');
    expect(index).not.toContain('await import("../contractorEngine")');
  });

  it("preserves the 50-minute hard child-process boundary", () => {
    const subprocess = read("contractorEngineSubprocess.ts");
    expect(subprocess).toContain("export const CONTRACTOR_ENGINE_TIMEOUT_MS = 50 * 60 * 1000");
    expect(subprocess).toContain('child.kill("SIGKILL")');
    expect(subprocess).toContain("buildHardTimeoutSummary");
    expect(subprocess).toContain("progress: lastProgress");
  });

  it("uses persisted cursors and progress without a schema migration", () => {
    const source = read("contractorEngineIncremental.ts");
    const policy = read("contractorEngineIncrementalPolicy.ts");
    expect(source).toContain("getSystemKv(CONTRACTOR_ENGINE_CURSOR_KEY)");
    expect(source).toContain("setSystemKv(CONTRACTOR_ENGINE_PROGRESS_KEY");
    expect(source).toContain("persistCursor(cursor)");
    expect(policy).toContain('contractorEngine.incremental.v1');
    expect(policy).toContain('contractorEngine.incremental.progress.v1');
  });

  it("replaces only seed-data links for a bounded project batch", () => {
    const source = read("contractorEngineIncremental.ts");
    expect(source).toContain('eq(contractorProjectLinks.source, "seed_data")');
    expect(source).toContain("inArray(contractorProjectLinks.projectId, projectIds)");
    expect(source).not.toContain("db.delete(contractorProjectLinks)\n        .where(eq(contractorProjectLinks.contractorId");
  });

  it("keeps pairings idempotent instead of clearing and blindly duplicating them", () => {
    const source = read("contractorEngineIncremental.ts");
    expect(source).toContain("existingByKey");
    expect(source).toContain("await db.update(contractorPairings).set(values)");
    expect(source).toContain("staleIds");
    expect(source).not.toContain("await db.delete(contractorPairings);");
  });

  it("does not introduce provider work and does not make Contractor Engine critical", () => {
    const source = read("contractorEngineIncremental.ts");
    const pipeline = read("dailyPipeline.ts");
    expect(source).not.toContain("invokeLLM(");
    expect(source).not.toContain("runExtractionPipeline");
    const criticalStart = pipeline.indexOf("const CRITICAL_STEP_NAMES");
    const criticalEnd = pipeline.indexOf("]);", criticalStart);
    const criticalBlock = pipeline.slice(criticalStart, criticalEnd);
    expect(criticalBlock).not.toContain('"Contractor Engine"');
  });
});
