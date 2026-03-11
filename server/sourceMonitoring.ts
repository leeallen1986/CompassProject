/**
 * Source Monitoring Module
 *
 * Tracks per-source metrics:
 * - Last successful fetch
 * - Number of articles retrieved
 * - Number of projects extracted
 * - Error rate
 * - Response time
 *
 * Exposes metrics for the admin pipeline view.
 */
import { eq, sql, desc } from "drizzle-orm";
import { getDb } from "./db";
import { pipelineRuns, rssSources, projects, projectoryEnrichmentLog } from "../drizzle/schema";
import { ALL_SOURCES, getSourceSummary, type SourceConfig, type SourceRole } from "./sourceConfig";

// ── Types ──

export interface SourceMetric {
  id: string;
  name: string;
  role: SourceRole;
  frequency: string;
  active: boolean;
  lastSuccessfulFetch: string | null;
  articlesRetrieved: number;
  projectsExtracted: number;
  errorCount: number;
  errorRate: number; // 0-1
  avgResponseTimeMs: number;
  lastError: string | null;
  healthStatus: "healthy" | "degraded" | "failing" | "unknown";
}

export interface SourceMonitoringSummary {
  totalSources: number;
  healthySources: number;
  degradedSources: number;
  failingSources: number;
  unknownSources: number;
  byRole: {
    primaryDiscovery: { total: number; healthy: number };
    secondaryConfirmation: { total: number; healthy: number };
    enrichment: { total: number; healthy: number };
  };
  metrics: SourceMetric[];
  lastPipelineRun: {
    id: number;
    startedAt: string;
    status: string;
    duration: number;
  } | null;
}

// ── In-Memory Metrics Store ──
// Updated during pipeline runs

interface MetricEntry {
  sourceId: string;
  fetchCount: number;
  successCount: number;
  errorCount: number;
  totalResponseTimeMs: number;
  articlesRetrieved: number;
  projectsExtracted: number;
  lastSuccessfulFetch: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
}

const metricsStore = new Map<string, MetricEntry>();

function getOrCreateEntry(sourceId: string): MetricEntry {
  if (!metricsStore.has(sourceId)) {
    metricsStore.set(sourceId, {
      sourceId,
      fetchCount: 0,
      successCount: 0,
      errorCount: 0,
      totalResponseTimeMs: 0,
      articlesRetrieved: 0,
      projectsExtracted: 0,
      lastSuccessfulFetch: null,
      lastError: null,
      lastErrorAt: null,
    });
  }
  return metricsStore.get(sourceId)!;
}

// ── Recording Functions (called during pipeline) ──

export function recordFetchStart(sourceId: string): number {
  return Date.now();
}

export function recordFetchSuccess(sourceId: string, startTime: number, articles: number, projectsFound: number): void {
  const entry = getOrCreateEntry(sourceId);
  entry.fetchCount++;
  entry.successCount++;
  entry.totalResponseTimeMs += Date.now() - startTime;
  entry.articlesRetrieved += articles;
  entry.projectsExtracted += projectsFound;
  entry.lastSuccessfulFetch = new Date();
}

export function recordFetchError(sourceId: string, startTime: number, error: string): void {
  const entry = getOrCreateEntry(sourceId);
  entry.fetchCount++;
  entry.errorCount++;
  entry.totalResponseTimeMs += Date.now() - startTime;
  entry.lastError = error;
  entry.lastErrorAt = new Date();
}

// ── Query Functions ──

function getHealthStatus(entry: MetricEntry): "healthy" | "degraded" | "failing" | "unknown" {
  if (entry.fetchCount === 0) return "unknown";
  const errorRate = entry.errorCount / entry.fetchCount;
  if (errorRate > 0.5) return "failing";
  if (errorRate > 0.2) return "degraded";
  return "healthy";
}

