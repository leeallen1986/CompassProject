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

  // ── Phase 1c & 1d Fallback Tests ──

  it("should initialize unfilteredFallback and nameOnlyFallback tracking in progress", () => {
    const jobId = startCompanySearch({
      withDomain: [{ company: "Example Corp", domain: "example.com" }],
      withoutDomain: [],
      targetRoles: ["operations"],
      maxPerCompany: 5,
      maxTotal: 100,
    });

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.unfilteredFallback).toBeDefined();
    expect(progress!.unfilteredFallback.attempted).toBe(0);
    expect(progress!.unfilteredFallback.withResults).toBe(0);
    expect(progress!.nameOnlyFallback).toBeDefined();
    expect(progress!.nameOnlyFallback.attempted).toBe(0);
    expect(progress!.nameOnlyFallback.withResults).toBe(0);
  });

  it("should attempt Phase 1c unfiltered search when Hunter and Apollo filtered both return 0", async () => {
    // Mock Hunter to return 0 emails for this domain
    const { domainSearch: mockDomainSearch } = await import("./hunterService");
    (mockDomainSearch as any).mockResolvedValueOnce({
      domain: "tinydriller.com.au",
      organization: "Tiny Driller",
      pattern: null,
      emails: [],
      totalResults: 0,
    });

    // Mock Apollo to return 0 on first call (filtered), then return a person on second call (unfiltered)
    const { apolloPeopleSearch: mockApolloSearch } = await import("./apolloEnrichment");
    (mockApolloSearch as any)
      .mockResolvedValueOnce({ people: [], total_entries: 0 })  // Phase 1b: filtered → 0
      .mockResolvedValueOnce({                                   // Phase 1c: unfiltered → 1 person
        people: [
          {
            id: "apollo-unfiltered-1",
            first_name: "Dave",
            last_name_obfuscated: "Sm***h",
            title: "Director",
            has_email: true,
            organization: { name: "Tiny Driller Pty Ltd" },
          },
        ],
        total_entries: 1,
      });

    const jobId = startCompanySearch({
      withDomain: [{ company: "Tiny Driller", domain: "tinydriller.com.au" }],
      withoutDomain: [],
      targetRoles: ["operations"],
      maxPerCompany: 5,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(15000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    expect(progress!.unfilteredFallback.attempted).toBe(1);
    expect(progress!.unfilteredFallback.withResults).toBe(1);
    expect(progress!.contacts.length).toBe(1);
    expect(progress!.contacts[0].firstName).toBe("Dave");
    expect(progress!.contacts[0].reviewNotes).toContain("unfiltered fallback");
  });

  it("should attempt Phase 1d name-only search when all prior phases return 0", async () => {
    const { domainSearch: mockDomainSearch } = await import("./hunterService");
    (mockDomainSearch as any).mockResolvedValueOnce({
      domain: "cahs.au",
      organization: "",
      pattern: null,
      emails: [],
      totalResults: 0,
    });

    const { apolloPeopleSearch: mockApolloSearch } = await import("./apolloEnrichment");
    (mockApolloSearch as any)
      .mockResolvedValueOnce({ people: [], total_entries: 0 })  // Phase 1b: filtered → 0
      .mockResolvedValueOnce({ people: [], total_entries: 0 })  // Phase 1c: unfiltered → 0
      .mockResolvedValueOnce({                                   // Phase 1d: name-only → 1 person
        people: [
          {
            id: "apollo-nameonly-1",
            first_name: "Tom",
            last_name_obfuscated: "Br***n",
            title: "General Manager",
            has_email: true,
            organization: { name: "CAHS Australia" },
          },
        ],
        total_entries: 1,
      });

    const jobId = startCompanySearch({
      withDomain: [{ company: "CAHS", domain: "cahs.au" }],
      withoutDomain: [],
      targetRoles: ["operations"],
      maxPerCompany: 5,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(20000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    expect(progress!.nameOnlyFallback.attempted).toBe(1);
    expect(progress!.nameOnlyFallback.withResults).toBe(1);
    expect(progress!.contacts.length).toBe(1);
    expect(progress!.contacts[0].firstName).toBe("Tom");
    expect(progress!.contacts[0].reviewNotes).toContain("name-only fallback");
  });

  it("should skip Phase 1c/1d when Phase 1b already found contacts", async () => {
    // Hunter returns 0 but Apollo filtered returns contacts → no need for 1c/1d
    const { domainSearch: mockDomainSearch } = await import("./hunterService");
    (mockDomainSearch as any).mockResolvedValueOnce({
      domain: "onsitegroup.com.au",
      organization: "Onsite Rental Group",
      pattern: null,
      emails: [],
      totalResults: 0,
    });

    const { apolloPeopleSearch: mockApolloSearch } = await import("./apolloEnrichment");
    (mockApolloSearch as any).mockResolvedValueOnce({
      people: [
        {
          id: "apollo-filtered-1",
          first_name: "Lisa",
          last_name_obfuscated: "Ta***r",
          title: "Operations Manager",
          has_email: true,
          organization: { name: "Onsite Rental Group" },
        },
      ],
      total_entries: 1,
    });

    const jobId = startCompanySearch({
      withDomain: [{ company: "Onsite Rental Group", domain: "onsitegroup.com.au" }],
      withoutDomain: [],
      targetRoles: ["operations"],
      maxPerCompany: 5,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(15000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    // Phase 1b found a contact, so 1c and 1d should not have been attempted
    expect(progress!.unfilteredFallback.attempted).toBe(0);
    expect(progress!.nameOnlyFallback.attempted).toBe(0);
    expect(progress!.contacts.length).toBe(1);
  });

  it("should still exclude HR/Marketing roles even in unfiltered Phase 1c", async () => {
    const { domainSearch: mockDomainSearch } = await import("./hunterService");
    (mockDomainSearch as any).mockResolvedValueOnce({
      domain: "airrentals.net.au",
      organization: "Air Rentals",
      pattern: null,
      emails: [],
      totalResults: 0,
    });

    const { apolloPeopleSearch: mockApolloSearch } = await import("./apolloEnrichment");
    (mockApolloSearch as any)
      .mockResolvedValueOnce({ people: [], total_entries: 0 })  // Phase 1b
      .mockResolvedValueOnce({                                   // Phase 1c: unfiltered
        people: [
          {
            id: "apollo-hr-1",
            first_name: "Karen",
            last_name_obfuscated: "Jo***s",
            title: "HR Manager",
            has_email: true,
            organization: { name: "Air Rentals" },
          },
          {
            id: "apollo-gm-1",
            first_name: "Steve",
            last_name_obfuscated: "Wi***s",
            title: "General Manager",
            has_email: true,
            organization: { name: "Air Rentals" },
          },
        ],
        total_entries: 2,
      });

    const jobId = startCompanySearch({
      withDomain: [{ company: "Air Rentals", domain: "airrentals.net.au" }],
      withoutDomain: [],
      targetRoles: ["operations"],
      maxPerCompany: 5,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(15000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    // HR Manager should be excluded, General Manager should be kept
    expect(progress!.contacts.length).toBe(1);
    expect(progress!.contacts[0].title).toBe("General Manager");
  });

  it("should log zero-result companies that are not indexed anywhere", async () => {
    const consoleSpy = vi.spyOn(console, "log");

    const { domainSearch: mockDomainSearch } = await import("./hunterService");
    (mockDomainSearch as any).mockResolvedValueOnce({
      domain: "upac.au",
      organization: "",
      pattern: null,
      emails: [],
      totalResults: 0,
    });

    const { apolloPeopleSearch: mockApolloSearch } = await import("./apolloEnrichment");
    (mockApolloSearch as any)
      .mockResolvedValueOnce({ people: [], total_entries: 0 })  // Phase 1b
      .mockResolvedValueOnce({ people: [], total_entries: 0 })  // Phase 1c
      .mockResolvedValueOnce({ people: [], total_entries: 0 }); // Phase 1d

    const jobId = startCompanySearch({
      withDomain: [{ company: "Under Pressure Air Compressors", domain: "upac.au" }],
      withoutDomain: [],
      targetRoles: ["operations"],
      maxPerCompany: 5,
      maxTotal: 100,
    });

    await vi.advanceTimersByTimeAsync(20000);

    const progress = getCompanySearchProgress(jobId);
    expect(progress!.status).toBe("completed");
    expect(progress!.contacts.length).toBe(0);
    // Should have attempted all fallback phases
    expect(progress!.unfilteredFallback.attempted).toBe(1);
    expect(progress!.nameOnlyFallback.attempted).toBe(1);
    // Should have logged diagnostic messages
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Phase 1c")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Phase 1d")
    );

    consoleSpy.mockRestore();
  });
});
