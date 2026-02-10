import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the database helpers
vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  return {
    ...original,
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
  getLatestReport,
  getAllReports,
  getReportById,
  getProjectsByReportId,
  getContactsByReportId,
  getDrillingCampaignsByReportId,
  getAwardedProjectsByReportId,
  createReport,
  createProjects,
  createContacts,
  createDrillingCampaigns,
  createAwardedProjects,
} from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const mockReport = {
  id: 1,
  weekEnding: "Feb 10, 2026",
  generatedTime: "7:00 AM AWST",
  totalProjects: 28,
  hotProjects: 5,
  warmProjects: 12,
  coldProjects: 11,
  confirmedContractors: 8,
  predictedContractors: 15,
  capexOpportunities: 18,
  totalContacts: 35,
  sourcesSearched: "20+",
  newProjectsCount: 8,
  executiveSummaryMain: "Test summary",
  executiveSummaryChanges: "Test changes",
  actionItems: ["Action 1", "Action 2"],
  researchPasses: [{ pass: "A", focus: "Mining", rawProjects: 10, keySources: "ASX" }],
  sourceCategories: [{ name: "ASX Announcements", type: "asx" }],
  createdAt: new Date(),
};

const mockProject = {
  id: 1,
  reportId: 1,
  projectKey: "test-project",
  name: "Test Mining Project",
  location: "Pilbara, WA",
  value: "$500M",
  owner: "BHP",
  priority: "hot" as const,
  capexGrade: "A" as const,
  opportunityRoute: "Direct CAPEX" as const,
  sector: "mining" as const,
  isNew: true,
  stage: "Construction",
  overview: "Test overview",
  equipmentSignals: ["Compressors needed"],
  contractors: [{ name: "Contractor A", status: "confirmed" }],
  opportunityNote: "Direct sale opportunity",
  sources: [{ label: "ASX", url: "https://example.com", date: "2026-02-10" }],
  timeline: "24 months",
  completion: "2028",
  createdAt: new Date(),
};

const mockContact = {
  id: 1,
  reportId: 1,
  name: "John Smith",
  title: "Project Manager",
  company: "BHP",
  project: "Test Mining Project",
  priority: "hot" as const,
  roleBucket: "Decision Maker",
  email: "john@bhp.com",
  linkedin: "https://linkedin.com/in/john",
  phone: null,
  createdAt: new Date(),
};

const mockDrilling = {
  id: 1,
  reportId: 1,
  campaign: "Test Drilling Campaign",
  operator: "Rio Tinto",
  location: "Pilbara, WA",
  drillType: "RC Drilling",
  timing: "Q1 2026",
  airRequirement: "900 CFM @ 350 psi",
  sourceLabel: "ASX",
  sourceUrl: "https://example.com",
  createdAt: new Date(),
};

const mockAwarded = {
  id: 1,
  reportId: 1,
  project: "Test Awarded Project",
  value: "$200M",
  winningContractor: "NRW Holdings",
  location: "WA",
  stage: "Mobilisation",
  opportunity: "Direct" as const,
  sourceLabel: "ASX",
  sourceUrl: "https://example.com",
  createdAt: new Date(),
};

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

describe("report.latest", () => {
  it("returns the latest report for authenticated users", async () => {
    vi.mocked(getLatestReport).mockResolvedValue(mockReport);
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.report.latest();
    expect(result).toEqual(mockReport);
    expect(getLatestReport).toHaveBeenCalledOnce();
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.report.latest()).rejects.toThrow();
  });
});

describe("report.list", () => {
  it("returns all reports for authenticated users", async () => {
    vi.mocked(getAllReports).mockResolvedValue([mockReport]);
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.report.list();
    expect(result).toEqual([mockReport]);
    expect(getAllReports).toHaveBeenCalledOnce();
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.report.list()).rejects.toThrow();
  });
});

describe("report.byId", () => {
  it("returns a specific report by ID", async () => {
    vi.mocked(getReportById).mockResolvedValue(mockReport);
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.report.byId({ id: 1 });
    expect(result).toEqual(mockReport);
    expect(getReportById).toHaveBeenCalledWith(1);
  });
});

