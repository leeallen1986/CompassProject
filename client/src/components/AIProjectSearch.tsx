/**
 * AI Project Search — Guided Sales Workflow
 * 
 * Multi-step flow: Search → Match → View Stakeholders → Enrich → Draft Outreach
 * Sales reps type in keywords/products and the AI guides them through the full
 * project-to-outreach pipeline without leaving the component.
 */
import { useState, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Search, Sparkles, Loader2, Target, MapPin, Building,
  ChevronDown, ChevronUp, Users, ArrowRight, Lightbulb,
  Flame, Zap, Package, TrendingUp, ExternalLink,
  UserPlus, Mail, Phone, Linkedin, RefreshCw, CheckCircle2,
  AlertCircle, Send, Shield
} from "lucide-react";
import { toast } from "sonner";
import OutreachEmailModal from "./OutreachEmailModal";

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

interface ProjectContact {
  id: number;
  name: string;
  title: string;
  company: string;
  email: string | null;
  linkedin: string | null;
  phone: string | null;
  roleBucket: string;
  roleRelevance: string | null;
  confidenceScore: string | null;
  enrichmentStatus: string | null;
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

// ── Role Relevance Badge ──
function RoleBadge({ relevance }: { relevance: string | null }) {
  if (relevance === "high") return (
    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 uppercase">Key</span>
  );
  if (relevance === "medium") return (
    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700 uppercase">Med</span>
  );
  if (relevance === "low") return (
    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-500 uppercase">Corp</span>
  );
  return null;
}

// ── Sector Label ──
const sectorLabels: Record<string, string> = {
  mining: "Mining", oil_gas: "Oil & Gas", infrastructure: "Infrastructure",
  energy: "Energy", defence: "Defence",
};

// ── Workflow Step Indicator ──
function WorkflowSteps({ currentStep }: { currentStep: number }) {
  const steps = [
    { label: "Search", icon: Search },
    { label: "Match", icon: Target },
    { label: "Stakeholders", icon: Users },
    { label: "Outreach", icon: Send },
  ];
  return (
    <div className="flex items-center gap-1 mb-4">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isActive = i <= currentStep;
        const isCurrent = i === currentStep;
        return (
          <div key={step.label} className="flex items-center gap-1">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${
              isCurrent ? "bg-navy text-white shadow-sm" :
              isActive ? "bg-navy/10 text-navy" :
              "bg-slate-100 text-slate-400"
            }`}>
              <Icon className="w-3 h-3" />
              {step.label}
            </div>
            {i < steps.length - 1 && (
              <ArrowRight className={`w-3 h-3 ${isActive ? "text-navy" : "text-slate-300"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Contact Row in stakeholder panel ──
function ContactRow({ contact, onDraftEmail, projectName }: {
  contact: ProjectContact;
  onDraftEmail: (contact: ProjectContact) => void;
  projectName: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg hover:bg-gold/5 transition-colors group">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-navy truncate">{contact.name}</span>
          <RoleBadge relevance={contact.roleRelevance} />
          {contact.enrichmentStatus === "enriched" && (
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">{contact.title}</span>
          <span className="text-[10px] text-muted-foreground">at {contact.company}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
        {contact.email && (
          <button
            onClick={() => onDraftEmail(contact)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-gold/15 text-gold-dark hover:bg-gold/30 border border-gold/20 transition-colors"
            title="Draft outreach email"
          >
            <Mail className="w-3 h-3" /> Draft
          </button>
        )}
        {contact.linkedin && (
          <a
            href={contact.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md bg-navy/8 text-navy hover:bg-navy/15 transition-colors"
            title="View LinkedIn"
          >
            <Linkedin className="w-3 h-3" />
          </a>
        )}
        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            className="p-1.5 rounded-md bg-teal/10 text-teal hover:bg-teal/20 transition-colors"
            title="Call"
          >
            <Phone className="w-3 h-3" />
          </a>
        )}
        {!contact.email && !contact.linkedin && (
          <span className="text-[10px] text-muted-foreground italic">No contact info</span>
        )}
      </div>
    </div>
  );
}

// ── Stakeholder Panel (inline within result card) ──
function StakeholderPanel({ projectId, projectName, project, onClose }: {
  projectId: number;
  projectName: string;
  project: MatchedProject;
  onClose: () => void;
}) {
  const { data: reportData, isLoading } = trpc.report.full.useQuery({});

  const contactsData = useMemo(() => {
    if (!reportData) return [];
    const allContacts = (reportData as any)?.contacts || [];
    const nameLC = projectName.toLowerCase().slice(0, 30);
    return allContacts.filter((c: any) => {
      const cp = (c.project || "").toLowerCase();
      return cp.includes(nameLC) || nameLC.includes(cp.slice(0, 30));
    }).map((c: any): ProjectContact => ({
      id: c.id,
      name: c.name,
      title: c.title,
      company: c.company,
      email: c.email,
      linkedin: c.linkedin || c.linkedinProfileUrl,
      phone: c.phone,
      roleBucket: c.roleBucket,
      roleRelevance: c.roleRelevance,
      confidenceScore: c.confidenceScore,
      enrichmentStatus: c.enrichmentStatus,
    }));
  }, [reportData, projectName]);

  const [outreachContact, setOutreachContact] = useState<ProjectContact | null>(null);

  const contacts: ProjectContact[] = contactsData || [];
  const highRelevance = contacts.filter((c: ProjectContact) => c.roleRelevance === "high");
  const medRelevance = contacts.filter((c: ProjectContact) => c.roleRelevance === "medium");
  const lowRelevance = contacts.filter((c: ProjectContact) => c.roleRelevance === "low" || !c.roleRelevance);

  const sortedContacts = [...highRelevance, ...medRelevance, ...lowRelevance];

  return (
    <div className="border-t border-border bg-slate-50/50">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-teal" />
            <h4 className="text-sm font-bold text-navy">Stakeholders</h4>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal/10 text-teal font-bold">
              {contacts.length} found
            </span>
            {highRelevance.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">
                {highRelevance.length} key
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-navy transition-colors"
          >
            Close
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-teal" />
            <span className="text-xs text-muted-foreground">Loading stakeholders...</span>
          </div>
        ) : sortedContacts.length === 0 ? (
          <div className="text-center py-4">
            <AlertCircle className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No stakeholders found for this project yet.</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Try running stakeholder discovery from the Admin panel.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {sortedContacts.map(contact => (
              <ContactRow
                key={contact.id}
                contact={contact}
                onDraftEmail={(c) => setOutreachContact(c)}
                projectName={projectName}
              />
            ))}
          </div>
        )}

        {/* Quick action bar */}
        {sortedContacts.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {highRelevance.length} key decision-makers, {medRelevance.length} influencers, {lowRelevance.length} corporate
            </span>
            {highRelevance.length > 0 && highRelevance[0].email && (
              <button
                onClick={() => setOutreachContact(highRelevance[0])}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-navy text-xs font-bold hover:bg-gold-light transition-colors"
              >
                <Send className="w-3 h-3" /> Draft to Top Contact
              </button>
            )}
          </div>
        )}
      </div>

      {/* Outreach Modal */}
      {outreachContact && (
        <OutreachEmailModal
          isOpen={true}
          onClose={() => setOutreachContact(null)}
          contact={{
            id: outreachContact.id,
            name: outreachContact.name,
            title: outreachContact.title,
            company: outreachContact.company,
            email: outreachContact.email || "",
            roleBucket: outreachContact.roleBucket,
          }}
          project={{
            id: project.projectId,
            name: project.name,
            location: project.location,
            value: project.value,
            sector: project.sector,
            stage: project.stage,
            overview: project.overview,
            equipmentSignals: null,
            opportunityRoute: "",
            matchedBusinessLines: project.matchedProducts || [],
          }}
        />
      )}
    </div>
  );
}

// ── Result Card with Guided Workflow ──
function ResultCard({ match, rank, onNavigateToProject }: {
  match: MatchedProject;
  rank: number;
  onNavigateToProject?: (projectId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showStakeholders, setShowStakeholders] = useState(false);

  return (
    <div className="bg-card rounded-lg border border-border hover:border-gold/40 hover:shadow-md transition-all overflow-hidden">
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

          {/* Stage + Actions */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span><strong className="text-navy">Stage:</strong> {match.stage}</span>
              <span><strong className="text-navy">Sector:</strong> {sectorLabels[match.sector] || match.sector}</span>
            </div>
          </div>

          {/* ── Guided Workflow Action Buttons ── */}
          <div className="flex items-center gap-2 pt-2 border-t border-border flex-wrap">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowStakeholders(!showStakeholders);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                showStakeholders
                  ? "bg-teal text-white"
                  : "bg-teal/10 text-teal hover:bg-teal/20 border border-teal/20"
              }`}
            >
              <Users className="w-3 h-3" />
              {showStakeholders ? "Hide Stakeholders" : "View Stakeholders"}
              {match.contactCount > 0 && (
                <span className="px-1 py-0.5 rounded-full bg-white/20 text-[9px] font-bold ml-0.5">
                  {match.contactCount}
                </span>
              )}
            </button>

            {onNavigateToProject && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToProject(match.projectId);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light transition-colors"
              >
                <ExternalLink className="w-3 h-3" /> Full Details
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Inline Stakeholder Panel ── */}
      {showStakeholders && (
        <StakeholderPanel
          projectId={match.projectId}
          projectName={match.name}
          project={match}
          onClose={() => setShowStakeholders(false)}
        />
      )}
    </div>
  );
}

// ── Main Component ──
export default function AIProjectSearch({ onNavigateToProject }: { onNavigateToProject?: (projectId: number) => void } = {}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MatchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentStep = !result ? 0 : 1;

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
      {/* Workflow Progress */}
      <WorkflowSteps currentStep={currentStep} />

      {/* Search Header */}
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-gold" />
          <h2 className="text-lg font-bold text-navy">Sales Opportunity Finder</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Enter keywords, products, or solutions — the AI will match projects, show stakeholders, and help you draft outreach in one flow.
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
              <><Zap className="w-4 h-4" /> Find Opportunities</>
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

          {/* Workflow Hint */}
          <div className="bg-navy/5 border border-navy/15 rounded-lg px-4 py-2.5 flex items-center gap-3">
            <Shield className="w-4 h-4 text-navy shrink-0" />
            <p className="text-xs text-navy/80">
              <strong>Next steps:</strong> Expand a project card to see details, then click <strong>"View Stakeholders"</strong> to see contacts and <strong>"Draft"</strong> to compose outreach — all without leaving this page.
            </p>
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
          <p className="text-xs text-muted-foreground max-w-md mx-auto mb-4">
            Enter the products or solutions you're currently pushing, and the AI will match you with the most relevant projects, show key stakeholders, and help you draft outreach — all in one workflow.
          </p>
          <div className="flex items-center justify-center gap-6 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><Search className="w-3 h-3" /> Search</span>
            <ArrowRight className="w-3 h-3" />
            <span className="flex items-center gap-1"><Target className="w-3 h-3" /> Match</span>
            <ArrowRight className="w-3 h-3" />
            <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Stakeholders</span>
            <ArrowRight className="w-3 h-3" />
            <span className="flex items-center gap-1"><Send className="w-3 h-3" /> Outreach</span>
          </div>
        </div>
      )}
    </div>
  );
}
