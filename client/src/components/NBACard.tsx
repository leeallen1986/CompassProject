/**
 * NBACard — Next Best Action display component
 *
 * Shows per-project AI-generated guidance:
 * - Why this project matters now
 * - Best stakeholder to contact
 * - Likely pain points
 * - Recommended action + call angle
 *
 * Designed to feel like a sharp sales coordinator, not a robot.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Sparkles, User, AlertTriangle, Phone, ChevronDown, ChevronUp,
  Loader2, RefreshCw, Target, MessageSquare, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface NBACardProps {
  projectId: number;
  projectName: string;
  /** Compact mode for list views, expanded mode for detail views */
  compact?: boolean;
}

const urgencyColors: Record<string, { bg: string; text: string; label: string }> = {
  urgent: { bg: "bg-red-50 border-red-200", text: "text-red-700", label: "Act Now" },
  high: { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", label: "High Priority" },
  moderate: { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", label: "This Week" },
  low: { bg: "bg-slate-50 border-slate-200", text: "text-slate-600", label: "Monitor" },
};

export default function NBACard({ projectId, projectName, compact = false }: NBACardProps) {
  const [expanded, setExpanded] = useState(!compact);

  const { data: nba, isLoading, error, refetch, isFetching } = trpc.nba.forProject.useQuery(
    { projectId },
    {
      staleTime: 1000 * 60 * 30, // 30 min
      retry: 1,
    }
  );

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 animate-pulse">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Generating sales guidance...</span>
        </div>
      </div>
    );
  }

  if (error || !nba) {
    return null; // Silently fail — NBA is supplementary
  }

  const urgency = urgencyColors[nba.urgencyLevel] || urgencyColors.moderate;

  if (compact && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`w-full text-left rounded-lg border ${urgency.bg} p-3 hover:shadow-sm transition-all group`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold shrink-0" />
            <span className="text-xs font-semibold text-navy">Next Best Action</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${urgency.text} bg-white/60`}>
              {urgency.label}
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-navy transition-colors" />
        </div>
        <p className="text-xs text-foreground/70 mt-1 line-clamp-1">{nba.recommendedAction}</p>
      </button>
    );
  }

  return (
    <div className={`rounded-lg border ${urgency.bg} overflow-hidden`}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gold" />
          <span className="text-sm font-bold text-navy">Next Best Action</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${urgency.text} bg-white/60`}>
            {urgency.label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          {compact && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setExpanded(false)}
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* Why it matters */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Why It Matters Now</span>
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">{nba.whyItMattersNow}</p>
        </div>

        {/* Best Stakeholder */}
        {nba.bestStakeholder && (
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <User className="w-3.5 h-3.5 text-teal" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-teal">Best First Contact</span>
            </div>
            <div className="bg-white/60 rounded-md p-2.5">
              <div className="text-sm font-medium text-navy">{nba.bestStakeholder.name}</div>
              <div className="text-xs text-muted-foreground">{nba.bestStakeholder.title} at {nba.bestStakeholder.company}</div>
              <p className="text-xs text-foreground/70 mt-1 italic">{nba.bestStakeholder.whyThisContact}</p>
            </div>
          </div>
        )}

        {/* Pain Points */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-orange-600">Likely Pain Points</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {nba.likelyPainPoints.map((pp, i) => (
              <span key={i} className="px-2 py-1 rounded-md bg-white/60 text-xs text-foreground/70 border border-orange-100">
                {pp}
              </span>
            ))}
          </div>
        </div>

        {/* Recommended Action */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="w-3.5 h-3.5 text-navy" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-navy">Recommended Action</span>
          </div>
          <p className="text-sm text-foreground/80 font-medium">{nba.recommendedAction}</p>
        </div>

        {/* Call Angle */}
        <div className="bg-navy/5 rounded-md p-3 border border-navy/10">
          <div className="flex items-center gap-1.5 mb-1">
            <Phone className="w-3.5 h-3.5 text-navy" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-navy">Call Angle</span>
          </div>
          <p className="text-sm text-foreground/80 italic">"{nba.callAngle}"</p>
        </div>

        {/* Business Lines */}
        {nba.relevantBusinessLines.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <MessageSquare className="w-3 h-3 text-muted-foreground" />
            {nba.relevantBusinessLines.map((bl, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-navy/8 text-navy">
                {bl}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * NBABatchLoader — loads NBA for multiple projects at once
 * Used on the This Week page to pre-fetch NBA data
 */
export function useNBABatch(projectIds: number[]) {
  return trpc.nba.forProjects.useQuery(
    { projectIds },
    {
      enabled: projectIds.length > 0,
      staleTime: 1000 * 60 * 30,
      retry: 1,
    }
  );
}