function buildMetricFromEntry(source: SourceConfig, entry: MetricEntry | undefined): SourceMetric {
  if (!entry) {
    return {
      id: source.id,
      name: source.name,
      role: source.role,
      frequency: source.frequency,
      active: source.active,
      lastSuccessfulFetch: null,
      articlesRetrieved: 0,
      projectsExtracted: 0,
      errorCount: 0,
      errorRate: 0,
      avgResponseTimeMs: 0,
      lastError: null,
      healthStatus: "unknown",
    };
  }

  return {
    id: source.id,
    name: source.name,
    role: source.role,
    frequency: source.frequency,
    active: source.active,
    lastSuccessfulFetch: entry.lastSuccessfulFetch?.toISOString() || null,
    articlesRetrieved: entry.articlesRetrieved,
    projectsExtracted: entry.projectsExtracted,
    errorCount: entry.errorCount,
    errorRate: entry.fetchCount > 0 ? entry.errorCount / entry.fetchCount : 0,
    avgResponseTimeMs: entry.fetchCount > 0 ? Math.round(entry.totalResponseTimeMs / entry.fetchCount) : 0,
    lastError: entry.lastError,
    healthStatus: getHealthStatus(entry),
  };
}

// ── Main Query ──

export async function getSourceMonitoringSummary(): Promise<SourceMonitoringSummary> {
  const db = await getDb();

  // Build metrics for all sources
  const metrics: SourceMetric[] = ALL_SOURCES.map(source => {
    const entry = metricsStore.get(source.id);
    return buildMetricFromEntry(source, entry);
  });

  // Enrich with database data if available
  if (db) {
    // Get RSS source stats
    try {
      const rssSourceRows = await db
        .select({
          name: rssSources.name,
          lastFetchedAt: rssSources.lastFetchedAt,
          lastError: rssSources.lastError,
          consecutiveErrors: rssSources.consecutiveErrors,
          totalArticles: rssSources.totalArticles,
        })
        .from(rssSources);

      // Aggregate RSS stats into the rss_feeds metric
      const rssMetric = metrics.find(m => m.id === "rss_feeds");
      if (rssMetric && rssSourceRows.length > 0) {
        const totalArticles = rssSourceRows.reduce((sum, r) => sum + (r.totalArticles || 0), 0);
        const lastFetch = rssSourceRows
          .filter(r => r.lastFetchedAt)
          .sort((a, b) => (b.lastFetchedAt?.getTime() || 0) - (a.lastFetchedAt?.getTime() || 0))[0];
        const errorSources = rssSourceRows.filter(r => (r.consecutiveErrors || 0) > 0).length;

        rssMetric.articlesRetrieved = totalArticles;
        rssMetric.lastSuccessfulFetch = lastFetch?.lastFetchedAt?.toISOString() || null;
        rssMetric.errorCount = errorSources;
        rssMetric.errorRate = rssSourceRows.length > 0 ? errorSources / rssSourceRows.length : 0;
        rssMetric.healthStatus = rssMetric.errorRate > 0.5 ? "failing" : rssMetric.errorRate > 0.2 ? "degraded" : rssSourceRows.length > 0 ? "healthy" : "unknown";
      }
    } catch {}

    // Get last pipeline run
    try {
      const [lastRun] = await db
        .select()
        .from(pipelineRuns)
        .orderBy(desc(pipelineRuns.startedAt))
        .limit(1);

      if (lastRun) {
        // Enrich source metrics from pipeline run data
        const austenderMetric = metrics.find(m => m.id === "austender");
        if (austenderMetric && lastRun.austenderContracts) {
          austenderMetric.projectsExtracted += lastRun.austenderContracts;
          if (lastRun.completedAt) {
            austenderMetric.lastSuccessfulFetch = lastRun.completedAt.toISOString();
            austenderMetric.healthStatus = "healthy";
          }
        }

        const dmirsMetric = metrics.find(m => m.id === "dmirs");
        if (dmirsMetric && lastRun.dmirsProjects) {
          dmirsMetric.projectsExtracted += lastRun.dmirsProjects;
          if (lastRun.completedAt) {
            dmirsMetric.lastSuccessfulFetch = lastRun.completedAt.toISOString();
            dmirsMetric.healthStatus = "healthy";
          }
        }

        const projectoryMetric = metrics.find(m => m.id === "projectory");
        if (projectoryMetric && lastRun.projectoryEnriched) {
          projectoryMetric.projectsExtracted += lastRun.projectoryEnriched;
          if (lastRun.completedAt) {
            projectoryMetric.lastSuccessfulFetch = lastRun.completedAt.toISOString();
            projectoryMetric.healthStatus = "healthy";
          }
        }
      }
    } catch {}

    // Get Projectory enrichment stats
    try {
      const [projStats] = await db
        .select({
          total: sql<number>`COUNT(*)`,
          matched: sql<number>`SUM(CASE WHEN ${projectoryEnrichmentLog.status} = 'matched' THEN 1 ELSE 0 END)`,
          errors: sql<number>`SUM(CASE WHEN ${projectoryEnrichmentLog.status} = 'error' THEN 1 ELSE 0 END)`,
        })
        .from(projectoryEnrichmentLog);

      const projectoryMetric = metrics.find(m => m.id === "projectory");
      if (projectoryMetric && projStats) {
        projectoryMetric.articlesRetrieved = projStats.total || 0;
        projectoryMetric.projectsExtracted = projStats.matched || 0;
        projectoryMetric.errorCount = projStats.errors || 0;
      }
    } catch {}
  }

  // Calculate summary
  const healthySources = metrics.filter(m => m.healthStatus === "healthy").length;
  const degradedSources = metrics.filter(m => m.healthStatus === "degraded").length;
  const failingSources = metrics.filter(m => m.healthStatus === "failing").length;
  const unknownSources = metrics.filter(m => m.healthStatus === "unknown").length;

  const primaryMetrics = metrics.filter(m => m.role === "primary_discovery");
  const secondaryMetrics = metrics.filter(m => m.role === "secondary_confirmation");
  const enrichmentMetrics = metrics.filter(m => m.role === "enrichment");

  // Get last pipeline run info
  let lastPipelineRun = null;
  if (db) {
    try {
      const [lastRun] = await db
        .select({
          id: pipelineRuns.id,
          startedAt: pipelineRuns.startedAt,
          status: pipelineRuns.status,
          durationMs: pipelineRuns.durationMs,
        })
        .from(pipelineRuns)
        .orderBy(desc(pipelineRuns.startedAt))
        .limit(1);

      if (lastRun) {
        lastPipelineRun = {
          id: lastRun.id,
          startedAt: lastRun.startedAt?.toISOString() || "",
          status: lastRun.status || "unknown",
          duration: lastRun.durationMs || 0,
        };
      }
    } catch {}
  }

  return {
    totalSources: metrics.length,
    healthySources,
    degradedSources,
    failingSources,
    unknownSources,
    byRole: {
      primaryDiscovery: {
        total: primaryMetrics.length,
        healthy: primaryMetrics.filter(m => m.healthStatus === "healthy").length,
      },
      secondaryConfirmation: {
        total: secondaryMetrics.length,
        healthy: secondaryMetrics.filter(m => m.healthStatus === "healthy").length,
      },
      enrichment: {
        total: enrichmentMetrics.length,
        healthy: enrichmentMetrics.filter(m => m.healthStatus === "healthy").length,
      },
    },
    metrics,
    lastPipelineRun,
  };
}

// ── Reset metrics (for testing) ──

/**
 * Convenience function to record a source run from the pipeline.
 * Wraps recordFetchStart + recordFetchSuccess/recordFetchError.
 */
export function recordSourceRun(
  sourceId: string,
  success: boolean,
  itemsFound: number,
  durationSec: number,
  error?: string
): void {
  const startTime = Date.now() - (durationSec * 1000);
  if (success) {
    recordFetchSuccess(sourceId, startTime, itemsFound, itemsFound);
  } else {
    recordFetchError(sourceId, startTime, error || "Unknown error");
  }
}

export function resetMetrics(): void {
  metricsStore.clear();
}
