/**
 * ExternalProspectPanel
 * Shown when an account is NOT found in Atlas.
 *
 * Decision tree:
 *   1. Show close-match suggestions from Atlas ("Did you mean?")
 *   2. If user confirms no match → External Prospect Mode form
 *   3. Run bounded LLM synthesis, clearly labelled EXTERNAL
 *   4. Display results with source tags and confidence levels
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, Search, ExternalLink, ChevronRight,
  Globe, Building2, Briefcase, Target, Users, Lightbulb,
  AlertCircle, CheckCircle2, HelpCircle, Loader2, RefreshCw,
  ArrowRight, MapPin, TrendingUp, ShieldAlert,
} from "lucide-react";

// ── Types ──
interface CloseMatch {
  name: string;
  accountKind: "owner" | "contractor";
  matchReason: string;
}

interface ExternalProspectResult {
  companyOverview: {
    description: string;
    industry: string;
    region: string;
    estimatedSize: string;
    publiclyListed: boolean | null;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  };
  relevanceToAtlasCopco: {
    summary: string;
    likelyEquipmentNeeds: string[];
    estimatedOpportunitySize: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  };
  knownProjects: Array<{
    name: string;
    description: string;
    status: string;
    region: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  }>;
  stakeholderGuidance: {
    typicalBuyingRoles: string[];
    suggestedEntryPoints: string[];
    warningFlags: string[];
  };
  recommendedActions: Array<{
    action: string;
    rationale: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    isVerified: boolean;
  }>;
  dataQualityWarning: string;
}

// ── Confidence badge ──
function ConfidenceBadge({ level }: { level: "HIGH" | "MEDIUM" | "LOW" }) {
  const styles = {
    HIGH: "bg-emerald-50 text-emerald-700 border-emerald-200",
    MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
    LOW: "bg-red-50 text-red-700 border-red-200",
  };
  const icons = {
    HIGH: <CheckCircle2 className="w-2.5 h-2.5" />,
    MEDIUM: <HelpCircle className="w-2.5 h-2.5" />,
    LOW: <AlertCircle className="w-2.5 h-2.5" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${styles[level]}`}>
      {icons[level]} {level}
    </span>
  );
}

// ── Source label banner ──
function ExternalSourceBanner({ companyName }: { companyName: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 mb-4">
      <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-semibold text-amber-800">EXTERNAL — Not Atlas-verified</p>
        <p className="text-[11px] text-amber-700 mt-0.5">
          <strong>{companyName}</strong> is not in the Atlas project database. This brief is generated from
          external knowledge only. Treat all claims as unverified until cross-checked with Atlas data or direct outreach.
        </p>
      </div>
    </div>
  );
}

// ── Main component ──
interface ExternalProspectPanelProps {
  searchQuery: string;
  onSelectMatch: (name: string) => void;
}

type PanelState = "suggestions" | "prospect_form" | "researching" | "results" | "error";

const OBJECTIVE_OPTIONS = [
  { key: "general", label: "General Review", description: "Overview of company, fit, and entry points" },
  { key: "map_stakeholders", label: "Map Stakeholders", description: "Identify likely buying roles and entry contacts" },
  { key: "pursue_tender", label: "Pursue Tender", description: "Assess tender/project opportunities" },
  { key: "explore_cross_sell", label: "Explore Cross-Sell", description: "Identify adjacent PT lane opportunities" },
  { key: "meeting_prep", label: "Meeting Prep", description: "Prepare for a first meeting or call" },
] as const;

const INDUSTRY_OPTIONS = [
  "Mining", "Oil & Gas", "Infrastructure", "Energy", "Defence",
  "Construction", "Utilities", "Government", "Other",
];

const REGION_OPTIONS = [
  "Western Australia", "Queensland", "New South Wales", "Victoria",
  "South Australia", "Northern Territory", "Tasmania", "ACT",
  "National (Australia)", "International",
];

export default function ExternalProspectPanel({ searchQuery, onSelectMatch }: ExternalProspectPanelProps) {
  const [panelState, setPanelState] = useState<PanelState>("suggestions");
  const [industry, setIndustry] = useState("");
  const [region, setRegion] = useState("Western Australia");
  const [objective, setObjective] = useState<typeof OBJECTIVE_OPTIONS[number]["key"]>("general");
  const [result, setResult] = useState<ExternalProspectResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Close-match suggestions
  const { data: closeMatches = [], isLoading: isLoadingSuggestions } = trpc.accountAttack.suggestCloseMatches.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.length >= 2 }
  );

  // External prospect mutation
  const runProspect = trpc.accountAttack.runExternalProspect.useMutation({
    onSuccess: (data) => {
      if (data.success && data.result) {
        setResult(data.result as ExternalProspectResult);
        setPanelState("results");
      } else {
        setErrorMsg((data as any).error || "Research failed. Please try again.");
        setPanelState("error");
      }
    },
    onError: (err) => {
      setErrorMsg(err.message);
      setPanelState("error");
    },
  });

  const handleRunResearch = () => {
    setPanelState("researching");
    runProspect.mutate({
      companyName: searchQuery,
      industry: industry || undefined,
      region: region || undefined,
      objective,
    });
  };

  // ── Suggestions state ──
  if (panelState === "suggestions") {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-amber-50/50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-foreground">
                No Atlas match found for "{searchQuery}"
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                This account is not in the Atlas project database. Check the suggestions below or research externally.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Close-match suggestions */}
          {isLoadingSuggestions ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Checking for close matches in Atlas…
            </div>
          ) : closeMatches.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                Possible Atlas matches — did you mean one of these?
              </p>
              <div className="space-y-1.5">
                {closeMatches.map((match: CloseMatch) => (
                  <button
                    key={match.name}
                    onClick={() => onSelectMatch(match.name)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-background hover:bg-navy/5 hover:border-navy/30 transition-all group text-left"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium text-foreground truncate">{match.name}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 shrink-0 ${
                          match.accountKind === "contractor"
                            ? "border-blue-200 text-blue-700 bg-blue-50"
                            : "border-teal-200 text-teal-700 bg-teal-50"
                        }`}
                      >
                        {match.accountKind === "contractor" ? "Contractor" : "Owner"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-muted-foreground hidden sm:block">{match.matchReason}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-navy transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No close matches found in Atlas for "{searchQuery}".
            </p>
          )}

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-card px-3 text-[11px] text-muted-foreground">or</span>
            </div>
          </div>

          {/* External Prospect CTA */}
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-4">
            <div className="flex items-start gap-3">
              <Globe className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-900">Research "{searchQuery}" as an External Prospect</p>
                <p className="text-[11px] text-amber-700 mt-1">
                  Use AI to generate a prospect brief from external knowledge. Output will be clearly labelled
                  as <strong>not Atlas-verified</strong> and must be treated as unconfirmed intelligence.
                </p>
                <p className="text-[11px] text-amber-600 mt-1 italic">
                  Suitable for: new-logo accounts, whitespace prospects, pre-Atlas mapping.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => setPanelState("prospect_form")}
              className="mt-3 bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Research Externally
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Prospect form state ──
  if (panelState === "prospect_form") {
    return (
      <div className="rounded-xl border border-amber-300 bg-card overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-amber-900">External Prospect Research</h3>
            <Badge className="bg-amber-200 text-amber-800 text-[10px] px-1.5 border-0 ml-auto">
              NOT ATLAS-VERIFIED
            </Badge>
          </div>
          <p className="text-xs text-amber-700 mt-1">
            Researching: <strong>{searchQuery}</strong>
          </p>
        </div>

        <div className="p-5 space-y-4">
          {/* Industry */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Industry <span className="text-muted-foreground font-normal">(optional — improves accuracy)</span>
            </label>
            <select
              value={industry}
              onChange={e => setIndustry(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400"
            >
              <option value="">Unknown / Not sure</option>
              {INDUSTRY_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* Region */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Region <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <select
              value={region}
              onChange={e => setRegion(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400"
            >
              {REGION_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* Objective */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">Research Objective</label>
            <div className="space-y-1.5">
              {OBJECTIVE_OPTIONS.map(opt => (
                <label
                  key={opt.key}
                  className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                    objective === opt.key
                      ? "border-amber-400 bg-amber-50"
                      : "border-border bg-background hover:border-amber-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="objective"
                    value={opt.key}
                    checked={objective === opt.key}
                    onChange={() => setObjective(opt.key)}
                    className="mt-0.5 accent-amber-600"
                  />
                  <div>
                    <p className="text-xs font-semibold text-foreground">{opt.label}</p>
                    <p className="text-[11px] text-muted-foreground">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Data quality warning */}
          <div className="flex items-start gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-600">
              Results are generated from the LLM's training data. Specific contacts, emails, and project details
              will NOT be fabricated — but company-level intelligence may be outdated or incomplete.
              Always verify before outreach.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleRunResearch}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5"
            >
              <Globe className="w-3.5 h-3.5" />
              Run External Research
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPanelState("suggestions")}
              className="text-xs"
            >
              Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Researching state ──
  if (panelState === "researching") {
    return (
      <div className="rounded-xl border border-amber-300 bg-card p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="relative">
            <Globe className="w-8 h-8 text-amber-500" />
            <Loader2 className="w-4 h-4 text-amber-600 animate-spin absolute -top-1 -right-1" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Researching "{searchQuery}"…</p>
            <p className="text-xs text-muted-foreground mt-1">
              Generating external prospect brief. ~20–30 seconds.
            </p>
          </div>
          <Badge className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px]">
            EXTERNAL RESEARCH IN PROGRESS
          </Badge>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (panelState === "error") {
    return (
      <div className="rounded-xl border border-red-200 bg-card p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Research failed</p>
            <p className="text-xs text-muted-foreground mt-1">{errorMsg || "An unexpected error occurred."}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPanelState("prospect_form")}
              className="mt-3 text-xs gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Results state ──
  if (panelState === "results" && result) {
    return (
      <div className="space-y-4">
        {/* External source banner */}
        <ExternalSourceBanner companyName={searchQuery} />

        {/* Company Overview */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <h4 className="text-sm font-bold text-foreground">Company Overview</h4>
            </div>
            <div className="flex items-center gap-2">
              <ConfidenceBadge level={result.companyOverview.confidence} />
              <Badge className="bg-amber-100 text-amber-700 border border-amber-200 text-[10px]">EXTERNAL</Badge>
            </div>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-foreground/80 leading-relaxed">{result.companyOverview.description}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-slate-50 border border-border px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Industry</p>
                <p className="text-xs font-medium text-foreground mt-0.5">{result.companyOverview.industry}</p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-border px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Region</p>
                <p className="text-xs font-medium text-foreground mt-0.5">{result.companyOverview.region}</p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-border px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Size</p>
                <p className="text-xs font-medium text-foreground mt-0.5">{result.companyOverview.estimatedSize}</p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-border px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Listed</p>
                <p className="text-xs font-medium text-foreground mt-0.5">
                  {result.companyOverview.publiclyListed === null ? "Unknown" : result.companyOverview.publiclyListed ? "Yes" : "No"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Relevance to Atlas Copco */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <h4 className="text-sm font-bold text-foreground">Relevance to Atlas Copco PT</h4>
            </div>
            <ConfidenceBadge level={result.relevanceToAtlasCopco.confidence} />
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-foreground/80 leading-relaxed">{result.relevanceToAtlasCopco.summary}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Likely Equipment Needs</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.relevanceToAtlasCopco.likelyEquipmentNeeds.map((need, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full bg-navy/10 text-navy text-[11px] font-medium">{need}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Estimated Opportunity</p>
                <p className="text-sm font-bold text-gold">{result.relevanceToAtlasCopco.estimatedOpportunitySize}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Known Projects */}
        {result.knownProjects.length > 0 && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-slate-50 flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" />
              <h4 className="text-sm font-bold text-foreground">Known Projects</h4>
              <span className="text-xs text-muted-foreground ml-auto">External intelligence only</span>
            </div>
            <div className="divide-y divide-border">
              {result.knownProjects.map((project, i) => (
                <div key={i} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">{project.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{project.description}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <MapPin className="w-2.5 h-2.5" /> {project.region}
                        </span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <span className="text-[10px] text-muted-foreground">{project.status}</span>
                      </div>
                    </div>
                    <ConfidenceBadge level={project.confidence} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stakeholder Guidance */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-slate-50 flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h4 className="text-sm font-bold text-foreground">Stakeholder Guidance</h4>
            <Badge className="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] ml-auto">AI-INFERRED</Badge>
          </div>
          <div className="p-5 space-y-3">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Typical Buying Roles</p>
              <div className="flex flex-wrap gap-1.5">
                {result.stakeholderGuidance.typicalBuyingRoles.map((role, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full bg-teal/10 text-teal text-[11px] font-medium border border-teal/20">{role}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Suggested Entry Points</p>
              <ul className="space-y-1">
                {result.stakeholderGuidance.suggestedEntryPoints.map((entry, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                    {entry}
                  </li>
                ))}
              </ul>
            </div>
            {result.stakeholderGuidance.warningFlags.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Warning Flags</p>
                <ul className="space-y-1">
                  {result.stakeholderGuidance.warningFlags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                      <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                      {flag}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Recommended Actions */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-slate-50 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-muted-foreground" />
            <h4 className="text-sm font-bold text-foreground">Recommended Actions</h4>
            <Badge className="bg-amber-100 text-amber-700 border border-amber-200 text-[10px] ml-auto">UNVERIFIED</Badge>
          </div>
          <div className="divide-y divide-border">
            {result.recommendedActions.map((action, i) => (
              <div key={i} className="px-5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-semibold text-foreground">{i + 1}. {action.action}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{action.rationale}</p>
                  </div>
                  <ConfidenceBadge level={action.confidence} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Data quality warning */}
        <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <AlertCircle className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-600">{result.dataQualityWarning}</p>
        </div>

        {/* Refresh / back */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setResult(null); setPanelState("prospect_form"); }}
            className="text-xs gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Re-run Research
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPanelState("suggestions")}
            className="text-xs"
          >
            Back to Suggestions
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
