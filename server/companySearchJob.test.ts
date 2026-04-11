/**
 * companySearchJob.test.ts — Tests for background company search job manager
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startCompanySearch, getCompanySearchProgress } from "./companySearchJob";

// Mock the external API calls
vi.mock("./hunterService", () => ({
  domainSearch: vi.fn().mockResolvedValue({
    domain: "example.com",
    organization: "Example Corp",
    pattern: "{first}.{last}@example.com",
    emails: [
      {
        value: "john.doe@example.com",
        type: "personal",
        confidence: 90,
        first_name: "John",
        last_name: "Doe",
        position: "Operations Manager",
        seniority: "senior",
        department: "operations",
        linkedin: "https://linkedin.com/in/johndoe",
        twitter: null,
        phone_number: null,
        verification: { date: null, status: "valid" },
      },
      {
        value: "jane.smith@example.com",
        type: "personal",
        confidence: 85,
        first_name: "Jane",
        last_name: "Smith",
        position: "HR Manager",
        seniority: "senior",
        department: "hr",
        linkedin: null,
        twitter: null,
        phone_number: null,
        verification: { date: null, status: "valid" },
      },
    ],
    totalResults: 2,
  }),
}));

vi.mock("./apolloEnrichment", () => ({
  apolloPeopleSearch: vi.fn().mockResolvedValue({
    people: [
      {
        id: "apollo-1",
        first_name: "Mike",
        last_name_obfuscated: "Jo***n",
        title: "Fleet Manager",
        has_email: true,
        has_city: true,
        has_state: true,
        has_country: true,
        has_direct_phone: null,
        organization: { name: "Drilling Corp", has_industry: true },
      },
      {
        id: "apollo-2",
        first_name: "Sarah",
        last_name_obfuscated: "Wi***s",
        title: "Marketing Director",
        has_email: true,
        has_city: false,
        has_state: false,
        has_country: true,
        has_direct_phone: null,
        organization: { name: "Drilling Corp", has_industry: true },
      },
    ],
    total_entries: 2,
  }),
}));

vi.mock("./hunterContactSearch", () => ({
  PREDEFINED_ROLES: {
    operations: {
      name: "Operations / GM",
      patterns: [/operations/i, /general\s*manager/i, /managing\s*director/i],
    },
    fleet_equipment: {
      name: "Fleet & Equipment",
      patterns: [/fleet/i, /equipment/i, /plant\s*manager/i, /maintenance/i],
    },
    procurement: {
      name: "Procurement",
      patterns: [/procurement/i, /purchasing/i, /supply\s*chain/i, /buyer/i],
    },
  },
  searchContactsByDomain: vi.fn(),
  searchContactsByCompanyName: vi.fn(),
  getAvailableRoles: vi.fn(),
}));

describe("companySearchJob", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return a jobId immediately when starting a search", () => {
    const jobId = startCompanySearch({
      withDomain: [],
      withoutDomain: [{ company: "Test Corp" }],
      targetRoles: ["fleet_equipment"],
      maxPerCompany: 10,
      maxTotal: 100,
    });

    expect(jobId).toBeTruthy();
    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(0);
  });

  it("should return progress immediately after starting", () => {
    const jobId = startCompanySearch({
      withDomain: [],
      withoutDomain: [{ company: "Test Corp" }],
      targetRoles: ["fleet_equipment"],
      maxPerCompany: 10,
      maxTotal: 100,
    });

    const progress = getCompanySearchProgress(jobId);
    expect(progress).not.toBeNull();
    expect(progress!.status).toBe("running");
    expect(progress!.totalCompanies).toBe(1);
    expect(progress!.companiesSearched).toBe(0);
  });

  it("should return null for non-existent job", () => {
    const progress = getCompanySearchProgress("nonexistent-job");
    expect(progress).toBeNull();
  });

  it("should correctly count total companies (domain + name)", () => {
    const jobId = startCompanySearch({
      withDomain: [
        { company: "Example Corp", domain: "example.com" },
        { company: "Test Inc", domain: "test.com" },
      ],
      withoutDomain: [
        { company: "No Domain Co" },
        { company: "Another Co" },
        { company: "Third Co" },
      ],
      targetRoles: ["operations"],
      maxPerCompany: 10,
      maxTotal: 100,
    });

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.totalCompanies).toBe(5);
  });

  it("should complete search and have contacts after processing", async () => {
    const jobId = startCompanySearch({
      withDomain: [],
      withoutDomain: [{ company: "Drilling Corp" }],
      targetRoles: ["fleet_equipment"],
      maxPerCompany: 25,
      maxTotal: 100,
    });

    // Wait for the async job to complete
    await vi.advanceTimersByTimeAsync(5000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress).not.toBeNull();
    expect(progress!.status).toBe("completed");
    expect(progress!.companiesSearched).toBe(1);
    // Fleet Manager should match, Marketing Director should be excluded
    expect(progress!.totalFiltered).toBe(1);
    expect(progress!.contacts.length).toBe(1);
    expect(progress!.contacts[0].firstName).toBe("Mike");
    expect(progress!.contacts[0].title).toBe("Fleet Manager");
  });

  it("should filter out excluded roles (HR, Marketing, etc.)", async () => {
    const jobId = startCompanySearch({
      withDomain: [{ company: "Example Corp", domain: "example.com" }],
      withoutDomain: [],
      targetRoles: ["operations"],
      maxPerCompany: 25,
      maxTotal: 100,
    });

    // Wait for the async job to complete
    await vi.advanceTimersByTimeAsync(5000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    // Operations Manager should match, HR Manager should be excluded
    expect(progress!.contacts.length).toBe(1);
    expect(progress!.contacts[0].firstName).toBe("John");
    expect(progress!.contacts[0].title).toBe("Operations Manager");
  });

  it("should track domain breakdown for each company", async () => {
    const jobId = startCompanySearch({
      withDomain: [{ company: "Example Corp", domain: "example.com" }],
      withoutDomain: [{ company: "Drilling Corp" }],
      targetRoles: ["operations", "fleet_equipment"],
      maxPerCompany: 25,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(10000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    expect(progress!.domainBreakdown.length).toBe(2);
  });

  it("should respect maxTotal limit", async () => {
    const jobId = startCompanySearch({
      withDomain: [{ company: "Example Corp", domain: "example.com" }],
      withoutDomain: [{ company: "Drilling Corp" }],
      targetRoles: ["operations", "fleet_equipment"],
      maxPerCompany: 25,
      maxTotal: 1, // Only allow 1 contact total
    });

    await vi.advanceTimersByTimeAsync(10000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    expect(progress!.contacts.length).toBeLessThanOrEqual(1);
  });

  it("should track elapsed time", async () => {
    const jobId = startCompanySearch({
      withDomain: [],
      withoutDomain: [{ company: "Drilling Corp" }],
      targetRoles: ["fleet_equipment"],
      maxPerCompany: 10,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(5000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });
});
