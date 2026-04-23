/**
 * Account Attack Phase 2 — AI Research Panel
 *
 * Bounded AI synthesis over Atlas internal context.
 * Three output panels: Stakeholder Map, Sales Brief, Recommended Actions.
 * All evidence-linked. All source-tagged.
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Streamdown } from "streamdown";
import {
  Sparkles, Loader2, ChevronDown, ChevronUp, ChevronRight,
  AlertTriangle, CheckCircle2, Shield, Users, FileText,
  Target, ArrowRight, ExternalLink, Mail, Linkedin,
  Clock, Eye, Info, RefreshCw, Zap, Brain, BookOpen,
  UserCheck, UserX, HelpCircle, Star, AlertCircle,
} from "lucide-react";

// ── Types ──
type LensMode = "focused" | "balanced" | "open";

interface AccountResearchPanelProps {
  accountName: string;
  accountData: any;
  lensMode: LensMode;
  userLane: string | null;
  primaryLaneLabel: string;
}

// ── Objective options ──
const OBJECTIVES = [
  { key: "general_account_review", label: "General Account Review", desc: "Full synthesis of account intelligence", icon: BookOpen },
  { key: "new_logo", label: "New Logo Pursuit", desc: "First engagement strategy", icon: Star },
  { key: "grow_installed_base", label: "Grow Installed Base", desc: "Expand within existing account", icon: Target },
  { key: "displace_competitor", label: "Displace Competitor", desc: "Competitive displacement angles", icon: Shield },
  { key: "pursue_live_tender", label: "Pursue Live Tender", desc: "Tender-specific preparation", icon: Zap },
  { key: "map_stakeholders", label: "Map Stakeholders", desc: "Buying committee analysis", icon: Users },
  { key: "prepare_account_review", label: "Prepare Account Review", desc: "Internal review preparation", icon: FileText },
];

const DEPTH_OPTIONS = [
  { key: "quick", label: "Quick", desc: "Fast overview (30s)", tokens: "~4K" },
  { key: "standard", label: "Standard", desc: "Thorough analysis (60s)", tokens: "~8K" },
  { key: "deep", label: "Deep", desc: "Comprehensive synthesis (90s)", tokens: "~16K" },
];

// ── Source tag styling ──
function sourceTagStyle(tag: string) {
  if (tag === "atlas_known") return "bg-teal/15 text-teal border-teal/30";
  if (tag === "ai_inferred") return "bg-amber-100 text-amber-700 border-amber-300";
  return "bg-slate-100 text-slate-600 border-slate-300";
}

function sourceTagLabel(tag: string) {
  if (tag === "atlas_known") return "Atlas Data";
  if (tag === "ai_inferred") return "AI Inferred";
  return "Mixed";
}

function confidenceBadge(conf: string) {
  if (conf === "high") return "bg-emerald-100 text-emerald-700";
  if (conf === "medium") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

// ══════════════════════════════════════════════════
// Main Panel
// ══════════════════════════════════════════════════
export default function AccountResearchPanel({
  accountName,
  accountData,
  lensMode,
  userLane,
  primaryLaneLabel,
}: AccountResearchPanelProps) {
  const [objective, setObjective] = useState("general_account_review");
  const [depth, setDepth] = useState<"quick" | "standard" | "deep">("quick");
  const [showObjectiveSelector, setShowObjectiveSelector] = useState(false);
  const [activeTab, setActiveTab] = useState<"stakeholders" | "brief" | "actions">("brief");
  const [expandedBriefSections, setExpandedBriefSections] = useState<Set<string>>(new Set(["accountSummary", "whyThisAccountMatters", "currentOpportunities"]));

  // ── Trigger evaluation ──
  const triggerInput = useMemo(() => ({
    accountName,
    objective,
    lensMode,
    ptLaneFocus: userLane || undefined,
    researchDepth: depth,
    stakeholderCount: accountData?.stakeholders?.length || 0,
    highRelevanceStakeholderCount: (accountData?.stakeholders || []).filter(
      (s: any) => s.roleRelevance === "high" || s.roleRelevance === "direct"
    ).length,
    opportunityCount: accountData?.opportunities?.length || 0,
    hotOpportunityCount: (accountData?.opportunities || []).filter(
      (o: any) => o.priority === "hot"
    ).length,
    hasActionHistory: (accountData?.actionHistory?.length || 0) > 0,
    hasCollateral: (accountData?.collateral?.length || 0) > 0,
    accountType: accountData?.account?.accountType || "Unknown",
    laneDistribution: accountData?.account?.laneDistribution || {},
  }), [accountName, objective, lensMode, userLane, depth, accountData]);

  const { data: triggerEval, isLoading: isEvaluating } = trpc.accountResearch.evaluateTrigger.useQuery(
    triggerInput,
    { enabled: !!accountName && !!accountData?.account }
  );

  // ── Cached result ──
  const cacheInput = useMemo(() => ({
    accountName,
    objective,
    lensMode,
    ptLaneFocus: userLane || undefined,
    researchDepth: depth,
  }), [accountName, objective, lensMode, userLane, depth]);

  const { data: cachedResult, refetch: refetchCache } = trpc.accountResearch.getCachedResult.useQuery(
    cacheInput,
    { enabled: !!accountName && !!accountData?.account }
  );

  // ── Run research mutation ──
  const runResearch = trpc.accountResearch.runResearch.useMutation({
    onSuccess: () => {
      refetchCache();
    },
  });

  const handleRunResearch = useCallback(() => {
    if (!accountData) return;
    runResearch.mutate({
      accountName,
      objective,
      lensMode,
      ptLaneFocus: userLane || undefined,
      researchDepth: depth,
      accountContext: {
        account: accountData.account,
        opportunities: accountData.opportunities || [],
        stakeholders: accountData.stakeholders || [],
        contractors: accountData.contractors || [],
        contractorPairings: accountData.contractorPairings || [],
        actionHistory: accountData.actionHistory || [],
        collateral: accountData.collateral || [],
      },
    });
  }, [accountName, objective, lensMode, userLane, depth, accountData, runResearch]);

  // ── Research state machine ──
  const isRunning = runResearch.isPending;
  const hasFailed = runResearch.data?.status === "failed" || runResearch.isError;
  const freshResult = runResearch.data?.status === "complete" ? runResearch.data : null;
  const displayResult: any = freshResult || (cachedResult?.status === "complete" ? cachedResult : null);
  const isStale = !!(cachedResult as any)?.isStale && !freshResult;

  // Auto-expand brief sections on fresh result
  useEffect(() => {
    if (displayResult) {
      setExpandedBriefSections(new Set(["accountSummary", "whyThisAccountMatters", "currentOpportunities"]));
    }
  }, [displayResult]);

  // Toggle brief section
  const toggleBriefSection = useCallback((key: string) => {
    setExpandedBriefSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Objective label ──
  const objectiveLabel = OBJECTIVES.find(o => o.key === objective)?.label || objective;

  return (
    <div className="mt-4">
      {/* ── Research Trigger Banner ── */}
      <div className="rounded-lg border border-indigo-200 bg-gradient-to-r from-indigo-50 to-slate-50 overflow-hidden">
        {/* Header bar */}
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-indigo-100 flex items-center justify-center">
              <Brain className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-navy tracking-tight">AI Research Synthesis</h3>
              <p className="text-[10px] text-muted-foreground">Bounded analysis over Atlas internal data only</p>
            </div>
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-2">
            {isRunning && (
              <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-600 border-indigo-200 animate-pulse">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Synthesising...
              </Badge>
            )}
            {displayResult && !isRunning && (
              <Badge variant="outline" className={`text-[10px] ${isStale ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"}`}>
                {isStale ? <Clock className="w-3 h-3 mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                {isStale ? "Stale — refresh available" : "Fresh result"}
              </Badge>
            )}
            {hasFailed && !isRunning && (
              <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">
                <AlertCircle className="w-3 h-3 mr-1" /> Failed
              </Badge>
            )}
          </div>
        </div>

        {/* Objective + Depth selector */}
        <div className="px-4 pb-3 flex items-end gap-3 flex-wrap">
          {/* Objective */}
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Objective</label>
            <div className="relative">
              <button
                onClick={() => setShowObjectiveSelector(v => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border bg-white text-xs font-medium text-navy hover:border-indigo-300 transition-colors"
              >
                <span className="flex items-center gap-2">
                  {(() => { const O = OBJECTIVES.find(o => o.key === objective); return O ? <O.icon className="w-3.5 h-3.5 text-indigo-500" /> : null; })()}
                  {objectiveLabel}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              {showObjectiveSelector && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-20 py-1 max-h-64 overflow-y-auto">
                  {OBJECTIVES.map(o => (
                    <button
                      key={o.key}
                      onClick={() => { setObjective(o.key); setShowObjectiveSelector(false); }}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-indigo-50 transition-colors ${objective === o.key ? "bg-indigo-50" : ""}`}
                    >
                      <o.icon className={`w-3.5 h-3.5 ${objective === o.key ? "text-indigo-600" : "text-muted-foreground"}`} />
                      <div>
                        <div className={`text-xs font-medium ${objective === o.key ? "text-indigo-700" : "text-navy"}`}>{o.label}</div>
                        <div className="text-[10px] text-muted-foreground">{o.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Depth */}
          <div className="min-w-[160px]">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Depth</label>
            <div className="flex rounded-md border border-border bg-white overflow-hidden">
              {DEPTH_OPTIONS.map(d => (
                <button
                  key={d.key}
                  onClick={() => setDepth(d.key as "quick" | "standard" | "deep")}
                  className={`flex-1 px-2.5 py-2 text-[10px] font-semibold transition-colors ${
                    depth === d.key
                      ? "bg-indigo-600 text-white"
                      : "text-muted-foreground hover:bg-indigo-50"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button
            onClick={handleRunResearch}
            disabled={isRunning}
            className="px-4 py-2 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            {isRunning ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running...</>
            ) : isStale ? (
              <><RefreshCw className="w-3.5 h-3.5" /> Refresh Research</>
            ) : displayResult ? (
              <><RefreshCw className="w-3.5 h-3.5" /> Re-run Research</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5" /> Run Research</>
            )}
          </button>
        </div>

        {/* Trigger recommendation */}
        {triggerEval && !displayResult && !isRunning && (
          <div className={`px-4 py-2.5 border-t ${triggerEval.recommended ? "border-indigo-200 bg-indigo-50/50" : "border-slate-200 bg-slate-50/50"}`}>
            <div className="flex items-start gap-2">
              {triggerEval.recommended ? (
                <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-[11px] text-navy font-medium">
                  {triggerEval.recommended ? "Research recommended" : "Research available"}
                </p>
                {triggerEval.reasons.map((r, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground mt-0.5">{r}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Error state */}
        {hasFailed && !isRunning && (
          <div className="px-4 py-2.5 border-t border-red-200 bg-red-50/50">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] text-red-700 font-medium">Research failed</p>
                <p className="text-[10px] text-red-600 mt-0.5">
                  {runResearch.data?.errorMessage || runResearch.error?.message || "An unexpected error occurred. Try again or reduce depth."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Running state */}
        {isRunning && (
          <div className="px-4 py-4 border-t border-indigo-200">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
              </div>
              <div>
                <p className="text-xs font-medium text-navy">Synthesising account intelligence...</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Analysing {accountData?.opportunities?.length || 0} opportunities, {accountData?.stakeholders?.length || 0} stakeholders, and {accountData?.contractors?.length || 0} contractors.
                  {depth === "quick" ? " ~30 seconds." : depth === "standard" ? " ~60 seconds." : " ~90 seconds."}
                </p>
              </div>
            </div>
            <div className="mt-3 h-1.5 bg-indigo-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full animate-pulse" style={{ width: "60%" }} />
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* ── Research Results ── */}
      {/* ══════════════════════════════════════════════════ */}
      {displayResult && !isRunning && (
        <div className="mt-4">
          {/* Stale banner */}
          {isStale && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <p className="text-[11px] text-amber-700">
                This research is <span className="font-semibold">stale</span> (generated {cachedResult?.createdAt ? new Date(cachedResult.createdAt).toLocaleDateString() : "previously"}).
                Click <span className="font-semibold">Refresh Research</span> for an updated synthesis.
              </p>
            </div>
          )}

          {/* Tab bar */}
          <div className="flex rounded-lg border border-border bg-white overflow-hidden mb-3">
            {[
              { key: "brief" as const, label: "Sales Brief", icon: FileText, count: null },
              { key: "stakeholders" as const, label: "Stakeholder Map", icon: Users, count: displayResult.stakeholderMap?.length || 0 },
              { key: "actions" as const, label: "Actions", icon: Target, count: displayResult.recommendedActions?.length || 0 },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-3 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  activeTab === tab.key
                    ? "bg-indigo-600 text-white"
                    : "text-muted-foreground hover:bg-indigo-50 hover:text-navy"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
                {tab.count !== null && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    activeTab === tab.key ? "bg-white/20" : "bg-slate-100"
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Sales Brief Tab ── */}
          {activeTab === "brief" && displayResult.salesBrief && (
            <SalesBriefPanel
              brief={displayResult.salesBrief}
              expandedSections={expandedBriefSections}
              toggleSection={toggleBriefSection}
            />
          )}

          {/* ── Stakeholder Map Tab ── */}
          {activeTab === "stakeholders" && (
            <StakeholderMapPanel
              stakeholders={displayResult.stakeholderMap || []}
              primaryLaneLabel={primaryLaneLabel}
            />
          )}

          {/* ── Recommended Actions Tab ── */}
          {activeTab === "actions" && (
            <RecommendedActionsPanel
              actions={displayResult.recommendedActions || []}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════
// Sales Brief Panel
// ══════════════════════════════════════════════════
const BRIEF_SECTIONS = [
  { key: "accountSummary", label: "Account Summary", icon: BookOpen },
  { key: "whyThisAccountMatters", label: "Why This Account Matters", icon: Star },
  { key: "currentOpportunities", label: "Current Opportunities", icon: Target },
  { key: "routeToBuy", label: "Route to Buy", icon: ArrowRight },
  { key: "contractorPicture", label: "Contractor Picture", icon: Users },
  { key: "ptLaneFit", label: "PT Lane Fit", icon: Zap },
  { key: "secondaryPtLaneOpportunities", label: "Secondary PT Lane Opportunities", icon: Target },
  { key: "crossSellAdjacentLane", label: "Cross-Sell / Adjacent Lane", icon: ArrowRight },
  { key: "keyRisksBlockers", label: "Key Risks & Blockers", icon: AlertTriangle },
  { key: "recommendedNextActions", label: "Recommended Next Actions", icon: CheckCircle2 },
  { key: "suggestedCollateral", label: "Suggested Collateral", icon: FileText },
];

function SalesBriefPanel({
  brief,
  expandedSections,
  toggleSection,
}: {
  brief: Record<string, { text: string; sourceTag: string; confidence: string; sourceNote: string }>;
  expandedSections: Set<string>;
  toggleSection: (key: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-white overflow-hidden divide-y divide-border">
      {BRIEF_SECTIONS.map(section => {
        const data = brief[section.key];
        if (!data) return null;
        const isExpanded = expandedSections.has(section.key);

        return (
          <div key={section.key}>
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <section.icon className="w-3.5 h-3.5 text-indigo-500" />
                <span className="text-xs font-semibold text-navy">{section.label}</span>
                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 border ${sourceTagStyle(data.sourceTag)}`}>
                  {sourceTagLabel(data.sourceTag)}
                </Badge>
                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${confidenceBadge(data.confidence)}`}>
                  {data.confidence}
                </Badge>
              </div>
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
            {isExpanded && (
              <div className="px-4 pb-3">
                <div className="text-xs text-foreground/80 leading-relaxed">
                  <Streamdown>{data.text}</Streamdown>
                </div>
                {data.sourceNote && (
                  <p className="mt-2 text-[10px] text-muted-foreground italic flex items-start gap-1">
                    <Info className="w-3 h-3 shrink-0 mt-0.5" />
                    {data.sourceNote}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════
// Stakeholder Map Panel
// ══════════════════════════════════════════════════
function StakeholderMapPanel({
  stakeholders,
  primaryLaneLabel,
}: {
  stakeholders: any[];
  primaryLaneLabel: string;
}) {
  const [filter, setFilter] = useState<"all" | "atlas_known" | "ai_inferred">("all");

  const filtered = useMemo(() => {
    if (filter === "all") return stakeholders;
    return stakeholders.filter(s => s.source === filter);
  }, [stakeholders, filter]);

  const atlasCount = stakeholders.filter(s => s.source === "atlas_known").length;
  const inferredCount = stakeholders.filter(s => s.source === "ai_inferred").length;

  if (stakeholders.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-white px-4 py-8 text-center">
        <Users className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">No stakeholder map generated. Try running research with a deeper depth.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-white overflow-hidden">
      {/* Filter bar */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-border flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Filter:</span>
        {[
          { key: "all" as const, label: `All (${stakeholders.length})` },
          { key: "atlas_known" as const, label: `Atlas Data (${atlasCount})` },
          { key: "ai_inferred" as const, label: `AI Inferred (${inferredCount})` },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${
              filter === f.key
                ? "bg-indigo-600 text-white"
                : "bg-white text-muted-foreground border border-border hover:border-indigo-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Stakeholder cards */}
      <div className="divide-y divide-border">
        {filtered.map((s, i) => (
          <StakeholderCard key={i} s={s} />
        ))}
      </div>
    </div>
  );
}

function StakeholderCard({ s }: { s: any }) {
  const isInferred = s.source === "ai_inferred";
  const isPlaceholder = s.enrichmentStatus === "role_placeholder";

  return (
    <div className={`px-4 py-3 ${isInferred ? "bg-amber-50/30" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
            isPlaceholder ? "bg-slate-100" : isInferred ? "bg-amber-100" : "bg-teal/15"
          }`}>
            {isPlaceholder ? (
              <HelpCircle className="w-4 h-4 text-slate-400" />
            ) : isInferred ? (
              <UserX className="w-4 h-4 text-amber-500" />
            ) : (
              <UserCheck className="w-4 h-4 text-teal" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-semibold ${isPlaceholder ? "text-slate-500 italic" : "text-navy"}`}>
                {s.name}
              </span>
              <Badge variant="outline" className={`text-[9px] px-1.5 py-0 border ${sourceTagStyle(s.source)}`}>
                {sourceTagLabel(s.source)}
              </Badge>
              <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${confidenceBadge(s.confidence)}`}>
                {s.confidence}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{s.title} — {s.company}</p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-[10px] text-indigo-600 font-medium">{s.likelyRole}</span>
              <span className="text-[10px] text-muted-foreground">Lane: {s.buyingCommitteeLane}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                s.laneRelevance === "primary" ? "bg-teal/15 text-teal" :
                s.laneRelevance === "adjacent" ? "bg-blue-100 text-blue-600" :
                "bg-slate-100 text-slate-500"
              }`}>
                {s.laneRelevance}
              </span>
            </div>
          </div>
        </div>

        {/* Contact actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {s.hasEmail && (
            <span className="w-6 h-6 rounded bg-teal/15 flex items-center justify-center">
              <Mail className="w-3 h-3 text-teal" />
            </span>
          )}
          {s.hasLinkedin && (
            <span className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center">
              <Linkedin className="w-3 h-3 text-blue-600" />
            </span>
          )}
          {s.enrichmentStatus === "needs_enrichment" && (
            <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-600 border-amber-200">
              Needs enrichment
            </Badge>
          )}
        </div>
      </div>

      {/* Next step + evidence */}
      <div className="mt-2 ml-10.5 pl-0.5">
        <p className="text-[10px] text-navy font-medium flex items-start gap-1">
          <ArrowRight className="w-3 h-3 text-indigo-500 shrink-0 mt-0.5" />
          {s.nextStep}
        </p>
        {s.sourceNote && (
          <p className="text-[10px] text-muted-foreground mt-0.5 italic ml-4">{s.sourceNote}</p>
        )}
        <p className="text-[9px] text-muted-foreground mt-0.5 ml-4">
          Evidence: <span className="font-mono">{s.evidenceRef}</span>
        </p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════
// Recommended Actions Panel
// ══════════════════════════════════════════════════
function RecommendedActionsPanel({ actions }: { actions: any[] }) {
  if (actions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-white px-4 py-8 text-center">
        <Target className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">No recommended actions generated.</p>
      </div>
    );
  }

  const verified = actions.filter(a => a.isVerified);
  const unverified = actions.filter(a => !a.isVerified);

  return (
    <div className="rounded-lg border border-border bg-white overflow-hidden">
      {/* Verified actions */}
      {verified.length > 0 && (
        <>
          <div className="px-4 py-2 bg-emerald-50 border-b border-border flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">
              Evidence-Backed Actions ({verified.length})
            </span>
          </div>
          <div className="divide-y divide-border">
            {verified.map((a, i) => (
              <ActionCard key={i} a={a} />
            ))}
          </div>
        </>
      )}

      {/* Unverified actions */}
      {unverified.length > 0 && (
        <>
          <div className="px-4 py-2 bg-amber-50 border-b border-t border-border flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
              Suggested — Unverified ({unverified.length})
            </span>
          </div>
          <div className="divide-y divide-border">
            {unverified.map((a, i) => (
              <ActionCard key={i} a={a} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ActionCard({ a }: { a: any }) {
  const priorityStyle = a.priority === "high"
    ? "bg-red-100 text-red-700"
    : a.priority === "medium"
    ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-600";

  return (
    <div className={`px-4 py-3 ${!a.isVerified ? "bg-amber-50/20" : ""}`}>
      <div className="flex items-start gap-2.5">
        <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
          a.isVerified ? "bg-emerald-100" : "bg-amber-100"
        }`}>
          {a.isVerified ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${priorityStyle}`}>
              {a.priority}
            </Badge>
            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 border ${sourceTagStyle(a.source)}`}>
              {sourceTagLabel(a.source)}
            </Badge>
            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${confidenceBadge(a.confidence)}`}>
              {a.confidence}
            </Badge>
          </div>
          <p className="text-xs text-navy font-medium leading-relaxed">{a.action}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{a.sourceNote}</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">
            Evidence: <span className="font-mono">{a.evidenceRef}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
