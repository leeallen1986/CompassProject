/**
 * Weekly Pipeline Runner — "Sunday Mega-Scrape" (v2 — enrichment-before-digest)
 *
 * Runs EVERY scraper AND every enrichment step in a single pass (unlike the
 * daily pipeline which spreads scrapers across different days of the week).
 *
 * Scheduled for Sunday 9pm AWST (13:00 UTC) via in-process scheduler.
 *
 * Pipeline order:
 *
 * ─── DISCOVERY ───
 *  1. RSS Harvest — fetch all configured feeds
 *  2. AI Extraction — extract projects from queued articles (increased cap)
 *  3. ASX Targeted Monitoring — scan target companies for project signals
 *  4. Projectory Scraper — crawl all 6 categories
 *  5. Projectory Enrichment — enrich existing projects with Projectory data
 *  6. DMIRS MINEDEX — WA mining registrations
 *  7. AEMO — energy generation projects
 *  8. Government Major Projects — Infrastructure Australia + NREPL
 *  9. AusTender — federal government contracts
 * 10. ICN Gateway — major project work packages
 * 11. ICN Validation — validate existing projects against ICN
 *
 * ─── ENRICHMENT ───
 * 12. Contact Enrichment — enrich all new contacts
 * 13. Web Stakeholder Discovery — open-web stakeholder search
 * 14. Apollo Selective Gap-Fill — verify emails + find additional contacts
 * 15. Business Line Scoring — score projects across 9 business lines
 * 16. Tier Classification — classify projects into actionable/warm/monitor
 * 17. Contractor & Delivery Pattern Engine — company registry + pairings
 * 18. Contractor Enrichment Pass — enrich projects missing contractors
 * 19. Role Relevance Classification — classify contact role relevance
 * 20. Second-Pass Contact Search — find contacts for projects with few relevant ones
 *
 * ─── DIGEST & HOUSEKEEPING ───
 * 21. Weekly Report Generation — create report row with stats
 * 22. Weekly Digest — send email summaries to subscribed users
 * 23. Staleness Check — mark old projects as stale
 * 24. Notify Owner — summary notification
 */
import { harvestAllFeeds } from "./rssHarvester";
import { runExtractionPipeline } from "./aiExtractor";
import { runEnrichmentPipeline } from "./contactEnrichment";
import { runProjectoryScraper } from "./projectoryScraper";
import { runDmirsScraper } from "./dmirsScraper";
import { runAemoScraper } from "./aemoScraper";
import { runGovScraper } from "./govScraper";
import { runAusTenderScraper } from "./austenderScraper";
import { runIcnScraper } from "./icnScraper";
import { sendWeeklyDigests } from "./emailDigest";
import { markStaleProjects, getDb } from "./db";
import { notifyOwner } from "./_core/notification";
import { projects, contacts, reports } from "../drizzle/schema";
import { sql, eq, gte } from "drizzle-orm";

// New enrichment imports
import { scanTargetCompanies } from "./asxMonitor";
import { enrichUnenrichedProjects } from "./projectoryEnrichment";
import { validateAllProjects as icnValidateAllProjects } from "./icnEnrichment";
import { runBulkWebDiscovery } from "./webStakeholderDiscovery";
import { findEligibleProjects, buildGapFillPlan, getBudgetStatus } from "./apolloEligibility";
import { enrichProjectContacts, revealContactEmail } from "./apolloEnrichment";
import { classifyAllProjects } from "./tierClassification";
import { runContractorEngine } from "./contractorEngine";
import { runContractorEnrichmentPass } from "./contractorEnrichmentPass";
import { classifyAllContactRelevance } from "./roleRelevance";
import { runBulkSecondPass } from "./secondPassContactSearch";

