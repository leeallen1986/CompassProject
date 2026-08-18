import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Issue #104 production reliability wiring", () => {
  it("selects the execution-plane budget inside the real daily pipeline", () => {
    const daily = source("./dailyPipeline.ts");
    expect(daily).toContain('import { selectPipelineRuntimeBudgetMs } from "./pipelineRuntimePolicy"');
    expect(daily).toContain("selectPipelineRuntimeBudgetMs(triggeredBy)");
    expect(daily).not.toContain("const PIPELINE_TIMEOUT_MS = 90 * 60 * 1000");
  });

  it("runs the Contractor Engine through the isolated hard-timeout boundary", () => {
    const daily = source("./dailyPipeline.ts");
    expect(daily).toContain('import { runContractorEngineIsolated } from "./contractorEngineSubprocess"');
    expect(daily).toContain('markStepStarted("Contractor Engine")');
    expect(daily).toContain("await runContractorEngineIsolated()");
    expect(daily).not.toContain("await runContractorEngine()");
  });

  it("routes production HTTP triggers through the stale-run guard and V2 reliability", () => {
    const index = source("./_core/index.ts");
    expect(index).toContain('from "../scheduledPipelineGuard"');
    expect(index).toContain('from "../operationsReliabilityV2"');
    expect(index).not.toContain("registerSigtermHandler");
  });

  it("does not invoke production startup cleanup through the legacy dev scheduler", () => {
    const index = source("./_core/index.ts");
    expect(index).toContain('process.env.NODE_ENV !== "production"');
    expect(index).toContain('process.env.DISABLE_DEV_SCHEDULER !== "true"');
    expect(index).toContain("if (useDevPipelineScheduler) startDailyScheduler()");
  });

  it("uses an incremental dedicated worker behind the hard boundary and retains bundled child-only mode", () => {
    const index = source("./_core/index.ts");
    const isolated = source("./contractorEngineSubprocess.ts");
    const worker = source("./contractorEngineWorker.ts");

    expect(isolated).toContain('"contractorEngineWorker.ts"');
    expect(isolated).toContain('COMPASS_SUBPROCESS_MODE: "contractor-engine"');
    expect(isolated).toContain('child.kill("SIGKILL")');
    expect(worker).toContain("await runIncrementalContractorEngine(");
    expect(worker).toContain('type: "contractor-engine-progress"');
    expect(worker).toContain("process.send(message, () => process.exit(code))");
    expect(index).toContain('COMPASS_SUBPROCESS_MODE !== "contractor-engine"');
    expect(index).toContain("process.send(message, () => process.exit(code))");
  });
});
