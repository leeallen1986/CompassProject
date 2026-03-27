/**
 * Tests for the EMAIL_DIGESTS_ENABLED kill switch.
 * Validates that when the env var is not "true", no emails are sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies so we don't hit real services
vi.mock("./emailSender", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "mock-id" }),
}));

vi.mock("./db", () => ({
  getAllUsersWithProfiles: vi.fn().mockResolvedValue([]),
  getLatestReport: vi.fn().mockResolvedValue(null),
  getProjectsByReportId: vi.fn().mockResolvedValue([]),
  getContactsByReportId: vi.fn().mockResolvedValue([]),
  getPipelineClaimsByUser: vi.fn().mockResolvedValue([]),
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./tierClassification", () => ({
  shouldIncludeInBrief: vi.fn().mockReturnValue(true),
  getTierLabel: vi.fn().mockReturnValue("Actionable"),
}));

vi.mock("./businessLineScoring", () => ({
  getProjectScoresBatch: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("./thisWeekService", () => ({
  getThisWeekForEmail: vi.fn().mockResolvedValue({
    projects: [],
    stakeholders: [],
    suggestedActions: [],
    stats: { totalProjects: 0, hotProjects: 0, newContacts: 0 },
  }),
}));

describe("EMAIL_DIGESTS_ENABLED kill switch", () => {
  const originalEnv = process.env.EMAIL_DIGESTS_ENABLED;

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.EMAIL_DIGESTS_ENABLED = originalEnv;
    } else {
      delete process.env.EMAIL_DIGESTS_ENABLED;
    }
    vi.clearAllMocks();
  });

  it("sendWeeklyDigests returns immediately when EMAIL_DIGESTS_ENABLED is not 'true'", async () => {
    process.env.EMAIL_DIGESTS_ENABLED = "false";

    const { sendWeeklyDigests } = await import("./emailDigest");
    const result = await sendWeeklyDigests();

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);

    // Verify no DB calls were made (kill switch returned early)
    const { getLatestReport } = await import("./db");
    expect(getLatestReport).not.toHaveBeenCalled();
  });

  it("sendThursdayReminders returns immediately when EMAIL_DIGESTS_ENABLED is not 'true'", async () => {
    process.env.EMAIL_DIGESTS_ENABLED = "false";

    const { sendThursdayReminders } = await import("./emailDigest");
    const result = await sendThursdayReminders();

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);

    // Verify no DB calls were made
    const { getLatestReport } = await import("./db");
    expect(getLatestReport).not.toHaveBeenCalled();
  });

  it("sendWeeklyDigests returns immediately when EMAIL_DIGESTS_ENABLED is undefined", async () => {
    delete process.env.EMAIL_DIGESTS_ENABLED;

    const { sendWeeklyDigests } = await import("./emailDigest");
    const result = await sendWeeklyDigests();

    expect(result.sent).toBe(0);

    const { getLatestReport } = await import("./db");
    expect(getLatestReport).not.toHaveBeenCalled();
  });

  it("validates EMAIL_DIGESTS_ENABLED env var is currently set to enable emails", () => {
    // This test validates the actual env var is set correctly in the current environment
    const value = process.env.EMAIL_DIGESTS_ENABLED;
    // Email digests are now enabled (Resend domain verified, SPF/DKIM/DMARC configured)
    expect(value).toBe("true");
  });
});
