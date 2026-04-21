/*
 * ProjectCard — Expandable project card with priority-coded left border
 * Design: Nordic Industrial Precision — deep navy, gold accents, teal highlights
 * Now includes feedback buttons (thumbs up/down) and relevance score
 * Enhanced: Shows multiple contacts with verification scores, LinkedIn links, and verify buttons
 */
import { useState, useMemo } from "react";
import { ChevronDown, ExternalLink, MapPin, DollarSign, Building2, Sparkles, ThumbsUp, ThumbsDown, Target, Check, Mail, User, Search, Loader2, Users, ShieldCheck, Bot, CheckCircle2, AlertTriangle, Linkedin, Archive, RotateCcw, Clock, Award, KeyRound, FileText, Download, Pin, PinOff } from "lucide-react";
import OutreachEmailModal from "@/components/OutreachEmailModal";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// DB project shape from the API
export interface ProjectData {
  id: number;
  reportId: number;
  projectKey: string;
  name: string;
  location: string;
  value: string;
  owner: string;
  priority: "hot" | "warm" | "cold";
  capexGrade: "A" | "B" | "Unknown";
  opportunityRoute: "Direct CAPEX" | "Fleet CAPEX" | "OPEX/Monitor";
  sector: "mining" | "oil_gas" | "infrastructure" | "energy" | "defence";
  isNew: boolean;
  stage: string | null;
  overview: string | null;
  equipmentSignals: string[] | null;
  contractors: { name: string; status: string; confidence?: number; detail?: string }[] | null;
  opportunityNote: string | null;
  sources: { label: string; url: string; date?: string }[] | null;
  timeline: string | null;
  completion: string | null;
  matchedBusinessLines: number[] | null;
  actionTier?: "tier1_actionable" | "tier2_warm" | "tier3_monitor" | null;
  lifecycleStatus?: "active" | "stale" | "archived" | "awarded" | "completed" | null;
  lastActivityAt?: Date | null;
  createdAt: Date;
  keepFlag?: boolean | null;
  // Personalization fields (optional, added by filtering engine)
  relevanceScore?: number;
  relevanceReasons?: string[];
}

const priorityConfig = {
  hot: { border: "border-l-hot", bg: "bg-hot/5", badge: "bg-hot text-white", label: "HOT" },
  warm: { border: "border-l-warm", bg: "bg-warm/5", badge: "bg-warm text-navy", label: "WARM" },
  cold: { border: "border-l-cold", bg: "bg-cold/5", badge: "bg-cold text-white", label: "COLD" },
};

const capexBadge: Record<string, string> = {
  A: "bg-navy text-gold-light",
  B: "bg-navy-light text-slate-200",
  Unknown: "bg-slate-300 text-slate-700",
};

const routeBadge: Record<string, string> = {
  "Direct CAPEX": "bg-teal/15 text-teal border border-teal/30",
  "Fleet CAPEX": "bg-gold/15 text-gold-dark border border-gold/30",
  "OPEX/Monitor": "bg-slate-200 text-slate-600 border border-slate-300",
};

const feedbackReasons = [
  { key: "great_fit", label: "Great fit for us" },
  { key: "wrong_region", label: "Wrong region" },
  { key: "too_small", label: "Too small" },
  { key: "wrong_market", label: "Wrong market" },
  { key: "not_our_buyer", label: "Not our buyer type" },
  { key: "too_early", label: "Too early stage" },
];

interface FeedbackState {
  vote: "up" | "down" | null;
  reason?: string;
}

// Business line badge colors — covers all 9 scoring dimensions + legacy names
const businessLineBadgeConfig: Record<string, { bg: string; text: string; short: string }> = {
  "Portable Air": { bg: "bg-sky-100", text: "text-sky-700", short: "Air" },
  "PAL": { bg: "bg-amber-100", text: "text-amber-700", short: "PAL" },
  "Pump (Flow)": { bg: "bg-blue-100", text: "text-blue-700", short: "Pump" },
  "Pump/Dewatering": { bg: "bg-blue-100", text: "text-blue-700", short: "Pump" },
  "BESS": { bg: "bg-emerald-100", text: "text-emerald-700", short: "BESS" },
  "Generators": { bg: "bg-orange-100", text: "text-orange-700", short: "Gen" },
  "Nitrogen": { bg: "bg-purple-100", text: "text-purple-700", short: "N\u2082" },
  "Booster": { bg: "bg-red-100", text: "text-red-700", short: "HP" },
  "Service Potential": { bg: "bg-teal-100", text: "text-teal-700", short: "Svc" },
  "Rental Influence": { bg: "bg-indigo-100", text: "text-indigo-700", short: "Rent" },
};

