/**
 * PilotEnrichmentPanel
 *
 * Admin-only panel for the controlled pilot-week enrichment workflow.
 * Provides:
 *   - Shortlist count and breakdown (hot/warm/no-contact/no-email)
 *   - Build Plan button → shows per-project gating decisions
 *   - Run Dry-Run button → simulates enrichment without Apollo calls
 *   - Run Live button → executes enrichment (requires confirmation)
 *   - Per-project result table with status, credits, QA pass/fail
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Zap, FlaskConical, CheckCircle2, XCircle,
  AlertTriangle, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { toast } from "sonner";

type PlanDecision = {
  projectId: number;
  projectName: string;
  priority: "hot" | "warm" | "cold";
  productLane: string | null;
  contactCount: number;
  contactsWithEmail: number;
  hasNoContacts: boolean;
  eligible: boolean;
  reason: string;
  estimatedCredits: number;
  hardBlocked: boolean;
  softSkipped: boolean;
};

type RunResult = {
  projectId: number;
  projectName: string;
  status: "enriched" | "skipped" | "failed" | "dry_run";
  contactsAdded: number;
  creditsUsed: number;
  qaPassCount: number;
  qaFailCount: number;
  sendReadyCount: number;
  error?: string;
};

const PRIORITY_BADGE: Record<string, string> = {
  hot: "bg-red-500 text-white",
  warm: "bg-amber-400 text-navy",
  cold: "bg-slate-400 text-white",
};

const STATUS_BADGE: Record<string, string> = {
  enriched: "bg-teal/20 text-teal border-teal/30",
  dry_run: "bg-blue-100 text-blue-700 border-blue-200",
  skipped: "bg-slate-100 text-slate-500 border-slate-200",
  failed: "bg-red-100 text-red-600 border-red-200",
};

export default function PilotEnrichmentPanel() {
  const [showPlan, setShowPlan] = useState(false);
  const [runResult, setRunResult] = useState<{
    dryRun: boolean;
    summary: {
      projectsAttempted: number;
      projectsEnriched: number;
      projectsFailed: number;
      projectsSkipped: number;
      totalContactsAdded: number;
      totalCreditsUsed: number;
      totalSendReady: number;
      noContactProjects: number;
    };
    results: RunResult[];
    weekKey: string;
    elapsedMs: number;
  } | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);

  // Shortlist query
  const { data: shortlist, isLoading: shortlistLoading } =
    trpc.pilotEnrichment.getShortlist.useQuery(undefined, {
      refetchOnWindowFocus: false,
    });

  // Plan query (only when showPlan is true)
  const { data: plan, isLoading: planLoading, refetch: refetchPlan } =
    trpc.pilotEnrichment.buildPlan.useQuery(undefined, {
      enabled: showPlan,
      refetchOnWindowFocus: false,
    });

  // Run mutation
  const runMutation = trpc.pilotEnrichment.runEnrichment.useMutation({
    onSuccess: (data) => {
      setRunResult(data as typeof runResult);
      setConfirmLive(false);
      if (data.dryRun) {
        toast.success(`Dry-run complete: ${data.summary.projectsAttempted} projects evaluated, ~${data.plan.estimatedTotalCredits} credits estimated`);
      } else {
        toast.success(`Live enrichment complete: ${data.summary.projectsEnriched} projects enriched, ${data.summary.totalContactsAdded} contacts added`);
      }
    },
    onError: (e) => {
      toast.error(`Enrichment run failed: ${e.message}`);
      setConfirmLive(false);
    },
  });

  const handleDryRun = () => {
    runMutation.mutate({ dryRun: true });
  };

  const handleLiveRun = () => {
    if (!confirmLive) {
      setConfirmLive(true);
      return;
    }
    runMutation.mutate({ dryRun: false });
  };

  return (
    <div className="bg-card rounded-lg border border-blue-200 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-navy flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-blue-600" />
            Pilot-Week Enrichment Run
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Controlled enrichment pass over the current Monday digest shortlist.
            Dry-run mode evaluates eligibility without calling Apollo.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            Shortlist
          </span>
          {shortlistLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : (
            <span className="text-lg font-bold text-navy">{shortlist?.total ?? "—"}</span>
          )}
        </div>
      </div>

      {/* Shortlist KPIs */}
      {shortlist && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Hot", value: shortlist.hotCount, color: "text-red-500" },
            { label: "Warm", value: shortlist.warmCount, color: "text-amber-500" },
            { label: "No Contact", value: shortlist.noContactCount, color: "text-orange-500" },
            { label: "No Email", value: shortlist.noEmailCount, color: "text-slate-500" },
          ].map(kpi => (
            <div key={kpi.label} className="bg-slate-50 rounded-lg border border-border p-2 text-center">
              <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Build Plan toggle */}
      <div>
        <button
          className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 transition-colors"
          onClick={() => {
            setShowPlan(v => !v);
            if (!showPlan) refetchPlan();
          }}
        >
          {showPlan ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showPlan ? "Hide" : "Show"} Enrichment Plan
        </button>

        {showPlan && (
          <div className="mt-3 space-y-3">
            {planLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Building plan…
              </div>
            ) : plan ? (
              <>
                {/* Plan summary */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                  {[
                    { label: "Eligible", value: plan.eligible, color: "text-teal" },
                    { label: "Hard Blocked", value: plan.hardBlocked, color: "text-red-500" },
                    { label: "Soft Skipped", value: plan.softSkipped, color: "text-slate-400" },
                    { label: "To Enrich", value: plan.toEnrich.length, color: "text-blue-600" },
                    { label: "Est. Credits", value: plan.estimatedTotalCredits, color: "text-amber-600" },
                    { label: "Daily Left", value: plan.creditBudget.dailyRemaining, color: plan.creditBudget.withinBudget ? "text-teal" : "text-red-500" },
                  ].map(kpi => (
                    <div key={kpi.label} className="bg-slate-50 rounded border border-border p-2">
                      <div className={`text-base font-bold ${kpi.color}`}>{kpi.value}</div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{kpi.label}</div>
                    </div>
                  ))}
                </div>

                {plan.budgetInsufficient && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg border border-red-200 px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Budget insufficient — enrichment would be skipped. Check Apollo credit balance.
                  </div>
                )}

                {/* Per-project decisions table */}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-navy text-white">
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Project</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Priority</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Lane</th>
                        <th className="text-center px-3 py-2 font-semibold uppercase tracking-wider">Contacts</th>
                        <th className="text-center px-3 py-2 font-semibold uppercase tracking-wider">w/ Email</th>
                        <th className="text-center px-3 py-2 font-semibold uppercase tracking-wider">Est. Credits</th>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(plan.decisions as PlanDecision[]).map((d, i) => (
                        <tr key={d.projectId} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50/50"}`}>
                          <td className="px-3 py-2 font-medium text-navy max-w-[200px] truncate" title={d.projectName}>
                            {d.projectName}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${PRIORITY_BADGE[d.priority] ?? ""}`}>
                              {d.priority}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{d.productLane ?? "—"}</td>
                          <td className="px-3 py-2 text-center">{d.contactCount}</td>
                          <td className="px-3 py-2 text-center">{d.contactsWithEmail}</td>
                          <td className="px-3 py-2 text-center">
                            {d.eligible ? (
                              <span className="font-semibold text-amber-600">{d.estimatedCredits}</span>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              {d.eligible ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-teal shrink-0" />
                              ) : d.hardBlocked ? (
                                <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                              ) : (
                                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              )}
                              <span className="text-[10px] text-muted-foreground truncate max-w-[160px]" title={d.reason}>
                                {d.reason}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
          onClick={handleDryRun}
          disabled={runMutation.isPending}
        >
          {runMutation.isPending && runMutation.variables?.dryRun ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
          ) : (
            <FlaskConical className="w-3.5 h-3.5 mr-1.5" />
          )}
          Dry-Run Preview
        </Button>

        {!confirmLive ? (
          <Button
            size="sm"
            className="text-xs bg-amber-500 hover:bg-amber-600 text-white"
            onClick={handleLiveRun}
            disabled={runMutation.isPending}
          >
            <Zap className="w-3.5 h-3.5 mr-1.5" />
            Run Live Enrichment
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-600 font-semibold">Confirm live Apollo call?</span>
            <Button
              size="sm"
              className="text-xs bg-red-500 hover:bg-red-600 text-white"
              onClick={handleLiveRun}
              disabled={runMutation.isPending}
            >
              {runMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : null}
              Yes, Run Live
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => setConfirmLive(false)}
              disabled={runMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Run results */}
      {runResult && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal" />
            <span className="text-xs font-bold text-navy">
              {runResult.dryRun ? "Dry-Run" : "Live"} Result — Week {runResult.weekKey}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">{runResult.elapsedMs}ms</span>
          </div>

          {/* Summary KPIs */}
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 text-center">
            {[
              { label: "Attempted", value: runResult.summary.projectsAttempted },
              { label: "Enriched", value: runResult.summary.projectsEnriched, color: "text-teal" },
              { label: "Failed", value: runResult.summary.projectsFailed, color: "text-red-500" },
              { label: "Skipped", value: runResult.summary.projectsSkipped, color: "text-slate-400" },
              { label: "Contacts Added", value: runResult.summary.totalContactsAdded, color: "text-blue-600" },
              { label: "Credits Used", value: runResult.summary.totalCreditsUsed, color: "text-amber-600" },
              { label: "Send Ready", value: runResult.summary.totalSendReady, color: "text-teal" },
            ].map(kpi => (
              <div key={kpi.label} className="bg-slate-50 rounded border border-border p-2">
                <div className={`text-base font-bold ${kpi.color ?? "text-navy"}`}>{kpi.value}</div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{kpi.label}</div>
              </div>
            ))}
          </div>

          {/* Per-project results */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-600">
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Project</th>
                  <th className="text-center px-3 py-2 font-semibold uppercase tracking-wider">Status</th>
                  <th className="text-center px-3 py-2 font-semibold uppercase tracking-wider">Added</th>
                  <th className="text-center px-3 py-2 font-semibold uppercase tracking-wider">Credits</th>
                  <th className="text-center px-3 py-2 font-semibold uppercase tracking-wider">QA Pass</th>
                  <th className="text-center px-3 py-2 font-semibold uppercase tracking-wider">Send Ready</th>
                </tr>
              </thead>
              <tbody>
                {runResult.results.map((r, i) => (
                  <tr key={r.projectId} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50/50"}`}>
                    <td className="px-3 py-2 font-medium text-navy max-w-[200px] truncate" title={r.projectName}>
                      {r.projectName}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase ${STATUS_BADGE[r.status] ?? ""}`}>
                        {r.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">{r.contactsAdded || "—"}</td>
                    <td className="px-3 py-2 text-center">{r.creditsUsed || "—"}</td>
                    <td className="px-3 py-2 text-center">
                      {r.qaPassCount > 0 ? (
                        <span className="text-teal font-semibold">{r.qaPassCount}</span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.sendReadyCount > 0 ? (
                        <span className="text-teal font-semibold">{r.sendReadyCount}</span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