export interface WeeklyPipelineResult {
  harvest: {
    totalSources: number;
    totalNew: number;
    totalDuplicates: number;
    totalErrors: number;
  };
  extraction: {
    processed: number;
    extracted: number;
    duplicates: number;
    failed: number;
    creditsUsed: number;
  };
  asxMonitor: {
    ran: boolean;
    companiesChecked: number;
    announcementsScanned: number;
    projectSignals: number;
    newProjects: number;
    duplicates: number;
    errors: number;
    duration: number;
  };
  projectory: {
    ran: boolean;
    totalNewProjects: number;
    totalNewContacts: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
  };
  projectoryEnrichment: {
    ran: boolean;
    enriched: number;
    contractorsFound: number;
    failed: number;
    sessionExpired: boolean;
  };
  dmirs: {
    ran: boolean;
    totalNewProjects: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
  };
  aemo: {
    ran: boolean;
    totalNewProjects: number;
    totalDuplicates: number;
    totalSkipped: number;
    totalErrors: number;
    duration: number;
  };
  gov: {
    ran: boolean;
    totalNewProjects: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
  };
  austender: {
    ran: boolean;
    totalFetched: number;
    totalRelevant: number;
    totalNewProjects: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
  };
  icn: {
    ran: boolean;
    totalNewProjects: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
  };
  icnValidation: {
    ran: boolean;
    validated: number;
    contractorsFound: number;
    failed: number;
  };
  enrichment: {
    processed: number;
    enriched: number;
    notFound: number;
    failed: number;
    dailyUsed: number;
  };
  digest: {
    sent: number;
    failed: number;
    skipped: number;
  };
  staleCount: number;
  totalNewProjects: number;
  totalNewContacts: number;
  duration: number;
  completedAt: string;
}