describe("report.full", () => {
  it("returns full report data with all associated records", async () => {
    vi.mocked(getLatestReport).mockResolvedValue(mockReport);
    vi.mocked(getProjectsByReportId).mockResolvedValue([mockProject]);
    vi.mocked(getContactsByReportId).mockResolvedValue([mockContact]);
    vi.mocked(getDrillingCampaignsByReportId).mockResolvedValue([mockDrilling]);
    vi.mocked(getAwardedProjectsByReportId).mockResolvedValue([mockAwarded]);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.report.full({});

    expect(result).not.toBeNull();
    expect(result!.report).toEqual(mockReport);
    expect(result!.projects).toEqual([mockProject]);
    expect(result!.contacts).toEqual([mockContact]);
    expect(result!.drillingCampaigns).toEqual([mockDrilling]);
    expect(result!.awardedProjects).toEqual([mockAwarded]);
  });

  it("returns full report data for a specific report ID", async () => {
    vi.mocked(getReportById).mockResolvedValue(mockReport);
    vi.mocked(getProjectsByReportId).mockResolvedValue([mockProject]);
    vi.mocked(getContactsByReportId).mockResolvedValue([mockContact]);
    vi.mocked(getDrillingCampaignsByReportId).mockResolvedValue([mockDrilling]);
    vi.mocked(getAwardedProjectsByReportId).mockResolvedValue([mockAwarded]);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.report.full({ reportId: 1 });

    expect(result).not.toBeNull();
    expect(getReportById).toHaveBeenCalledWith(1);
  });

  it("returns null when no report exists", async () => {
    vi.mocked(getLatestReport).mockResolvedValue(null);
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.report.full({});
    expect(result).toBeNull();
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.report.full({})).rejects.toThrow();
  });
});

describe("report.create", () => {
  const createInput = {
    report: {
      weekEnding: "Feb 17, 2026",
      generatedTime: "7:00 AM AWST",
      totalProjects: 30,
      hotProjects: 6,
      warmProjects: 13,
      coldProjects: 11,
      confirmedContractors: 9,
      predictedContractors: 16,
      capexOpportunities: 20,
      totalContacts: 40,
      sourcesSearched: "25+",
      newProjectsCount: 5,
      executiveSummaryMain: "New summary",
      actionItems: ["New action"],
    },
    projects: [{
      projectKey: "new-project",
      name: "New Project",
      location: "NSW",
      value: "$100M",
      owner: "Rio Tinto",
      priority: "warm" as const,
      capexGrade: "B" as const,
      opportunityRoute: "Fleet CAPEX" as const,
      sector: "mining" as const,
      isNew: true,
    }],
    contacts: [{
      name: "Jane Doe",
      title: "Engineer",
      company: "Rio Tinto",
      project: "New Project",
      priority: "warm" as const,
      roleBucket: "Technical",
    }],
    drillingCampaigns: [{
      campaign: "New Campaign",
      operator: "BHP",
      location: "WA",
      drillType: "Diamond",
      timing: "Q2 2026",
      airRequirement: "400 CFM",
    }],
    awardedProjects: [{
      project: "New Awarded",
      value: "$50M",
      winningContractor: "Downer",
      location: "QLD",
      stage: "Construction",
      opportunity: "Fleet" as const,
    }],
  };

  it("creates a report with all data for admin users", async () => {
    vi.mocked(createReport).mockResolvedValue(2);
    vi.mocked(createProjects).mockResolvedValue(undefined);
    vi.mocked(createContacts).mockResolvedValue(undefined);
    vi.mocked(createDrillingCampaigns).mockResolvedValue(undefined);
    vi.mocked(createAwardedProjects).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(createAuthContext("admin"));
    const result = await caller.report.create(createInput);

    expect(result).toEqual({ reportId: 2 });
    expect(createReport).toHaveBeenCalledOnce();
    expect(createProjects).toHaveBeenCalledOnce();
    expect(createContacts).toHaveBeenCalledOnce();
    expect(createDrillingCampaigns).toHaveBeenCalledOnce();
    expect(createAwardedProjects).toHaveBeenCalledOnce();
  });

  it("rejects non-admin users", async () => {
    const caller = appRouter.createCaller(createAuthContext("user"));
    await expect(caller.report.create(createInput)).rejects.toThrow();
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(caller.report.create(createInput)).rejects.toThrow();
  });
});
