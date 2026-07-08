import { describe, it, expect } from "vitest";

/**
 * Tests for the pure helper/display logic in FullPotentialSignalImportModal.
 * The component itself uses tRPC mutations and React state, so we test the
 * stateless helper logic extracted here rather than mounting the component.
 */

// ── Replicate display helpers from the component ─────────────────────────────

const MATCH_REASON_LABEL: Record<string, string> = {
  account_id: "ID",
  stable_key: "Key",
  canonical_name: "Canonical",
  display_name: "Display",
  alias: "Alias",
  unlinked: "Unlinked",
};

const URGENCY_BADGE: Record<string, string> = {
  hot: "bg-red-100 text-red-700 border-red-200",
  warm: "bg-amber-100 text-amber-700 border-amber-200",
  cold: "bg-slate-100 text-slate-600 border-slate-200",
  unknown: "bg-slate-100 text-slate-500 border-slate-200",
};

const CONFIDENCE_BADGE: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700 border-emerald-200",
  medium: "bg-blue-100 text-blue-700 border-blue-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
  unknown: "bg-slate-100 text-slate-500 border-slate-200",
};

// ── canCommit logic (replicated from component) ───────────────────────────────

type SignalImportSummary = {
  dryRun: boolean;
  workbookVersion: string | null;
  rowsParsed: number;
  rowsValid: number;
  createdSignals: number;
  skippedDuplicates: number;
  linkedAccounts: number;
  unlinkedSignals: number;
  errors: { rowNumber: number; field?: string; message: string }[];
  preview: {
    rowNumber: number;
    signalTitle: string;
    accountId: number | null;
    accountMatchReason: string | null;
    signalDate: string | null;
    confidenceLevel: string | null;
    urgency: string | null;
    status: string | null;
  }[];
};

function canCommit(
  dryRunSummary: SignalImportSummary | null,
  commitSummary: SignalImportSummary | null,
  isBusy: boolean,
): boolean {
  return (
    !!dryRunSummary &&
    dryRunSummary.errors.length === 0 &&
    dryRunSummary.rowsValid > 0 &&
    !commitSummary &&
    !isBusy
  );
}

function makeSummary(overrides: Partial<SignalImportSummary> = {}): SignalImportSummary {
  return {
    dryRun: true,
    workbookVersion: null,
    rowsParsed: 5,
    rowsValid: 5,
    createdSignals: 0,
    skippedDuplicates: 0,
    linkedAccounts: 4,
    unlinkedSignals: 1,
    errors: [],
    preview: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FullPotentialSignalImportModal — canCommit logic", () => {
  it("returns false when dryRunSummary is null", () => {
    expect(canCommit(null, null, false)).toBe(false);
  });

  it("returns false when dryRunSummary has errors", () => {
    const summary = makeSummary({ errors: [{ rowNumber: 2, message: "Missing signalTitle" }] });
    expect(canCommit(summary, null, false)).toBe(false);
  });

  it("returns false when dryRunSummary has rowsValid === 0", () => {
    const summary = makeSummary({ rowsValid: 0 });
    expect(canCommit(summary, null, false)).toBe(false);
  });

  it("returns false when commitSummary is already set (already committed)", () => {
    const dryRun = makeSummary();
    const commit = makeSummary({ dryRun: false, createdSignals: 5 });
    expect(canCommit(dryRun, commit, false)).toBe(false);
  });

  it("returns false when isBusy is true", () => {
    const summary = makeSummary();
    expect(canCommit(summary, null, true)).toBe(false);
  });

  it("returns true when dry-run is clean, rowsValid > 0, no commit yet, not busy", () => {
    const summary = makeSummary();
    expect(canCommit(summary, null, false)).toBe(true);
  });
});

describe("FullPotentialSignalImportModal — MATCH_REASON_LABEL map", () => {
  it("maps all expected account match reasons", () => {
    expect(MATCH_REASON_LABEL["account_id"]).toBe("ID");
    expect(MATCH_REASON_LABEL["stable_key"]).toBe("Key");
    expect(MATCH_REASON_LABEL["canonical_name"]).toBe("Canonical");
    expect(MATCH_REASON_LABEL["display_name"]).toBe("Display");
    expect(MATCH_REASON_LABEL["alias"]).toBe("Alias");
    expect(MATCH_REASON_LABEL["unlinked"]).toBe("Unlinked");
  });

  it("has no entry for unknown reason (falls back to raw value in component)", () => {
    expect(MATCH_REASON_LABEL["some_unknown_reason"]).toBeUndefined();
  });
});

describe("FullPotentialSignalImportModal — URGENCY_BADGE map", () => {
  it("maps hot urgency to red classes", () => {
    expect(URGENCY_BADGE["hot"]).toContain("red");
  });

  it("maps warm urgency to amber classes", () => {
    expect(URGENCY_BADGE["warm"]).toContain("amber");
  });

  it("maps cold urgency to slate classes", () => {
    expect(URGENCY_BADGE["cold"]).toContain("slate");
  });

  it("maps unknown urgency to slate classes", () => {
    expect(URGENCY_BADGE["unknown"]).toContain("slate");
  });
});

describe("FullPotentialSignalImportModal — CONFIDENCE_BADGE map", () => {
  it("maps high confidence to emerald classes", () => {
    expect(CONFIDENCE_BADGE["high"]).toContain("emerald");
  });

  it("maps medium confidence to blue classes", () => {
    expect(CONFIDENCE_BADGE["medium"]).toContain("blue");
  });

  it("maps low confidence to slate classes", () => {
    expect(CONFIDENCE_BADGE["low"]).toContain("slate");
  });

  it("maps unknown confidence to slate classes", () => {
    expect(CONFIDENCE_BADGE["unknown"]).toContain("slate");
  });
});

describe("FullPotentialSignalImportModal — preview cap display logic", () => {
  it("shows cap notice when rowsValid > preview.length", () => {
    const summary = makeSummary({
      rowsValid: 25,
      preview: Array.from({ length: 20 }, (_, i) => ({
        rowNumber: i + 2,
        signalTitle: `Signal ${i + 1}`,
        accountId: null,
        accountMatchReason: "unlinked",
        signalDate: "2025-07-01",
        confidenceLevel: "high",
        urgency: "hot",
        status: "new",
      })),
    });
    const shouldShowCapNotice = summary.rowsValid > summary.preview.length;
    expect(shouldShowCapNotice).toBe(true);
  });

  it("does not show cap notice when rowsValid === preview.length", () => {
    const summary = makeSummary({
      rowsValid: 5,
      preview: Array.from({ length: 5 }, (_, i) => ({
        rowNumber: i + 2,
        signalTitle: `Signal ${i + 1}`,
        accountId: i + 100,
        accountMatchReason: "account_id",
        signalDate: "2025-07-01",
        confidenceLevel: "medium",
        urgency: "warm",
        status: "new",
      })),
    });
    const shouldShowCapNotice = summary.rowsValid > summary.preview.length;
    expect(shouldShowCapNotice).toBe(false);
  });
});

describe("FullPotentialSignalImportModal — dry-run clean detection", () => {
  it("detects clean dry-run (no errors)", () => {
    const summary = makeSummary({ errors: [] });
    expect(summary.errors.length === 0).toBe(true);
  });

  it("detects dirty dry-run (has errors)", () => {
    const summary = makeSummary({
      errors: [
        { rowNumber: 3, field: "signalType", message: "Invalid signalType value: 'unknown_type'" },
      ],
    });
    expect(summary.errors.length === 0).toBe(false);
  });
});
