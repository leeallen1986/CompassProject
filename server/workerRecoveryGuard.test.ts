import { describe, expect, it } from "vitest";
import { workerExpectedWindowStart } from "./workerRecoveryGuard";

describe("Issue #104 worker recovery window", () => {
  it("uses the current 20:00 UTC window after schedule time", () => {
    expect(workerExpectedWindowStart(new Date("2026-08-18T20:30:00Z")).toISOString())
      .toBe("2026-08-18T20:00:00.000Z");
  });

  it("uses the previous 20:00 UTC window before schedule time", () => {
    expect(workerExpectedWindowStart(new Date("2026-08-18T19:59:59Z")).toISOString())
      .toBe("2026-08-17T20:00:00.000Z");
  });
});
