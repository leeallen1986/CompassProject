import { Link } from "wouter";
import {
  AlertCircle,
  Bot,
  Check,
  Clock3,
  ExternalLink,
  Loader2,
  Target,
  X,
} from "lucide-react";
import {
  confidenceClass,
  dispositionClass,
  formatActivationDate,
  recommendationStatusLabel,
  type DailyActivationDecision,
  type DailyRecommendation,
  type GroundedAiBrief,
} from "@/lib/fullPotentialDailyActivation";
import GroundedBrief from "./GroundedBrief";
import ResponseEditor, { type RecommendationResponseInput } from "./ResponseEditor";

function productLabel(value: string | null): string {
  if (!value) return "Product family not yet evidenced";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, character => character.toUpperCase());
}

function sourceLabel(value: string): string {
  return value === "fp_signal"
    ? "FP signal"
    : value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

export default function RecommendationCard({
  recommendation,
  responseBusy,
  briefBusy,
  brief,
  responseOpen,
  onOpenResponse,
  onCloseResponse,
  onRespond,
  onGenerateBrief,
}: {
  recommendation: DailyRecommendation;
  responseBusy: boolean;
  briefBusy: boolean;
  brief: GroundedAiBrief | null;
  responseOpen: DailyActivationDecision | null;
  onOpenResponse: (decision: DailyActivationDecision) => void;
  onCloseResponse: () => void;
  onRespond: (input: RecommendationResponseInput) => void;
  onGenerateBrief: () => void;
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/full-potential?search=${encodeURIComponent(recommendation.accountName)}`}
            className="block truncate text-sm font-bold text-navy hover:text-gold-dark hover:underline"
          >
            {recommendation.accountName}
          </Link>
          <div className="mt-1 flex flex-wrap gap-1 text-[9px] font-bold">
            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-slate-600">
              {recommendation.priorityTier.replace(/_/g, " ")}
            </span>
            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-slate-600">
              {recommendation.routeToMarket.replace(/_/g, " ")}
            </span>
            <span className={`rounded border px-1.5 py-0.5 ${confidenceClass(recommendation.confidence)}`}>
              {recommendation.confidence}
            </span>
            <span className={`rounded border px-1.5 py-0.5 ${dispositionClass(recommendation.disposition)}`}>
              {recommendationStatusLabel(recommendation.disposition)}
            </span>
          </div>
        </div>
        <span
          className="rounded-full bg-navy px-2 py-1 text-[10px] font-bold text-white"
          title="Deterministic commercial-priority score"
        >
          {recommendation.score}
        </span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-700">{recommendation.whyNow}</p>

      <div className="mt-3 rounded-lg border border-border bg-slate-50/70 p-2.5">
        <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          Product hypothesis
        </div>
        <div className="mt-1 text-xs font-semibold text-navy">
          {productLabel(recommendation.productHypothesis.productFamily)}
        </div>
        {recommendation.productHypothesis.application && (
          <div className="mt-0.5 text-[10px] text-slate-600">
            Application: {recommendation.productHypothesis.application}
          </div>
        )}
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {recommendation.productHypothesis.rationale}
        </p>
      </div>

      <div className="mt-3 flex items-start gap-2">
        <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-dark" />
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Recommended next action
          </div>
          <p className="mt-0.5 text-xs font-medium leading-relaxed text-navy">
            {recommendation.recommendedAction}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Due {formatActivationDate(recommendation.defaultDueDate)} · {recommendation.expectedOutcome}
          </p>
        </div>
      </div>

      {recommendation.uncertainties.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-[10px] text-amber-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{recommendation.uncertainties.join(" · ")}</span>
        </div>
      )}

      {recommendation.sources.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border pt-2">
          <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Grounding
          </div>
          {recommendation.sources.slice(0, 3).map(source => (
            <div
              key={`${source.sourceType}-${source.sourceId ?? source.title}`}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
            >
              <span className="shrink-0 font-semibold text-slate-700">
                {sourceLabel(source.sourceType)}
              </span>
              <span className="min-w-0 flex-1 truncate">{source.title}</span>
              {source.sourceUrl && (
                <a
                  href={source.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto shrink-0 text-blue-600 hover:underline"
                  aria-label={`Open source for ${source.title}`}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {brief && <GroundedBrief brief={brief} />}

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
        <button
          type="button"
          disabled={briefBusy || !!brief}
          onClick={onGenerateBrief}
          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
        >
          {briefBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
          {brief ? "Brief ready" : "AI brief"}
        </button>

        {recommendation.disposition === "pending" ? (
          <>
            <button
              type="button"
              onClick={() => onOpenResponse("accepted")}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              <Check className="h-3 w-3" /> Accept / edit
            </button>
            <button
              type="button"
              onClick={() => onOpenResponse("deferred")}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-700 transition-colors hover:bg-amber-100"
            >
              <Clock3 className="h-3 w-3" /> Defer
            </button>
            <button
              type="button"
              onClick={() => onOpenResponse("rejected")}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 transition-colors hover:bg-slate-100"
            >
              <X className="h-3 w-3" /> Reject
            </button>
          </>
        ) : (
          recommendation.existingActionId && (
            <Link
              href={`/full-potential?search=${encodeURIComponent(recommendation.accountName)}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[10px] font-bold text-navy hover:bg-slate-50"
            >
              Review action #{recommendation.existingActionId}
            </Link>
          )
        )}
      </div>

      {responseOpen && (
        <ResponseEditor
          recommendation={recommendation}
          initialDecision={responseOpen}
          busy={responseBusy}
          onCancel={onCloseResponse}
          onSubmit={onRespond}
        />
      )}
    </article>
  );
}
