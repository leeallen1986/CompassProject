/**
 * Part D — Action Tracking
 * ManagerRollup: aggregated action counts for the current week.
 * Visible to admin/manager roles on the This Week page.
 */

import { trpc } from "@/lib/trpc";
import { BarChart3, Users, Layers, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { OutcomeBadge, OUTCOME_META, type OutcomeCode } from "./ActionTracker";

const LANE_LABELS: Record<string, string> = {
  portable_air: "Portable Air",
  pumps: "Pumps",
  pal: "PAL",
  bess: "BESS",
  multi_lane_pt: "Multi-Lane",
};

const LANE_COLORS: Record<string, string> = {
  portable_air: "text-sky-600",
  pumps: "text-blue-600",
  pal: "text-violet-600",
  bess: "text-emerald-600",
  multi_lane_pt: "text-orange-500",
};

// Outcome display order for the rollup table
const ROLLUP_OUTCOMES: OutcomeCode[] = [
  "not_started",
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

export default function ManagerRollup({ weekKey }: { weekKey?: string }) {
  const [showRepBreakdown, setShowRepBreakdown] = useState(false);
  const [showLaneBreakdown, setShowLaneBreakdown] = useState(false);

  const { data: rollup, isLoading } = trpc.projectActions.getManagerRollup.useQuery(
    { weekKey },
    { staleTime: 60_000 }
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-navy" />
            Team Action Rollup
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading rollup...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!rollup) return null;

  const noResponse = rollup.byOutcome["not_started"] ?? 0;

  return (
    <Card className="border-navy/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-navy" />
          Team Action Rollup
          <span className="text-xs font-normal text-muted-foreground ml-1">
            {rollup.weekKey} · {rollup.totalActions} action{rollup.totalActions !== 1 ? "s" : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* ── Outcome counts ── */}
        <div className="space-y-1.5">
          {ROLLUP_OUTCOMES.map((outcome) => {
            const count = rollup.byOutcome[outcome] ?? 0;
            if (count === 0) return null;
            const meta = OUTCOME_META[outcome];
            const pct = rollup.totalActions > 0 ? Math.round((count / rollup.totalActions) * 100) : 0;
            return (
              <div key={outcome} className="flex items-center gap-2">
                <OutcomeBadge outcome={outcome} size="xs" />
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${meta.bgColor.replace("bg-", "bg-").replace("border-", "")}`}
                    style={{ width: `${pct}%`, backgroundColor: "currentColor" }}
                  />
                </div>
                <span className="text-xs font-bold text-navy w-6 text-right">{count}</span>
              </div>
            );
          })}
        </div>

        {/* ── Summary stats ── */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="text-center p-2 rounded-lg bg-emerald-50 border border-emerald-200">
            <div className="text-lg font-bold text-emerald-700">{rollup.byOutcome["won"] ?? 0}</div>
            <div className="text-[9px] text-emerald-600 font-semibold uppercase tracking-wider">Won</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-blue-50 border border-blue-200">
            <div className="text-lg font-bold text-blue-700">
              {(rollup.byOutcome["contacted"] ?? 0) + (rollup.byOutcome["meeting_booked"] ?? 0) + (rollup.byOutcome["proposal_sent"] ?? 0)}
            </div>
            <div className="text-[9px] text-blue-600 font-semibold uppercase tracking-wider">Active</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-lg font-bold text-slate-600">{noResponse}</div>
            <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">No Response</div>
          </div>
        </div>

        <Separator />

        {/* ── Rep breakdown ── */}
        {rollup.byRep.length > 0 && (
          <div>
            <button
              onClick={() => setShowRepBreakdown(!showRepBreakdown)}
              className="flex items-center gap-1.5 text-xs font-semibold text-navy hover:text-gold-dark transition-colors w-full"
            >
              <Users className="w-3.5 h-3.5" />
              By Rep ({rollup.byRep.length})
              {showRepBreakdown ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
            </button>
            {showRepBreakdown && (
              <div className="mt-2 space-y-2">
                {rollup.byRep
                  .sort((a, b) => b.count - a.count)
                  .map((rep) => (
                    <div key={rep.userId} className="p-2 rounded-lg bg-slate-50 border border-border">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-navy">{rep.userName ?? `Rep #${rep.userId}`}</span>
                        <span className="text-xs text-muted-foreground">{rep.count} action{rep.count !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(rep.byOutcome).map(([outcome, count]) => (
                          <span key={outcome} className="text-[9px] text-muted-foreground">
                            {OUTCOME_META[outcome as OutcomeCode]?.label ?? outcome}: <strong>{count as number}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* ── Lane breakdown ── */}
        {Object.keys(rollup.byLane).length > 0 && (
          <div>
            <button
              onClick={() => setShowLaneBreakdown(!showLaneBreakdown)}
              className="flex items-center gap-1.5 text-xs font-semibold text-navy hover:text-gold-dark transition-colors w-full"
            >
              <Layers className="w-3.5 h-3.5" />
              By PT Lane
              {showLaneBreakdown ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
            </button>
            {showLaneBreakdown && (
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(rollup.byLane)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .map(([lane, count]) => (
                    <div key={lane} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-card border border-border">
                      <span className={`text-xs font-semibold ${LANE_COLORS[lane] ?? "text-navy"}`}>
                        {LANE_LABELS[lane] ?? lane}
                      </span>
                      <span className="text-xs text-muted-foreground">{count as number}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
