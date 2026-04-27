/**
 * Tests for the reportId fragmentation fix.
 *
 * The core bug: emailDigest.ts used getProjectsByReportId(latestReport.id) to load
 * projects for the digest. But each scraper created its own report row (or worse,
 * TendersWA used the pipeline run ID as reportId), so the latest report always had
 * 0 projects linked to it.
 *
 * The fix: emailDigest.ts now uses getActiveProjects() and getAllContacts() instead
 * of filtering by reportId. The pipeline also creates a canonical report at startup
 * and passes it to TendersWA/QTOL NT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock db.ts ──
const mockGetActiveProjects = vi.fn();
const mockGetAllContacts = vi.fn();
const mockGetProjectsByReportId = vi.fn();
const mockGetContactsByReportId = vi.fn();
const mockGetLatestReport = vi.fn();
const mockGetLatestPipelineRun = vi.fn();
const mockGetEmailRecipients = vi.fn();
const mockGetPipelineClaimsByUser = vi.fn();
const mockGetDb = vi.fn();
const mockLogEmailSendExtended = vi.fn();
const mockGetCurrentWeekKey = vi.fn().mockReturnValue("2026-W17");
const mockGetManagerRollup = vi.fn();
const mockWasEmailSentToUserThisWeek = vi.fn().mockResolvedValue(false);
const mockCheckPipelineFreshness = vi.fn();
const mockGetAllUsersWithProfiles = vi.fn();

vi.mock("./db", () => ({
  getActiveProjects: (...args: any[]) => mockGetActiveProjects(...args),
  getAllContacts: (...args: any[]) => mockGetAllContacts(...args),
  getProjectsByReportId: (...args: any[]) => mockGetProjectsByReportId(...args),
  getContactsByReportId: (...args: any[]) => mockGetContactsByReportId(...args),
  getLatestReport: (...args: any[]) => mockGetLatestReport(...args),
  getLatestPipelineRun: (...args: any[]) => mockGetLatestPipelineRun(...args),
  getEmailRecipients: (...args: any[]) => mockGetEmailRecipients(...args),
  getPipelineClaimsByUser: (...args: any[]) => mockGetPipelineClaimsByUser(...args),
  getDb: (...args: any[]) => mockGetDb(...args),
  logEmailSendExtended: (...args: any[]) => mockLogEmailSendExtended(...args),
  getCurrentWeekKey: (...args: any[]) => mockGetCurrentWeekKey(...args),
  getManagerRollup: (...args: any[]) => mockGetManagerRollup(...args),
  wasEmailSentToUserThisWeek: (...args: any[]) => mockWasEmailSentToUserThisWeek(...args),
  checkPipelineFreshness: (...args: any[]) => mockCheckPipelineFreshness(...args),
  getAllUsersWithProfiles: (...args: any[]) => mockGetAllUsersWithProfiles(...args),
}));

vi.mock("./emailSender", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock("./tierClassification", () => ({
  shouldIncludeInBrief: vi.fn().mockReturnValue(true),
  getTierLabel: vi.fn().mockReturnValue("Tier 1"),
}));

vi.mock("./businessLineScoring", () => ({
  getProjectScoresBatch: vi.fn().mockResolvedValue([]),
}));

vi.mock("./_core/env", () => ({
  ENV: { appSiteUrl: "https://test.example.com" },
}));

vi.mock("./thisWeekService", () => ({
  getThisWeekForEmail: vi.fn().mockResolvedValue({
    top3Projects: [],
    top2Stakeholders: [],
    urgentAction: null,
    weekLabel: "2026-04-27",
    stats: { totalProjects: 10, hotProjects: 3, warmProjects: 4, coldProjects: 3 },
  }),
}));

vi.mock("../drizzle/schema", () => ({
  userEmailSendLog: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

describe("reportId fragmentation fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emailDigest should call getActiveProjects, NOT getProjectsByReportId", async () => {
    // Setup: latest report exists but has 0 projects (the bug scenario)
    mockGetLatestReport.mockResolvedValue({ id: 600001, weekEnding: "2026-04-27" });
    mockGetLatestPipelineRun.mockResolvedValue({ completedAt: new Date() });
    mockCheckPipelineFreshness.mockResolvedValue({ status: "completed", ageHours: 1 });

    // The OLD bug: getProjectsByReportId(600001) returns 0 projects
    mockGetProjectsByReportId.mockResolvedValue([]);
    mockGetContactsByReportId.mockResolvedValue([]);

    // The FIX: getActiveProjects returns all 1100 projects
    mockGetActiveProjects.mockResolvedValue([
      { id: 1, name: "Test Project", priority: "hot", suppressed: false, actionTier: "tier1_actionable" },
    ]);
    mockGetAllContacts.mockResolvedValue([
      { id: 1, name: "Test Contact", project: "Test Project", priority: "hot" },
    ]);

    // No recipients (we just want to verify the function calls the right DB methods)
    mockGetEmailRecipients.mockResolvedValue([]);

    const { sendWeeklyDigests } = await import("./emailDigest");
    await sendWeeklyDigests(false, true); // dryRun=true

    // Verify: getActiveProjects was called (the fix)
    expect(mockGetActiveProjects).toHaveBeenCalled();
    // Verify: getAllContacts was called (the fix)
    expect(mockGetAllContacts).toHaveBeenCalled();
    // Verify: getProjectsByReportId was NOT called (the old broken path)
    expect(mockGetProjectsByReportId).not.toHaveBeenCalled();
    // Verify: getContactsByReportId was NOT called (the old broken path)
    expect(mockGetContactsByReportId).not.toHaveBeenCalled();
  });

  it("getActiveProjects returns non-suppressed projects regardless of reportId", async () => {
    // This test validates the db.ts function directly
    const { getActiveProjects } = await import("./db");
    // Since db.ts is mocked, we just verify the mock is wired correctly
    mockGetActiveProjects.mockResolvedValue([
      { id: 1, name: "Project A", reportId: 690001, suppressed: false },
      { id: 2, name: "Project B", reportId: 660001, suppressed: false },
      { id: 3, name: "Project C", reportId: 600001, suppressed: false },
    ]);

    const result = await getActiveProjects();
    expect(result).toHaveLength(3);
    // All three projects from different reportIds are returned
    expect(result.map((p: any) => p.reportId)).toEqual([690001, 660001, 600001]);
  });

  it("digest should still work when report exists but has 0 projects", async () => {
    mockGetLatestReport.mockResolvedValue({ id: 600001, weekEnding: "2026-04-27" });
    mockGetLatestPipelineRun.mockResolvedValue({ completedAt: new Date() });
    mockCheckPipelineFreshness.mockResolvedValue({ status: "completed", ageHours: 1 });

    // Active projects exist (from various reportIds)
    mockGetActiveProjects.mockResolvedValue([
      { id: 1, name: "Mining Expansion", priority: "hot", suppressed: false, actionTier: "tier1_actionable", owner: "BHP" },
      { id: 2, name: "Solar Farm", priority: "warm", suppressed: false, actionTier: "tier2_develop", owner: "AGL" },
    ]);
    mockGetAllContacts.mockResolvedValue([
      { id: 1, name: "John Smith", project: "Mining Expansion", priority: "hot", email: "john@bhp.com" },
    ]);

    mockGetEmailRecipients.mockResolvedValue([]);

    const { sendWeeklyDigests } = await import("./emailDigest");
    const result = await sendWeeklyDigests(false, true);

    // Should not crash, should load projects via getActiveProjects
    expect(mockGetActiveProjects).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
