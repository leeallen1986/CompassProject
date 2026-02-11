/*
 * ProjectCard — Expandable project card with priority-coded left border
 * Design: Nordic Industrial Precision — deep navy, gold accents, teal highlights
 * Now includes feedback buttons (thumbs up/down) and relevance score
 */
import { useState } from "react";
import { ChevronDown, ExternalLink, MapPin, DollarSign, Building2, Sparkles, ThumbsUp, ThumbsDown, Target, Check } from "lucide-react";
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

export default function ProjectCard({
  project,
  existingFeedback,
  pipelineClaim,
}: {
  project: ProjectData;
  existingFeedback?: { vote: "up" | "down"; reason: string | null } | null;
  pipelineClaim?: { id: number; status: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
