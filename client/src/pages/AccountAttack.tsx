/**
 * Account Attack — Phase 1
 * Internal-data-first account-planning cockpit.
 * No AI calls. No external scraping. No web search.
 * Seller-lens weighting is client-side only.
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation, Link, useSearch } from "wouter";
import { getLoginUrl } from "@/const";
import { LaneBadge, getLaneLabel, LANE_OPTIONS } from "@/components/LaneBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sanitizeContractorName } from "@shared/utils";
import AccountResearchPanel from "@/components/AccountResearchPanel";
import ExternalProspectPanel from "@/components/ExternalProspectPanel";
import {
  Search, Target, Building2, Users, HardHat, Mail, Linkedin,
  MapPin, Calendar, ChevronRight, ChevronDown, ChevronUp,
  Flame, TrendingUp, BarChart3, Loader2, LogIn, LogOut,
  Settings, Database, Sparkles, Layers, Megaphone, MoreHorizontal,
  ExternalLink, FileText, Clock, Eye, Crosshair, Shield,
  ArrowRight, AlertTriangle, CheckCircle2, X, Pickaxe, Fuel,
} from "lucide-react";

// ── Types ──
type LensMode = "focused" | "balanced" | "open";

const LENS_LABELS: Record<LensMode, { label: string; desc: string }> = {
  focused: { label: "Focused", desc: "Prioritize your lane heavily" },
  balanced: { label: "Balanced", desc: "Your lane first, adjacent visible" },
  open: { label: "Open", desc: "Full PT account picture" },
};

const LANE_MULTIPLIERS: Record<LensMode, { primary: number; adjacent: number; unclassified: number }> = {
  focused: { primary: 3.0, adjacent: 0.5, unclassified: 0.3 },
  balanced: { primary: 2.0, adjacent: 1.0, unclassified: 0.7 },
  open: { primary: 1.0, adjacent: 1.0, unclassified: 1.0 },
};

// Visual opacity applied to rows based on lens mode + lane relevance
// Focused: primary full, adjacent/unclassified dimmed
// Balanced: primary + adjacent full, unclassified slightly dimmed
// Open: all full
const LANE_ROW_OPACITY: Record<LensMode, Record<"primary" | "adjacent" | "unclassified", string>> = {
  focused:  { primary: "",           adjacent: "opacity-50",  unclassified: "opacity-30" },
  balanced: { primary: "",           adjacent: "",            unclassified: "opacity-60" },
  open:     { primary: "",           adjacent: "",            unclassified: "" },
};

// Map user profile business lines to PT lane keys
function businessLinesToLane(lines: string[] | null | undefined): string | null {
  if (!lines || lines.length === 0) return null;
  const mapping: Record<string, string> = {
    "Portable Air": "portable_air",
    "Pump (Flow)": "pumps",
    "Pump/Dewatering": "pumps",
    "PAL": "pal",
    "BESS": "bess",
    "Nitrogen": "portable_air",
    "Generators": "portable_air",
    "Lighting": "portable_air",
  };
  return mapping[lines[0]] || "portable_air";
}

// ── Priority helpers ──
function priorityBadge(priority: string) {
  if (priority === "hot") return "bg-hot text-white";
  if (priority === "warm") return "bg-warm text-navy";
  return "bg-cold text-white";
}

const sectorLabels: Record<string, string> = {
  mining: "Mining", oil_gas: "Oil & Gas", infrastructure: "Infrastructure",
  energy: "Energy", defence: "Defence",
};

const sectorIcons: Record<string, React.ReactNode> = {
  mining: <Pickaxe className="w-3.5 h-3.5" />,
  oil_gas: <Fuel className="w-3.5 h-3.5" />,
  infrastructure: <Building2 className="w-3.5 h-3.5" />,
  energy: <TrendingUp className="w-3.5 h-3.5" />,
  defence: <Shield className="w-3.5 h-3.5" />,
};

// ── Collapsible Section ──
function CollapsibleSection({
  title, count, defaultOpen = false, icon, children,
}: {
  title: string; count: number; defaultOpen?: boolean;
  icon: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <span className="font-semibold text-navy text-sm flex-1">{title}</span>
        <span className="text-xs font-bold text-muted-foreground bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

// ── Input Bar ──
type SearchResult = { name: string; accountKind: 'owner' | 'contractor' };

function InputBar({
  accountName, setAccountName, lensMode, setLensMode,
  laneFilter, setLaneFilter, searchResults, isSearching, onSelect,
}: {
  accountName: string; setAccountName: (v: string) => void;
  lensMode: LensMode; setLensMode: (v: LensMode) => void;
  laneFilter: string; setLaneFilter: (v: string) => void;
  searchResults: SearchResult[]; isSearching: boolean;
  onSelect: (name: string) => void;
}) {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <div className="bg-card rounded-xl border border-border p-4 sm:p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        {/* Row 1: Account search */}
        <div className="relative">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Account Name
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by owner / account name..."
              value={accountName}
              onChange={e => { setAccountName(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              onKeyDown={e => {
                if (e.key === 'Enter' && accountName.trim()) {
                  onSelect(accountName.trim());
                  setShowDropdown(false);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold"
            />
            {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute z-50 top-full mt-1 w-full bg-card border border-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
              {searchResults.map((result, i) => (
                <button
                  key={i}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors flex items-center gap-2"
                  onMouseDown={() => { onSelect(result.name); setShowDropdown(false); }}
                >
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{result.name}</span>
                  {result.accountKind === 'contractor' && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">Contractor</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Row 2: Controls */}
        <div className="flex flex-wrap gap-4 items-end">
          {/* Lens mode */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Lens Mode
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["focused", "balanced", "open"] as LensMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setLensMode(mode)}
                  className={`px-3 py-2 text-xs font-semibold transition-colors ${
                    lensMode === mode
                      ? "bg-navy text-white"
                      : "bg-card text-muted-foreground hover:bg-slate-50"
                  }`}
                >
                  {LENS_LABELS[mode].label}
                </button>
              ))}
            </div>
            {/* Fix 7: Show active lens description so Balanced vs Open is self-explanatory */}
            <p className="text-[10px] text-muted-foreground mt-1.5 italic">
              {LENS_LABELS[lensMode].desc}
            </p>
          </div>

          {/* PT Lane filter */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              PT Lane Focus
            </label>
            <select
              value={laneFilter}
              onChange={e => setLaneFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-card text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              {LANE_OPTIONS.map(opt => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Research depth placeholder (disabled) */}
          <div className="opacity-50">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Research Depth
            </label>
            <select disabled className="px-3 py-2 rounded-lg border border-border bg-slate-50 text-xs text-muted-foreground cursor-not-allowed">
              <option>Phase 2</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Account Header ──
function AccountHeader({ account }: { account: NonNullable<any> }) {
  const isContractor = account.accountKind === 'contractor';
  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
      {isContractor && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
          <HardHat className="w-3.5 h-3.5 shrink-0" />
          <span><strong>Contractor Account</strong> — Projects shown are those where {account.name} appears as a contractor or EPC partner, not as the project owner.</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="text-xl font-bold text-navy tracking-tight">{account.name}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-muted-foreground">{account.accountType}</p>
            {isContractor && account.contractorMeta?.compositeScore != null && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal/10 text-teal border border-teal/20">
                Score {account.contractorMeta.compositeScore}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-center">
            <div className="text-2xl font-bold text-navy">{account.projectCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Projects</div>
          </div>
          <Separator orientation="vertical" className="h-10" />
          <div className="flex gap-2">
            {account.hotCount > 0 && (
              <div className="text-center">
                <div className="text-lg font-bold text-hot">{account.hotCount}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Hot</div>
              </div>
            )}
            {account.warmCount > 0 && (
              <div className="text-center">
                <div className="text-lg font-bold text-warm">{account.warmCount}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Warm</div>
              </div>
            )}
            {account.coldCount > 0 && (
              <div className="text-center">
                <div className="text-lg font-bold text-cold">{account.coldCount}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Cold</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Distribution strips */}
      <div className="flex flex-wrap gap-4">
        {/* Sectors */}
        {Object.keys(account.sectorDistribution).length > 0 && (
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sectors</span>
            <div className="flex gap-1.5 mt-1">
              {Object.entries(account.sectorDistribution as Record<string, number>).map(([sector, count]) => (
                <span key={sector} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-navy">
                  {sectorIcons[sector]} {sectorLabels[sector] || sector} ({count})
                </span>
              ))}
            </div>
          </div>
        )}

        {/* States */}
        {Object.keys(account.stateDistribution).length > 0 && (
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">States</span>
            <div className="flex gap-1.5 mt-1">
              {Object.entries(account.stateDistribution as Record<string, number>).map(([state, count]) => (
                <span key={state} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-navy">
                  <MapPin className="w-3 h-3" /> {state} ({count})
                </span>
              ))}
            </div>
          </div>
        )}

        {/* PT Lanes */}
        {Object.keys(account.laneDistribution).length > 0 && (
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">PT Lanes</span>
            <div className="flex gap-1.5 mt-1">
              {Object.entries(account.laneDistribution as Record<string, number>).map(([lane, count]) => (
                <span key={lane} className="inline-flex items-center gap-1">
                  {lane !== "unclassified" ? (
                    <LaneBadge lane={lane} />
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-slate-200 text-[10px] font-bold text-slate-600 uppercase">Unclassified</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">({count})</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Opportunity Row ──
function OpportunityRow({ opp, navigate, laneRelevance, lensMode }: {
  opp: any; navigate: (path: string) => void;
  laneRelevance: "primary" | "adjacent" | "unclassified";
  lensMode?: LensMode;
}) {
  const relevanceIndicator = laneRelevance === "primary"
    ? "border-l-4 border-l-gold"
    : laneRelevance === "adjacent"
      ? "border-l-4 border-l-slate-300"
      : "border-l-2 border-l-transparent";

  // Fix 7: Apply opacity based on lens mode + lane relevance for Balanced vs Open differentiation
  const opacityClass = lensMode ? (LANE_ROW_OPACITY[lensMode][laneRelevance] || "") : "";

  const tenderClose = opp.tenderCloseDate ? new Date(opp.tenderCloseDate) : null;
  const daysToClose = tenderClose ? Math.ceil((tenderClose.getTime() - Date.now()) / 86400000) : null;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer border-b border-border last:border-0 ${relevanceIndicator} ${opacityClass}`}
      onClick={() => navigate(`/project/${opp.id}`)}
    >
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${priorityBadge(opp.priority)}`}>
        {opp.priority}
      </span>
      <LaneBadge lane={opp.productLane} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-navy truncate">{opp.name}</div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
          <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{opp.location}</span>
          {opp.value && <span>| {opp.value}</span>}
          {opp.stageCode && opp.stageCode !== "unknown" && (
            <span>| {opp.stageCode.charAt(0).toUpperCase() + opp.stageCode.slice(1)}</span>
          )}
        </div>
      </div>
      {daysToClose !== null && daysToClose <= 14 && (
        <span className={`text-[10px] font-bold flex items-center gap-1 shrink-0 ${daysToClose <= 7 ? "text-hot" : "text-amber-600"}`}>
          <Clock className="w-3 h-3" /> {daysToClose}d
        </span>
      )}
      {opp.enrichmentBlockedReason && (
        <Tooltip>
          <TooltipTrigger>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{formatBlockedReason(opp.enrichmentBlockedReason)}</p>
          </TooltipContent>
        </Tooltip>
      )}
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}

function formatBlockedReason(reason: string): string {
  const map: Record<string, string> = {
    blocked_government_owner_manual_discovery: "Government owner — manual discovery needed",
    blocked_unknown_owner: "Unknown owner — data quality issue",
    blocked_dirty_owner_string: "Owner data too poor to enrich",
    blocked_no_usable_domain: "No usable domain for enrichment",
  };
  return map[reason] || reason;
}

// ── Stakeholder Row ──
function StakeholderRow({ s, laneRelevance }: { s: any; laneRelevance: "primary" | "adjacent" | "unclassified" }) {
  const relevanceIndicator = laneRelevance === "primary"
    ? "border-l-4 border-l-gold"
    : laneRelevance === "adjacent"
      ? "border-l-4 border-l-slate-300"
      : "border-l-2 border-l-transparent";

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 ${relevanceIndicator}`}>
      <div className="w-8 h-8 rounded-full bg-navy/10 flex items-center justify-center shrink-0">
        <Users className="w-4 h-4 text-navy" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-navy truncate">{s.name}</span>
          {s.roleRelevance === "high" && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-100 text-emerald-700">KEY</span>
          )}
          {s.roleRelevance === "medium" && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-100 text-amber-700">MED</span>
          )}
          {s.verifiedByUser && (
            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
          )}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {s.title && <span>{s.title}</span>}
          {s.title && s.company && <span> at </span>}
          {s.company && <span className="font-medium">{s.company}</span>}
        </div>
        {s.linkedProjectNames.length > 0 && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Linked: {s.linkedProjectNames.join(", ")}
            {s.linkedProjectIds.length > 3 && ` +${s.linkedProjectIds.length - 3} more`}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {s.email && (
          <a href={`mailto:${s.email}`} onClick={e => e.stopPropagation()} className="px-2 py-1 rounded text-[10px] font-semibold bg-teal/15 text-teal hover:bg-teal/25 transition-colors">
            <Mail className="w-3 h-3 inline mr-0.5" />Email
          </a>
        )}
        {s.linkedin && (
          <a href={s.linkedin} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="px-2 py-1 rounded text-[10px] font-semibold bg-navy/10 text-navy hover:bg-navy/20 transition-colors">
            <Linkedin className="w-3 h-3 inline mr-0.5" />LI
          </a>
        )}
        {s.enrichmentSource && (
          <span className="text-[9px] text-muted-foreground">{s.enrichmentSource}</span>
        )}
      </div>
    </div>
  );
}

// ── Contractor Row ──
function ContractorRow({ c }: { c: any }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <HardHat className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-navy">{sanitizeContractorName(c.name)}</span>
          <span className="text-[11px] text-muted-foreground ml-2">{c.primaryRole}</span>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">{c.linkedProjects.length} project{c.linkedProjects.length !== 1 ? "s" : ""}</span>
        {c.compositeScore !== null && (
          <span className="text-[10px] font-bold text-gold shrink-0">Score: {Math.round(c.compositeScore)}</span>
        )}
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {c.linkedProjects.map((lp: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-navy/30 shrink-0" />
              <span className="font-medium text-navy">{lp.projectName}</span>
              <span>— {lp.role} ({lp.status})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pairing Row ──
function PairingRow({ p }: { p: any }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0">
      <div className="flex-1 min-w-0 text-[11px]">
        <span className="font-semibold text-navy">{sanitizeContractorName(p.companyAName)}</span>
        <span className="text-muted-foreground"> ({p.companyARoleInPairing}) </span>
        <span className="text-gold font-bold mx-1">↔</span>
        <span className="font-semibold text-navy">{sanitizeContractorName(p.companyBName)}</span>
        <span className="text-muted-foreground"> ({p.companyBRoleInPairing})</span>
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0">{p.coOccurrenceCount}x</span>
      {p.strengthScore !== null && (
        <span className="text-[10px] font-bold text-gold shrink-0">{Math.round(p.strengthScore)}</span>
      )}
    </div>
  );
}

// ── Action History Row ──
function ActionHistoryRow({ a }: { a: any }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0">
      <div className={`w-2 h-2 rounded-full shrink-0 ${
        a.status === "sent" ? "bg-emerald-500" : a.status === "drafted" ? "bg-amber-400" : "bg-slate-300"
      }`} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-navy truncate">{a.subject}</div>
        <div className="text-[10px] text-muted-foreground">
          {a.contactName} {a.projectName ? `· ${a.projectName}` : ""}
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {new Date(a.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
      </span>
    </div>
  );
}

// ── Collateral Row ──
function CollateralRow({ c }: { c: any }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0">
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-navy truncate">{c.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {c.productLine} · Matched to: {c.matchedProjectName}
        </div>
      </div>
      <span className="text-[10px] font-bold text-gold shrink-0">{Math.round(c.matchScore)}%</span>
      <a href={c.fileUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-teal hover:text-teal-light shrink-0">
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

// ── Empty state ──
function EmptyState({ icon, title, description, cta }: {
  icon: React.ReactNode; title: string; description: string; cta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-navy mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground max-w-sm">{description}</p>
      {cta && <div className="mt-3">{cta}</div>}
    </div>
  );
}

// ── Skeleton ──
function AccountAttackSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy h-16" />
      <main className="container py-6 space-y-5">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </main>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// ── Main Component ──
// ══════════════════════════════════════════════════════
export default function AccountAttack() {
  const { user, loading: authLoading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const prefillAccount = params.get("account") || "";

  const [accountName, setAccountName] = useState(prefillAccount);
  const [selectedAccount, setSelectedAccount] = useState(prefillAccount);
  const [lensMode, setLensMode] = useState<LensMode>("balanced");
  const [laneFilter, setLaneFilter] = useState("all");
  const [showNavMenu, setShowNavMenu] = useState(false);
  const [showMoreStakeholders, setShowMoreStakeholders] = useState(false);

  // Auto-fill lane from profile
  const { data: profile } = trpc.profile.get.useQuery(undefined, { enabled: isAuthenticated });

  useEffect(() => {
    if (profile && laneFilter === "all") {
      const userLane = businessLinesToLane(profile.assignedBusinessLines);
      if (userLane) setLaneFilter(userLane);
    }
  }, [profile]);

  // Prefill from URL
  useEffect(() => {
    if (prefillAccount && !selectedAccount) {
      setAccountName(prefillAccount);
      setSelectedAccount(prefillAccount);
    }
  }, [prefillAccount]);

  // Search
  const { data: searchResults = [], isFetching: isSearching } = trpc.accountAttack.search.useQuery(
    { query: accountName },
    { enabled: accountName.length >= 2 && accountName !== selectedAccount }
  );

  // Load account data
  const { data: accountData, isLoading: isLoadingAccount } = trpc.accountAttack.loadAccountData.useQuery(
    { accountName: selectedAccount },
    { enabled: !!selectedAccount }
  );

  const handleSelect = useCallback((name: string) => {
    setAccountName(name);
    setSelectedAccount(name);
  }, []);

  // ── Seller-lens weighting ──
  const userLane = laneFilter !== "all" ? laneFilter : businessLinesToLane(profile?.assignedBusinessLines) || null;

  const classifyLaneRelevance = useCallback((projectLane: string | null | undefined): "primary" | "adjacent" | "unclassified" => {
    if (!userLane) return "unclassified";
    if (!projectLane) return "unclassified";
    if (projectLane === userLane) return "primary";
    return "adjacent";
  }, [userLane]);

  const getLaneMultiplier = useCallback((relevance: "primary" | "adjacent" | "unclassified"): number => {
    return LANE_MULTIPLIERS[lensMode][relevance];
  }, [lensMode]);

  // ── Primary-lane project count (for zero-lane signal) ──
  const primaryLaneProjectCount = useMemo(() => {
    if (!accountData?.opportunities) return 0;
    return accountData.opportunities.filter(
      (o: any) => classifyLaneRelevance(o.productLane) === "primary"
    ).length;
  }, [accountData?.opportunities, classifyLaneRelevance]);

  // Human-readable label for the user's primary lane
  const primaryLaneLabel = useMemo(() => {
    if (!userLane) return "your lane";
    const opt = LANE_OPTIONS.find(o => o.key === userLane);
    return opt ? opt.label : userLane;
  }, [userLane]);

  // ── Sorted opportunities ──
  const sortedOpportunities = useMemo(() => {
    if (!accountData?.opportunities) return [];
    return [...accountData.opportunities].sort((a, b) => {
      const aRelevance = classifyLaneRelevance(a.productLane);
      const bRelevance = classifyLaneRelevance(b.productLane);
      const aMultiplier = getLaneMultiplier(aRelevance);
      const bMultiplier = getLaneMultiplier(bRelevance);

      // Base score: priority weight
      const priorityWeight = { hot: 3, warm: 2, cold: 1 };
      const aBase = (priorityWeight[a.priority as keyof typeof priorityWeight] || 1);
      const bBase = (priorityWeight[b.priority as keyof typeof priorityWeight] || 1);

      // Urgency multiplier for tenders closing soon
      const aUrgency = a.tenderCloseDate && new Date(a.tenderCloseDate).getTime() - Date.now() < 14 * 86400000 ? 1.5 : 1;
      const bUrgency = b.tenderCloseDate && new Date(b.tenderCloseDate).getTime() - Date.now() < 14 * 86400000 ? 1.5 : 1;

      const aScore = aBase * aMultiplier * aUrgency;
      const bScore = bBase * bMultiplier * bUrgency;

      return bScore - aScore;
    });
  }, [accountData?.opportunities, classifyLaneRelevance, getLaneMultiplier]);

  // ── Sorted stakeholders ──
  const sortedStakeholders = useMemo(() => {
    if (!accountData?.stakeholders) return [];
    return [...accountData.stakeholders].sort((a, b) => {
      // Sort by lane relevance of linked projects
      const aProjectLanes = a.linkedProjectIds.map((pid: number) => {
        const opp = accountData.opportunities.find((o: any) => o.id === pid);
        return opp?.productLane;
      });
      const bProjectLanes = b.linkedProjectIds.map((pid: number) => {
        const opp = accountData.opportunities.find((o: any) => o.id === pid);
        return opp?.productLane;
      });

      const aHasPrimary = aProjectLanes.some((l: any) => classifyLaneRelevance(l) === "primary");
      const bHasPrimary = bProjectLanes.some((l: any) => classifyLaneRelevance(l) === "primary");

      if (aHasPrimary && !bHasPrimary) return -1;
      if (!aHasPrimary && bHasPrimary) return 1;

      // Then by role relevance
      const roleOrder = { high: 0, medium: 1, low: 2 };
      const aRole = roleOrder[a.roleRelevance as keyof typeof roleOrder] ?? 3;
      const bRole = roleOrder[b.roleRelevance as keyof typeof roleOrder] ?? 3;
      return aRole - bRole;
    });
  }, [accountData?.stakeholders, accountData?.opportunities, classifyLaneRelevance]);

  // Stakeholder lane classification for display
  const stakeholderLaneRelevance = useCallback((s: any): "primary" | "adjacent" | "unclassified" => {
    if (!accountData?.opportunities) return "unclassified";
    const projectLanes = s.linkedProjectIds.map((pid: number) => {
      const opp = accountData.opportunities.find((o: any) => o.id === pid);
      return opp?.productLane;
    });
    if (projectLanes.some((l: any) => classifyLaneRelevance(l) === "primary")) return "primary";
    if (projectLanes.some((l: any) => classifyLaneRelevance(l) === "adjacent")) return "adjacent";
    return "unclassified";
  }, [accountData?.opportunities, classifyLaneRelevance]);

  // Focused mode: split stakeholders
  const primaryStakeholders = useMemo(() => {
    if (lensMode !== "focused") return sortedStakeholders;
    return sortedStakeholders.filter(s => stakeholderLaneRelevance(s) === "primary");
  }, [sortedStakeholders, lensMode, stakeholderLaneRelevance]);

  const adjacentStakeholders = useMemo(() => {
    if (lensMode !== "focused") return [];
    return sortedStakeholders.filter(s => stakeholderLaneRelevance(s) !== "primary");
  }, [sortedStakeholders, lensMode, stakeholderLaneRelevance]);

  // ── Auth guards ──
  if (authLoading) return <AccountAttackSkeleton />;
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-3xl font-bold text-navy tracking-wider">ATLAS COPCO</div>
          <p className="text-muted-foreground">Sign in to access Account Attack</p>
          <a href={getLoginUrl()} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-navy text-white font-semibold hover:bg-navy-light transition-colors">
            <LogIn className="w-4 h-4" /> Sign In
          </a>
        </div>
      </div>
    );
  }

  const hasAccount = !!accountData?.account;
  const hasOpportunities = sortedOpportunities.length > 0;
  const hasStakeholders = sortedStakeholders.length > 0;
  const hasContractors = (accountData?.contractors?.length || 0) > 0;
  const hasPairings = (accountData?.contractorPairings?.length || 0) > 0;
  const hasActionHistory = (accountData?.actionHistory?.length || 0) > 0;
  const hasCollateral = (accountData?.collateral?.length || 0) > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="bg-navy h-16 flex items-center px-4 sm:px-6 gap-4 sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <h1 className="text-white font-bold text-base sm:text-lg tracking-tight whitespace-nowrap flex items-center gap-2">
            <Crosshair className="w-5 h-5 text-gold" />
            Account Attack
          </h1>
          {selectedAccount && (
            <span className="text-slate-400 text-xs truncate hidden sm:block">
              {selectedAccount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <nav className="hidden lg:flex items-center gap-3 text-[11px]">
            <Link href="/" className="text-slate-300 hover:text-white flex items-center gap-1 transition-colors">
              <Flame className="w-3 h-3" /> This Week
            </Link>
            <span className="text-slate-700">|</span>
            <Link href="/dashboard" className="text-slate-300 hover:text-white flex items-center gap-1 transition-colors">
              <BarChart3 className="w-3 h-3" /> Dashboard
            </Link>
            <span className="text-slate-700">|</span>
            <Link href="/pipeline" className="text-slate-300 hover:text-white flex items-center gap-1 transition-colors">
              <Target className="w-3 h-3" /> Pipeline
            </Link>
            {user?.role === "admin" && (
              <>
                <span className="text-slate-700">|</span>
                <Link href="/admin" className="text-gold hover:text-gold-light flex items-center gap-1 transition-colors">
                  <Database className="w-3 h-3" /> Admin
                </Link>
              </>
            )}
            <span className="text-slate-700">|</span>
            <span className="text-slate-400 text-[11px]">{user?.name || user?.email}</span>
            <button onClick={() => logout()} className="text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
              <LogOut className="w-3 h-3" />
            </button>
          </nav>

          {/* Mobile nav */}
          <div className="lg:hidden relative">
            <button onClick={() => setShowNavMenu(v => !v)} className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {showNavMenu && (
              <div className="absolute right-0 top-full mt-2 w-44 bg-navy border border-white/10 rounded-lg shadow-xl z-50 py-1">
                <Link href="/" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setShowNavMenu(false)}>
                  <Flame className="w-4 h-4" /> This Week
                </Link>
                <Link href="/dashboard" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setShowNavMenu(false)}>
                  <BarChart3 className="w-4 h-4" /> Dashboard
                </Link>
                <Link href="/pipeline" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setShowNavMenu(false)}>
                  <Target className="w-4 h-4" /> Pipeline
                </Link>
                <Separator className="my-1 bg-white/10" />
                <button onClick={() => logout()} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="container py-5 sm:py-6 space-y-5">
        {/* Input Bar */}
        <InputBar
          accountName={accountName}
          setAccountName={setAccountName}
          lensMode={lensMode}
          setLensMode={setLensMode}
          laneFilter={laneFilter}
          setLaneFilter={setLaneFilter}
          searchResults={searchResults}
          isSearching={isSearching}
          onSelect={handleSelect}
        />

        {/* Loading state */}
        {isLoadingAccount && selectedAccount && (
          <div className="space-y-4">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-64 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </div>
        )}

        {/* No account selected */}
        {!selectedAccount && !isLoadingAccount && (
          <EmptyState
            icon={<Crosshair className="w-6 h-6 text-muted-foreground" />}
            title="Select an Account"
            description="Search for an account name above to load the account-planning cockpit. Start typing to see matching owners from your project database."
          />
        )}

        {/* Account not found — show close-match suggestions + External Prospect Mode */}
        {selectedAccount && !isLoadingAccount && !hasAccount && (
          <ExternalProspectPanel
            searchQuery={selectedAccount}
            onSelectMatch={(name: string) => {
              setAccountName(name);
              setSelectedAccount(name);
            }}
          />
        )}

        {/* ── Account loaded ── */}
        {hasAccount && accountData && (
          <>
            {/* Account Header */}
            <AccountHeader account={accountData.account} />

            {/* Current Opportunities */}
            <CollapsibleSection
              title="Current Opportunities"
              count={sortedOpportunities.length}
              defaultOpen={true}
              icon={<Target className="w-4 h-4 text-gold" />}
            >
              {/* Fix 1: Zero-primary-lane banner in Focused mode */}
              {lensMode === "focused" && userLane && primaryLaneProjectCount === 0 && hasOpportunities && (
                <div className="mx-4 mt-3 mb-1 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    <span className="font-semibold">No {primaryLaneLabel} projects found for this account.</span>{" "}
                    Showing all lanes — switch to <span className="font-semibold">Balanced</span> or <span className="font-semibold">Open</span> to explore.
                  </p>
                </div>
              )}
              {hasOpportunities ? (
                <div>
                  {sortedOpportunities.map(opp => (
                    <OpportunityRow
                      key={opp.id}
                      opp={opp}
                      navigate={navigate}
                      laneRelevance={classifyLaneRelevance(opp.productLane)}
                      lensMode={lensMode}
                    />
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground">No active opportunities found for this account.</p>
                </div>
              )}
            </CollapsibleSection>

            {/* Known Stakeholders */}
            <CollapsibleSection
              title="Known Stakeholders"
              count={sortedStakeholders.length}
              defaultOpen={true}
              icon={<Users className="w-4 h-4 text-teal" />}
            >
              {hasStakeholders ? (
                <div>
                  {/* In focused mode, show primary first, then collapsible adjacent */}
                  {lensMode === "focused" ? (
                    <>
                      {primaryStakeholders.length > 0 ? (
                        primaryStakeholders.map(s => (
                          <StakeholderRow key={s.id} s={s} laneRelevance="primary" />
                        ))
                      ) : (
                        <div className="px-4 py-3 text-[11px] text-muted-foreground italic">
                          {accountData.account?.accountType === "Government / Public Body" ? (
                            <span>
                              <span className="font-semibold not-italic text-muted-foreground">Government / Public Body</span> — direct contact enrichment is limited for government entities.
                              {" "}Engage via the <span className="font-semibold not-italic">contractor delivery chain</span> below, or monitor <span className="font-semibold not-italic">tender publications</span> for this account.
                            </span>
                          ) : (
                            "No stakeholders directly linked to your lane. Showing adjacent contacts below."
                          )}
                        </div>
                      )}
                      {adjacentStakeholders.length > 0 && (
                        <>
                          <button
                            className="w-full px-4 py-2 text-[11px] font-semibold text-muted-foreground hover:text-navy hover:bg-slate-50 transition-colors flex items-center gap-2"
                            onClick={() => setShowMoreStakeholders(v => !v)}
                          >
                            {showMoreStakeholders ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            Show {adjacentStakeholders.length} adjacent-lane contact{adjacentStakeholders.length !== 1 ? "s" : ""}
                          </button>
                          {showMoreStakeholders && adjacentStakeholders.map(s => (
                            <StakeholderRow key={s.id} s={s} laneRelevance={stakeholderLaneRelevance(s)} />
                          ))}
                        </>
                      )}
                    </>
                  ) : (
                    sortedStakeholders.map(s => (
                      <StakeholderRow key={s.id} s={s} laneRelevance={stakeholderLaneRelevance(s)} />
                    ))
                  )}
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  {accountData.account?.accountType === "Government / Public Body" ? (
                    <>
                      <p className="text-xs text-muted-foreground font-medium">Government / Public Body</p>
                      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed max-w-xs mx-auto">
                        Direct contact enrichment is limited for government entities. Engage via the
                        <span className="font-semibold"> contractor delivery chain</span> below, or monitor
                        <span className="font-semibold"> tender publications</span> for this account.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">No enriched contacts yet for this account.</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Open a project card and run enrichment to discover stakeholders.</p>
                    </>
                  )}
                </div>
              )}
            </CollapsibleSection>

            {/* Contractor & Delivery Chain */}
            <CollapsibleSection
              title="Contractor & Delivery Chain"
              count={(accountData.contractors?.length || 0) + (accountData.contractorPairings?.length || 0)}
              defaultOpen={hasContractors || hasPairings}
              icon={<HardHat className="w-4 h-4 text-navy" />}
            >
              {hasContractors || hasPairings ? (
                <div>
                  {hasContractors && (
                    <>
                      <div className="px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-slate-50">
                        Linked Contractors
                      </div>
                      {accountData.contractors!.map((c: any) => (
                        <ContractorRow key={c.id} c={c} />
                      ))}
                    </>
                  )}
                  {hasPairings && (
                    <>
                      <div className="px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-slate-50">
                        Known Pairings
                      </div>
                      {accountData.contractorPairings!.map((p: any) => (
                        <PairingRow key={p.id} p={p} />
                      ))}
                    </>
                  )}
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground">No contractor chain identified yet for this account.</p>
                </div>
              )}
            </CollapsibleSection>

            {/* ── Phase 2: AI Research Synthesis ── */}
            <AccountResearchPanel
              accountName={selectedAccount}
              accountData={accountData}
              lensMode={lensMode}
              userLane={userLane}
              primaryLaneLabel={primaryLaneLabel}
            />

            {/* Action History — only if populated */}
            {hasActionHistory && (
              <CollapsibleSection
                title="Action History"
                count={accountData.actionHistory!.length}
                defaultOpen={false}
                icon={<Clock className="w-4 h-4 text-muted-foreground" />}
              >
                <div>
                  {accountData.actionHistory!.map((a: any, i: number) => (
                    <ActionHistoryRow key={a.id || i} a={a} />
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Collateral Match — only if populated */}
            {hasCollateral && (
              <CollapsibleSection
                title="Matched Collateral"
                count={accountData.collateral!.length}
                defaultOpen={false}
                icon={<FileText className="w-4 h-4 text-muted-foreground" />}
              >
                <div>
                  {accountData.collateral!.map((c: any) => (
                    <CollateralRow key={c.id} c={c} />
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Fix 6: Sparse-state bottom note — shown when no action history or collateral is present.
                Ensures the page feels intentionally complete rather than abandoned. */}
            {!hasActionHistory && !hasCollateral && (
              <div className="mt-2 mb-4 mx-4 rounded-lg border border-dashed border-border px-4 py-3 text-center">
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-semibold">No action history or collateral on file.</span>
                  {" "}Log your first touchpoint or attach a flyer via the project cards above.
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