const pipelineStatusLabels: Record<string, string> = {
  identified: "In Pipeline",
  contacted: "Contacted",
  meeting_booked: "Meeting Booked",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

const pipelineStatusColors: Record<string, string> = {
  identified: "bg-slate-500",
  contacted: "bg-blue-500",
  meeting_booked: "bg-amber-500",
  quoted: "bg-purple-500",
  won: "bg-emerald-500",
  lost: "bg-red-500",
};

function ClaimButton({ projectId, reportId }: { projectId: number; reportId: number }) {
  const utils = trpc.useUtils();
  const claimMutation = trpc.pipeline.claim.useMutation({
    onSuccess: (data) => {
      if (data.alreadyClaimed) {
        toast.info("You've already claimed this project");
      } else {
        toast.success("Project added to your pipeline!");
      }
      utils.pipeline.mine.invalidate();
      utils.pipeline.team.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        claimMutation.mutate({ projectId, reportId });
      }}
      disabled={claimMutation.isPending}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-navy bg-gold/20 hover:bg-gold/40 border border-gold/30 transition-colors disabled:opacity-50"
      title="Add to my pipeline"
    >
      <Target className="w-3 h-3" />
      {claimMutation.isPending ? "..." : "Claim"}
    </button>
  );
}

// Contact shape from the API — includes all verification fields
export interface ContactData {
  id: number;
  name: string;
  title: string;
  company: string;
  project: string;
  priority: "hot" | "warm" | "cold";
  roleBucket: string;
  email: string | null;
  linkedin: string | null;
  // Verification & enrichment fields
  enrichmentSource?: string | null;
  verificationStatus?: string | null;
  confidenceScore?: string | null;
  linkedinSearchUrl?: string | null;
  emailVerified?: boolean | null;
  linkedinProfilePic?: string | null;
  verificationScore?: number | null;
  linkedinProfileUrl?: string | null;
  verifiedByUserId?: string | null;
  verifiedAt?: Date | null;
  roleRelevance?: "high" | "medium" | "low" | null;
}

/** Stopwords to ignore during keyword matching */
const STOP_WORDS = new Set(["the", "a", "an", "of", "in", "for", "and", "or", "to", "at", "by", "on", "is", "—", "-", "/"]);

/** Extract meaningful keywords from a string */
function extractKeywords(text: string): string[] {
  return text.toLowerCase().split(/[\s/—\-–,()]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/** Check if two strings share significant keyword overlap */
function hasKeywordOverlap(a: string, b: string): boolean {
  const kwA = extractKeywords(a);
  const kwB = extractKeywords(b);
  if (kwA.length === 0 || kwB.length === 0) return false;
  const shared = kwA.filter(w => kwB.some(bw => bw.includes(w) || w.includes(bw)));
  // At least 2 shared keywords, or 1 if the contact project name is very short
  return shared.length >= 2 || (shared.length >= 1 && kwA.length <= 2);
}

/**
 * Find ALL matching contacts for a project, ranked by relevance.
 * Returns up to `limit` contacts sorted by score.
 * Matching strategy:
 *   1. Direct substring match (contact.project ⊂ project.name or vice versa)
 *   2. Keyword overlap (e.g., "Rio Tinto Maintenance" ↔ "Monadelphous Rio Tinto Pilbara Maintenance Services")
 *   3. Company/owner match (contact.company ≈ project.owner)
 * Scoring: buyerRoles preference > verification score > has email > priority (hot > warm > cold)
 */
function findProjectContacts(
  projectName: string,
  projectOwner: string,
  allContacts: ContactData[],
  buyerRoles?: string[] | null,
  limit: number = 5,
): ContactData[] {
  const projectNameLower = projectName.toLowerCase();
  const ownerLower = projectOwner.toLowerCase();
  // Split owner on / or & for multi-owner projects (e.g., "Santos / BW Offshore")
  const ownerParts = ownerLower.split(/[/&,]+/).map(s => s.trim()).filter(Boolean);

  const projectContacts = allContacts.filter(c => {
    const cProject = c.project.toLowerCase();
    const cCompany = c.company.toLowerCase();
    // Direct substring match
    if (cProject.includes(projectNameLower) || projectNameLower.includes(cProject)) return true;
    // Keyword overlap between contact project and project name
    if (hasKeywordOverlap(cProject, projectNameLower)) return true;
    // Company matches project owner (or any part of multi-owner)
    if (ownerParts.some(op => cCompany.includes(op) || op.includes(cCompany))) return true;
    // Contact company appears in project name
    if (projectNameLower.includes(cCompany) && cCompany.length > 3) return true;
    return false;
  });

  if (projectContacts.length === 0) return [];

  // Deduplicate by name+company (case-insensitive)
  const seen = new Map<string, ContactData>();
  for (const c of projectContacts) {
    const key = `${c.name.toLowerCase()}|${c.company.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || (c.verificationScore ?? 0) > (existing.verificationScore ?? 0)) {
      seen.set(key, c);
    }
  }
  const deduped = Array.from(seen.values());

  // Score each contact
  const priorityScore = { hot: 3, warm: 2, cold: 1 };
  const scored = deduped.map(c => {
    let score = priorityScore[c.priority] || 0;
    // Boost if matches user's preferred buyer roles
    if (buyerRoles && buyerRoles.length > 0) {
      const roleLower = c.roleBucket.toLowerCase();
      if (buyerRoles.some(r => roleLower.includes(r.toLowerCase()))) score += 10;
    }
    // Boost by verification score (0-100 → 0-5 points)
    score += ((c.verificationScore ?? 0) / 20);
    // Boost if has email (actionable)
    if (c.email) score += 5;
    // Boost if contact project name directly matches
    const cProject = c.project.toLowerCase();
    if (projectNameLower.includes(cProject) || cProject.includes(projectNameLower)) score += 3;
    // Boost verified contacts
    if (c.verificationStatus === "verified") score += 8;
    // Boost by role relevance (high = +12, medium = +6, low = -5)
    if (c.roleRelevance === "high") score += 12;
    else if (c.roleRelevance === "medium") score += 6;
    else if (c.roleRelevance === "low") score -= 5;
    return { contact: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.contact);
}

// ── Lifecycle Actions ──
const lifecycleOptions = [
  { value: "active", label: "Active", icon: CheckCircle2, color: "text-teal", bg: "bg-teal/10 hover:bg-teal/20 border-teal/30" },
  { value: "stale", label: "Stale", icon: Clock, color: "text-amber-600", bg: "bg-amber-50 hover:bg-amber-100 border-amber-300" },
  { value: "archived", label: "Archive", icon: Archive, color: "text-slate-500", bg: "bg-slate-100 hover:bg-slate-200 border-slate-300" },
  { value: "awarded", label: "Awarded", icon: Award, color: "text-teal", bg: "bg-teal/10 hover:bg-teal/20 border-teal/30" },
  { value: "completed", label: "Completed", icon: Check, color: "text-navy", bg: "bg-navy/10 hover:bg-navy/20 border-navy/20" },
] as const;

function LifecycleActions({ project }: { project: ProjectData }) {
  const utils = trpc.useUtils();
  const currentStatus = project.lifecycleStatus ?? "active";

  const updateLifecycle = trpc.projectLifecycle.update.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`Project moved to "${vars.status}"`);
      utils.report.full.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="mt-4 pt-3 border-t border-border">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
        <Archive className="w-3.5 h-3.5" /> Project Status
      </h4>
      <div className="flex items-center gap-1.5 flex-wrap">
        {lifecycleOptions.map(opt => {
          const Icon = opt.icon;
          const isActive = currentStatus === opt.value;
          return (
            <button
              key={opt.value}
              disabled={updateLifecycle.isPending}
              onClick={(e) => {
                e.stopPropagation();
                if (!isActive) {
                  updateLifecycle.mutate({ projectId: project.id, status: opt.value });
                }
              }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-all ${
                isActive
                  ? `${opt.bg} ${opt.color} border-current shadow-sm`
                  : "bg-card text-muted-foreground border-border hover:border-navy/30"
              }`}
            >
              <Icon className="w-3 h-3" />
              {opt.label}
            </button>
          );
        })}
      </div>
      {currentStatus === "stale" && (
        <p className="text-[10px] text-amber-600 mt-1.5 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          No updates or pipeline activity in 30+ days. Archive or re-activate.
        </p>
      )}
    </div>
  );
}

