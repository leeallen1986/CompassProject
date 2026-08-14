import { describe, expect, it } from "vitest";
import {
  AUTOMATED_PIPELINE_TIMEOUT_MS,
  MANUAL_PIPELINE_TIMEOUT_MS,
  isAutomatedPipelineTrigger,
  selectPipelineRuntimeBudgetMs,
} from "./pipelineRuntimePolicy";

describe("Issue #104 runtime budget selection", () => {
  it.each(["cron", "scheduled-task", "scheduled-task-secret", "self-healing-retry"])(
    "gives automated trigger %s the 180-minute budget",
    trigger => {
      expect(selectPipelineRuntimeBudgetMs(trigger)).toBe(AUTOMATED_PIPELINE_TIMEOUT_MS);
      expect(isAutomatedPipelineTrigger(trigger)).toBe(true);
    },
  );

  it.each([undefined, null, "admin", "manual", "scheduler-dev", "Lee Allen"])(
    "keeps manual/web trigger %s at 90 minutes",
    trigger => {
      expect(selectPipelineRuntimeBudgetMs(trigger)).toBe(MANUAL_PIPELINE_TIMEOUT_MS);
      expect(isAutomatedPipelineTrigger(trigger)).toBe(false);
    },
  );
});
