import { describe, expect, it } from "vitest";
import {
  APOLLO_GAP_FILL_WALL_CLOCK_LIMIT_MS,
  observeOwnedRun,
  type SupervisorObservationState,
} from "./pipelineExecutionSupervisor";

const emptyState: SupervisorObservationState = {
  currentStep: null,
  currentStepObservedAtMs: null,
};

describe("Issue #104 process supervisor policy", () => {
  it("starts a wall-clock observation when a step is first seen", () => {
    const decision = observeOwnedRun(
      { currentStep: "Apollo Gap-Fill" },
      emptyState,
      1_000,
    );
    expect(decision).toEqual({
      action: "continue",
      nextState: {
        currentStep: "Apollo Gap-Fill",
        currentStepObservedAtMs: 1_000,
      },
    });
  });

  it("terminates Apollo when the same owned step exceeds its wall-clock boundary", () => {
    const state: SupervisorObservationState = {
      currentStep: "Apollo Gap-Fill",
      currentStepObservedAtMs: 10_000,
    };
    const decision = observeOwnedRun(
      { currentStep: "Apollo Gap-Fill" },
      state,
      10_000 + APOLLO_GAP_FILL_WALL_CLOCK_LIMIT_MS,
    );
    expect(decision.action).toBe("terminate_apollo_timeout");
  });

  it("resets the wall-clock observation when the pipeline advances", () => {
    const state: SupervisorObservationState = {
      currentStep: "Apollo Gap-Fill",
      currentStepObservedAtMs: 10_000,
    };
    const decision = observeOwnedRun(
      { currentStep: "Business Line Scoring" },
      state,
      20_000,
    );
    expect(decision).toEqual({
      action: "continue",
      nextState: {
        currentStep: "Business Line Scoring",
        currentStepObservedAtMs: 20_000,
      },
    });
  });

  it("never applies the Apollo boundary to another step", () => {
    const state: SupervisorObservationState = {
      currentStep: "Tier Classification",
      currentStepObservedAtMs: 1,
    };
    const decision = observeOwnedRun(
      { currentStep: "Tier Classification" },
      state,
      Number.MAX_SAFE_INTEGER,
    );
    expect(decision.action).toBe("continue");
  });
});
