/**
 * Part D — Action Tracking
 * ActionTracker: one-click outcome buttons + status badge for a single project.
 * Used on ThisWeek.tsx project rows and ProjectCard.tsx.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CheckCircle2, Phone, Calendar, FileText, Trophy, XCircle,
  Clock, MinusCircle, Zap, UserSearch, ChevronDown, ChevronUp,
  Loader2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OutcomeCode =
  | "not_started"
  | "contacted"
  | "meeting_booked"
  | "proposal_sent"
  | "won"
  | "lost"
  | "deferred"
  | "not_relevant"
  | "already_active"
  | "contact_discovery_needed";

export type ProductLane =
  | "portable_air"
  | "pumps"
  | "pal"
  | "bess"
  | "multi_lane_pt";

// ── Outcome metadata ──────────────────────────────────────────────────────────

export const OUTCOME_META: Record<
  OutcomeCode,
  { label: string; icon: React.ReactNode; color: string; bgColor: string; closed?: boolean }
> = {
  not_started: {
    label: "Not Started",
    icon: <Clock className="w-3.5 h-3.5" />,
    color: "text-slate-500",
    bgColor: "bg-slate-100 border-slate-200",
  },
  contacted: {
    label: "Contacted",
    icon: <Phone className="w-3.5 h-3.5" />,
    color: "text-blue-600",
    bgColor: "bg-blue-50 border-blue-200",
  },
  meeting_booked: {
    label: "Meeting Booked",
    icon: <Calendar className="w-3.5 h-3.5" />,
    color: "text-violet-600",
    bgColor: "bg-violet-50 border-violet-200",
  },
  proposal_sent: {
    label: "Proposal Sent",
    icon: <FileText className="w-3.5 h-3.5" />,
    color: "text-amber-600",
    bgColor: "bg-amber-50 border-amber-200",
  },
  won: {
    label: "Won",
    icon: <Trophy className="w-3.5 h-3.5" />,
    color: "text-emerald-700",
    bgColor: "bg-emerald-50 border-emerald-200",
    closed: true,
  },
  lost: {
    label: "Lost",
    icon: <XCircle className="w-3.5 h-3.5" />,
    color: "text-red-600",
    bgColor: "bg-red-50 border-red-200",
    closed: true,
  },
  deferred: {
    label: "Deferred",
    icon: <Clock className="w-3.5 h-3.5" />,
    color: "text-orange-500",
    bgColor: "bg-orange-50 border-orange-200",
  },
  not_relevant: {
    label: "Not Relevant",
    icon: <MinusCircle className="w-3.5 h-3.5" />,
    color: "text-slate-400",
    bgColor: "bg-slate-50 border-slate-200",
    closed: true,
  },
  already_active: {
    label: "Already Active",
    icon: <Zap className="w-3.5 h-3.5" />,
    color: "text-teal-600",
    bgColor: "bg-teal-50 border-teal-200",
  },
  contact_discovery_needed: {
    label: "Discovery Needed",
    icon: <UserSearch className="w-3.5 h-3.5" />,
    color: "text-amber-700",
    bgColor: "bg-amber-50 border-amber-300",
  },
};

// ── Outcome Status Badge ──────────────────────────────────────────────────────

export function OutcomeBadge({
  outcome,
  size = "sm",
}: {
  outcome: OutcomeCode;
  size?: "xs" | "sm";
}) {
  const meta = OUTCOME_META[outcome] ?? OUTCOME_META.not_started;
  const sizeClass = size === "xs" ? "text-[9px] px-1 py-0.5" : "text-[10px] px-1.5 py-0.5";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-semibold ${sizeClass} ${meta.bgColor} ${meta.color}`}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

// ── One-Click Action Buttons ──────────────────────────────────────────────────

const QUICK_OUTCOMES: OutcomeCode[] = [
  "contacted",
  "meeting_booked",
  "proposal_sent",
  "won",
  "lost",
  "deferred",
  "not_relevant",
  "already_active",
  "contact_discovery_needed",
];

interface ActionTrackerProps {
  projectId: number;
  productLane?: ProductLane;
  /** If true, renders as a compact inline strip rather than full panel */
  compact?: boolean;
  /** Called after a successful outcome update */
  onUpdate?: (outcome: OutcomeCode) => void;
}

