/**
 * companySearchJob.test.ts — Tests for background company search job manager
 * with LLM domain inference integration
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startCompanySearch, getCompanySearchProgress } from "./companySearchJob";

// Mock the LLM domain inference
vi.mock("./domainInference", () => ({
  inferCompanyDomains: vi.fn().mockImplementation(async (companies: string[], onProgress?: Function) => {
    // Simulate progress callback
    if (onProgress) onProgress(0, companies.length, companies.slice(0, 5));
    await new Promise(r => setTimeout(r, 100));
    if (onProgress) onProgress(companies.length, companies.length, []);

    return companies.map((company: string) => {
      // Simulate: well-known companies get high confidence domains
      if (company.toLowerCase().includes("ausdrill")) {
        return { company, domain: "ausdrill.com.au", confidence: "high" };
      }
      if (company.toLowerCase().includes("boart")) {
        return { company, domain: "boartlongyear.com", confidence: "high" };
      }
      if (company.toLowerCase().includes("drilling")) {
        return { company, domain: "drillingcorp.com.au", confidence: "medium" };
      }
      // Unknown companies get null
      return { company, domain: null, confidence: "low" };
    });
  }),
}));

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
    owner_principal: {
      name: "Owner / Principal",
      patterns: [/\bowner\b/i, /\bprincipal\b/i, /\bfounder\b/i, /co-?founder/i, /\bpartner\b/i, /\bproprietor\b/i],
    },
    business_development: {
      name: "Business Development",
      patterns: [/business\s*develop/i, /\bcontracts?\s*(manager|director|admin)/i, /commercial\s*(manager|director)/i, /\bbd\s*manager/i, /tender/i],
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

  it("should start with inferring_domains phase when companies lack domains", () => {
    const jobId = startCompanySearch({
      withDomain: [],
      withoutDomain: [{ company: "Ausdrill" }, { company: "Unknown Co" }],
      targetRoles: ["operations"],
      maxPerCompany: 10,
      maxTotal: 100,
    });

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.phase).toBe("inferring_domains");
    expect(progress!.domainInference.total).toBe(2);
  });

  it("should skip domain inference when all companies have domains", () => {
    const jobId = startCompanySearch({
      withDomain: [{ company: "Example Corp", domain: "example.com" }],
      withoutDomain: [],
      targetRoles: ["operations"],
      maxPerCompany: 10,
      maxTotal: 100,
    });

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.phase).toBe("searching_hunter");
    expect(progress!.domainInference.total).toBe(0);
  });

  it("should complete search with domain inference and have contacts", async () => {
    const jobId = startCompanySearch({
      withDomain: [],
      withoutDomain: [{ company: "Ausdrill" }, { company: "Unknown Co" }],
      targetRoles: ["operations"],
      maxPerCompany: 25,
      maxTotal: 100,
    });

    // Wait for the async job to complete (inference + search)
    await vi.advanceTimersByTimeAsync(15000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress).not.toBeNull();
    expect(progress!.status).toBe("completed");
    expect(progress!.phase).toBe("done");
    // Ausdrill should get a domain inferred (high confidence) → Hunter search
    // Unknown Co should get null domain → Apollo fallback
    expect(progress!.domainInference.completed).toBe(2);
    expect(progress!.domainInference.resolved).toBeGreaterThanOrEqual(1); // At least Ausdrill
    expect(progress!.companiesSearched).toBe(2);
  });

  it("should route LLM-inferred domains to Hunter and unknowns to Apollo", async () => {
    const jobId = startCompanySearch({
      withDomain: [],
      withoutDomain: [
        { company: "Ausdrill" },       // → high confidence → Hunter
        { company: "Boart Longyear" },  // → high confidence → Hunter
        { company: "Unknown XYZ Co" },  // → low confidence → Apollo
      ],
      targetRoles: ["operations", "fleet_equipment"],
      maxPerCompany: 25,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(20000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    // 2 should be resolved by LLM (Ausdrill + Boart)
    expect(progress!.domainInference.resolved).toBe(2);
    expect(progress!.domainInference.highConfidence).toBe(2);
    // All 3 companies should be searched
    expect(progress!.companiesSearched).toBe(3);
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
      withoutDomain: [{ company: "Unknown Co" }],
      targetRoles: ["operations", "fleet_equipment"],
      maxPerCompany: 25,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(15000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    expect(progress!.domainBreakdown.length).toBe(2);
  });

  it("should respect maxTotal limit", async () => {
    const jobId = startCompanySearch({
      withDomain: [{ company: "Example Corp", domain: "example.com" }],
      withoutDomain: [{ company: "Unknown Co" }],
      targetRoles: ["operations", "fleet_equipment"],
      maxPerCompany: 25,
      maxTotal: 1, // Only allow 1 contact total
    });

    await vi.advanceTimersByTimeAsync(15000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    expect(progress!.contacts.length).toBeLessThanOrEqual(1);
  });

  it("should track elapsed time", async () => {
    const jobId = startCompanySearch({
      withDomain: [],
      withoutDomain: [{ company: "Ausdrill" }],
      targetRoles: ["fleet_equipment"],
      maxPerCompany: 10,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(10000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });

  it("should track domain inference stats correctly", async () => {
    const jobId = startCompanySearch({
      withDomain: [],
      withoutDomain: [
        { company: "Ausdrill" },            // high confidence
        { company: "Boart Longyear" },       // high confidence
        { company: "Drilling Services" },    // medium confidence
        { company: "Random Unknown" },       // low confidence (null)
      ],
      targetRoles: ["operations"],
      maxPerCompany: 10,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(20000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    expect(progress!.domainInference.total).toBe(4);
    expect(progress!.domainInference.completed).toBe(4);
    // Ausdrill (high) + Boart (high) + Drilling Services (medium) = 3 resolved
    expect(progress!.domainInference.resolved).toBe(3);
    expect(progress!.domainInference.highConfidence).toBe(2);
    expect(progress!.domainInference.mediumConfidence).toBe(1);
  });

  // ── Apollo Fallback Tests ──

  it("should initialize apolloFallback tracking in progress", () => {
    const jobId = startCompanySearch({
      withDomain: [{ company: "Example Corp", domain: "example.com" }],
      withoutDomain: [],
      targetRoles: ["operations"],
      maxPerCompany: 5,
      maxTotal: 100,
    });

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.apolloFallback).toBeDefined();
    expect(progress!.apolloFallback.attempted).toBe(0);
    expect(progress!.apolloFallback.withResults).toBe(0);
  });

  it("should match owner_principal titles when that role is selected", async () => {
    // Override the Hunter mock to return an Owner title
    const { domainSearch: mockDomainSearch } = await import("./hunterService");
    (mockDomainSearch as any).mockResolvedValueOnce({
      domain: "smalldriller.com.au",
      organization: "Small Driller Pty Ltd",
      pattern: null,
      emails: [
        {
          value: "bob@smalldriller.com.au",
          type: "personal",
          confidence: 80,
          first_name: "Bob",
          last_name: "Jones",
          position: "Owner",
          seniority: "owner",
          department: null,
          linkedin: "https://linkedin.com/in/bobjones",
          twitter: null,
          phone_number: null,
          verification: { date: null, status: "valid" },
        },
      ],
      totalResults: 1,
    });

    const jobId = startCompanySearch({
      withDomain: [{ company: "Small Driller Pty Ltd", domain: "smalldriller.com.au" }],
      withoutDomain: [],
      targetRoles: ["owner_principal"],
      maxPerCompany: 5,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(5000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    expect(progress!.contacts.length).toBe(1);
    expect(progress!.contacts[0].title).toBe("Owner");
    expect(progress!.contacts[0].firstName).toBe("Bob");
  });

  it("should match business_development titles when that role is selected", async () => {
    const { domainSearch: mockDomainSearch } = await import("./hunterService");
    (mockDomainSearch as any).mockResolvedValueOnce({
      domain: "drillingco.com.au",
      organization: "Drilling Co",
      pattern: null,
      emails: [
        {
          value: "sarah@drillingco.com.au",
          type: "personal",
          confidence: 75,
          first_name: "Sarah",
          last_name: "Williams",
          position: "Business Development Manager",
          seniority: "senior",
          department: "business_development",
          linkedin: null,
          twitter: null,
          phone_number: null,
          verification: { date: null, status: "valid" },
        },
        {
          value: "mark@drillingco.com.au",
          type: "personal",
          confidence: 70,
          first_name: "Mark",
          last_name: "Brown",
          position: "Contracts Manager",
          seniority: "senior",
          department: "contracts",
          linkedin: null,
          twitter: null,
          phone_number: null,
          verification: { date: null, status: "valid" },
        },
      ],
      totalResults: 2,
    });

    const jobId = startCompanySearch({
      withDomain: [{ company: "Drilling Co", domain: "drillingco.com.au" }],
      withoutDomain: [],
      targetRoles: ["business_development"],
      maxPerCompany: 5,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(5000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    expect(progress!.contacts.length).toBe(2);
    expect(progress!.contacts.map(c => c.title)).toContain("Business Development Manager");
    expect(progress!.contacts.map(c => c.title)).toContain("Contracts Manager");
  });
});
