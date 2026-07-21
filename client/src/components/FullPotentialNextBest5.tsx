import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  Bot,
  Building2,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

type Recommendation = {
  rank: number;
  serverPosition: number;
  projectId: number;
  projectName: string;
  projectState: string | null;
  location: string;
  relevanceScore: number;
  accountId: number;
  accountName: string;
  candidateName: string;
  candidateRole: string;
  certainty: "confirmed" | "likely_high" | "likely_medium";
  ownerName: string | null;
  channelOwner: string | null;
  routeToMarket: string | null;
  whyNow: string;
  supportingEvidence: string[];
  uncertainties: string[];
  productHypothesis: { label: string; application: string; confidence: "high" | "medium" };
  recommendedAction: string;
  expectedOutcome: string;
  sources: Array<{ label: string; url: string | null; date: string | null }>;
  projectHref: string;
  accountHref: string;
};

type ResponseBody = {
  readOnly: true;
  candidatePoolSize: number;
  eligibleCount: number;
  recommendations: Recommendation[];
  crmBoundary: string;
  userContext: { scopeResolved: boolean; scopeIssue: string | null };
};

function label(value: string | null | undefined) {
  return value
    ? value.replace(/_/g, " ").replace(/\b\w/g, character => character.toUpperCase())
    : "—";
}

function certaintyClass(value: Recommendation["certainty"]) {
  if (value === "confirmed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "likely_high") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
          {recommendation.rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={recommendation.projectHref} className="block truncate text-sm font-bold text-navy hover:text-gold-dark hover:underline">
                {recommendation.projectName}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span>{recommendation.projectState || recommendation.location}</span>
                <span>·</span>
                <span>Server rank {recommendation.serverPosition}</span>
                <span>·</span>
                <span>Relevance {recommendation.relevanceScore}</span>
              </div>
            </div>
            <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-1 text-[10px] font-bold text-gold-dark">
              {recommendation.productHypothesis.label}
            </span>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-slate-500" />
              <Link href={recommendation.accountHref} className="text-xs font-bold text-navy hover:text-gold-dark hover:underline">
                {recommendation.accountName}
              </Link>
              <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${certaintyClass(recommendation.certainty)}`}>
                {label(recommendation.certainty)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {label(recommendation.candidateRole)} · {label(recommendation.routeToMarket)}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Owner: {recommendation.ownerName || recommendation.channelOwner || "Not confirmed"}
            </div>
          </div>

          <div className="mt-3">
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Why now</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">{recommendation.whyNow}</p>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Grounded evidence</div>
              <ul className="mt-1 space-y-1 text-[10px] leading-relaxed text-slate-600">
                {recommendation.supportingEvidence.slice(0, 3).map(item => (
                  <li key={item} className="flex gap-1.5">
                    <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">What remains uncertain</div>
              {recommendation.uncertainties.length > 0 ? (
                <ul className="mt-1 space-y-1 text-[10px] leading-relaxed text-amber-800">
                  {recommendation.uncertainties.slice(0, 3).map(item => (
                    <li key={item} className="flex gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[10px] text-emerald-700">Buying route is confirmed; validate the customer need and timing.</p>
              )}
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-3">
            <div className="flex items-start gap-2">
              <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-dark" />
              <div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-gold-dark">Recommended evidence-generating action</div>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-navy">{recommendation.recommendedAction}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{recommendation.expectedOutcome}</p>
              </div>
            </div>
          </div>

          {recommendation.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Sources</span>
              {recommendation.sources.map(source => source.url ? (
                <a key={`${source.label}-${source.url}`} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-semibold text-blue-700 hover:bg-blue-50">
                  {source.label}<ExternalLink className="h-2.5 w-2.5" />
                </a>
              ) : null)}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function FullPotentialNextBest5() {
  const { isAuthenticated, user } = useAuth();
  const [data, setData] = useState<ResponseBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!isAuthenticated || !user || user.role === "distributor") return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/full-potential/next-best-5", {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Next Best 5 could not be loaded");
      setData(payload as ResponseBody);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Next Best 5 could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // The endpoint is read-only and follows the This Week cache window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id, user?.role]);

  if (!isAuthenticated || user?.role === "distributor") return null;

  return (
    <section aria-labelledby="next-best-5-heading" className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/80 via-card to-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-100 px-2.5 py-1 text-[10px] font-bold text-blue-800">
            <Bot className="h-3 w-3" /> Read-only intelligence pilot
          </div>
          <h2 id="next-best-5-heading" className="mt-2 flex items-center gap-2 text-lg font-bold text-navy">
            <Sparkles className="h-5 w-5 text-gold-dark" /> Next Best 5
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            The first evidence-backed projects from the exact This Week server order. No task, pursuit, forecast or CRM record is created.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-card px-3 py-2 text-[10px] font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </button>
      </div>

      {loading && !data ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-blue-100 bg-card p-4 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> Checking project evidence, buying routes and Full Potential state…
        </div>
      ) : error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><div className="font-bold">Next Best 5 unavailable</div><p className="mt-1">{error}</p></div>
        </div>
      ) : data && !data.userContext.scopeResolved ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><div className="font-bold">Profile scope must be resolved first</div><p className="mt-1">No recommendations were generated: {data.userContext.scopeIssue || "unknown issue"}.</p></div>
        </div>
      ) : data && data.recommendations.length === 0 ? (
        <div className="mt-4 rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          No current project meets the complete evidence, account-route and ownership bar. The system returns fewer than five rather than fill the list with noise.
        </div>
      ) : data ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span className="rounded-full border border-slate-200 bg-card px-2.5 py-1">{data.recommendations.length} shown</span>
            <span className="rounded-full border border-slate-200 bg-card px-2.5 py-1">{data.eligibleCount} eligible</span>
            <span className="rounded-full border border-slate-200 bg-card px-2.5 py-1">{data.candidatePoolSize} server-ranked candidates checked</span>
          </div>
          <div className="mt-4 space-y-3">
            {data.recommendations.map(recommendation => <RecommendationCard key={`${recommendation.projectId}-${recommendation.accountId}`} recommendation={recommendation} />)}
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-card/70 px-3 py-2 text-[10px] text-muted-foreground">
            <strong className="text-slate-700">CRM boundary:</strong> {data.crmBoundary}
          </div>
        </>
      ) : null}
    </section>
  );
}