export default function ActionTracker({
  projectId,
  productLane,
  compact = false,
  onUpdate,
}: ActionTrackerProps) {
  const utils = trpc.useUtils();
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [pendingOutcome, setPendingOutcome] = useState<OutcomeCode | null>(null);

  // Fetch current action for this project
  const { data: currentAction, isLoading } = trpc.projectActions.getLatestForProject.useQuery(
    { projectId },
    { staleTime: 30_000 }
  );

  const oneClick = trpc.projectActions.oneClickUpdate.useMutation({
    onSuccess: (data) => {
      utils.projectActions.getLatestForProject.invalidate({ projectId });
      utils.projectActions.getManagerRollup.invalidate();
      setPendingOutcome(null);
      setNotes("");
      setShowNotes(false);
      onUpdate?.(data.outcomeCode as OutcomeCode);
    },
  });

  const handleOutcomeClick = (outcome: OutcomeCode) => {
    setPendingOutcome(outcome);
    if (showNotes) {
      // Submit with notes
      oneClick.mutate({ projectId, outcomeCode: outcome, outcomeNotes: notes || undefined, productLane });
    } else {
      // Submit immediately
      oneClick.mutate({ projectId, outcomeCode: outcome, productLane });
    }
  };

  const currentOutcome = (currentAction?.outcomeCode as OutcomeCode) ?? "not_started";
  const currentMeta = OUTCOME_META[currentOutcome];

  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {/* Current status */}
        <OutcomeBadge outcome={currentOutcome} size="xs" />
        {currentAction?.updatedAt && (
          <span className="text-[9px] text-muted-foreground">
            {new Date(currentAction.updatedAt).toLocaleDateString()}
          </span>
        )}
        {/* Quick action buttons (compact strip) */}
        {QUICK_OUTCOMES.map((outcome) => {
          const meta = OUTCOME_META[outcome];
          const isActive = currentOutcome === outcome;
          const isPending = pendingOutcome === outcome && oneClick.isPending;
          return (
            <Tooltip key={outcome}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleOutcomeClick(outcome)}
                  disabled={oneClick.isPending}
                  className={`p-1 rounded transition-all ${
                    isActive
                      ? `${meta.bgColor} ${meta.color} ring-1 ring-current`
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : meta.icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {meta.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  // Full panel mode
  return (
    <div className="border border-border rounded-lg p-3 bg-card space-y-3" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-navy">Action Status</span>
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : (
            <OutcomeBadge outcome={currentOutcome} />
          )}
        </div>
        {currentAction?.updatedAt && (
          <span className="text-[10px] text-muted-foreground">
            Updated {new Date(currentAction.updatedAt).toLocaleDateString()}
            {currentAction.userId && " · " + (currentAction as any).userName}
          </span>
        )}
      </div>

      {/* One-click buttons */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_OUTCOMES.map((outcome) => {
          const meta = OUTCOME_META[outcome];
          const isActive = currentOutcome === outcome;
          const isPending = pendingOutcome === outcome && oneClick.isPending;
          return (
            <button
              key={outcome}
              onClick={() => handleOutcomeClick(outcome)}
              disabled={oneClick.isPending}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border transition-all ${
                isActive
                  ? `${meta.bgColor} ${meta.color} ring-1 ring-current`
                  : `border-border text-muted-foreground hover:${meta.bgColor} hover:${meta.color}`
              }`}
            >
              {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : meta.icon}
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Optional notes toggle */}
      <div>
        <button
          onClick={() => setShowNotes(!showNotes)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showNotes ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showNotes ? "Hide notes" : "Add a note (optional)"}
        </button>
        {showNotes && (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Who was contacted, what happened, next step..."
            rows={2}
            className="mt-1.5 w-full text-xs border border-border rounded-md px-2 py-1.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-gold/40"
          />
        )}
      </div>

      {/* Existing notes */}
      {currentAction?.outcomeNotes && (
        <div className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5 italic">
          "{currentAction.outcomeNotes}"
        </div>
      )}
    </div>
  );
}
