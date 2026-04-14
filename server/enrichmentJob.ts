/**
 * Enrichment Background Job
 * 
 * Converts the synchronous enrichCampaignContacts call into a background job
 * with polling support, preventing gateway timeouts on the deployed platform.
 * 
 * Pattern: start job → return jobId immediately → frontend polls for progress
 */
import { nanoid } from "nanoid";
import { enrichCampaignContacts } from "./campaignService";

// ── Types ──

export interface EnrichmentJobProgress {
  jobId: string;
  campaignId: number;
  status: "running" | "completed" | "failed";
  /** Enrichment results (populated when status === "completed") */
  result: {
    enriched: number;
    notFound: number;
    failed: number;
    creditsUsed: number;
    hunterFound: number;
    apolloFound: number;
    emailsVerified: number;
    emailsCorrected: number;
    linkedInAdded: number;
    titlesUpdated: number;
  } | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  elapsedSeconds: number;
}

// ── In-memory job store ──

const jobs = new Map<string, EnrichmentJobProgress>();

const MAX_JOBS = 50;
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cleanupOldJobs() {
  if (jobs.size <= MAX_JOBS) return;
  const now = Date.now();
  for (const [id, job] of Array.from(jobs.entries())) {
    if (now - job.startedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
  // If still over limit, remove oldest completed jobs
  if (jobs.size > MAX_JOBS) {
    const sorted = Array.from(jobs.entries())
      .filter(([, j]) => j.status !== "running")
      .sort((a, b) => a[1].startedAt - b[1].startedAt);
    for (const [id] of sorted) {
      jobs.delete(id);
      if (jobs.size <= MAX_JOBS) break;
    }
  }
}

// ── Public API ──

export function startEnrichmentJob(
  campaignId: number,
  options: { maxContacts?: number; userId?: number; userName?: string }
): string {
  cleanupOldJobs();

  const jobId = nanoid(12);

  const progress: EnrichmentJobProgress = {
    jobId,
    campaignId,
    status: "running",
    result: null,
    error: null,
    startedAt: Date.now(),
    completedAt: null,
    elapsedSeconds: 0,
  };

  jobs.set(jobId, progress);

  // Run enrichment in the background (fire and forget)
  enrichCampaignContacts(campaignId, options)
    .then(result => {
      const job = jobs.get(jobId);
      if (job) {
        job.status = "completed";
        job.result = result;
        job.completedAt = Date.now();
        job.elapsedSeconds = Math.round((Date.now() - job.startedAt) / 1000);
        console.log(`[EnrichmentJob] ${jobId} completed in ${job.elapsedSeconds}s: ${result.enriched} enriched, ${result.notFound} not found, ${result.failed} failed`);
      }
    })
    .catch(err => {
      const job = jobs.get(jobId);
      if (job) {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
        job.completedAt = Date.now();
        job.elapsedSeconds = Math.round((Date.now() - job.startedAt) / 1000);
        console.error(`[EnrichmentJob] ${jobId} failed after ${job.elapsedSeconds}s:`, err);
      }
    });

  return jobId;
}

export function getEnrichmentJobProgress(jobId: string): EnrichmentJobProgress | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  // Update elapsed time for running jobs
  if (job.status === "running") {
    job.elapsedSeconds = Math.round((Date.now() - job.startedAt) / 1000);
  }
  return job;
}