/** Infer a role bucket from a job title string */
function inferRoleBucketFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("procurement") || t.includes("purchasing") || t.includes("supply chain")) return "procurement";
  if (t.includes("engineer") || t.includes("technical") || t.includes("design")) return "engineering";
  if (t.includes("operations") || t.includes("site manager") || t.includes("mine manager")) return "operations";
  if (t.includes("project manager") || t.includes("project director") || t.includes("construction manager")) return "project_management";
  if (t.includes("maintenance") || t.includes("reliability")) return "maintenance";
  if (t.includes("fleet") || t.includes("equipment manager")) return "fleet";
  if (t.includes("general manager") || t.includes("managing director") || t.includes("ceo") || t.includes("coo") || t.includes("director")) return "executive";
  if (t.includes("construction") || t.includes("civil") || t.includes("building")) return "construction";
  return "other";
}

function EnrichProjectButton({ projectId, projectName, onOutreach, project }: { projectId: number; projectName: string; onOutreach?: (contact: { name: string; title: string; company: string; email: string; roleBucket: string }) => void; project?: ProjectData }) {
  const utils = trpc.useUtils();

  // Check enrichment cache status
  const cacheQuery = trpc.dataPipeline.enrichmentCacheStatus.useQuery(
    { projectId },
    { staleTime: 60_000 } // Cache for 1 minute client-side
  );

  const apolloExplicitMut = trpc.dataPipeline.apolloEnrichExplicit.useMutation({
    onSuccess: (data) => {
      toast.success(`Apollo found ${data.totalFound} contact${data.totalFound !== 1 ? "s" : ""} (${data.enrichCreditsUsed} credit${data.enrichCreditsUsed !== 1 ? "s" : ""} used)`, {
        description: `Contacts with verified emails added to project. Search used ${data.searchCreditsUsed} search + ${data.enrichCreditsUsed} reveal credits.`,
        duration: 8000,
      });
      utils.report.invalidate();
      utils.pipeline.invalidate();
      cacheQuery.refetch();
    },
    onError: (err: { message: string }) => {
      toast.error(`Apollo enrichment failed: ${err.message}`);
    },
  });

  const enrichMutation = trpc.dataPipeline.enrichProject.useMutation({
    onSuccess: (data) => {
      if ((data as any).quotaExhausted) {
        toast.warning("API quota temporarily exhausted", {
          description: "The daily search quota has been reached. Please try again tomorrow when the quota resets. Any existing contacts are still shown below.",
          duration: 10000,
        });
      } else if (data.fromCache) {
        toast.info(`${data.contactsFound} contact${data.contactsFound !== 1 ? "s" : ""} already on file (saved ${data.apiCallsSaved} API calls).`, {
          description: "Contacts were found from a recent search. Use 'Refresh' to search again.",
          duration: 5000,
        });
      } else if (data.contactsFound === 0) {
        toast.info(`No new contacts found for ${data.projectName || projectName}.`, {
          description: "No matching contacts were found for this project's companies and roles. Try again later or adjust your preferred buyer roles in Settings.",
          duration: 6000,
        });
      } else {
        toast.success(`Found ${data.contactsFound} new contact${data.contactsFound > 1 ? "s" : ""} for ${data.projectName || projectName}!`, {
          description: data.contacts.map((c: { name: string; headline?: string }) => `${c.name} — ${c.headline || ""}`).join(", "),
          duration: 8000,
        });
      }
      // Refresh report, pipeline, and cache data
      utils.report.invalidate();
      utils.pipeline.invalidate();
      cacheQuery.refetch();
    },
    onError: (err: { message: string }) => {
      toast.error(`Enrichment failed: ${err.message}`);
    },
  });

  const isCached = cacheQuery.data?.cached === true;
  const cachedAt = cacheQuery.data?.enrichedAt;
  const cachedContacts = cacheQuery.data?.contactsFound ?? 0;

  // Format relative time for cache display
  const formatCacheAge = (date: Date | undefined) => {
    if (!date) return "";
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    return "just now";
  };

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Find Contacts
          </h4>
          {isCached ? (
            <p className="text-[11px] text-muted-foreground mt-1">
              <span className="text-teal font-medium">{cachedContacts} contact{cachedContacts !== 1 ? "s" : ""}</span> found {formatCacheAge(cachedAt)}.
              Click <strong>Refresh</strong> to search again (uses API credits).
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground mt-1">
              Search Apollo for decision makers at this project's companies. Takes 10–30 seconds.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isCached && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toast.info(`Re-searching Apollo for contacts on ${projectName}...`, {
                  description: "Forcing a fresh search. This uses Apollo credits and may take 10–30 seconds.",
                  duration: 5000,
                });
                enrichMutation.mutate({ projectId, forceRefresh: true });
              }}
              disabled={enrichMutation.isPending}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 transition-colors disabled:opacity-50 disabled:cursor-wait"
              title="Force a fresh Apollo search (uses API credits)"
            >
              Refresh
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!isCached) {
                toast.info(`Searching Apollo for contacts on ${projectName}...`, {
                  description: "Searching Apollo's 275M+ contact database. This may take 10–30 seconds.",
                  duration: 5000,
                });
              }
              enrichMutation.mutate({ projectId });
            }}
            disabled={enrichMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-teal/10 text-teal hover:bg-teal/20 border border-teal/20 transition-colors disabled:opacity-50 disabled:cursor-wait"
          >
            {enrichMutation.isPending ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching...</>
            ) : isCached ? (
              <><Check className="w-3.5 h-3.5" /> {cachedContacts} Contact{cachedContacts !== 1 ? "s" : ""} Found</>
            ) : (
              <><Search className="w-3.5 h-3.5" /> Find Contacts</>
            )}
          </button>
        </div>
      </div>
      {/* Apollo Deep Enrichment — explicit request */}
      {isCached && cachedContacts > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toast.info(`Running Apollo deep enrichment on ${projectName}...`, {
                description: "Searching Apollo's 275M+ database for verified emails and additional stakeholders. Uses Apollo credits.",
                duration: 5000,
              });
              apolloExplicitMut.mutate({ projectId, enrichEmails: true, maxPerCompany: 5 });
            }}
            disabled={apolloExplicitMut.isPending}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition-colors disabled:opacity-50 disabled:cursor-wait"
            title="Use Apollo credits to find verified emails and additional stakeholders"
          >
            {apolloExplicitMut.isPending ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Apollo Enriching...</>
            ) : (
              <><KeyRound className="w-3 h-3" /> Enrich with Apollo</>
            )}
          </button>
          <span className="text-[10px] text-muted-foreground">Uses credits</span>
        </div>
      )}
      {enrichMutation.isPending && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground bg-teal/5 rounded-md px-3 py-2 border border-teal/10">
          <Loader2 className="w-3 h-3 animate-spin text-teal" />
          Searching for contacts matching your preferred buyer roles...
        </div>
      )}
      {enrichMutation.isSuccess && enrichMutation.data.contactsFound > 0 && !enrichMutation.data.fromCache && (
        <div className="mt-2 space-y-1">
          {(enrichMutation.data as any).source && (
            <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider font-semibold">
              Source: {(enrichMutation.data as any).source === "apollo" ? "Apollo.io" : (enrichMutation.data as any).source === "linkedin" ? "LinkedIn" : (enrichMutation.data as any).source === "llm" ? "AI Generated" : "Database"}
            </div>
          )}
          {enrichMutation.data.contacts.map((c: { name: string; status: string; headline?: string; linkedinUrl?: string; email?: string; enrichmentSource?: string }, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs bg-teal/5 rounded-md px-3 py-1.5 border border-teal/10">
              <User className="w-3 h-3 text-teal shrink-0" />
              <span className="font-medium text-navy">{c.name}</span>
              {c.headline && <span className="text-muted-foreground truncate">— {c.headline}</span>}
              <div className="ml-auto flex items-center gap-2 shrink-0">
                {c.email && onOutreach && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOutreach({
                        name: c.name,
                        title: c.headline || "Unknown",
                        company: project?.owner || "Unknown",
                        email: c.email!,
                        roleBucket: inferRoleBucketFromTitle(c.headline || ""),
                      });
                    }}
                    className="text-[10px] font-semibold bg-gold/15 text-gold-dark px-1.5 py-0.5 rounded hover:bg-gold/25 transition-colors"
                  >
                    <Mail className="w-3 h-3 inline mr-0.5" />
                    Outreach
                  </button>
                )}
                {c.email && !onOutreach && (
                  <a href={`mailto:${c.email}`} className="text-[10px] font-semibold bg-teal/15 text-teal px-1.5 py-0.5 rounded hover:bg-teal/25 transition-colors" onClick={e => e.stopPropagation()}>
                    Email
                  </a>
                )}
                {!c.email && (
                  <span className="text-[10px] text-muted-foreground italic">No email</span>
                )}
                {c.linkedinUrl && (
                  <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-teal hover:text-teal-light" onClick={e => e.stopPropagation()}>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Verification score badge with color coding and tooltip */
function VerificationScoreBadge({ contact }: { contact: ContactData }) {
  const score = contact.verificationScore ?? 0;
  const color = score >= 80 ? "text-emerald-600 border-emerald-400 bg-emerald-50" :
                score >= 60 ? "text-blue-600 border-blue-400 bg-blue-50" :
                score >= 40 ? "text-amber-600 border-amber-400 bg-amber-50" :
                "text-red-500 border-red-300 bg-red-50";
  const label = score >= 80 ? "High Confidence" :
                score >= 60 ? "Good Confidence" :
                score >= 40 ? "Moderate" : "Low Confidence";

  return (
    <div className="relative group">
      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full border-2 text-[11px] font-bold ${color}`}>
        {score}
      </span>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 bg-slate-800 text-white text-[9px] px-2 py-1.5 rounded shadow-lg whitespace-nowrap min-w-[140px]">
        <div className="font-bold mb-0.5">{label} ({score}/100)</div>
        <div>Source: {contact.verificationStatus === 'verified' ? '30' : contact.enrichmentSource === 'llm' ? '10' : '5'}/30</div>
        <div>Name: 15/15</div>
        <div>Email: {contact.email ? (contact.emailVerified ? '15' : contact.verificationStatus === 'verified' ? '12' : '8') : '0'}/15</div>
        <div>Title: {contact.title.split(' ').length >= 3 ? '15' : '12'}/15</div>
        <div>LinkedIn: {contact.linkedin || contact.linkedinProfileUrl ? '15' : contact.linkedinSearchUrl ? '5' : '0'}/15</div>
        <div>Company: {score >= 80 ? '10' : '5'}/10</div>
      </div>
    </div>
  );
}

/** Verification status badge */
function VerificationStatusBadge({ contact }: { contact: ContactData }) {
  if (contact.verificationStatus === "verified") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700" title="Verified via LinkedIn API">
        <ShieldCheck className="w-3 h-3" /> Verified
      </span>
    );
  }
  if (contact.verificationStatus === "ai_suggested" || contact.enrichmentSource === "llm") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700" title="AI-generated — verify before outreach">
        <Bot className="w-3 h-3" /> AI Suggested
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-500">
      Unverified
    </span>
  );
}

/** Single contact card within the project detail view */
function ProjectContactCard({
  contact,
  isPrimary,
  buyerRoles,
  onOutreach,
}: {
  contact: ContactData;
  isPrimary: boolean;
  buyerRoles?: string[] | null;
  onOutreach: (contact: ContactData) => void;
}) {
  const utils = trpc.useUtils();
  const [verifying, setVerifying] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showLinkedinInput, setShowLinkedinInput] = useState(false);
  const [linkedinUrlInput, setLinkedinUrlInput] = useState("");

  // LinkedIn API verification (existing)
  const verifyMutation = trpc.dataPipeline.verifyContact.useMutation({
    onSuccess: (result: { verified?: boolean; quotaExhausted?: boolean; message?: string }) => {
      setVerifying(false);
      if (result.verified) {
        toast.success(`Contact verified! ${result.message}`);
      } else if (result.quotaExhausted) {
        toast.warning("LinkedIn API quota exhausted — try again tomorrow");
      } else {
        toast.info(result.message || "Verification complete");
      }
      utils.report.invalidate();
    },
    onError: (err) => {
      setVerifying(false);
      toast.error(`Verification failed: ${err.message}`);
    },
  });

  // Crowdsourced verification (new — zero cost)
  const crowdVerifyMutation = trpc.contactVerification.verify.useMutation({
    onSuccess: () => {
      toast.success("Contact confirmed! Thank you for improving data quality.");
      setShowLinkedinInput(false);
      setLinkedinUrlInput("");
      utils.report.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const crowdRejectMutation = trpc.contactVerification.reject.useMutation({
    onSuccess: () => {
      toast.success("Contact flagged. It will be deprioritized in results.");
      setShowRejectInput(false);
      setRejectReason("");
      utils.report.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleVerify = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVerifying(true);
    verifyMutation.mutate({ contactId: contact.id });
  };

  const handleCrowdVerify = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showLinkedinInput) {
      // Submit with optional LinkedIn URL
      crowdVerifyMutation.mutate({
        contactId: contact.id,
        linkedinUrl: linkedinUrlInput.trim() || undefined,
      });
    } else {
      setShowLinkedinInput(true);
    }
  };

  const handleCrowdReject = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showRejectInput) {
      crowdRejectMutation.mutate({
        contactId: contact.id,
        reason: rejectReason.trim() || undefined,
      });
    } else {
      setShowRejectInput(true);
    }
  };

  // Check if this contact's role matches preferred buyer roles
  const isPreferredRole = buyerRoles && buyerRoles.length > 0 &&
    buyerRoles.some(r => contact.roleBucket.toLowerCase().includes(r.toLowerCase()));

  const linkedinUrl = contact.linkedin || contact.linkedinProfileUrl;
  const isAiSuggested = contact.verificationStatus === "ai_suggested" || contact.enrichmentSource === "llm";
  const isVerified = contact.verificationStatus === "verified";

  return (
    <div className={`rounded-lg p-3 border transition-all ${
      isPrimary
        ? "bg-navy/5 border-navy/15 ring-1 ring-navy/10"
        : "bg-slate-50 border-slate-200"
    }`}>
      <div className="flex items-start gap-3">
        {/* Verification Score Circle */}
        <div className="shrink-0 mt-0.5">
          <VerificationScoreBadge contact={contact} />
        </div>

        {/* Contact Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-navy">{contact.name}</span>
            {isPrimary && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-gold/20 text-gold-dark uppercase">
                Top Match
              </span>
            )}
            <VerificationStatusBadge contact={contact} />
            {isPreferredRole && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-teal/15 text-teal uppercase" title="Matches your preferred buyer roles">
                Preferred Role
              </span>
            )}
            {contact.roleRelevance === "high" && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 uppercase" title="High relevance: directly influences equipment decisions">
                Key Decision Maker
              </span>
            )}
            {contact.roleRelevance === "low" && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-500 uppercase" title="Low relevance: corporate executive, unlikely to influence equipment decisions">
                Corporate
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {contact.title} — {contact.company}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Role: {contact.roleBucket}
          </p>

          {/* Action buttons row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {/* LinkedIn Profile Link */}
            {linkedinUrl ? (
              <a
                href={linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-[#0077B5]/10 text-[#0077B5] hover:bg-[#0077B5]/20 transition-colors"
                title="View LinkedIn profile"
              >
                <Linkedin className="w-3 h-3" /> Profile
              </a>
            ) : contact.linkedinSearchUrl ? (
              <a
                href={contact.linkedinSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                title="Search LinkedIn for this contact"
              >
                <Search className="w-3 h-3" /> Search LI
              </a>
            ) : null}

            {/* Email / Outreach button */}
            {contact.email && (
              <div className="relative group">
                <button
                  onClick={(e) => { e.stopPropagation(); onOutreach(contact); }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
                    contact.emailVerified || isVerified
                      ? "bg-gold/15 text-gold-dark hover:bg-gold/25"
                      : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                  }`}
                >
                  <Mail className="w-3 h-3" />
                  {contact.emailVerified || isVerified ? "Outreach" : "Outreach*"}
                </button>
                {!contact.emailVerified && !isVerified && (
                  <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10 bg-slate-800 text-white text-[9px] px-2 py-1 rounded shadow-lg whitespace-nowrap">
                    <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-400" />
                    Email is pattern-guessed — verify before sending
                  </div>
                )}
              </div>
            )}

            {/* Verify via LinkedIn API button (only for AI-suggested, not yet verified) */}
            {isAiSuggested && !isVerified && (
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors disabled:opacity-50"
                title="Use LinkedIn API to verify this contact (uses daily credits)"
              >
                {verifying ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Verifying...</>
                ) : (
                  <><CheckCircle2 className="w-3 h-3" /> API Verify</>
                )}
              </button>
            )}

            {/* Crowdsourced: "I know this person" confirm button (zero cost) */}
            {!isVerified && !contact.verifiedByUserId && (
              <button
                onClick={handleCrowdVerify}
                disabled={crowdVerifyMutation.isPending}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-teal/10 text-teal hover:bg-teal/20 border border-teal/20 transition-colors disabled:opacity-50"
                title="Confirm you know this person is correct (no API cost)"
              >
                {crowdVerifyMutation.isPending ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Confirming...</>
                ) : showLinkedinInput ? (
                  <><ThumbsUp className="w-3 h-3" /> Submit</>
                ) : (
                  <><ThumbsUp className="w-3 h-3" /> I Know Them</>
                )}
              </button>
            )}

            {/* Crowdsourced: "Wrong person" reject button */}
            {!isVerified && !contact.verifiedByUserId && (
              <button
                onClick={handleCrowdReject}
                disabled={crowdRejectMutation.isPending}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-red-50 text-red-500 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-50"
                title="Flag this contact as incorrect or outdated"
              >
                {crowdRejectMutation.isPending ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Flagging...</>
                ) : showRejectInput ? (
                  <><ThumbsDown className="w-3 h-3" /> Submit</>
                ) : (
                  <><ThumbsDown className="w-3 h-3" /> Wrong Person</>
                )}
              </button>
            )}

            {/* Show "Verified by team" badge if already crowd-verified */}
            {contact.verifiedByUserId && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                <ShieldCheck className="w-3 h-3" /> Team Verified
              </span>
            )}
          </div>

          {/* Inline LinkedIn URL input for crowd verification */}
          {showLinkedinInput && (
            <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <input
                type="url"
                placeholder="Paste their LinkedIn URL (optional)"
                value={linkedinUrlInput}
                onChange={e => setLinkedinUrlInput(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded border border-teal/30 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-teal/50"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  crowdVerifyMutation.mutate({
                    contactId: contact.id,
                    linkedinUrl: linkedinUrlInput.trim() || undefined,
                  });
                }}
                disabled={crowdVerifyMutation.isPending}
                className="px-2.5 py-1.5 rounded text-[10px] font-bold bg-teal text-white hover:bg-teal/90 transition-colors disabled:opacity-50"
              >
                Confirm
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowLinkedinInput(false); setLinkedinUrlInput(""); }}
                className="px-2 py-1.5 rounded text-[10px] text-muted-foreground hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Inline reject reason input */}
          {showRejectInput && (
            <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <input
                type="text"
                placeholder="Why is this wrong? (optional)"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded border border-red-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-red-300"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  crowdRejectMutation.mutate({
                    contactId: contact.id,
                    reason: rejectReason.trim() || undefined,
                  });
                }}
                disabled={crowdRejectMutation.isPending}
                className="px-2.5 py-1.5 rounded text-[10px] font-bold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                Flag
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowRejectInput(false); setRejectReason(""); }}
                className="px-2 py-1.5 rounded text-[10px] text-muted-foreground hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProjectCard({
  project,
  existingFeedback,
  pipelineClaim,
  businessLineNames,
  allContacts,
  buyerRoles,
}: {
  project: ProjectData;
  existingFeedback?: { vote: "up" | "down"; reason: string | null } | null;
  pipelineClaim?: { id: number; status: string } | null;
  businessLineNames?: Record<number, string>;
  allContacts?: ContactData[];
  buyerRoles?: string[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const [showOutreach, setShowOutreach] = useState(false);
  const [outreachContact, setOutreachContact] = useState<ContactData | null>(null);
  const [showAllContacts, setShowAllContacts] = useState(false);

  // Find all matching contacts for this project (up to 10)
  const projectContacts = useMemo(() => {
    if (!allContacts || allContacts.length === 0) return [];
    return findProjectContacts(project.name, project.owner, allContacts, buyerRoles, 10);
  }, [project.name, project.owner, allContacts, buyerRoles]);

  const primaryContact = projectContacts.length > 0 ? projectContacts[0] : null;
  // Show first 3 by default, expand to show all
  const visibleContacts = showAllContacts ? projectContacts : projectContacts.slice(0, 3);
  const hasMoreContacts = projectContacts.length > 3;

  const [feedback, setFeedback] = useState<FeedbackState>({
    vote: existingFeedback?.vote ?? null,
    reason: existingFeedback?.reason ?? undefined,
  });

  // keepFlag (Pin/Protect) state — optimistic
  const [pinned, setPinned] = useState<boolean>(!!project.keepFlag);
  const utils = trpc.useUtils();
  const setKeepFlagMut = trpc.projectLifecycle.setKeepFlag.useMutation({
    onMutate: ({ keep }) => setPinned(keep),
    onError: () => setPinned(!!project.keepFlag),
    onSuccess: () => {
      utils.report.full.invalidate();
      toast.success(pinned ? "Project unpinned" : "Project pinned — won't be auto-archived");
    },
  });

  // Fetch BL scores when card is expanded
  const blScoresQuery = trpc.dataPipeline.projectScores.useQuery(
    { projectId: project.id },
    { enabled: open }
  );

  // Fetch matched collateral for this project when expanded
  const collateralQuery = trpc.collateral.suggestionsForProject.useQuery(
    { projectId: project.id, limit: 5 },
    { enabled: open }
  );

  const cfg = priorityConfig[project.priority];
  const equipmentSignals = project.equipmentSignals ?? [];
  const contractors = project.contractors ?? [];
  const sources = project.sources ?? [];

  const submitFeedback = trpc.feedback.submit.useMutation({
    onSuccess: () => {
      toast.success("Feedback recorded — this improves your future results");
      setShowReasons(false);
    },
  });

  const handleVote = (vote: "up" | "down") => {
    if (feedback.vote === vote) {
      // Toggle off
      setFeedback({ vote: null });
      return;
    }
    setFeedback({ vote, reason: undefined });
    if (vote === "down") {
      setShowReasons(true);
    } else {
      // Thumbs up — submit immediately
      submitFeedback.mutate({
        projectId: project.id,
        reportId: project.reportId,
        vote: "up",
        reason: "great_fit",
      });
    }
  };

  const handleReason = (reason: string) => {
    setFeedback(prev => ({ ...prev, reason }));
    submitFeedback.mutate({
      projectId: project.id,
      reportId: project.reportId,
      vote: "down",
      reason,
    });
  };

  const handleOutreach = (contact: ContactData) => {
    setOutreachContact(contact);
    setShowOutreach(true);
  };

  const activeOutreachContact = outreachContact || primaryContact;

  return (
    <div
      id={`project-${project.id}`}
      data-project-id={project.id}
      className={`bg-card rounded-lg border-l-4 ${cfg.border} shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden ${project.isNew ? "ring-1 ring-teal/40" : ""}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
        className="w-full text-left p-4 sm:p-5 flex items-start justify-between gap-3 cursor-pointer"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <h3 className="text-sm sm:text-base font-semibold text-navy leading-tight">{project.name}</h3>
            {project.isNew && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal text-white uppercase tracking-wider">
                <Sparkles className="w-3 h-3" /> New
              </span>
            )}
            {project.relevanceScore !== undefined && project.relevanceScore >= 50 && (
              <span className="relative group inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gold/20 text-gold-dark uppercase tracking-wider cursor-help">
                {project.relevanceScore}% match
                {/* Score breakdown tooltip */}
                {project.relevanceReasons && project.relevanceReasons.length > 0 && (
                  <span className="absolute left-0 top-full mt-1 z-50 hidden group-hover:block w-48 bg-navy text-white text-[10px] font-normal normal-case tracking-normal rounded-lg shadow-lg p-2.5">
                    <span className="block font-bold text-gold mb-1">Match Breakdown</span>
                    {project.relevanceReasons.map((reason, i) => (
                      <span key={i} className="flex items-center gap-1.5 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-gold shrink-0" />
                        {reason}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{project.location}</span>
            <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" />{project.value}</span>
            <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" />{project.owner}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cfg.badge}`}>{cfg.label}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${capexBadge[project.capexGrade]}`}>CAPEX {project.capexGrade}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${routeBadge[project.opportunityRoute]}`}>{project.opportunityRoute}</span>
            {/* Action Tier badge */}
            {project.actionTier && (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                project.actionTier === "tier1_actionable" ? "bg-emerald-100 text-emerald-700 border border-emerald-300" :
                project.actionTier === "tier2_warm" ? "bg-amber-100 text-amber-700 border border-amber-300" :
                "bg-slate-200 text-slate-500 border border-slate-300"
              }`}>
                {project.actionTier === "tier1_actionable" ? "Action Now" :
                 project.actionTier === "tier2_warm" ? "Warm" : "Monitor"}
              </span>
            )}
            {/* Lifecycle status badge */}
            {project.lifecycleStatus && project.lifecycleStatus !== "active" && (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                project.lifecycleStatus === "stale" ? "bg-amber-100 text-amber-700 border border-amber-300" :
                project.lifecycleStatus === "archived" ? "bg-slate-200 text-slate-500 border border-slate-300" :
                project.lifecycleStatus === "awarded" ? "bg-teal/15 text-teal border border-teal/30" :
                "bg-navy/10 text-navy border border-navy/20"
              }`}>
                {project.lifecycleStatus === "stale" && <Clock className="w-3 h-3 inline mr-0.5 -mt-0.5" />}
                {project.lifecycleStatus === "archived" && <Archive className="w-3 h-3 inline mr-0.5 -mt-0.5" />}
                {project.lifecycleStatus === "awarded" && <Award className="w-3 h-3 inline mr-0.5 -mt-0.5" />}
                {project.lifecycleStatus}
              </span>
            )}
            {/* Business line badges */}
            {businessLineNames && project.matchedBusinessLines && project.matchedBusinessLines.length > 0 && (
              <>
                <span className="w-px h-3 bg-border mx-0.5" />
                {project.matchedBusinessLines.map(blId => {
                  const name = businessLineNames[blId];
                  if (!name) return null;
                  const cfg = businessLineBadgeConfig[name] || { bg: "bg-slate-100", text: "text-slate-600", short: name };
                  return (
                    <span key={blId} className={`px-2 py-0.5 rounded text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
                      {cfg.short}
                    </span>
                  );
                })}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          {/* Claim / Pipeline status button */}
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {pipelineClaim ? (
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-white ${pipelineStatusColors[pipelineClaim.status] || "bg-slate-500"}`}>
                <Check className="w-3 h-3" />
                {pipelineStatusLabels[pipelineClaim.status] || pipelineClaim.status}
              </span>
            ) : (
              <ClaimButton projectId={project.id} reportId={project.reportId} />
            )}
          </div>
          {/* Feedback buttons */}
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <button
              onClick={(e) => { e.stopPropagation(); handleVote("up"); }}
              className={`p-1.5 rounded-md transition-all ${
                feedback.vote === "up"
                  ? "bg-teal/20 text-teal"
                  : "text-muted-foreground hover:bg-teal/10 hover:text-teal"
              }`}
              title="Good lead for me"
            >
              <ThumbsUp className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleVote("down"); }}
              className={`p-1.5 rounded-md transition-all ${
                feedback.vote === "down"
                  ? "bg-hot/20 text-hot"
                  : "text-muted-foreground hover:bg-hot/10 hover:text-hot"
              }`}
              title="Not relevant to me"
            >
              <ThumbsDown className="w-4 h-4" />
            </button>
          </div>
          {/* Pin / Protect button */}
          <button
            onClick={(e) => { e.stopPropagation(); setKeepFlagMut.mutate({ projectId: project.id, keep: !pinned }); }}
            className={`p-1.5 rounded-md transition-all ${
              pinned
                ? "bg-gold/20 text-gold-dark"
                : "text-muted-foreground hover:bg-gold/10 hover:text-gold-dark"
            }`}
            title={pinned ? "Unpin project (allow auto-archive)" : "Pin project (protect from auto-archive)"}
            disabled={setKeepFlagMut.isPending}
          >
            {pinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
          </button>
          <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </div>
      </div>

      {/* Feedback reason selector (appears when thumbs down) */}
      <AnimatePresence>
        {showReasons && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 sm:px-5 pb-3 border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Why isn't this relevant? (helps improve future results)</p>
              <div className="flex flex-wrap gap-1.5">
                {feedbackReasons.filter(r => r.key !== "great_fit").map(r => (
                  <button
                    key={r.key}
                    onClick={() => handleReason(r.key)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      feedback.reason === r.key
                        ? "bg-hot/15 text-hot border border-hot/30"
                        : "bg-card text-muted-foreground border border-border hover:border-hot/30"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 sm:px-5 pb-5 border-t border-border">
              {/* Relevance reasons */}
              {project.relevanceReasons && project.relevanceReasons.length > 0 && (
                <div className="pt-3 pb-2">
                  <div className="flex flex-wrap gap-1.5">
                    {project.relevanceReasons.map((reason, i) => (
                      <span key={i} className="px-2 py-0.5 rounded text-[10px] font-medium bg-gold/10 text-gold-dark border border-gold/20">
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4">
                {/* Overview */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-2">Project Overview</h4>
                  <p className="text-sm text-foreground/80 leading-relaxed">{project.overview}</p>
                  {project.opportunityNote && (
                    <div className="mt-3 p-3 bg-gold/8 rounded border border-gold/20">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-1">Opportunity Route</h4>
                      <p className="text-sm text-foreground/80">{project.opportunityNote}</p>
                    </div>
                  )}
                </div>

                {/* Contractors */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-2">Contractors</h4>
                  <ul className="space-y-1.5">
                    {contractors.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                          c.status === "confirmed" ? "bg-teal/15 text-teal" :
                          c.status === "predicted" ? "bg-gold/15 text-gold-dark" :
                          "bg-slate-200 text-slate-500"
                        }`}>
                          {c.status === "confirmed" ? "Confirmed" : c.status === "predicted" ? `Predicted ${c.confidence || ""}` : "TBD"}
                        </span>
                        <span className="text-foreground/80">{c.name}{c.detail ? ` — ${c.detail}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Equipment Signals */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-2">Equipment Signals</h4>
                  <ul className="space-y-1">
                    {equipmentSignals.map((s, i) => (
                      <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                        <span className="w-1 h-1 rounded-full bg-teal shrink-0 mt-2" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Timeline & Sources */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-2">Timeline & Sources</h4>
                  <div className="text-sm text-foreground/80 space-y-1">
                    <p><span className="font-medium text-foreground">Stage:</span> {project.stage}</p>
                    {project.timeline && <p><span className="font-medium text-foreground">Duration:</span> {project.timeline}</p>}
                    {project.completion && <p><span className="font-medium text-foreground">Completion:</span> {project.completion}</p>}
                  </div>
                  <div className="mt-3 space-y-1">
                    {sources.map((src, i) => (
                      <a
                        key={i}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-teal hover:text-teal-light transition-colors"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        {src.label}{src.date ? ` (${src.date})` : ""}
                      </a>
                    ))}
                  </div>
                </div>
              </div>

              {/* Business Line Relevance Scores */}
              {blScoresQuery.data && blScoresQuery.data.length > 0 && (
                <div className="mt-5 pt-4 border-t border-border">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-3 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5" /> Business Line Relevance
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {blScoresQuery.data
                      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
                      .map((dim: { dimension: string; score: number; explanation: string }) => {
                        const cfg = businessLineBadgeConfig[dim.dimension] || { bg: "bg-slate-100", text: "text-slate-600", short: dim.dimension };
                        const barColor = dim.score >= 7 ? "bg-teal" : dim.score >= 4 ? "bg-gold" : "bg-slate-300";
                        return (
                          <div key={dim.dimension} className="bg-card border border-border rounded-lg p-2.5 hover:shadow-sm transition-shadow" title={dim.explanation}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
                                {dim.dimension}
                              </span>
                              <span className={`text-sm font-bold ${dim.score >= 7 ? "text-teal" : dim.score >= 4 ? "text-gold-dark" : "text-muted-foreground"}`}>
                                {dim.score}/10
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1.5">
                              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${dim.score * 10}%` }} />
                            </div>
                            <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2">{dim.explanation}</p>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
              {blScoresQuery.isLoading && open && (
                <div className="mt-5 pt-4 border-t border-border">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading business line scores...
                  </div>
                </div>
              )}

              {/* Recommended Collateral */}
              {collateralQuery.data && collateralQuery.data.length > 0 && (
                <div className="mt-5 pt-4 border-t border-border">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-3 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Recommended Collateral
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-teal/10 text-teal text-[10px] font-bold">
                      {collateralQuery.data.length}
                    </span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {collateralQuery.data.map((item: { id: number; name: string; fileUrl: string; productLine: string; matchScore: number; matchReason: string }) => {
                      const scoreColor = item.matchScore >= 80 ? "text-teal" : item.matchScore >= 60 ? "text-gold-dark" : "text-muted-foreground";
                      const scoreBg = item.matchScore >= 80 ? "bg-teal" : item.matchScore >= 60 ? "bg-gold" : "bg-slate-300";
                      const plConfig = businessLineBadgeConfig[item.productLine] || { bg: "bg-slate-100", text: "text-slate-600", short: item.productLine };
                      return (
                        <div key={item.id} className="bg-card border border-border rounded-lg p-3 hover:shadow-md hover:border-teal/30 transition-all group">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-navy truncate" title={item.name}>{item.name}</p>
                              <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-semibold ${plConfig.bg} ${plConfig.text}`}>
                                {plConfig.short}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className={`text-sm font-bold ${scoreColor}`}>{item.matchScore}</span>
                            </div>
                          </div>
                          <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden mb-2">
                            <div className={`h-full rounded-full transition-all ${scoreBg}`} style={{ width: `${item.matchScore}%` }} />
                          </div>
                          {item.matchReason && (
                            <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2 mb-2" title={item.matchReason}>{item.matchReason}</p>
                          )}
                          <a
                            href={item.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-semibold bg-teal/10 text-teal hover:bg-teal/20 transition-colors w-full justify-center"
                          >
                            <Download className="w-3 h-3" /> Download Flyer
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {collateralQuery.isLoading && open && (
                <div className="mt-5 pt-4 border-t border-border">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading recommended collateral...
                  </div>
                </div>
              )}

              {/* Lifecycle Actions */}
              <LifecycleActions project={project} />

              {/* Find Contacts (On-Demand Enrichment) Button */}
              <EnrichProjectButton
                projectId={project.id}
                projectName={project.name}
                project={project}
                onOutreach={(contact) => {
                  // Create a minimal ContactData-like object for the outreach modal
                  setOutreachContact({
                    id: 0,
                    name: contact.name,
                    title: contact.title,
                    company: contact.company,
                    project: project.name,
                    priority: "warm",
                    roleBucket: contact.roleBucket,
                    email: contact.email,
                    linkedin: null,
                  });
                  setShowOutreach(true);
                }}
              />

              {/* Project Contacts Section — Enhanced with verification scores, LinkedIn links, verify buttons */}
              {projectContacts.length > 0 && (
                <div className="mt-5 pt-4 border-t border-border">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" /> Project Contacts
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-navy/10 text-navy text-[10px] font-bold">
                        {projectContacts.length}
                      </span>
                    </h4>
                    {hasMoreContacts && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowAllContacts(!showAllContacts); }}
                        className="text-[10px] font-semibold text-teal hover:text-teal-light transition-colors"
                      >
                        {showAllContacts ? "Show less" : `Show all ${projectContacts.length}`}
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {visibleContacts.map((contact, i) => (
                      <ProjectContactCard
                        key={contact.id}
                        contact={contact}
                        isPrimary={i === 0}
                        buyerRoles={buyerRoles}
                        onOutreach={handleOutreach}
                      />
                    ))}
                  </div>
                  {/* AI-generated email disclaimer */}
                  {projectContacts.some(c => c.enrichmentSource === "llm" || c.verificationStatus === "ai_suggested") && (
                    <p className="text-[10px] text-muted-foreground mt-2 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                      AI-suggested contacts and emails are pattern-guessed. Use the Verify button or check LinkedIn before outreach.
                    </p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Outreach Email Modal */}
      {activeOutreachContact && showOutreach && (
        <OutreachEmailModal
          isOpen={showOutreach}
          onClose={() => { setShowOutreach(false); setOutreachContact(null); }}
          contact={{
            id: activeOutreachContact.id,
            name: activeOutreachContact.name,
            title: activeOutreachContact.title,
            company: activeOutreachContact.company,
            email: activeOutreachContact.email || "",
            roleBucket: activeOutreachContact.roleBucket,
          }}
          project={{
            id: project.id,
            name: project.name,
            location: project.location,
            value: project.value,
            sector: project.sector,
            stage: project.stage,
            overview: project.overview,
            equipmentSignals: project.equipmentSignals,
            opportunityRoute: project.opportunityRoute,
            matchedBusinessLines: (project.matchedBusinessLines || []).map(blId => businessLineNames?.[blId] || String(blId)),
          }}
        />
      )}
    </div>
  );
}
