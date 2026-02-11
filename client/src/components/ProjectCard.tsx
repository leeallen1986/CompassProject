/*
 * ProjectCard — Expandable project card with priority-coded left border
 * Design: Nordic Industrial Precision — deep navy, gold accents, teal highlights
 * Now includes feedback buttons (thumbs up/down) and relevance score
 */
import { useState } from "react";
import { ChevronDown, ExternalLink, MapPin, DollarSign, Building2, Sparkles, ThumbsUp, ThumbsDown, Target, Check, Mail, User } from "lucide-react";
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
  createdAt: Date;
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

// Business line badge colors
const businessLineBadgeConfig: Record<string, { bg: string; text: string; short: string }> = {
  "Portable Air": { bg: "bg-sky-100", text: "text-sky-700", short: "Air" },
  "PAL": { bg: "bg-amber-100", text: "text-amber-700", short: "PAL" },
  "Pump (Flow)": { bg: "bg-blue-100", text: "text-blue-700", short: "Pump" },
  "BESS": { bg: "bg-emerald-100", text: "text-emerald-700", short: "BESS" },
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

// Contact shape from the API
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
 * Find the best primary contact for a project based on user's preferred buyer roles.
 * Matching strategy:
 *   1. Direct substring match (contact.project ⊂ project.name or vice versa)
 *   2. Keyword overlap (e.g., "Rio Tinto Maintenance" ↔ "Monadelphous Rio Tinto Pilbara Maintenance Services")
 *   3. Company/owner match (contact.company ≈ project.owner)
 * Scoring: buyerRoles preference > has email > priority (hot > warm > cold)
 */
function findPrimaryContact(
  projectName: string,
  projectOwner: string,
  allContacts: ContactData[],
  buyerRoles?: string[] | null,
): ContactData | null {
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

  if (projectContacts.length === 0) return null;

  // Score each contact
  const priorityScore = { hot: 3, warm: 2, cold: 1 };
  const scored = projectContacts.map(c => {
    let score = priorityScore[c.priority] || 0;
    // Boost if matches user's preferred buyer roles
    if (buyerRoles && buyerRoles.length > 0) {
      const roleLower = c.roleBucket.toLowerCase();
      if (buyerRoles.some(r => roleLower.includes(r.toLowerCase()))) score += 10;
    }
    // Boost if has email (actionable)
    if (c.email) score += 5;
    // Boost if contact project name directly matches
    const cProject = c.project.toLowerCase();
    if (projectNameLower.includes(cProject) || cProject.includes(projectNameLower)) score += 3;
    return { contact: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.contact ?? null;
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

  // Find primary contact for this project
  const primaryContact = allContacts && allContacts.length > 0
    ? findPrimaryContact(project.name, project.owner, allContacts, buyerRoles)
    : null;
  const [feedback, setFeedback] = useState<FeedbackState>({
    vote: existingFeedback?.vote ?? null,
    reason: existingFeedback?.reason ?? undefined,
  });

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

  return (
    <div
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
            {project.relevanceScore !== undefined && project.relevanceScore >= 70 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gold/20 text-gold-dark uppercase tracking-wider">
                {project.relevanceScore}% match
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

              {/* Primary Contact & Outreach */}
              {primaryContact && (
                <div className="mt-5 pt-4 border-t border-border">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-3 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" /> Recommended Contact
                  </h4>
                  <div className="flex items-center justify-between gap-3 bg-navy/5 rounded-lg p-3 border border-navy/10">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-navy">{primaryContact.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                          primaryContact.priority === "hot" ? "bg-hot/15 text-hot" :
                          primaryContact.priority === "warm" ? "bg-warm/15 text-warm" :
                          "bg-cold/15 text-cold"
                        }`}>{primaryContact.priority}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{primaryContact.title} — {primaryContact.company}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Role: {primaryContact.roleBucket}</p>
                    </div>
                    {primaryContact.email && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowOutreach(true); }}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gold text-navy text-xs font-bold hover:bg-gold-light transition-colors shadow-sm"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Outreach
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Outreach Email Modal */}
      {primaryContact && showOutreach && (
        <OutreachEmailModal
          isOpen={showOutreach}
          onClose={() => setShowOutreach(false)}
          contact={{
            id: primaryContact.id,
            name: primaryContact.name,
            title: primaryContact.title,
            company: primaryContact.company,
            email: primaryContact.email || "",
            roleBucket: primaryContact.roleBucket,
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
