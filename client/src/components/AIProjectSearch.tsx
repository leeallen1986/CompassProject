/**
 * AI Project Search — LLM-powered project matching for sales teams.
 * Sales reps type in keywords/products (e.g., "N2 solutions", "dewatering pumps")
 * and the AI finds and ranks the best matching projects with sales angles.
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import {
  Search, Sparkles, Loader2, Target, MapPin, Building,
  ChevronDown, ChevronUp, Users, ArrowRight, Lightbulb,
  Flame, Zap, Package, TrendingUp, ExternalLink
} from "lucide-react";
import { toast } from "sonner";

// ── Types matching backend ──
interface MatchedProject {
  projectId: number;
  name: string;
  location: string;
  value: string;
  owner: string;
  priority: "hot" | "warm" | "cold";
  sector: string;
  stage: string;
  overview: string;
  relevanceScore: number;
  salesAngle: string;
  suggestedApproach: string;
  matchedProducts: string[];
  contactCount: number;
  topContact?: { name: string; title: string; company: string };
}

interface MatchResult {
  query: string;
  totalProjectsSearched: number;
  preFilteredCount: number;
  matches: MatchedProject[];
  searchInsight: string;
  suggestedKeywords: string[];
}

// ── Quick search suggestions ──
const QUICK_SEARCHES = [
  { label: "N2 Solutions", query: "nitrogen N2 generation" },
  { label: "Drilling Compressors", query: "drilling compressor RC blast hole" },
  { label: "BESS / Hybrid Power", query: "battery energy storage hybrid solar" },
  { label: "Dewatering Pumps", query: "dewatering pump submersible" },
  { label: "Power Generators", query: "generator power remote mining" },
  { label: "Lighting Towers", query: "lighting tower construction mining" },
  { label: "Tunnelling", query: "tunnelling shotcrete underground" },
  { label: "Infrastructure", query: "infrastructure construction road rail" },
];

// ── Relevance Score Badge ──
function RelevanceBadge({ score }: { score: number }) {
  const color = score >= 80 ? "bg-hot text-white" :
    score >= 60 ? "bg-gold text-navy" :
    score >= 40 ? "bg-teal text-white" :
    "bg-slate-200 text-slate-700";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
      <Target className="w-3 h-3" />
      {score}%
    </span>
  );
}

// ── Priority Badge ──
function PriorityBadge({ priority }: { priority: string }) {
  const cls = priority === "hot" ? "bg-hot text-white" :
    priority === "warm" ? "bg-warm text-navy" :
    "bg-cold text-white";
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${cls}`}>
      {priority}
    </span>
  );
}

// ── Sector Label ──
const sectorLabels: Record<string, string> = {
  mining: "Mining", oil_gas: "Oil & Gas", infrastructure: "Infrastructure",
  energy: "Energy", defence: "Defence",
};

// ── Result Card ──
function ResultCard({ match, rank, onNavigateToProject }: { match: MatchedProject; rank: number; onNavigateToProject?: (projectId: number) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card rounded-lg border border-border hover:border-gold/40 hover:shadow-md transition-all">
      {/* Header */}
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="shrink-0 w-8 h-8 rounded-full bg-navy text-white text-sm font-bold flex items-center justify-center">
              {rank}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-navy text-sm truncate">{match.name}</h3>
                <PriorityBadge priority={match.priority} />
                <RelevanceBadge score={match.relevanceScore} />
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{match.location}</span>
                <span className="flex items-center gap-1"><Building className="w-3 h-3" />{match.owner}</span>
                <span className="text-gold font-semibold">{match.value}</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-medium">{sectorLabels[match.sector] || match.sector}</span>
              </div>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {match.contactCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-teal font-medium">
                <Users className="w-3 h-3" />{match.contactCount}
              </span>
            )}
            {onNavigateToProject && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToProject(match.projectId);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-navy bg-gold/20 hover:bg-gold/40 border border-gold/30 transition-colors"
                title="View full project details"
              >
                <ExternalLink className="w-3 h-3" /> View
              </button>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>

        {/* Sales Angle — always visible */}
        <div className="mt-2 ml-11">
          <p className="text-sm text-foreground/80 leading-relaxed">
            <Sparkles className="w-3.5 h-3.5 inline text-gold mr-1" />
            {match.salesAngle}
          </p>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 ml-11 space-y-3">
          {/* Suggested Approach */}
          <div className="bg-gold/8 border border-gold/20 rounded-lg p-3">
            <h4 className="text-xs font-bold text-gold-dark uppercase tracking-wider mb-1 flex items-center gap-1">
              <ArrowRight className="w-3 h-3" /> Suggested Approach
            </h4>
            <p className="text-sm text-foreground/80">{match.suggestedApproach}</p>
          </div>

          {/* Matched Products */}
          {match.matchedProducts.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-navy uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Package className="w-3 h-3" /> Recommended Products
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {match.matchedProducts.map((product, i) => (
                  <span key={i} className="px-2 py-1 rounded-md bg-teal/10 text-teal text-xs font-medium border border-teal/20">
                    {product}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Project Overview */}
          {match.overview && (
            <div>
              <h4 className="text-xs font-bold text-navy uppercase tracking-wider mb-1">Project Overview</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{match.overview.slice(0, 300)}{match.overview.length > 300 ? "..." : ""}</p>
            </div>
          )}

          {/* Top Contact */}
          {match.topContact && (
            <div className="flex items-center gap-2 text-xs">
              <Users className="w-3 h-3 text-teal" />
              <span className="font-medium text-navy">{match.topContact.name}</span>
              <span className="text-muted-foreground">— {match.topContact.title} at {match.topContact.company}</span>
            </div>
          )}

          {/* Stage + View Project */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span><strong className="text-navy">Stage:</strong> {match.stage}</span>
              <span><strong className="text-navy">Sector:</strong> {sectorLabels[match.sector] || match.sector}</span>
            </div>
            {onNavigateToProject && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToProject(match.projectId);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-semibold hover:bg-navy-light transition-colors"
              >
                <ExternalLink className="w-3 h-3" /> View Full Project
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──
export default function AIProjectSearch({ onNavigateToProject }: { onNavigateToProject?: (projectId: number) => void } = {}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MatchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchMutation = trpc.search.projects.useMutation({
    onSuccess: (data) => {
      setResult(data as MatchResult);
      if ((data as MatchResult).matches.length === 0) {
        toast.info("No matching projects found. Try different keywords.");
      }
    },
    onError: (err) => {
      toast.error(`Search failed: ${err.message}`);
    },
  });

  const handleSearch = (searchQuery?: string) => {
    const q = (searchQuery || query).trim();
    if (q.length < 2) {
      toast.warning("Please enter at least 2 characters");
      return;
    }
    if (searchQuery) setQuery(searchQuery);
    searchMutation.mutate({ query: q });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="space-y-5">
      {/* Search Header */}
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-gold" />
          <h2 className="text-lg font-bold text-navy">AI Project Finder</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Enter keywords, products, or solutions you're pushing — the AI will find and rank the best matching projects with sales angles and recommended products.
        </p>

        {/* Search Input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              placeholder='Try "N2 solutions", "dewatering pumps", "blast hole drilling"...'
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full pl-9 pr-4 py-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold transition-all"
              disabled={searchMutation.isPending}
            />
          </div>
          <button
            onClick={() => handleSearch()}
            disabled={searchMutation.isPending || query.trim().length < 2}
            className="px-5 py-3 rounded-lg bg-navy text-white text-sm font-semibold hover:bg-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {searchMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Searching...</>
            ) : (
              <><Zap className="w-4 h-4" /> Search</>
            )}
          </button>
        </div>

        {/* Quick Searches */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Quick:</span>
          {QUICK_SEARCHES.map(qs => (
            <button
              key={qs.label}
              onClick={() => handleSearch(qs.query)}
              disabled={searchMutation.isPending}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-gold/15 hover:text-navy transition-colors disabled:opacity-50"
            >
              {qs.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {searchMutation.isPending && (
        <div className="bg-card rounded-lg border border-border p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gold mx-auto mb-3" />
          <p className="text-sm font-medium text-navy">Analyzing {query}...</p>
          <p className="text-xs text-muted-foreground mt-1">Pre-filtering projects, then running AI analysis for best matches</p>
        </div>
      )}

      {/* Results */}
      {result && !searchMutation.isPending && (
        <div className="space-y-4">
          {/* Search Insight */}
          <div className="bg-gold/8 border border-gold/25 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Lightbulb className="w-4 h-4 text-gold-dark shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-gold-dark mb-1">Market Insight</h3>
                <p className="text-sm text-foreground/80 leading-relaxed">{result.searchInsight}</p>
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>
              <strong className="text-navy">{result.matches.length}</strong> matches from{" "}
              <strong className="text-navy">{result.preFilteredCount}</strong> pre-filtered /{" "}
              <strong className="text-navy">{result.totalProjectsSearched}</strong> total projects
            </span>
            {result.suggestedKeywords.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider font-medium">Also try:</span>
                {result.suggestedKeywords.slice(0, 4).map(kw => (
                  <button
                    key={kw}
                    onClick={() => handleSearch(kw)}
                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-teal/10 text-teal hover:bg-teal/20 transition-colors"
                  >
                    {kw}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Result Cards */}
          {result.matches.length > 0 ? (
            <div className="space-y-3">
              {result.matches.map((match, i) => (
                <ResultCard key={match.projectId} match={match} rank={i + 1} onNavigateToProject={onNavigateToProject} />
              ))}
            </div>
          ) : (
            <div className="bg-card rounded-lg border border-border p-8 text-center">
              <Search className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-navy">No matching projects found</p>
              <p className="text-xs text-muted-foreground mt-1">Try different keywords or check the quick search suggestions above</p>
            </div>
          )}
        </div>
      )}

      {/* Empty State — before any search */}
      {!result && !searchMutation.isPending && (
        <div className="bg-card rounded-lg border border-border p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-gold/15 flex items-center justify-center mx-auto mb-3">
            <TrendingUp className="w-6 h-6 text-gold" />
          </div>
          <h3 className="text-sm font-bold text-navy mb-1">Find Your Next Opportunity</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Enter the products or solutions you're currently pushing, and the AI will match you with the most relevant projects from our database of 500+ opportunities.
          </p>
        </div>
      )}
    </div>
  );
}
