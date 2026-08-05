import { describe, expect, it } from "vitest";
import {
  AI_DRAFTING_UNAVAILABLE_MESSAGE,
  isCompleteOutreachDraft,
  isCurrentOutreachOperation,
  isQuotaOrCircuitUnavailable,
  planOutreachComposerOpen,
} from "./outreachComposerState";

describe("Issue #86 outreach composer state", () => {
  it("keeps the controller-prescribed AI unavailable message exact", () => {
    expect(AI_DRAFTING_UNAVAILABLE_MESSAGE).toBe(
      "AI drafting is temporarily unavailable. Use a saved template or write manually."
    );
  });

  it.each(["quota_exhausted", "rate_limited", "circuit_open"])(
    "blocks another AI attempt while %s is known",
    reason => {
      expect(isQuotaOrCircuitUnavailable(reason)).toBe(true);
    }
  );

  it.each([
    undefined,
    null,
    "configuration",
    "timeout",
    "upstream_unavailable",
    "malformed_response",
  ])("does not misclassify %s as a known quota/circuit block", reason => {
    expect(isQuotaOrCircuitUnavailable(reason)).toBe(false);
  });

  it("requires non-whitespace subject and body before recipient handoff", () => {
    expect(isCompleteOutreachDraft("Subject", "Body")).toBe(true);
    expect(isCompleteOutreachDraft(" Subject ", "\nBody\n")).toBe(true);
    expect(isCompleteOutreachDraft("", "Body")).toBe(false);
    expect(isCompleteOutreachDraft("   ", "Body")).toBe(false);
    expect(isCompleteOutreachDraft("Subject", "\n\t ")).toBe(false);
  });

  it.each(["quota_exhausted", "rate_limited", "circuit_open"])(
    "reopens in a provider-free state after %s instead of hanging or retrying",
    reason => {
      expect(planOutreachComposerOpen(true, reason)).toEqual({
        draftState: "error",
        shouldRequestAi: false,
        knownQuotaBlock: true,
      });
    },
  );

  it("starts initial generation only when IDs are valid and no quota block is known", () => {
    expect(planOutreachComposerOpen(true, null)).toEqual({
      draftState: "loading",
      shouldRequestAi: true,
      knownQuotaBlock: false,
    });
    expect(planOutreachComposerOpen(false, null).shouldRequestAi).toBe(false);
  });

  it("rejects an abandoned handoff response after close and same-context reopen", () => {
    const oldRequestEpoch = 4;
    const reopenedEpoch = 6;
    expect(
      isCurrentOutreachOperation(
        reopenedEpoch,
        oldRequestEpoch,
        "10:20",
        "10:20",
      ),
    ).toBe(false);
    expect(
      isCurrentOutreachOperation(6, 6, "10:20", "10:20"),
    ).toBe(true);
  });
});