export async function runWeeklyPipeline(): Promise<WeeklyPipelineResult> {
  const startTime = Date.now();
  const TOTAL_STEPS = 24;
  console.log("[WeeklyPipeline] ═══════════════════════════════════════════════");
  console.log("[WeeklyPipeline] Starting WEEKLY MEGA-SCRAPE v2 (Sunday 9pm AWST)");
  console.log("[WeeklyPipeline] ═══════════════════════════════════════════════");

  let totalNewProjects = 0;
  let totalNewContacts = 0;

  // ════════════════════════════════════════════════════════════
  // DISCOVERY SOURCES
  // ════════════════════════════════════════════════════════════

  // ── Step 1: RSS Harvest ──
  console.log(`[WeeklyPipeline] Step 1/${TOTAL_STEPS}: Harvesting ALL RSS feeds...`);
  let harvestResult;
  try {
    harvestResult = await harvestAllFeeds();
    console.log(
      `[WeeklyPipeline] ✓ Harvest: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources`
    );
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Harvest failed:", err instanceof Error ? err.message : String(err));
    harvestResult = { totalSources: 0, totalFetched: 0, totalNew: 0, totalDuplicates: 0, totalErrors: 1 };
  }

  // ── Step 2: AI Extraction ──
  console.log(`[WeeklyPipeline] Step 2/${TOTAL_STEPS}: Running AI extraction on queued articles...`);
  let extractionResult;
  try {
    extractionResult = await runExtractionPipeline();
    totalNewProjects += extractionResult.extracted;
    console.log(
      `[WeeklyPipeline] ✓ Extraction: ${extractionResult.extracted} projects from ${extractionResult.processed} articles`
    );
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Extraction failed:", err instanceof Error ? err.message : String(err));
    extractionResult = { processed: 0, extracted: 0, duplicates: 0, skipped: 0, failed: 0, creditsUsed: 0, results: [] };
  }

  // ── Step 3: ASX Targeted Monitoring ──
  console.log(`[WeeklyPipeline] Step 3/${TOTAL_STEPS}: Running ASX targeted monitoring...`);
  let asxResult = { ran: false, companiesChecked: 0, announcementsScanned: 0, projectSignals: 0, newProjects: 0, duplicates: 0, errors: 0, duration: 0 };
  try {
    const asxData = await scanTargetCompanies(14); // 2-week lookback for weekly
    asxResult = {
      ran: true,
      companiesChecked: asxData.totalCompaniesChecked,
      announcementsScanned: asxData.totalAnnouncementsScanned,
      projectSignals: asxData.totalProjectSignals,
      newProjects: asxData.totalNewProjects,
      duplicates: asxData.totalDuplicates,
      errors: asxData.totalErrors,
      duration: asxData.duration,
    };
    totalNewProjects += asxData.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ ASX: ${asxData.totalNewProjects} new projects from ${asxData.totalCompaniesChecked} companies`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ ASX monitoring failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 4: Projectory Scraper ──
  console.log(`[WeeklyPipeline] Step 4/${TOTAL_STEPS}: Scraping Projectory (all 6 categories)...`);
  let projectoryResult = { ran: false, totalNewProjects: 0, totalNewContacts: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  try {
    const scrapeResult = await runProjectoryScraper();
    projectoryResult = {
      ran: true,
      totalNewProjects: scrapeResult.totalNewProjects,
      totalNewContacts: scrapeResult.totalNewContacts,
      totalDuplicates: scrapeResult.totalDuplicates,
      totalErrors: scrapeResult.totalErrors,
      duration: scrapeResult.duration,
    };
    totalNewProjects += scrapeResult.totalNewProjects;
    totalNewContacts += scrapeResult.totalNewContacts;
    console.log(`[WeeklyPipeline] ✓ Projectory: ${scrapeResult.totalNewProjects} new projects, ${scrapeResult.totalNewContacts} contacts`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Projectory failed:", err instanceof Error ? err.message : String(err));
    projectoryResult.ran = true;
    projectoryResult.totalErrors = 1;
  }

  // ── Step 5: Projectory Enrichment ──
  console.log(`[WeeklyPipeline] Step 5/${TOTAL_STEPS}: Running Projectory enrichment on existing projects...`);
  let projectoryEnrichResult = { ran: false, enriched: 0, contractorsFound: 0, failed: 0, sessionExpired: false };
  try {
    const enrichResult = await enrichUnenrichedProjects(50); // Higher cap for weekly
    projectoryEnrichResult = {
      ran: true,
      enriched: enrichResult.totalEnriched,
      contractorsFound: enrichResult.totalContractorsDiscovered,
      failed: enrichResult.totalErrors,
      sessionExpired: false,
    };
    console.log(`[WeeklyPipeline] ✓ Projectory enrichment: ${enrichResult.totalEnriched} enriched, ${enrichResult.totalContractorsDiscovered} contractors found`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Projectory enrichment failed:", err instanceof Error ? err.message : String(err));
    projectoryEnrichResult.ran = true;
  }

  // ── Step 6: DMIRS MINEDEX ──
  console.log(`[WeeklyPipeline] Step 6/${TOTAL_STEPS}: Scraping DMIRS MINEDEX (WA mining)...`);
  let dmirsResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  try {
    const scrapeResult = await runDmirsScraper();
    dmirsResult = {
      ran: true,
      totalNewProjects: scrapeResult.totalNewProjects,
      totalDuplicates: scrapeResult.totalDuplicates,
      totalErrors: scrapeResult.totalErrors,
      duration: scrapeResult.duration,
    };
    totalNewProjects += scrapeResult.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ DMIRS: ${scrapeResult.totalNewProjects} new projects`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ DMIRS failed:", err instanceof Error ? err.message : String(err));
    dmirsResult.ran = true;
    dmirsResult.totalErrors = 1;
  }

  // ── Step 7: AEMO ──
  console.log(`[WeeklyPipeline] Step 7/${TOTAL_STEPS}: Scraping AEMO generation projects...`);
  let aemoResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalSkipped: 0, totalErrors: 0, duration: 0 };
  try {
    const scrapeResult = await runAemoScraper();
    aemoResult = {
      ran: true,
      totalNewProjects: scrapeResult.totalNewProjects,
      totalDuplicates: scrapeResult.totalDuplicates,
      totalSkipped: scrapeResult.totalSkipped,
      totalErrors: scrapeResult.totalErrors,
      duration: scrapeResult.duration,
    };
    totalNewProjects += scrapeResult.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ AEMO: ${scrapeResult.totalNewProjects} new projects`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ AEMO failed:", err instanceof Error ? err.message : String(err));
    aemoResult.ran = true;
    aemoResult.totalErrors = 1;
  }

  // ── Step 8: Government Major Projects ──
  console.log(`[WeeklyPipeline] Step 8/${TOTAL_STEPS}: Scraping government major projects...`);
  let govResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  try {
    const scrapeResult = await runGovScraper();
    govResult = {
      ran: true,
      totalNewProjects: scrapeResult.totalNewProjects,
      totalDuplicates: scrapeResult.totalDuplicates,
      totalErrors: scrapeResult.totalErrors,
      duration: scrapeResult.duration,
    };
    totalNewProjects += scrapeResult.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ Gov: ${scrapeResult.totalNewProjects} new projects`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Gov failed:", err instanceof Error ? err.message : String(err));
    govResult.ran = true;
    govResult.totalErrors = 1;
  }

  // ── Step 9: AusTender ──
  console.log(`[WeeklyPipeline] Step 9/${TOTAL_STEPS}: Scraping AusTender contracts...`);
  let austenderResult = { ran: false, totalFetched: 0, totalRelevant: 0, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  try {
    const scrapeResult = await runAusTenderScraper();
    austenderResult = {
      ran: true,
      totalFetched: scrapeResult.totalFetched,
      totalRelevant: scrapeResult.totalRelevant,
      totalNewProjects: scrapeResult.totalNewProjects,
      totalDuplicates: scrapeResult.totalDuplicates,
      totalErrors: scrapeResult.totalErrors,
      duration: scrapeResult.duration,
    };
    totalNewProjects += scrapeResult.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ AusTender: ${scrapeResult.totalNewProjects} new from ${scrapeResult.totalRelevant} relevant`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ AusTender failed:", err instanceof Error ? err.message : String(err));
    austenderResult.ran = true;
    austenderResult.totalErrors = 1;
  }

  // ── Step 10: ICN Gateway ──
  console.log(`[WeeklyPipeline] Step 10/${TOTAL_STEPS}: Scraping ICN Gateway projects...`);
  let icnResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  try {
    const scrapeResult = await runIcnScraper();
    icnResult = {
      ran: true,
      totalNewProjects: scrapeResult.totalNewProjects,
      totalDuplicates: scrapeResult.totalDuplicates,
      totalErrors: scrapeResult.totalErrors,
      duration: scrapeResult.duration,
    };
    totalNewProjects += scrapeResult.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ ICN: ${scrapeResult.totalNewProjects} new projects`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ ICN failed:", err instanceof Error ? err.message : String(err));
    icnResult.ran = true;
    icnResult.totalErrors = 1;
  }

  // ── Step 11: ICN Validation ──
  console.log(`[WeeklyPipeline] Step 11/${TOTAL_STEPS}: Running ICN validation on existing projects...`);
  let icnValidationResult = { ran: false, validated: 0, contractorsFound: 0, failed: 0 };
  try {
    const valResult = await icnValidateAllProjects();
    icnValidationResult = {
      ran: true,
      validated: valResult.totalMatched,
      contractorsFound: valResult.totalContractorsAdded,
      failed: valResult.totalChecked - valResult.totalMatched,
    };
    console.log(`[WeeklyPipeline] ✓ ICN validation: ${valResult.totalMatched} validated, ${valResult.totalContractorsAdded} contractors found`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ ICN validation failed:", err instanceof Error ? err.message : String(err));
    icnValidationResult.ran = true;
  }

  // ════════════════════════════════════════════════════════════
  // ENRICHMENT PIPELINE (all steps run before digest)
  // ════════════════════════════════════════════════════════════

  // ── Step 12: Contact Enrichment ──
  console.log(`[WeeklyPipeline] Step 12/${TOTAL_STEPS}: Enriching all new contacts...`);
  let enrichmentResult;
  try {
    enrichmentResult = await runEnrichmentPipeline();
    totalNewContacts += enrichmentResult.enriched;
    console.log(
      `[WeeklyPipeline] ✓ Enrichment: ${enrichmentResult.enriched} contacts enriched`
    );
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Enrichment failed:", err instanceof Error ? err.message : String(err));
    enrichmentResult = { processed: 0, enriched: 0, notFound: 0, failed: 0, dailyUsed: 0, results: [] };
  }

  // ── Step 13: Web Stakeholder Discovery ──
  console.log(`[WeeklyPipeline] Step 13/${TOTAL_STEPS}: Running open-web stakeholder discovery...`);
  let webDiscoveryContacts = 0;
  try {
    const webResult = await runBulkWebDiscovery(40); // Higher cap for weekly
    webDiscoveryContacts = webResult.contactsFound;
    console.log(`[WeeklyPipeline] ✓ Web discovery: ${webResult.contactsFound} contacts found across ${webResult.processed} projects`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Web stakeholder discovery failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 14: Apollo Selective Gap-Fill ──
  console.log(`[WeeklyPipeline] Step 14/${TOTAL_STEPS}: Running selective Apollo gap-fill...`);
  let apolloCreditsUsed = 0;
  let apolloNewContacts = 0;
  try {
    const eligibility = await findEligibleProjects(20); // Higher cap for weekly
    if (!eligibility.budgetStatus.withinBudget) {
      console.log(`[WeeklyPipeline] ⊘ Apollo gap-fill skipped: budget exhausted`);
    } else if (eligibility.eligible.length === 0) {
      console.log(`[WeeklyPipeline] ⊘ Apollo gap-fill skipped: no eligible projects`);
    } else {
      let totalVerified = 0;
      let totalNewApolloContacts = 0;
      let totalCredits = 0;
      let projectsProcessed = 0;

      for (const proj of eligibility.eligible) {
        try {
          const currentBudget = await getBudgetStatus();
          if (!currentBudget.withinBudget) {
            console.log(`[WeeklyPipeline] Apollo budget hit during gap-fill, stopping`);
            break;
          }

          const plan = await buildGapFillPlan(proj.projectId, proj.maxCredits);
          if (plan.actions.length === 0) continue;

          for (const action of plan.actions) {
            if (action.type === "verify_email" && action.contactId) {
              try {
                const result = await revealContactEmail(action.contactId, {
                  userId: 0,
                  userName: "weekly-pipeline-auto",
                });
                if (result) {
                  totalVerified++;
                  totalCredits++;
                }
              } catch (revealErr) {
                console.warn(`[WeeklyPipeline] Apollo reveal failed for contact ${action.contactId}:`, revealErr instanceof Error ? revealErr.message : String(revealErr));
              }
            } else if (action.type === "find_additional") {
              try {
                const searchResult = await enrichProjectContacts(
                  proj.projectId,
                  0,
                  { maxPerCompany: 3, enrichEmails: true }
                );
                totalNewApolloContacts += searchResult.totalFound;
                totalCredits += searchResult.enrichCreditsUsed;
              } catch (searchErr) {
                console.warn(`[WeeklyPipeline] Apollo search failed for project ${proj.projectId}:`, searchErr instanceof Error ? searchErr.message : String(searchErr));
              }
            }
          }
          projectsProcessed++;
        } catch (projErr) {
          console.warn(`[WeeklyPipeline] Apollo gap-fill failed for project ${proj.projectId}:`, projErr instanceof Error ? projErr.message : String(projErr));
        }
      }

      apolloCreditsUsed = totalCredits;
      apolloNewContacts = totalNewApolloContacts;
      console.log(`[WeeklyPipeline] ✓ Apollo gap-fill: ${projectsProcessed} projects, ${totalVerified} emails verified, ${totalNewApolloContacts} new contacts, ${totalCredits} credits used`);
    }
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Apollo gap-fill failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 15: Business Line Scoring ──
  console.log(`[WeeklyPipeline] Step 15/${TOTAL_STEPS}: Scoring projects across 9 business lines...`);
  let blScored = 0;
  try {
    const { getUnscoredProjectIds: getUnscored, scoreAndSaveProjects: bulkScore } = await import("./businessLineScoring");
    const unscoredIds = await getUnscored(200); // Higher cap for weekly
    if (unscoredIds.length > 0) {
      const blResult = await bulkScore(unscoredIds);
      blScored = blResult.scored;
      console.log(`[WeeklyPipeline] ✓ BL Scoring: ${blResult.scored} scored, ${blResult.failed} failed out of ${unscoredIds.length}`);
    } else {
      console.log("[WeeklyPipeline] ✓ No unscored projects found");
    }
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ BL Scoring failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 16: Tier Classification ──
  console.log(`[WeeklyPipeline] Step 16/${TOTAL_STEPS}: Running tier classification on all projects...`);
  let tierResult = { tier1Count: 0, tier2Count: 0, tier3Count: 0 };
  try {
    const result = await classifyAllProjects();
    tierResult = { tier1Count: result.tier1Count, tier2Count: result.tier2Count, tier3Count: result.tier3Count };
    console.log(`[WeeklyPipeline] ✓ Tier classification: ${result.tier1Count} actionable, ${result.tier2Count} warm, ${result.tier3Count} monitor`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Tier classification failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 17: Contractor & Delivery Pattern Engine ──
  console.log(`[WeeklyPipeline] Step 17/${TOTAL_STEPS}: Running contractor & delivery pattern engine...`);
  let contractorEngineResult = { companies: 0, pairings: 0, patterns: 0 };
  try {
    const ceResult = await runContractorEngine();
    contractorEngineResult = {
      companies: ceResult.registry.totalCompanies,
      pairings: ceResult.pairings.totalPairings,
      patterns: ceResult.patterns.totalPatterns,
    };
    console.log(`[WeeklyPipeline] ✓ Contractor engine: ${ceResult.registry.totalCompanies} companies, ${ceResult.pairings.totalPairings} pairings, ${ceResult.patterns.totalPatterns} patterns`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Contractor engine failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 18: Contractor Enrichment Pass ──
  console.log(`[WeeklyPipeline] Step 18/${TOTAL_STEPS}: Running contractor enrichment pass...`);
  let contractorEnrichResult = { enriched: 0, contractorsDiscovered: 0 };
  try {
    const ceResult = await runContractorEnrichmentPass(40); // Higher cap for weekly
    contractorEnrichResult = {
      enriched: ceResult.enriched,
      contractorsDiscovered: ceResult.contractorsDiscovered,
    };
    console.log(`[WeeklyPipeline] ✓ Contractor enrichment: ${ceResult.enriched} enriched, ${ceResult.contractorsDiscovered} contractors discovered`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Contractor enrichment pass failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 19: Role Relevance Classification ──
  console.log(`[WeeklyPipeline] Step 19/${TOTAL_STEPS}: Classifying contact role relevance...`);
  let roleResult = { highCount: 0, mediumCount: 0, lowCount: 0 };
  try {
    const result = await classifyAllContactRelevance();
    roleResult = { highCount: result.highCount, mediumCount: result.mediumCount, lowCount: result.lowCount };
    console.log(`[WeeklyPipeline] ✓ Role relevance: ${result.highCount} high, ${result.mediumCount} medium, ${result.lowCount} low`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Role relevance classification failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 20: Second-Pass Contact Search ──
  console.log(`[WeeklyPipeline] Step 20/${TOTAL_STEPS}: Running second-pass contact search...`);
  let secondPassResult = { contactsAdded: 0, projectsImproved: 0 };
  try {
    const spResult = await runBulkSecondPass(50); // Higher cap for weekly
    secondPassResult = {
      contactsAdded: spResult.totalContactsAdded,
      projectsImproved: spResult.projectsImproved,
    };
    console.log(`[WeeklyPipeline] ✓ Second-pass: ${spResult.totalContactsAdded} contacts added across ${spResult.projectsImproved} projects`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Second-pass contact search failed:", err instanceof Error ? err.message : String(err));
  }

  // ════════════════════════════════════════════════════════════
  // DIGEST & HOUSEKEEPING (after ALL enrichment is complete)
  // ════════════════════════════════════════════════════════════

  // ── Step 21: Weekly Report Generation ──
  console.log(`[WeeklyPipeline] Step 21/${TOTAL_STEPS}: Generating weekly report row...`);
  try {
    const db = await getDb();
    if (db) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);

      const [projectCount] = await db.select({ count: sql<number>`count(*)` }).from(projects).where(gte(projects.createdAt, weekStart));
      const [contactCount] = await db.select({ count: sql<number>`count(*)` }).from(contacts).where(gte(contacts.createdAt, weekStart));

      await db.insert(reports).values({
        weekEnding: new Date().toISOString().split("T")[0],
        generatedTime: new Date().toISOString(),
        totalProjects: Number(projectCount.count),
        totalContacts: Number(contactCount.count),
        hotProjects: tierResult.tier1Count,
        warmProjects: tierResult.tier2Count,
        coldProjects: tierResult.tier3Count,
        sourcesSearched: String(harvestResult.totalSources),
        newProjectsCount: totalNewProjects,
      });
      console.log(`[WeeklyPipeline] ✓ Weekly report row created`);
    }
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Report generation failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 22: Weekly Digest ──
  console.log(`[WeeklyPipeline] Step 22/${TOTAL_STEPS}: Sending weekly intelligence digest...`);
  let digestResult = { sent: 0, failed: 0, skipped: 0 };
  try {
    digestResult = await sendWeeklyDigests();
    console.log(`[WeeklyPipeline] ✓ Digest: ${digestResult.sent} sent, ${digestResult.failed} failed, ${digestResult.skipped} skipped`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Digest failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 23: Staleness Check ──
  console.log(`[WeeklyPipeline] Step 23/${TOTAL_STEPS}: Running project staleness check...`);
  let staleCount = 0;
  try {
    const staleResult = await markStaleProjects();
    staleCount = staleResult.staled + staleResult.archived;
    if (staleCount > 0) {
      console.log(`[WeeklyPipeline] ✓ Marked ${staleResult.staled} projects as stale, ${staleResult.archived} archived (Stage 5A)`);
    } else {
      console.log("[WeeklyPipeline] ✓ No new stale or archived projects found");
    }
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Staleness check failed:", err instanceof Error ? err.message : String(err));
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  const completedAt = new Date().toISOString();

  // ── Step 24: Notify Owner ──
  console.log(`[WeeklyPipeline] Step 24/${TOTAL_STEPS}: Sending owner notification...`);
  try {
    const totalProjectsDb = await getTotalProjectCount();
    const totalContactsDb = await getTotalContactCount();

    await notifyOwner({
      title: "Weekly Mega-Scrape Complete (v2)",
      content: [
        `**Weekly Pipeline Summary — ${new Date().toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}**`,
        "",
        `Duration: ${Math.floor(duration / 60)}m ${duration % 60}s`,
        "",
        "**Discovery:**",
        `- RSS Articles: ${harvestResult.totalNew} new`,
        `- AI Extracted: ${extractionResult.extracted} projects`,
        `- ASX Monitor: ${asxResult.newProjects} new projects`,
        `- Projectory: ${projectoryResult.totalNewProjects} projects`,
        `- Projectory Enrichment: ${projectoryEnrichResult.enriched} enriched`,
        `- DMIRS: ${dmirsResult.totalNewProjects} projects`,
        `- AEMO: ${aemoResult.totalNewProjects} projects`,
        `- Gov: ${govResult.totalNewProjects} projects`,
        `- AusTender: ${austenderResult.totalNewProjects} projects`,
        `- ICN: ${icnResult.totalNewProjects} projects`,
        `- ICN Validation: ${icnValidationResult.validated} validated`,
        "",
        "**Enrichment:**",
        `- Contacts Enriched: ${enrichmentResult.enriched}`,
        `- Web Discovery: ${webDiscoveryContacts} contacts`,
        `- Apollo: ${apolloNewContacts} new contacts (${apolloCreditsUsed} credits)`,
        `- BL Scoring: ${blScored} projects scored`,
        `- Tiers: ${tierResult.tier1Count} actionable / ${tierResult.tier2Count} warm / ${tierResult.tier3Count} monitor`,
        `- Contractor Engine: ${contractorEngineResult.companies} companies, ${contractorEngineResult.pairings} pairings`,
        `- Contractor Enrichment: ${contractorEnrichResult.enriched} enriched, ${contractorEnrichResult.contractorsDiscovered} discovered`,
        `- Role Relevance: ${roleResult.highCount} high / ${roleResult.mediumCount} medium / ${roleResult.lowCount} low`,
        `- Second-Pass: ${secondPassResult.contactsAdded} contacts added across ${secondPassResult.projectsImproved} projects`,
        "",
        `**Total New Projects: ${totalNewProjects}**`,
        `**Total New Contacts: ${totalNewContacts}**`,
        "",
        `**Database Totals:**`,
        `- Projects: ${totalProjectsDb}`,
        `- Contacts: ${totalContactsDb}`,
        "",
        `Digest: ${digestResult.sent} sent | Stale: ${staleCount} marked`,
      ].join("\n"),
    });
    console.log("[WeeklyPipeline] ✓ Owner notification sent");
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Owner notification failed:", err instanceof Error ? err.message : String(err));
  }

  const result: WeeklyPipelineResult = {
    harvest: {
      totalSources: harvestResult.totalSources,
      totalNew: harvestResult.totalNew,
      totalDuplicates: harvestResult.totalDuplicates,
      totalErrors: harvestResult.totalErrors,
    },
    extraction: {
      processed: extractionResult.processed,
      extracted: extractionResult.extracted,
      duplicates: extractionResult.duplicates,
      failed: extractionResult.failed,
      creditsUsed: extractionResult.creditsUsed,
    },
    asxMonitor: asxResult,
    projectory: projectoryResult,
    projectoryEnrichment: projectoryEnrichResult,
    dmirs: dmirsResult,
    aemo: aemoResult,
    gov: govResult,
    austender: austenderResult,
    icn: icnResult,
    icnValidation: icnValidationResult,
    enrichment: {
      processed: enrichmentResult.processed,
      enriched: enrichmentResult.enriched,
      notFound: enrichmentResult.notFound,
      failed: enrichmentResult.failed,
      dailyUsed: enrichmentResult.dailyUsed,
    },
    digest: digestResult,
    staleCount,
    totalNewProjects,
    totalNewContacts,
    duration,
    completedAt,
  };

  console.log("[WeeklyPipeline] ═══════════════════════════════════════════════");
  console.log(`[WeeklyPipeline] COMPLETE: ${totalNewProjects} new projects, ${totalNewContacts} new contacts in ${Math.floor(duration / 60)}m ${duration % 60}s`);
  console.log("[WeeklyPipeline] ═══════════════════════════════════════════════");

  return result;
}

// ── Helper: Get total project count ──
async function getTotalProjectCount(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(projects);
    return Number(row.count);
  } catch {
    return 0;
  }
}

// ── Helper: Get total contact count ──
async function getTotalContactCount(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(contacts);
    return Number(row.count);
  } catch {
    return 0;
  }
}

// ── In-process scheduler ──
// Runs every Sunday at 13:00 UTC (21:00 AWST / 9pm Perth Time)

let weeklySchedulerStarted = false;

export function startWeeklyScheduler(): void {
  if (weeklySchedulerStarted) return;
  weeklySchedulerStarted = true;

  function scheduleNextSunday(): void {
    const now = new Date();
    const next = new Date(now);

    // Find next Sunday
    const daysUntilSunday = (7 - now.getUTCDay()) % 7;
    next.setDate(now.getDate() + (daysUntilSunday === 0 ? 0 : daysUntilSunday));
    next.setUTCHours(13, 0, 0, 0); // 13:00 UTC = 21:00 AWST

    // If we've already passed Sunday 13:00 UTC this week, schedule for next Sunday
    if (next <= now) {
      next.setDate(next.getDate() + 7);
    }

    const delay = next.getTime() - now.getTime();
    const hoursUntil = Math.round(delay / 3600000 * 10) / 10;
    console.log(`[WeeklyPipeline] Next Sunday mega-scrape scheduled in ${hoursUntil}h at ${next.toISOString()} (9pm AWST)`);

    setTimeout(async () => {
      try {
        console.log("[WeeklyPipeline] Timer fired — starting weekly mega-scrape v2...");
        await runWeeklyPipeline();
      } catch (err: unknown) {
        console.error("[WeeklyPipeline] Scheduled run failed:", err instanceof Error ? err.message : String(err));
      }
      scheduleNextSunday();
    }, delay);
  }

  scheduleNextSunday();
}
