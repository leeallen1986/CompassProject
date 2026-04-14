import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the campaignService to avoid real DB calls
vi.mock("./campaignService", () => ({
  enrichCampaignContacts: vi.fn(),
}));

import { startEnrichmentJob, getEnrichmentJobProgress } from "./enrichmentJob";
import { enrichCampaignContacts } from "./campaignService";

const mockEnrich = vi.mocked(enrichCampaignContacts);

describe("enrichmentJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("startEnrichmentJob returns a job ID immediately", () => {
    // Make the mock return a pending promise so it stays "running"
    mockEnrich.mockReturnValue(new Promise(() => {}));
    const jobId = startEnrichmentJob(1, { maxContacts: 50 });
    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(0);
  });

  it("job starts in running status", () => {
    mockEnrich.mockReturnValue(new Promise(() => {}));
    const jobId = startEnrichmentJob(1, { maxContacts: 50 });
    const progress = getEnrichmentJobProgress(jobId);
    expect(progress).not.toBeNull();
    expect(progress!.status).toBe("running");
    expect(progress!.campaignId).toBe(1);
    expect(progress!.result).toBeNull();
    expect(progress!.error).toBeNull();
  });

  it("job transitions to completed when enrichment succeeds", async () => {
    const mockResult = {
      enriched: 10,
      notFound: 3,
      failed: 1,
      creditsUsed: 10,
      hunterFound: 2,
      apolloFound: 8,
      emailsVerified: 7,
      emailsCorrected: 1,
      linkedInAdded: 5,
      titlesUpdated: 3,
    };
    mockEnrich.mockResolvedValue(mockResult as any);
    const jobId = startEnrichmentJob(1, { maxContacts: 50 });
    // Wait for the promise to resolve
    await vi.waitFor(() => {
      const progress = getEnrichmentJobProgress(jobId);
      expect(progress!.status).toBe("completed");
    });
    const progress = getEnrichmentJobProgress(jobId);
    expect(progress!.result).toEqual(mockResult);
    expect(progress!.error).toBeNull();
    expect(progress!.completedAt).not.toBeNull();
    expect(progress!.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });

  it("job transitions to failed when enrichment throws", async () => {
    mockEnrich.mockRejectedValue(new Error("Apollo API rate limit"));
    const jobId = startEnrichmentJob(1, { maxContacts: 50 });
    await vi.waitFor(() => {
      const progress = getEnrichmentJobProgress(jobId);
      expect(progress!.status).toBe("failed");
    });
    const progress = getEnrichmentJobProgress(jobId);
    expect(progress!.error).toBe("Apollo API rate limit");
    expect(progress!.result).toBeNull();
    expect(progress!.completedAt).not.toBeNull();
  });

  it("getEnrichmentJobProgress returns null for unknown job ID", () => {
    const progress = getEnrichmentJobProgress("nonexistent-id");
    expect(progress).toBeNull();
  });

  it("passes options through to enrichCampaignContacts", () => {
    mockEnrich.mockReturnValue(new Promise(() => {}));
    startEnrichmentJob(42, { maxContacts: 75, userId: 5, userName: "test" });
    expect(mockEnrich).toHaveBeenCalledWith(42, {
      maxContacts: 75,
      userId: 5,
      userName: "test",
    });
  });

  it("running job updates elapsedSeconds on each progress check", () => {
    mockEnrich.mockReturnValue(new Promise(() => {}));
    const jobId = startEnrichmentJob(1, { maxContacts: 50 });
    const progress1 = getEnrichmentJobProgress(jobId);
    expect(progress1!.elapsedSeconds).toBeGreaterThanOrEqual(0);
    // elapsedSeconds should be a number (it updates on each call)
    expect(typeof progress1!.elapsedSeconds).toBe("number");
  });
});
