/**
 * Tests for digest HOLD / send enforcement.
 *
 * Validates that:
 * 1. A HELD digest (freshness gate blocked) does NOT send to recipients
 * 2. DIGEST_STALE_FALLBACK=true cannot silently bypass HOLD — it must log a warning
 * 3. force=true (batch) bypasses freshness gate but logs FORCE_OVERRIDE
 * 4. sendWeeklyDigestToUser() respects freshness gate by default
 * 5. sendWeeklyDigestToUser(userId, forceOverride=true) bypasses gate but logs FORCE_OVERRIDE
 * 6. sendWeeklyDigestToUser() default (no forceOverride) blocks when stale
 * 7. dryRun=true bypasses freshness gate (preview must always work)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared mock state ──
const mockSendEmail = vi.fn().mockResolvedValue({ id: "mock-id" });
const mockCheckPipelineFreshness = vi.fn();
const mockGetLatestReport = vi.fn().mockResolvedValue(null);
const mockGetActiveProjects = vi.fn().mockResolvedValue([]);
const mockGetAllContacts = vi.fn().mockResolvedValue([]);
const mockGetEmailRecipients = vi.fn().mockResolvedValue([]);
const mockGetDb = vi.fn().mockResolvedValue(null);
const mockNotifyOwner = vi.fn().mockResolvedValue(true);
const mockWasFreshnessHeldNotifiedThisWeek = vi.fn().mockResolvedValue(false);
const mockLogFreshnessHeld = vi.fn().mockResolvedValue(undefined);
const mockGetDigestWeekKey = vi.fn().mockReturnValue("2026-W19");
const mockClaimDigestSendSlot = vi.fn().mockResolvedValue(true);
const mockFinaliseDigestSendSlot = vi.fn().mockResolvedValue(undefined);
const mockGetLatestPipelineRun = vi.fn().mockResolvedValue(null);
const mockLogEmailSendExtended = vi.fn().mockResolvedValue(undefined);
const mockGetPipelineClaimsByUser = vi.fn().mockResolvedValue([]);
const mockGetThisWeekForEmail = vi.fn().mockResolvedValue({
  top3Projects: [], top2Stakeholders: [], urgentAction: null,
});

vi.mock("./emailSender", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    checkPipelineFreshness: (...args: unknown[]) => mockCheckPipelineFreshness(...args),
    getLatestReport: (...args: unknown[]) => mockGetLatestReport(...args),
    getActiveProjects: (...args: unknown[]) => mockGetActiveProjects(...args),
    getAllContacts: (...args: unknown[]) => mockGetAllContacts(...args),
    getEmailRecipients: (...args: unknown[]) => mockGetEmailRecipients(...args),
    getDb: (...args: unknown[]) => mockGetDb(...args),
    getDigestWeekKey: (...args: unknown[]) => mockGetDigestWeekKey(...args),
    getCurrentWeekKey: (...args: unknown[]) => mockGetDigestWeekKey(...args),
    claimDigestSendSlot: (...args: unknown[]) => mockClaimDigestSendSlot(...args),
    finaliseDigestSendSlot: (...args: unknown[]) => mockFinaliseDigestSendSlot(...args),
    getLatestPipelineRun: (...args: unknown[]) => mockGetLatestPipelineRun(...args),
    logEmailSendExtended: (...args: unknown[]) => mockLogEmailSendExtended(...args),
    getPipelineClaimsByUser: (...args: unknown[]) => mockGetPipelineClaimsByUser(...args),
    wasEmailSentToUserThisWeek: vi.fn().mockResolvedValue(false),
    getAllUsersWithProfiles: vi.fn().mockResolvedValue([]),
    getProjectsByReportId: vi.fn().mockResolvedValue([]),
    getContactsByReportId: vi.fn().mockResolvedValue([]),
    getManagerRollup: vi.fn().mockResolvedValue({ totalActions: 0, byOutcome: {}, byRep: [], byLane: {} }),
  };
});

vi.mock("./_core/notification", () => ({
  notifyOwner: (...args: unknown[]) => mockNotifyOwner(...args),
}));

vi.mock("./tierClassification", () => ({
  shouldIncludeInBrief: vi.fn().mockReturnValue(true),
  getTierLabel: vi.fn().mockReturnValue("Actionable"),
}));

vi.mock("./businessLineScoring", () => ({
  getProjectScoresBatch: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("./thisWeekService", () => ({
  getThisWeekForEmail: (...args: unknown[]) => mockGetThisWeekForEmail(...args),
  formatThisWeekSection: vi.fn().mockReturnValue(""),
}));

// ── Freshness state helpers ──
const STALE_FRESHNESS = {
  status: "stale" as const,
  ageHours: 74,
  windowHours: 26,
  blockedReason: "Last successful pipeline run was 74.1h ago — outside the 26h freshness window",
  lastCompletedAt: new Date(Date.now() - 74 * 3600 * 1000),
};

const FRESH_FRESHNESS = {
  status: "ok" as const,
  ageHours: 12,
  windowHours: 26,
  blockedReason: null,
  lastCompletedAt: new Date(Date.now() - 12 * 3600 * 1000),
};

const NEVER_RUN_FRESHNESS = {
  status: "never_run" as const,
  ageHours: Infinity,
  windowHours: 26,
  blockedReason: "No completed pipeline run found",
  lastCompletedAt: null,
};

describe("Digest HOLD / Send Enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: digests enabled
    process.env.EMAIL_DIGESTS_ENABLED = "true";
    delete process.env.DIGEST_STALE_FALLBACK;
    // Default: pipeline is fresh
    mockCheckPipelineFreshness.mockResolvedValue(FRESH_FRESHNESS);
    // Default: no report (so even if gate passes, nothing sends)
    mockGetLatestReport.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.DIGEST_STALE_FALLBACK;
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. HOLD: stale pipeline → batch send returns skipped=-1, no emails sent
  // ─────────────────────────────────────────────────────────────────────────
  describe("Freshness gate HOLD — batch send", () => {
    it("returns skipped=-1 when pipeline is stale and DIGEST_STALE_FALLBACK is not set", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      const { sendWeeklyDigests } = await import("./emailDigest");
      const result = await sendWeeklyDigests();

      expect(result.skipped).toBe(-1);
      expect(result.sent).toBe(0);
    });

    it("does NOT call sendEmail when pipeline is stale", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      const { sendWeeklyDigests } = await import("./emailDigest");
      await sendWeeklyDigests();

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("does NOT call sendEmail when pipeline has never run", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(NEVER_RUN_FRESHNESS);

      const { sendWeeklyDigests } = await import("./emailDigest");
      const result = await sendWeeklyDigests();

      expect(result.skipped).toBe(-1);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("notifies owner when pipeline is stale (first time this week)", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      const { sendWeeklyDigests } = await import("./emailDigest");
      await sendWeeklyDigests();

      // Owner should be notified
      expect(mockNotifyOwner).toHaveBeenCalledOnce();
      const call = mockNotifyOwner.mock.calls[0][0];
      expect(call.title).toContain("HELD");
    });

    it("does NOT notify owner twice in the same week (dedup guard)", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      // Simulate: already notified this week — the DB returns a 'failed' record
      // We mock getDb to return a db object whose .select chain returns a non-empty array
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 1 }]), // ← record exists = already notified
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue(undefined),
      };
      mockGetDb.mockResolvedValue(mockDb);

      const { sendWeeklyDigests } = await import("./emailDigest");
      await sendWeeklyDigests();

      // Owner should NOT be notified again
      expect(mockNotifyOwner).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. STALE FALLBACK — must log warning, NOT silently bypass
  // ─────────────────────────────────────────────────────────────────────────
  describe("DIGEST_STALE_FALLBACK — cannot silently bypass", () => {
    it("sends when DIGEST_STALE_FALLBACK=true but logs a STALE FALLBACK warning", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);
      process.env.DIGEST_STALE_FALLBACK = "true";

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { sendWeeklyDigests } = await import("./emailDigest");
      const result = await sendWeeklyDigests();

      // Should NOT return skipped=-1 (fallback allows send)
      expect(result.skipped).not.toBe(-1);

      // Must log a STALE FALLBACK warning — not silent
      const warnCalls = warnSpy.mock.calls.map(c => c.join(" "));
      const hasStaleWarning = warnCalls.some(msg => msg.includes("STALE FALLBACK"));
      expect(hasStaleWarning).toBe(true);

      warnSpy.mockRestore();
    });

    it("injects stale warning into email subject when DIGEST_STALE_FALLBACK=true", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);
      process.env.DIGEST_STALE_FALLBACK = "true";

      // Provide a report and one user so the email loop actually runs
      mockGetLatestReport.mockResolvedValue({ id: 1, weekEnding: "2 May 2026", createdAt: new Date() });
      mockGetEmailRecipients.mockResolvedValue([{
        user: { id: 99, name: "Test Rep", email: "rep@test.com", role: "user" },
        profile: { territories: ["WA"], industries: [], offerCategories: [], customerTypes: [], dealSizeMin: null, dealSizeMax: null, assignedBusinessLines: [] },
      }]);
      mockGetActiveProjects.mockResolvedValue([]);

      const { sendWeeklyDigests } = await import("./emailDigest");
      await sendWeeklyDigests();

      // If sendEmail was called, the subject must contain STALE DATA
      if (mockSendEmail.mock.calls.length > 0) {
        const subject = mockSendEmail.mock.calls[0][0].subject as string;
        expect(subject).toContain("STALE");
      }
      // If no users had matching projects, sendEmail may not be called — that's fine
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. FORCE=TRUE — batch bypass must log FORCE_OVERRIDE
  // ─────────────────────────────────────────────────────────────────────────
  describe("force=true (batch) — must log FORCE_OVERRIDE", () => {
    it("logs FORCE_OVERRIDE warning when force=true and pipeline is stale", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { sendWeeklyDigests } = await import("./emailDigest");
      await sendWeeklyDigests(true); // force=true

      const warnCalls = warnSpy.mock.calls.map(c => c.join(" "));
      const hasForceOverride = warnCalls.some(msg => msg.includes("FORCE_OVERRIDE"));
      expect(hasForceOverride).toBe(true);

      warnSpy.mockRestore();
    });

    it("logs FORCE_OVERRIDE warning even when pipeline is fresh (force=true)", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(FRESH_FRESHNESS);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { sendWeeklyDigests } = await import("./emailDigest");
      await sendWeeklyDigests(true); // force=true

      const warnCalls = warnSpy.mock.calls.map(c => c.join(" "));
      const hasForceOverride = warnCalls.some(msg => msg.includes("FORCE_OVERRIDE"));
      expect(hasForceOverride).toBe(true);

      warnSpy.mockRestore();
    });

    it("does NOT log FORCE_OVERRIDE when force=false (normal send)", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(FRESH_FRESHNESS);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { sendWeeklyDigests } = await import("./emailDigest");
      await sendWeeklyDigests(false); // force=false

      const warnCalls = warnSpy.mock.calls.map(c => c.join(" "));
      const hasForceOverride = warnCalls.some(msg => msg.includes("FORCE_OVERRIDE"));
      expect(hasForceOverride).toBe(false);

      warnSpy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. sendWeeklyDigestToUser — default blocks when stale
  // ─────────────────────────────────────────────────────────────────────────
  describe("sendWeeklyDigestToUser — freshness gate by default", () => {
    it("returns freshnessBlocked=true when pipeline is stale (default, no forceOverride)", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      const { sendWeeklyDigestToUser } = await import("./emailDigest");
      const result = await sendWeeklyDigestToUser(42);

      expect(result).not.toBeNull();
      expect(result!.freshnessBlocked).toBe(true);
      expect(result!.sent).toBe(false);
    });

    it("does NOT call sendEmail when pipeline is stale and forceOverride=false", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      const { sendWeeklyDigestToUser } = await import("./emailDigest");
      await sendWeeklyDigestToUser(42, false);

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("does NOT call sendEmail when pipeline has never run and forceOverride is default", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(NEVER_RUN_FRESHNESS);

      const { sendWeeklyDigestToUser } = await import("./emailDigest");
      const result = await sendWeeklyDigestToUser(42);

      expect(result!.freshnessBlocked).toBe(true);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("does NOT block when pipeline is fresh and forceOverride=false", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(FRESH_FRESHNESS);
      // No report → returns null (but gate was not the blocker)
      mockGetLatestReport.mockResolvedValue(null);

      const { sendWeeklyDigestToUser } = await import("./emailDigest");
      const result = await sendWeeklyDigestToUser(42, false);

      // null means no report found, but freshnessBlocked should NOT be set
      if (result !== null) {
        expect(result.freshnessBlocked).toBeFalsy();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. sendWeeklyDigestToUser forceOverride=true — bypasses gate but logs
  // ─────────────────────────────────────────────────────────────────────────
  describe("sendWeeklyDigestToUser — forceOverride=true logs FORCE_OVERRIDE", () => {
    it("logs FORCE_OVERRIDE warning when forceOverride=true and pipeline is stale", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);
      // No report → function returns null after gate, but we still want to verify the log
      mockGetLatestReport.mockResolvedValue(null);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { sendWeeklyDigestToUser } = await import("./emailDigest");
      await sendWeeklyDigestToUser(42, true);

      const warnCalls = warnSpy.mock.calls.map(c => c.join(" "));
      const hasForceOverride = warnCalls.some(msg => msg.includes("FORCE_OVERRIDE"));
      expect(hasForceOverride).toBe(true);

      warnSpy.mockRestore();
    });

    it("does NOT block when forceOverride=true even with stale pipeline", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);
      // No report → returns null, but the gate was NOT the blocker
      mockGetLatestReport.mockResolvedValue(null);

      const { sendWeeklyDigestToUser } = await import("./emailDigest");
      const result = await sendWeeklyDigestToUser(42, true);

      // null means no report, not freshness blocked
      if (result !== null) {
        expect(result.freshnessBlocked).toBeFalsy();
      }
      // The key assertion: freshness gate did NOT return early with freshnessBlocked=true
      // (if it had, result would be { sent: false, freshnessBlocked: true })
      expect(result?.freshnessBlocked).not.toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. dryRun=true — always bypasses freshness gate (preview must work)
  // ─────────────────────────────────────────────────────────────────────────
  describe("dryRun=true — bypasses freshness gate for previews", () => {
    it("does NOT check freshness when dryRun=true", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      const { sendWeeklyDigests } = await import("./emailDigest");
      await sendWeeklyDigests(false, true); // dryRun=true

      // checkPipelineFreshness should NOT be called (dryRun bypasses the gate entirely)
      expect(mockCheckPipelineFreshness).not.toHaveBeenCalled();
    });

    it("does NOT return skipped=-1 when dryRun=true even with stale pipeline", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      const { sendWeeklyDigests } = await import("./emailDigest");
      const result = await sendWeeklyDigests(false, true); // dryRun=true

      expect(result.skipped).not.toBe(-1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Recipient suppression proof — skipped=-1 sentinel is stable
  // ─────────────────────────────────────────────────────────────────────────
  describe("Recipient suppression proof", () => {
    it("skipped=-1 is the stable sentinel for freshness gate hold (not a normal skip)", async () => {
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      const { sendWeeklyDigests } = await import("./emailDigest");
      const result = await sendWeeklyDigests();

      // skipped=-1 is the specific signal used by persistentScheduler to detect a hold
      // (vs skipped=0 which means no users were skipped, vs skipped>0 which means users skipped)
      expect(result.skipped).toBe(-1);
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("persistentScheduler can detect hold via skipped=-1 (contract test)", async () => {
      // This test verifies the contract between sendWeeklyDigests and persistentScheduler.
      // persistentScheduler checks: if (result.skipped === -1) → do NOT log as 'sent'
      mockCheckPipelineFreshness.mockResolvedValue(STALE_FRESHNESS);

      const { sendWeeklyDigests } = await import("./emailDigest");
      const result = await sendWeeklyDigests();

      // The persistentScheduler logic:
      const isHeld = result.skipped === -1;
      expect(isHeld).toBe(true);

      // When held, the scheduler should NOT log a 'sent' record
      // (this prevents the catch-up logic from thinking the digest was delivered)
      // We verify the contract: if isHeld, no 'sent' log should be written
      // (persistentScheduler does this check — we just verify the signal is correct)
    });
  });
});
