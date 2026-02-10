import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the database helpers
vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  return {
    ...original,
    getProfileByUserId: vi.fn(),
    upsertProfile: vi.fn(),
    completeOnboarding: vi.fn(),
    upsertFeedback: vi.fn(),
    getFeedbackByUserAndReport: vi.fn(),
    // Keep other mocks from report.test.ts pattern
    getLatestReport: vi.fn(),
    getAllReports: vi.fn(),
    getReportById: vi.fn(),
    getProjectsByReportId: vi.fn(),
    getContactsByReportId: vi.fn(),
    getDrillingCampaignsByReportId: vi.fn(),
    getAwardedProjectsByReportId: vi.fn(),
    createReport: vi.fn(),
    createProjects: vi.fn(),
    createContacts: vi.fn(),
    createDrillingCampaigns: vi.fn(),
    createAwardedProjects: vi.fn(),
  };
});

import {
  getProfileByUserId,
  upsertProfile,
  completeOnboarding,
  upsertFeedback,
  getFeedbackByUserAndReport,
} from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const mockProfile = {
  id: 1,
  userId: 1,
  companyName: "Atlas Copco Portable Air",
  companyWebsite: "https://www.atlascopco.com",
  territories: ["WA", "NT"],
  remoteMetroOnly: "both",
  industries: ["mining_exploration", "mining_production"],
  offerCategories: ["equipment", "rentals"],
  customerTypes: ["principal_contractor"],
  dealSizeMin: "$25k",
  dealSizeMax: "$500k+",
  stageTiming: ["awarded_mobilizing", "construction"],
  buyerRoles: ["procurement", "project_manager"],
  keyAccounts: ["BHP", "Rio Tinto"],
  excludeAccounts: [],
  aiSegments: null,
  onboardingCompleted: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockFeedback = [
  {
    id: 1,
    userId: 1,
    projectId: 1,
    reportId: 1,
    vote: "up" as const,
    reason: "great_fit",
    createdAt: new Date(),
  },
  {
    id: 2,
    userId: 1,
    projectId: 3,
    reportId: 1,
    vote: "down" as const,
    reason: "wrong_region",
    createdAt: new Date(),
  },
];

function createAuthContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Profile tests ──

describe("profile.get", () => {
  it("returns the user profile for authenticated users", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValue(mockProfile);
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.profile.get();
    expect(result).toEqual(mockProfile);
    expect(getProfileByUserId).toHaveBeenCalledWith(1);
  });

  it("returns null when no profile exists", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValue(null);
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.profile.get();
    expect(result).toBeNull();
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.profile.get()).rejects.toThrow();
  });
});

describe("profile.update", () => {
  it("updates profile with territory and industry data", async () => {
    vi.mocked(upsertProfile).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAuthContext());

    const input = {
      territories: ["WA", "QLD"],
      industries: ["mining_exploration"],
      remoteMetroOnly: "remote",
    };

    const result = await caller.profile.update(input);
    expect(result).toEqual({ success: true });
    expect(upsertProfile).toHaveBeenCalledWith(1, input);
  });

  it("updates profile with offer categories and customer types", async () => {
    vi.mocked(upsertProfile).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAuthContext());

    const input = {
      offerCategories: ["equipment", "rentals"],
      customerTypes: ["owner_operator"],
    };

    const result = await caller.profile.update(input);
    expect(result).toEqual({ success: true });
    expect(upsertProfile).toHaveBeenCalledWith(1, input);
  });

  it("updates profile with deal size and stage timing", async () => {
    vi.mocked(upsertProfile).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAuthContext());

    const input = {
      dealSizeMin: "$50k",
      dealSizeMax: "$1M+",
      stageTiming: ["early_signal", "awarded_mobilizing"],
    };

    const result = await caller.profile.update(input);
    expect(result).toEqual({ success: true });
    expect(upsertProfile).toHaveBeenCalledWith(1, input);
  });

  it("updates profile with key accounts and exclusions", async () => {
    vi.mocked(upsertProfile).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAuthContext());

    const input = {
      keyAccounts: ["BHP", "Rio Tinto"],
      excludeAccounts: ["Competitor Corp"],
    };

    const result = await caller.profile.update(input);
    expect(result).toEqual({ success: true });
    expect(upsertProfile).toHaveBeenCalledWith(1, input);
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.profile.update({ territories: ["WA"] })).rejects.toThrow();
  });
});

describe("profile.completeOnboarding", () => {
  it("marks onboarding as completed", async () => {
    vi.mocked(completeOnboarding).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.profile.completeOnboarding();
    expect(result).toEqual({ success: true });
    expect(completeOnboarding).toHaveBeenCalledWith(1);
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.profile.completeOnboarding()).rejects.toThrow();
  });
});

// ── Feedback tests ──

describe("feedback.submit", () => {
  it("submits thumbs-up feedback", async () => {
    vi.mocked(upsertFeedback).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAuthContext());

    const result = await caller.feedback.submit({
      projectId: 1,
      reportId: 1,
      vote: "up",
      reason: "great_fit",
    });

    expect(result).toEqual({ success: true });
    expect(upsertFeedback).toHaveBeenCalledWith({
      userId: 1,
      projectId: 1,
      reportId: 1,
      vote: "up",
      reason: "great_fit",
    });
  });

  it("submits thumbs-down feedback with reason", async () => {
    vi.mocked(upsertFeedback).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAuthContext());

    const result = await caller.feedback.submit({
      projectId: 3,
      reportId: 1,
      vote: "down",
      reason: "wrong_region",
    });

    expect(result).toEqual({ success: true });
    expect(upsertFeedback).toHaveBeenCalledWith({
      userId: 1,
      projectId: 3,
      reportId: 1,
      vote: "down",
      reason: "wrong_region",
    });
  });

  it("submits feedback without a reason", async () => {
    vi.mocked(upsertFeedback).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAuthContext());

    const result = await caller.feedback.submit({
      projectId: 2,
      reportId: 1,
      vote: "up",
    });

    expect(result).toEqual({ success: true });
    expect(upsertFeedback).toHaveBeenCalledWith({
      userId: 1,
      projectId: 2,
      reportId: 1,
      vote: "up",
      reason: null,
    });
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(
      caller.feedback.submit({ projectId: 1, reportId: 1, vote: "up" })
    ).rejects.toThrow();
  });
});

describe("feedback.byReport", () => {
  it("returns feedback for a specific report", async () => {
    vi.mocked(getFeedbackByUserAndReport).mockResolvedValue(mockFeedback);
    const caller = appRouter.createCaller(createAuthContext());

    const result = await caller.feedback.byReport({ reportId: 1 });
    expect(result).toEqual(mockFeedback);
    expect(getFeedbackByUserAndReport).toHaveBeenCalledWith(1, 1);
  });

  it("returns empty array when no feedback exists", async () => {
    vi.mocked(getFeedbackByUserAndReport).mockResolvedValue([]);
    const caller = appRouter.createCaller(createAuthContext());

    const result = await caller.feedback.byReport({ reportId: 99 });
    expect(result).toEqual([]);
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.feedback.byReport({ reportId: 1 })).rejects.toThrow();
  });
});
