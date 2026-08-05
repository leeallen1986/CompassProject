import { describe, expect, it, vi } from "vitest";
import { recordOutreachDraftTelemetry } from "./outreachDraftTelemetry";

const INPUT = {
  userId: 1,
  projectId: 2,
  contactId: 3,
  claimId: 4,
  sourceAccountId: 5,
  tone: "consultative",
  generationMode: "deterministic_template",
  aiUnavailableReason: "quota_exhausted",
};

describe("recordOutreachDraftTelemetry", () => {
  it("writes only IDs and categorical metadata", async () => {
    const writer = vi.fn().mockResolvedValue(undefined);

    await expect(recordOutreachDraftTelemetry(INPUT, writer)).resolves.toBe(true);
    expect(writer).toHaveBeenCalledWith(1, "outreach_drafted", {
      projectId: 2,
      contactId: 3,
      claimId: 4,
      metadata: {
        tone: "consultative",
        generationMode: "deterministic_template",
        aiUnavailableReason: "quota_exhausted",
        sourceAccountId: 5,
      },
    });
  });

  it("absorbs a diagnostics failure so the caller can retain its draft", async () => {
    const writer = vi.fn().mockRejectedValue(new Error("metrics unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(recordOutreachDraftTelemetry(INPUT, writer)).resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith(
      "[Outreach] draft telemetry unavailable",
      {
        generationMode: "deterministic_template",
        aiUnavailableReason: "quota_exhausted",
      },
    );
    warning.mockRestore();
  });
});
