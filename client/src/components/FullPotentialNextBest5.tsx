import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  buildResponsePayload,
  dailyActivationApi,
  type DailyActivationDecision,
  type DailyActivationResponse,
  type GroundedAiBrief,
} from "@/lib/fullPotentialDailyActivation";
import RecommendationCard from "./fullPotentialDaily/RecommendationCard";
import ManagerRollup from "./fullPotentialDaily/ManagerRollup";
import type { RecommendationResponseInput } from "./fullPotentialDaily/ResponseEditor";

export default function FullPotentialNextBest5() {
  const { isAuthenticated, user } = useAuth();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= 1024,
  );
  const [tab, setTab] = useState<"recommendations" | "manager">("recommendations");
  const [data, setData] = useState<DailyActivationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [responseOpen, setResponseOpen] = useState<Record<string, DailyActivationDecision | null>>({});
  const [responseBusy, setResponseBusy] = useState<string | null>(null);
  const [briefBusy, setBriefBusy] = useState<number | null>(null);
  const [briefs, setBriefs] = useState<Record<number, GroundedAiBrief>>({});

  const isAdmin = user?.role === "admin";

  async function load() {
    if (!isAuthenticated || user?.role === "distributor") return;
    setLoading(true);
    setError("");
    try {
      setData(await dailyActivationApi.load());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load Full Potential recommendations",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [isAuthenticated, user?.id, user?.role]);

  const pendingCount =
    data?.recommendations.filter(item => item.disposition === "pending").length ?? 0;
  const totalCount = data?.recommendations.length ?? 0;
  const generatedLabel = useMemo(
    () => data
      ? new Date(data.generatedAt).toLocaleTimeString("en-AU", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    [data],
  );

  async function respond(
    recommendationKey: string,
    recommendation: NonNullable<DailyActivationResponse["recommendations"]>[number],
    input: RecommendationResponseInput,
  ) {
    setResponseBusy(recommendationKey);
    try {
      const result = await dailyActivationApi.respond(
        buildResponsePayload(
          recommendation,
          input.decision,
          input.actionText,
          input.dueDate,
          input.reason,
        ),
      );
      toast.success(
        result.alreadyExists
          ? "This recommendation was already dispositioned"
          : "Full Potential decision recorded",
      );
      setResponseOpen(current => ({ ...current, [recommendationKey]: null }));
      await Promise.all([
        load(),
        utils.fullPotential.myWeekActions.invalidate(),
      ]);
    } catch (responseError) {
      toast.error(
        responseError instanceof Error
          ? responseError.message
          : "Could not record recommendation decision",
      );
    } finally {
      setResponseBusy(null);
    }
  }

  async function generateBrief(accountId: number) {
    setBriefBusy(accountId);
    try {
      const brief = await dailyActivationApi.brief(accountId);
      setBriefs(current => ({ ...current, [accountId]: brief }));
      if (brief.generatedBy === "deterministic_fallback") {
        toast.info("AI service unavailable; showing the safe grounded brief");
      }
    } catch (briefError) {
      toast.error(
        briefError instanceof Error
          ? briefError.message
          : "Could not generate the grounded brief",
      );
    } finally {
      setBriefBusy(null);
    }
  }

  if (!isAuthenticated || user?.role === "distributor") return null;

  return (
    <div className="fixed bottom-20 left-4 z-40 w-[440px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-2xl lg:bottom-4">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center gap-3 bg-navy px-4 py-3 text-left text-white transition-colors hover:bg-navy-light"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">AI Next Best 5</div>
          <div className="text-[11px] text-slate-300">
            {loading
              ? "Ranking grounded account actions…"
              : `${pendingCount} pending · ${totalCount} shown${generatedLabel ? ` · ${generatedLabel}` : ""}`}
          </div>
        </div>
        {pendingCount > 0 && (
          <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-navy">
            {pendingCount}
          </span>
        )}
        {open
          ? <ChevronDown className="h-4 w-4 text-slate-300" />
          : <ChevronUp className="h-4 w-4 text-slate-300" />}
      </button>

      {open && (
        <div className="max-h-[72vh] overflow-y-auto p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setTab("recommendations")}
                className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${
                  tab === "recommendations"
                    ? "bg-card text-navy shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                My 5
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setTab("manager")}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${
                    tab === "manager"
                      ? "bg-card text-navy shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  Manager
                </button>
              )}
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void load()}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-navy"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {error}
            </div>
          ) : loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading recommendations…
            </div>
          ) : data && tab === "manager" && isAdmin ? (
            <ManagerRollup data={data} />
          ) : data?.recommendations.length ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-gold/30 bg-gold/10 p-3 text-[10px] leading-relaxed text-navy">
                <div className="flex items-center gap-1.5 font-bold">
                  <ShieldCheck className="h-3.5 w-3.5" /> Intelligence boundary
                </div>
                <p className="mt-1 text-muted-foreground">
                  Compass explains why to act and records the next evidence-generating commitment. It does not approve value or replace C4C.
                </p>
              </div>

              {data.recommendations.map(recommendation => (
                <RecommendationCard
                  key={recommendation.recommendationKey}
                  recommendation={recommendation}
                  responseBusy={responseBusy === recommendation.recommendationKey}
                  briefBusy={briefBusy === recommendation.accountId}
                  brief={briefs[recommendation.accountId] ?? null}
                  responseOpen={responseOpen[recommendation.recommendationKey] ?? null}
                  onOpenResponse={decision =>
                    setResponseOpen(current => ({
                      ...current,
                      [recommendation.recommendationKey]: decision,
                    }))
                  }
                  onCloseResponse={() =>
                    setResponseOpen(current => ({
                      ...current,
                      [recommendation.recommendationKey]: null,
                    }))
                  }
                  onRespond={input =>
                    void respond(
                      recommendation.recommendationKey,
                      recommendation,
                      input,
                    )
                  }
                  onGenerateBrief={() => void generateBrief(recommendation.accountId)}
                />
              ))}

              <Link
                href="/full-potential/pilot"
                className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-navy transition-colors hover:bg-slate-200"
              >
                Open top-five activation cockpit
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-slate-50/60 p-4 text-xs text-muted-foreground">
              No grounded Full Potential recommendations are available for your assigned accounts. Check account ownership or review the Full Potential universe.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
