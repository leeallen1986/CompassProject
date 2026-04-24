/**
 * WeeklyCoachingPanel — Personalised weekly coaching nudges
 *
 * Shows inside the This Week page:
 * - Top actions this week
 * - Overlooked opportunities
 * - Adjacent BL opportunity
 * - Early-stage warm up
 * - Too-late warning
 * - Focus insight + coverage note
 *
 * Collapsed by default to reduce noise. Stats hidden when all zeros.
 * Framed as a sharp sales coordinator, not performance surveillance.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import {
  Sparkles, Target, Eye, TrendingUp, Clock,
  ChevronDown, ChevronUp, Loader2, Zap, BarChart3,
  ArrowRight, Lightbulb, Shield, Layers
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const urgencyColors: Record<string, string> = {
  urgent: "border-l-red-500 bg-red-50/50",
  high: "border-l-amber-500 bg-amber-50/50",
  medium: "border-l-blue-500 bg-blue-50/50",
};

const actionTypeIcons: Record<string, React.ReactNode> = {
  engage: <Eye className="w-4 h-4 text-blue-600" />,
  follow_up: <ArrowRight className="w-4 h-4 text-amber-600" />,
  enrich: <TrendingUp className="w-4 h-4 text-teal" />,
  outreach: <Zap className="w-4 h-4 text-purple-600" />,
  discover: <Target className="w-4 h-4 text-red-600" />,
};

export default function WeeklyCoachingPanel() {
  const [expanded, setExpanded] = useState(false); // collapsed by default
  const [, navigate] = useLocation();

  const { data: coaching, isLoading, error } = trpc.coaching.weekly.useQuery(undefined, {
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: 1,
  });

  // Compute whether any stats are non-zero
  const hasActivity = useMemo(() => {
    if (!coaching?.stats) return false;
    const s = coaching.stats;
    return (
      s.projectsEngaged > 0 ||
      s.contactsOpened > 0 ||
      s.outreachSent > 0 ||
      s.sectorsWorked.length > 0 ||
      s.blsWorked.length > 0
    );
  }, [coaching?.stats]);

  // Count actionable items to show in collapsed header
  const actionCount = useMemo(() => {
    if (!coaching) return 0;
    return (
      coaching.topActions.length +
      coaching.overlookedOpportunities.length +
      (coaching.adjacentBLOpportunity ? 1 : 0)
    );
  }, [coaching]);

  if (isLoading) {
    return (
      <Card className="border-gold/30">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-gold" />
            <span className="text-sm font-medium text-muted-foreground">Preparing your coaching insights...</span>
          </div>
        </CardHeader>
      </Card>
    );
  }

  if (error || !coaching) return null;

  return (
    <Card className="border-gold/30 overflow-hidden">
      {/* Header — always visible */}
      <CardHeader
        className="pb-2 bg-gradient-to-r from-gold/5 to-transparent cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-gold" />
            <CardTitle className="text-base font-bold text-navy">Your Weekly Coaching</CardTitle>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gold/15 text-gold-dark">
              AI-Powered
            </span>
            {!expanded && actionCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-navy/10 text-navy">
                {actionCount} action{actionCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {/* Focus Insight — always visible as a one-liner */}
        <p className="text-sm text-foreground/70 mt-1 leading-relaxed italic">
          <Lightbulb className="w-3.5 h-3.5 inline mr-1 text-gold" />
          {coaching.focusInsight}
        </p>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-3 space-y-4">
          {/* Coverage Note */}
          <div className="bg-navy/5 rounded-md px-3 py-2 border border-navy/10">
            <p className="text-xs text-navy font-medium flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-navy shrink-0" />
              {coaching.coverageNote}
            </p>
          </div>

          {/* Activity Stats — only show when user has some activity */}
          {hasActivity && (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {coaching.stats.projectsEngaged > 0 && (
                <StatBadge value={coaching.stats.projectsEngaged} label="Projects Viewed" />
              )}
              <StatBadge value={coaching.stats.totalActionable} label="Actionable" />
              {coaching.stats.contactsOpened > 0 && (
                <StatBadge value={coaching.stats.contactsOpened} label="Contacts Opened" />
              )}
              {coaching.stats.outreachSent > 0 && (
                <StatBadge value={coaching.stats.outreachSent} label="Outreach Sent" />
              )}
              {coaching.stats.sectorsWorked.length > 0 && (
                <StatBadge value={coaching.stats.sectorsWorked.length} label="Sectors" />
              )}
            </div>
          )}

          {/* Top 5 Actions */}
          {coaching.topActions.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-navy mb-2 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-gold" />
                Top Actions This Week
              </h3>
              <div className="space-y-1.5">
                {coaching.topActions.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => navigate(`/project/${action.projectId}`)}
                    className={`w-full text-left rounded-md border-l-4 px-3 py-2 hover:shadow-sm transition-all ${urgencyColors[action.urgency] || urgencyColors.medium}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">{actionTypeIcons[action.type] || <Zap className="w-4 h-4" />}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-navy truncate">{action.projectName}</div>
                        <div className="text-[11px] text-foreground/60 leading-relaxed">{action.reason}</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Overlooked Opportunities */}
          {coaching.overlookedOpportunities.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-2 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-amber-500" />
                Overlooked Opportunities
              </h3>
              <div className="space-y-2">
                {coaching.overlookedOpportunities.map((opp, i) => (
                  <button
                    key={i}
                    onClick={() => navigate(`/project/${opp.projectId}`)}
                    className="w-full text-left rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2.5 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-navy">{opp.projectName}</div>
                        <div className="text-[10px] text-muted-foreground">{opp.location} · {opp.sector} · {opp.value}</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
                    </div>
                    <p className="text-[11px] text-amber-700 mt-1">{opp.whyOverlooked}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Adjacent BL Opportunity */}
          {coaching.adjacentBLOpportunity && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-teal mb-2 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-teal" />
                Adjacent Business Line Opportunity
              </h3>
              <button
                onClick={() => navigate(`/project/${coaching.adjacentBLOpportunity!.exampleProjectId}`)}
                className="w-full text-left rounded-md border border-teal/20 bg-teal/5 px-3 py-2.5 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal/15 text-teal">
                    {coaching.adjacentBLOpportunity.businessLine}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {coaching.adjacentBLOpportunity.projectCount} projects
                  </span>
                </div>
                <p className="text-[11px] text-foreground/70 leading-relaxed">{coaching.adjacentBLOpportunity.insight}</p>
              </button>
            </div>
          )}

          {/* Early Stage + Too Late row */}
          {(coaching.earlyStageWarmUp || coaching.tooLateProject) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Early Stage Warm Up */}
              {coaching.earlyStageWarmUp && (
                <button
                  onClick={() => navigate(`/project/${coaching.earlyStageWarmUp!.projectId}`)}
                  className="text-left rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2.5 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Layers className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Worth Warming Up</span>
                  </div>
                  <div className="text-xs font-semibold text-navy">{coaching.earlyStageWarmUp.projectName}</div>
                  <div className="text-[10px] text-muted-foreground mb-1">{coaching.earlyStageWarmUp.stage}</div>
                  <p className="text-[11px] text-foreground/60 leading-relaxed">{coaching.earlyStageWarmUp.whyWarmUp}</p>
                </button>
              )}

              {/* Too Late Warning */}
              {coaching.tooLateProject && (
                <div className="rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Probably Too Late</span>
                  </div>
                  <div className="text-xs font-semibold text-slate-700">{coaching.tooLateProject.projectName}</div>
                  <div className="text-[10px] text-muted-foreground mb-1">{coaching.tooLateProject.stage}</div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">{coaching.tooLateProject.whyTooLate}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function StatBadge({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center px-2 py-1.5 rounded-md bg-card border border-border">
      <div className="text-lg font-bold text-navy">{value}</div>
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}
