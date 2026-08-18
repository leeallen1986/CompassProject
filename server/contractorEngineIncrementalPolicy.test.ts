import { describe, expect, it } from "vitest";
import {
  CONTRACTOR_ENGINE_SOFT_RUNTIME_MS,
  EMPTY_CURSOR_STATE,
  boundedBatchSize,
  buildHardTimeoutSummary,
  dedupeLinkKeys,
  nextCursorAfterChunk,
  parseContractorEngineCursor,
  selectAfterCursor,
  serializeContractorEngineCursor,
  shouldStartPhase,
} from "./contractorEngineIncrementalPolicy";

describe("Issue #116 incremental contractor-engine policy", () => {
  it("selects the next bounded batch and wraps only after the cursor reaches the tail", () => {
    const rows = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }];
    expect(selectAfterCursor(rows, 20, 2)).toEqual({
      rows: [{ id: 30 }, { id: 40 }],
      wrapped: false,
    });
    expect(selectAfterCursor(rows, 40, 2)).toEqual({
      rows: [{ id: 10 }, { id: 20 }],
      wrapped: true,
    });
  });

  it("advances a checkpoint only to a completed chunk boundary", () => {
    expect(nextCursorAfterChunk(20, [30, 40], false)).toEqual({ cursor: 40, cycleIncrement: 0 });
    expect(nextCursorAfterChunk(40, [10, 20], true)).toEqual({ cursor: 20, cycleIncrement: 1 });
    expect(nextCursorAfterChunk(40, [], false)).toEqual({ cursor: 40, cycleIncrement: 0 });
  });

  it("recovers safely from missing, malformed or wrong-version cursor state", () => {
    expect(parseContractorEngineCursor(null)).toEqual(EMPTY_CURSOR_STATE);
    expect(parseContractorEngineCursor("not-json")).toEqual(EMPTY_CURSOR_STATE);
    expect(parseContractorEngineCursor(JSON.stringify({ version: 99, projectCursor: 500 })))
      .toEqual(EMPTY_CURSOR_STATE);

    const raw = serializeContractorEngineCursor({
      ...EMPTY_CURSOR_STATE,
      projectCursor: 123,
      awardedCursor: 44,
      scoringCursor: 77,
      projectCycles: 2,
    });
    expect(parseContractorEngineCursor(raw)).toMatchObject({
      projectCursor: 123,
      awardedCursor: 44,
      scoringCursor: 77,
      projectCycles: 2,
    });
  });

  it("bounds operator-configurable batch sizes", () => {
    expect(boundedBatchSize(undefined, 120, 500)).toBe(120);
    expect(boundedBatchSize("0", 120, 500)).toBe(120);
    expect(boundedBatchSize("250", 120, 500)).toBe(250);
    expect(boundedBatchSize("9000", 120, 500)).toBe(500);
  });

  it("deduplicates repeated contractor/project/role relationships deterministically", () => {
    const rows = [
      { contractorId: 1, projectId: 10, role: "owner", detail: "a" },
      { contractorId: 1, projectId: 10, role: "owner", detail: "duplicate" },
      { contractorId: 1, projectId: 10, role: "contractor", detail: "different role" },
    ];
    expect(dedupeLinkKeys(rows)).toEqual([rows[0], rows[2]]);
  });

  it("reserves a soft-runtime margin instead of relaxing the 50-minute hard boundary", () => {
    expect(shouldStartPhase(0, CONTRACTOR_ENGINE_SOFT_RUNTIME_MS - 60_000)).toBe(true);
    expect(shouldStartPhase(0, CONTRACTOR_ENGINE_SOFT_RUNTIME_MS)).toBe(false);
    expect(shouldStartPhase(0, CONTRACTOR_ENGINE_SOFT_RUNTIME_MS - 30_000, 60_000)).toBe(false);
  });

  it("produces bounded hard-timeout text with the last known phase", () => {
    const summary = buildHardTimeoutSummary(3_000_077, "registry<script>");
    expect(summary).toBe("Contractor Engine hard timeout after 3000s; child process killed; last phase=registryscript");
    expect(summary).not.toContain("<script>");
  });
});
