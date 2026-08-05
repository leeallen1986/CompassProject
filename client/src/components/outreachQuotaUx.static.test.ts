import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const modal = readFileSync(
  path.join(import.meta.dirname, "OutreachEmailModal.tsx"),
  "utf8"
);

describe("Issue #86 quota-safe outreach composer wiring", () => {
  it("renders persistent fallback and hard-error states", () => {
    expect(modal).toContain('draftState === "deterministic_fallback"');
    expect(modal).toContain('role="status"');
    expect(modal).toContain('draftState === "error"');
    expect(modal).toContain('role="alert"');
    expect(modal).toContain("AI_DRAFTING_UNAVAILABLE_MESSAGE");
    expect(modal).toContain("Deterministic provider-free draft");
  });

  it("blocks AI controls but keeps a provider-free manual template path", () => {
    expect(modal).toContain(
      "const aiActionsAvailable = actionsAvailable && !aiDraftingBlocked"
    );
    expect(modal).toContain("disabled={!aiActionsAvailable}");
    expect(modal).toContain("if (aiDraftingBlocked)");
    expect(modal).toContain('setDraftState("manual_template")');
    expect(modal).toContain("Saved template loaded without AI");
    expect(modal).toContain("disabled={!actionsAvailable || isGenerating}");
    expect(modal).toContain("planOutreachComposerOpen(");
    expect(modal).toContain("isCurrentOutreachOperation(");
  });

  it("requires and sends trimmed subject and body for recipient handoff", () => {
    expect(modal).toContain(
      "const hasCompleteDraft = isCompleteOutreachDraft(subject, body)"
    );
    expect(modal).toContain("!hasCompleteDraft");
    expect(modal).toContain("subject: subject.trim()");
    expect(modal).toContain("body: body.trim()");
  });

  it("keeps raw mutation errors out of draft failure messages", () => {
    expect(modal).toContain("setDraftError(AI_DRAFT_FAILURE_MESSAGE)");
    expect(modal).not.toContain(
      'toast.error("Failed to generate an email draft. Please try again.")'
    );
    expect(modal).not.toContain(
      'toast.error("Failed to personalise the template. Please try again.")'
    );
  });
});
