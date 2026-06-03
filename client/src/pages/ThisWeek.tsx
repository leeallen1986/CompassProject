/**
 * "This Week" — Redesigned Action Board
 * Clean, low-noise, action-focused weekly dashboard for sales reps.
 * Structure: Header → 5-pill KPI strip → Top 3 Action cards → Collapsible sections
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation, Link } from "wouter";
import {
  Flame, TrendingUp, Users, ArrowRight,
  MapPin, Calendar, ChevronRight, Sparkles, Target,
  BarChart3, LogOut, Database, Loader2, LogIn,
  AlertTriangle, Search, Clock, X, Zap,
  ChevronDown, ChevronUp, MoreHorizontal, Crosshair,
  UserCircle, Layers, Megaphone, Settings, Shield,
  Droplets, ExternalLink, Package,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { getLoginUrl } from "@/const";
import ScopeBar, { type ScopeMode } from "@/components/ScopeBar";
import { LaneBadge } from "@/components/LaneBadge";

// ── Sykes Pump Range Section ──
const SYKES_SERIES_LABELS: Record<string, { short: string; color: string; models: string }> = {
  "Acoustic": { short: "Acoustic", color: "bg-slate-100 text-slate-700 border-slate-200", models: "Noise-attenuated enclosures" },
  "MH": { short: "Medium Head", color: "bg-blue-50 text-blue-700 border-blue-200", models: "MH150, MH220, MH300, MH450" },
  "HH": { short: "High Head", color: "bg-indigo-50 text-indigo-700 border-indigo-200", models: "HH80, HH135, HH160i, HH220i, HH300" },
  "XH": { short: "Extra High Head", color: "bg-violet-50 text-violet-700 border-violet-200", models: "XH100, XH150, XH200, XH250, XH300" },
  "CP": { short: "Contractor Low Head", color: "bg-amber-50 text-amber-700 border-amber-200", models: "CP80i, CP100i, CP150i, CP220i, CP300i, CP310" },
  "SW": { short: "Sewage & Waste", color: "bg-rose-50 text-rose-700 border-rose-200", models: "SW100, SW150, SW250, SW310" },
  "Yakka": { short: "Yakka V2", color: "bg-emerald-50 text-emerald-700 border-emerald-200", models: "Yakka V2 150, V2 100, V2 SW100, V2 HH80" },
};

function getSykesSeries(name: string): string {
  if (name.includes("Acoustic")) return "Acoustic";
  if (name.includes("Medium Head") || name.includes("MH Series")) return "MH";
  if (name.includes("Extra High Head") || name.includes("XH Series")) return "XH";
  if (name.includes("High Head") || name.includes("HH Series")) return "HH";
  if (name.includes("Contractor") || name.includes("CP Series")) return "CP";
  if (name.includes("Sewage") || name.includes("SW Series")) return "SW";
  if (name.includes("Yakka")) return "Yakka";
  return "Other";
}

function SykesPumpRangeSection({ profile }: { profile: any }) {
  const [open, setOpen] = useState(false);
  const isAuthenticated = !!profile;

  // Only show for pump-line reps
  const assignedBLs: string[] = profile?.assignedBusinessLines ?? [];
  const hasPumpBL = assignedBLs.some(bl =>
    bl.toLowerCase().includes("pump") ||
    bl.toLowerCase().includes("dewater") ||
    bl.toLowerCase().includes("flow")
  );
  if (!hasPumpBL) return null;

  const { data: sykesPumps, isLoading } = trpc.collateral.list.useQuery(
    { productLine: "dewatering" },
    { enabled: isAuthenticated, staleTime: 10 * 60 * 1000 }
  );

  const sykesItems = (sykesPumps ?? []).filter(item => item.name.startsWith("Sykes"));

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/30 overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-blue-50/60 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <Droplets className="w-4 h-4 text-blue-600 shrink-0" />
        <span className="font-semibold text-navy text-sm flex-1">Sykes Pump Range</span>
        <span className="text-[10px] font-bold text-blue-700 bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-full mr-1">
          NEW
        </span>
        <span className="text-xs font-bold text-navy bg-slate-100 px-2.5 py-0.5 rounded-full">{sykesItems.length}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-blue-200">
          <div className="px-5 py-3 bg-blue-50/50 border-b border-blue-100">
            <p className="text-xs text-blue-800">
              <strong>Sykes Group</strong> pumps have been added to your portfolio. Each range below is matched against active hot/warm projects in your territory.
              <a href="https://sykesgroup.com/product-category/pumps/" target="_blank" rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold underline-offset-2 hover:underline">
                View Sykes catalogue <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>

          {isLoading ? (
            <div className="px-5 py-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading pump range...
            </div>
          ) : sykesItems.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-5 py-4">No Sykes pump items found.</p>
          ) : (
            <div className="divide-y divide-blue-100">
              {sykesItems.map((item: any) => {
                const seriesKey = getSykesSeries(item.name);
                const seriesInfo = SYKES_SERIES_LABELS[seriesKey];
                return (
                  <div key={item.id} className="flex items-center gap-3 px-5 py-3 hover:bg-blue-50/40 transition-colors">
                    <Package className="w-4 h-4 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-navy">{item.name}</span>
                        {seriesInfo && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${seriesInfo.color}`}>
                            {seriesInfo.short}
                          </span>
                        )}
                      </div>
                      {seriesInfo && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{seriesInfo.models}</div>
                      )}
                    </div>
                    {item.matchCount > 0 && (
                      <a
                        href={`/dashboard?collateralId=${item.id}`}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                      >
                        {item.matchCount} projects
                      </a>
                    )}
                    <a
                      href={item.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" /> View
                    </a>
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-5 py-3 border-t border-blue-100 bg-blue-50/30">
            <a
              href="/collateral?filter=dewatering"
              className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 transition-colors"
            >
              View all dewatering collateral in library <ChevronRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dismiss Button ──
function DismissButton({ actionKey }: { actionKey: string }) {
  const [dismissed, setDismissed] = useState(false);
  const utils = trpc.useUtils();
  const dismissMutation = trpc.thisWeek.dismissAction.useMutation({
    onSuccess: () => {
      setDismissed(true);
      utils.thisWeek.summary.invalidate();
    },
  });
  if (dismissed) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        dismissMutation.mutate({ actionKey, reason: "dismissed" });
      }}
      disabled={dismissMutation.isPending}
      className="shrink-0 p-1 rounded text-muted-foreground hover:text-hot hover:bg-hot/10 transition-colors"
      title="Dismiss"
    >
      {dismissMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
    </button>
  );
}

// ── Priority badge helper ──
function priorityBadgeClass(priority: string) {
  if (priority === "hot") return "bg-hot text-white";
  if (priority === "warm") return "bg-warm text-navy";
  return "bg-cold text-white";
}

// ── Status badge for rows ──
function StatusBadge({ type }: { type: "action_ready" | "closing_soon" | "discovery_needed" }) {
  const config = {
    action_ready: { label: "Action-ready", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    closing_soon: { label: "Closing within 14 days", bg: "bg-hot/10 text-hot border-hot/20" },
    discovery_needed: { label: "Find contacts", bg: "bg-amber-50 text-amber-700 border-amber-200" },
  };
  const c = config[type];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${c.bg}`}>
      {c.label}
    </span>
  );
}

// ── Contact CTA Badge (Part B) ──
function ContactCTABadge({ project }: { project: any }) {
  const cta = project?.contactCTA;
  if (!cta) return <StatusBadge type="discovery_needed" />;

  const queueMutation = trpc.thisWeek.triggerDiscovery.useMutation();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cta.action === "find_contacts" || cta.action === "refresh_contacts") {
      queueMutation.mutate({ projectId: project.id });
    }
  };

  if (cta.action === "view_best") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
        <UserCircle className="w-3 h-3" />
        {cta.contactName?.split(" ")[0] ?? "Contact"}
        <span className="opacity-60">· {cta.trustTier?.replace(/_/g, " ")}</span>
      </span>
    );
  }

  if (cta.action === "why_no_contacts") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border bg-slate-50 text-slate-500 border-slate-200" title={cta.blockedReason}>
        <AlertTriangle className="w-3 h-3" />
        Blocked
      </span>
    );
  }

  if (cta.action === "refresh_contacts") {
    return (
      <button
        onClick={handleClick}
        disabled={queueMutation.isPending}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors"
      >
        {queueMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
        {queueMutation.isSuccess ? "Queued" : cta.label}
      </button>
    );
  }

  // find_contacts
  return (
    <button
      onClick={handleClick}
      disabled={queueMutation.isPending}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 transition-colors"
    >
      {queueMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
      {queueMutation.isSuccess ? "Queued ✓" : "Find Contacts"}
    </button>
  );
}

// ── Scope Reason Chip ──
function ScopeReasonChip({ reason }: { reason?: string }) {
  if (!reason) return null;
  const isCrossSell = reason.toLowerCase().includes("cross-sell");
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${
      isCrossSell
        ? "bg-gold/10 text-gold-dark border-gold/20"
        : "bg-teal/10 text-teal border-teal/20"
    }`}>
      {reason}
    </span>
  );
}

// ── Collapsible Section ──
function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  icon,
  viewAllHref,
  viewAllLabel,
  children,
  emptyMessage,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  icon: React.ReactNode;
  viewAllHref?: string;
  viewAllLabel?: string;
  children: React.ReactNode;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <span className="font-semibold text-navy text-sm flex-1">{title}</span>
        <span className="text-xs font-bold text-navy bg-slate-100 px-2.5 py-0.5 rounded-full">{count}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border">
          {count === 0 ? (
            <p className="text-xs text-muted-foreground italic px-5 py-4">{emptyMessage || "Nothing here this week."}</p>
          ) : (
            <>
              {children}
              {viewAllHref && count > 3 && (
                <div className="px-5 py-3 border-t border-border">
                  <Link href={viewAllHref} className="text-xs text-teal hover:text-teal-light font-semibold flex items-center gap-1 transition-colors">
                    {viewAllLabel || `View all ${title.toLowerCase()} (${count})`} <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pump Action Mode Badge ──
const PUMP_ACTION_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  direct_pursue: { label: "Direct Pursue", color: "bg-emerald-50 text-emerald-700 border-emerald-200", description: "Known account, active site — go direct" },
  map_package: { label: "Map Package", color: "bg-blue-50 text-blue-700 border-blue-200", description: "Multiple pump needs — build a package" },
  find_site_contact: { label: "Find Site Contact", color: "bg-amber-50 text-amber-700 border-amber-200", description: "Good project, need the right person on-site" },
  watch_incumbent: { label: "Watch Incumbent", color: "bg-slate-50 text-slate-600 border-slate-200", description: "Competitor entrenched — monitor for openings" },
  account_nurture: { label: "Account Nurture", color: "bg-violet-50 text-violet-700 border-violet-200", description: "Priority account — build relationship" },
  reference_only: { label: "Reference Only", color: "bg-slate-50 text-slate-400 border-slate-200", description: "Low fit — track for context" },
};

function PumpActionBadge({ mode, matchedAccount, compact }: { mode: string; matchedAccount?: string | null; compact?: boolean }) {
  const config = PUMP_ACTION_CONFIG[mode];
  if (!config) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${config.color}`}>
        <Crosshair className="w-3 h-3" />
        {config.label}
      </span>
      {matchedAccount && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-gold/10 text-gold-dark border border-gold/25">
          <Target className="w-3 h-3" /> {matchedAccount}
        </span>
      )}
      {!compact && (
        <span className="text-[10px] text-muted-foreground italic">{config.description}</span>
      )}
    </div>
  );
}

// ── Top 3 Action Card ──
function TopActionCard({ action, project, navigate }: { action: any; project: any; navigate: (path: string) => void }) {
  // Determine card badge from contactCTA state
  const cta = project?.contactCTA;
  const hasContact = cta?.action === "view_best";
  const badgeLabel = hasContact ? "Action-ready" : cta?.label ?? "Find contacts";
  const badgeColor = hasContact
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : cta?.action === "why_no_contacts" ? "bg-slate-50 text-slate-500 border-slate-200"
    : cta?.action === "refresh_contacts" ? "bg-blue-50 text-blue-700 border-blue-200"
    : "bg-amber-50 text-amber-700 border-amber-200";
  const badgeIcon = hasContact
    ? <Zap className="w-3 h-3" />
    : cta?.action === "why_no_contacts" ? <AlertTriangle className="w-3 h-3" />
    : cta?.action === "refresh_contacts" ? <Clock className="w-3 h-3" />
    : <Search className="w-3 h-3" />;

  // Prefer lane scoring fields when available
  const pitch = project?.whyNow
    ? project.whyNow.slice(0, 140)
    : project?.whyItMatters
    ? project.whyItMatters.slice(0, 140)
    : project?.overview
    ? project.overview.slice(0, 140)
    : action.description?.slice(0, 140) || "";

  const nextAction = project?.bestNextMove || project?.suggestedAction || action.description || "Review project details.";
  const routeToBuy = project?.routeToBuy || "";
  const laneFitLabel: string = project?.laneFitLabel || "";
  const channel: string = project?.channel || "";
  const bestProductAngle: string = project?.bestProductAngle || "";
  const airFit: string = project?.airFit || "None";

  const channelColors: Record<string, string> = {
    direct: "bg-navy/10 text-navy",
    rental: "bg-teal/10 text-teal",
    crosssell: "bg-gold/15 text-gold-dark",
    monitor: "bg-slate-100 text-slate-500",
  };
  const laneFitColors: Record<string, string> = {
    High: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Medium: "bg-blue-50 text-blue-700 border-blue-200",
    Low: "bg-slate-50 text-slate-500 border-slate-200",
    "Not relevant": "bg-slate-50 text-slate-400 border-slate-200",
  };

  return (
    <div
      className="flex flex-col gap-3 p-5 rounded-xl border border-border bg-card cursor-pointer hover:shadow-lg hover:border-navy/20 transition-all group"
      onClick={() => project?.id && navigate(`/project/${project.id}?from=top3`)}
    >
      {/* Badge row: action-ready + lane fit + channel */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${badgeColor}`}>
          {badgeIcon} {badgeLabel}
        </span>
        {laneFitLabel && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${laneFitColors[laneFitLabel] || "bg-slate-50 text-slate-400 border-slate-200"}`}>
            {laneFitLabel} fit
          </span>
        )}
        {channel && channel !== "monitor" && channel !== "rental" && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${channelColors[channel] || "bg-slate-100 text-slate-500"}`}>
            {channel === "direct" ? "Direct sale" : channel === "crosssell" ? "Cross-sell" : channel}
          </span>
        )}
        {bestProductAngle && bestProductAngle !== "Monitor" && airFit !== "None" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200">
            🛠️ {bestProductAngle}
          </span>
        )}
        {action.actionKey && (
          <span className="ml-auto">
            <DismissButton actionKey={action.actionKey} />
          </span>
        )}
      </div>

      {/* Pump Action Mode badge */}
      {project?.pumpActionMode && (
        <PumpActionBadge mode={project.pumpActionMode} matchedAccount={project.matchedAccountPrior} compact />
      )}

      {/* Project title */}
      <h3 className="text-sm font-bold text-navy leading-snug line-clamp-2">
        {project?.name || action.projectName || action.title}
      </h3>

      {/* Short pitch */}
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{pitch}</p>

      {/* Contact state */}
      {hasContact ? (
        <div className="flex items-center gap-2 text-xs">
          <UserCircle className="w-4 h-4 text-navy shrink-0" />
          <div className="min-w-0">
            <span className="font-semibold text-navy">{project.bestStakeholder.name}</span>
            {project.bestStakeholder.title && (
              <span className="text-muted-foreground">, {project.bestStakeholder.title}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs">
          <Users className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-amber-600 font-medium">
            Role gap
          </span>
          <span className="text-muted-foreground">
            Identify {project?.sector === "mining" ? "Maintenance or Procurement" : "key"} contact
          </span>
        </div>
      )}

      {/* Route to buy */}
      {routeToBuy && (
        <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0 font-semibold text-navy/60">Route:</span>
          <span className="line-clamp-1">{routeToBuy}</span>
        </div>
      )}

      {/* Best next move */}
      <div className="flex items-start gap-2 mt-auto pt-1">
        <ArrowRight className="w-3.5 h-3.5 text-gold shrink-0 mt-0.5" />
        <p className="text-xs text-foreground/80 leading-relaxed line-clamp-2">{nextAction}</p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end pt-1 border-t border-border/50">
        <span className="text-xs text-teal font-semibold flex items-center gap-1 group-hover:text-teal-light transition-colors">
          Detail <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </div>
  );
}

// ── Compact Project Row ──
function CompactProjectRow({
  project,
  navigate,
  statusType,
  extraInfo,
}: {
  project: any;
  navigate: (path: string) => void;
  statusType?: "action_ready" | "closing_soon" | "discovery_needed";
  extraInfo?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50 transition-colors cursor-pointer border-b border-border last:border-0"
      onClick={() => navigate(`/project/${project.id}`)}
    >
      {/* Project name + context */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-navy truncate">{project.name}</div>
        {project.overview && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {project.overview.slice(0, 80)}
          </div>
        )}
      </div>

      {/* Location */}
      <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
        <MapPin className="w-3 h-3" />{project.location}
      </span>

      {/* Lane fit + channel chips */}
      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        {project.laneFitLabel && project.laneFitLabel !== "Not relevant" && (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
            project.laneFitLabel === "High" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
            project.laneFitLabel === "Medium" ? "bg-blue-50 text-blue-700 border-blue-200" :
            "bg-slate-50 text-slate-500 border-slate-200"
          }`}>
            {project.laneFitLabel}
          </span>
        )}
        {project.channel && project.channel !== "monitor" && project.channel !== "rental" && (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${
            project.channel === "direct" ? "bg-navy/10 text-navy" :
            project.channel === "crosssell" ? "bg-gold/15 text-gold-dark" :
            "bg-slate-100 text-slate-500"
          }`}>
            {project.channel === "direct" ? "Direct sale" :
             project.channel === "crosssell" ? "Cross-sell" :
             project.channel}
          </span>
        )}
        {project.bestProductAngle && project.bestProductAngle !== "Monitor" && project.airFit && project.airFit !== "None" && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200">
            🛠️ {project.bestProductAngle}
          </span>
        )}
        {project.scopeReason && <ScopeReasonChip reason={project.scopeReason} />}
      </div>

      {/* Extra info (e.g. closing date) */}
      {extraInfo}

      {/* Status badge */}
      {statusType && <StatusBadge type={statusType} />}

      {/* Chevron */}
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}

// ── Loading skeleton ──
function ThisWeekSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy h-16" />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="flex gap-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 flex-1 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
      </main>
    </div>
  );
}

// ── Login page ──
function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="text-3xl font-bold text-navy tracking-wider">ATLAS COPCO</div>
        <p className="text-muted-foreground">Sign in to view your weekly intelligence summary</p>
        <a
          href="/login"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-navy text-white font-semibold hover:bg-navy-light transition-colors"
        >
          <LogIn className="w-4 h-4" /> Sign In
        </a>
      </div>
    </div>
  );
}

// ── Main Component ──
export default function ThisWeek() {
  const { user, loading: authLoading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const [showNavMenu, setShowNavMenu] = useState(false);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("strict");
  const top3Ref = useRef<HTMLElement | null>(null);

  // Scroll to section when ?section= is in the URL
  const mustActRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    if (section === "top3" && top3Ref.current) {
      const timer = setTimeout(() => {
        top3Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
      return () => clearTimeout(timer);
    }
    if (section === "must_act" && mustActRef.current) {
      const timer = setTimeout(() => {
        mustActRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, []);  // Run once on mount

  const { data: summary, isLoading } = trpc.thisWeek.summary.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const { data: profile, isLoading: profileLoading } = trpc.profile.get.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 0,
  });

  // Live tenders closing within 14 days
  const { data: closingSoonProjects } = trpc.report.closingSoon.useQuery(
    { daysAhead: 14 },
    { enabled: isAuthenticated, staleTime: 10 * 60 * 1000 }
  );

  // ── Destructure summary ──
  const topProjects: any[] = summary?.topProjects ?? [];
  const suggestedActions: any[] = summary?.suggestedActions ?? [];
  const stats = summary?.stats ?? {
    totalInScope: 0, hotCount: 0, warmCount: 0,
    actionReadyCount: 0, needDiscoveryCount: 0, closingSoonCount: 0,
    tier1Count: 0, tier2Count: 0, tier3Count: 0,
    totalProjects: 0, newProjectsThisWeek: 0, newContactsThisWeek: 0,
    highRelevanceContacts: 0, projectsWithContractors: 0, projectsMissingContractors: 0,
  };
  const weekLabel: string = summary?.weekLabel ?? "";
  const userContext = summary?.userContext;
  const dataFreshnessWarning = summary?.dataFreshnessWarning;

  // ── Scope filtering ──
  const scopedProjects = useMemo(() => {
    if (scopeMode === "open") return topProjects;
    if (scopeMode === "balanced") {
      return topProjects.filter((p: any) => {
        const reason = (p.scopeReason ?? "").toLowerCase();
        return !reason.includes("outside primary");
      });
    }
    return topProjects.filter((p: any) => p.laneMatch !== false);
  }, [topProjects, scopeMode]);

  // ── Derived lists ──
  const actionReadyProjects = useMemo(() => {
    return scopedProjects.filter((p: any) =>
      p.bestStakeholder && (p.priority === "hot" || p.priority === "warm")
    );
  }, [scopedProjects]);

  const waitingOnDiscovery = useMemo(() => {
    return scopedProjects.filter((p: any) => {
      // Part C: Only show commercially relevant projects in the contact CTA section
      // Must be hot/warm, no send-ready contact, AND have decent lane fit + route-to-buy
      if (p.bestStakeholder) return false;
      if (p.priority !== "hot" && p.priority !== "warm") return false;
      // Suppress weak projects: must have at least Medium lane fit or be a direct/crosssell channel
      const laneFit = p.laneFitLabel ?? "Not relevant";
      const channel = p.channel ?? "monitor";
      if (laneFit === "Not relevant" && channel === "monitor") return false;
      if (laneFit === "Low" && channel === "monitor") return false;
      return true;
    });
  }, [scopedProjects]);

  const closingSoon = useMemo(() => {
    return (closingSoonProjects ?? []).filter((p: any) =>
      p.priority === "hot" || p.priority === "warm"
    );
  }, [closingSoonProjects]);

  // Top 3 Actions — from suggestedActions, enriched with project data
  const topActions = useMemo(() => {
    return suggestedActions.slice(0, 3).map((action: any) => {
      const project = scopedProjects.find((p: any) => p.id === action.projectId) ||
                      topProjects.find((p: any) => p.id === action.projectId);
      return { action, project };
    });
  }, [suggestedActions, scopedProjects, topProjects]);

  // KPI counts
  const hotCount = useMemo(() => scopedProjects.filter((p: any) => p.priority === "hot").length, [scopedProjects]);
  const warmCount = useMemo(() => scopedProjects.filter((p: any) => p.priority === "warm").length, [scopedProjects]);

  // Week date range for display
  const weekDisplay = useMemo(() => {
    if (!weekLabel) return "";
    try {
      const d = new Date(weekLabel);
      const end = new Date(d);
      end.setDate(end.getDate() + 6);
      const fmt = (dt: Date) => dt.toLocaleDateString("en-AU", { day: "numeric" });
      const monthFmt = (dt: Date) => dt.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
      return `Week of ${fmt(d)} – ${fmt(end)} ${monthFmt(end)}`;
    } catch {
      return weekLabel;
    }
  }, [weekLabel]);

  // ── Early returns ──
  if (authLoading) return <ThisWeekSkeleton />;
  if (!isAuthenticated) return <LoginPage />;
  if (profileLoading) return <ThisWeekSkeleton />;
  if (profile === null || (profile && !profile.onboardingCompleted)) {
    navigate("/onboarding");
    return <ThisWeekSkeleton />;
  }
  if (isLoading || !summary) return <ThisWeekSkeleton />;

  return (
    <div className="min-h-screen bg-background">

      {/* ── Header — 64px navy bar ── */}
      <header className="bg-navy h-16 flex items-center px-4 sm:px-6 gap-4 sticky top-0 z-30 shadow-sm">
        {/* Left: Logo + brand */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded bg-gold/20 flex items-center justify-center">
            <span className="text-gold font-bold text-sm">A</span>
          </div>
          <span className="text-white font-bold text-base tracking-tight hidden sm:block">ATLAS</span>
        </div>

        {/* Center: Nav links */}
        <nav className="hidden lg:flex items-center gap-1 flex-1 justify-center">
          <Link href="/" className="px-3 py-1.5 rounded-md text-sm font-semibold text-white bg-white/10">
            Dashboard
          </Link>
          <Link href="/pipeline" className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
            Pipeline
          </Link>
          <Link href="/account-attack" className="px-3 py-1.5 rounded-md text-sm font-medium text-gold hover:text-gold-light hover:bg-white/5 transition-colors">
            Account Attack
          </Link>
          <Link href="/account-priors" className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
            WA Targets
          </Link>
          <Link href="/my-profile" className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
            My Style
          </Link>
          {user?.role === "admin" && (
            <Link href="/admin" className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
              Admin
            </Link>
          )}
        </nav>

        {/* Right: User */}
        <div className="flex items-center gap-3 shrink-0 ml-auto lg:ml-0">
          {dataFreshnessWarning && (
            <span className="hidden sm:flex items-center gap-1 text-[11px] text-amber-400">
              <AlertTriangle className="w-3 h-3" />
            </span>
          )}
          <div className="hidden sm:flex items-center gap-2 text-sm text-slate-300">
            <span>{user?.name || user?.email}</span>
          </div>
          {(userContext?.territories?.length ?? 0) > 0 && (
            <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 text-slate-300 text-[11px] font-medium">
              {userContext?.territories?.[0]}
            </span>
          )}
          <button onClick={() => logout()} className="text-slate-400 hover:text-white p-1 transition-colors hidden lg:block">
            <LogOut className="w-4 h-4" />
          </button>

          {/* Mobile menu */}
          <div className="lg:hidden relative">
            <button
              onClick={() => setShowNavMenu(v => !v)}
              className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {showNavMenu && (
              <div className="absolute right-0 top-full mt-2 w-44 bg-navy border border-white/10 rounded-lg shadow-xl z-50 py-1">
                <Link href="/" className="flex items-center gap-2 px-4 py-2 text-sm text-white hover:bg-white/10" onClick={() => setShowNavMenu(false)}>
                  <BarChart3 className="w-4 h-4" /> Dashboard
                </Link>
                <Link href="/pipeline" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10" onClick={() => setShowNavMenu(false)}>
                  <Target className="w-4 h-4" /> Pipeline
                </Link>
                <Link href="/account-attack" className="flex items-center gap-2 px-4 py-2 text-sm text-gold hover:text-gold-light hover:bg-white/10" onClick={() => setShowNavMenu(false)}>
                  <Crosshair className="w-4 h-4" /> Account Attack
                </Link>
                <Link href="/account-priors" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10" onClick={() => setShowNavMenu(false)}>
                  <Target className="w-4 h-4" /> WA Targets
                </Link>
                <Link href="/my-profile" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10" onClick={() => setShowNavMenu(false)}>
                  <Sparkles className="w-4 h-4" /> My Style
                </Link>
                {user?.role === "admin" && (
                  <Link href="/admin" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10" onClick={() => setShowNavMenu(false)}>
                    <Database className="w-4 h-4" /> Admin
                  </Link>
                )}
                <Separator className="my-1 bg-white/10" />
                <button onClick={() => logout()} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/10">
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Page title + week + territory ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-navy">This Week</h1>
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium border border-slate-200">
            <Calendar className="w-3.5 h-3.5 mr-1.5" />
            {weekDisplay}
          </span>
          {(userContext?.territories?.length ?? 0) > 0 && (
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium border border-slate-200">
              <MapPin className="w-3.5 h-3.5 mr-1.5" />
              {userContext?.territories?.join(", ")}
            </span>
          )}
        </div>

        {/* ── KPI Strip ── */}
        <ValidateFirstKPIStrip
          hotCount={hotCount}
          warmCount={warmCount}
          actionReadyCount={actionReadyProjects.length}
          waitingOnDiscoveryCount={waitingOnDiscovery.length}
          closingSoonCount={closingSoon.length}
        />

        {/* ── Top 3 Actions ── */}
        <section id="top3" ref={top3Ref}>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-gold" />
            <h2 className="text-lg font-bold text-navy">Top 3 Actions</h2>
          </div>
          {topActions.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No urgent actions this week. All projects are either in progress or waiting on discovery.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {topActions.map(({ action, project }, i) => (
                <TopActionCard key={action.actionKey || i} action={action} project={project} navigate={navigate} />
              ))}
            </div>
          )}
        </section>

        {/* ── Collapsible: Action-ready (Must Act) ── */}
        <div id="must_act" ref={mustActRef} />
        <CollapsibleSection
          title="Action-ready"
          count={actionReadyProjects.length}
          defaultOpen={true}
          icon={<Zap className="w-4 h-4 text-emerald-600" />}
          viewAllHref="/dashboard?tab=projects&filter=action_ready"
          viewAllLabel={`View all action-ready (${actionReadyProjects.length})`}
          emptyMessage="No action-ready projects this week."
        >
          <div>
            {actionReadyProjects.slice(0, 6).map((project: any) => (
              <CompactProjectRow
                key={project.id}
                project={project}
                navigate={navigate}
                statusType="action_ready"
              />
            ))}
          </div>
        </CollapsibleSection>

        {/* ── Collapsible: Closing Soon ── */}
        <CollapsibleSection
          title="Closing soon"
          count={closingSoon.length}
          defaultOpen={closingSoon.length > 0}
          icon={<Clock className="w-4 h-4 text-hot" />}
          viewAllHref="/dashboard?tab=live-tenders"
          viewAllLabel={`View all closing soon (${closingSoon.length})`}
          emptyMessage="No live tenders closing within 14 days."
        >
          <div>
            {closingSoon.slice(0, 6).map((project: any) => {
              const daysLeft = project.tenderCloseDate
                ? Math.ceil((new Date(project.tenderCloseDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null;
              return (
                <CompactProjectRow
                  key={project.id}
                  project={project}
                  navigate={navigate}
                  statusType="closing_soon"
                  extraInfo={
                    daysLeft !== null ? (
                      <span className={`text-[11px] font-semibold shrink-0 ${daysLeft <= 7 ? "text-hot" : "text-amber-600"}`}>
                        Closing within {daysLeft} days
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        </CollapsibleSection>

        {/* ── Sykes Pump Range ── */}
        <SykesPumpRangeSection profile={profile} />

        {/* ── Collapsible: Contact Actions ── */}
        <CollapsibleSection
          title="Contact actions"
          count={waitingOnDiscovery.length}
          defaultOpen={waitingOnDiscovery.length > 0 && waitingOnDiscovery.length <= 10}
          icon={<Users className="w-4 h-4 text-amber-500" />}
          viewAllHref="/pipeline?filter=discovery_needed"
          viewAllLabel={`View all (${waitingOnDiscovery.length})`}
          emptyMessage="All commercially relevant projects have identified contacts."
        >
          <div>
            {waitingOnDiscovery.slice(0, 8).map((project: any) => (
              <div
                key={project.id}
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50 transition-colors cursor-pointer border-b border-border last:border-0"
                onClick={() => navigate(`/project/${project.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-navy truncate">{project.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {project.laneFitLabel && project.laneFitLabel !== "Not relevant" && (
                      <span className="mr-2">{project.laneFitLabel} fit</span>
                    )}
                    {project.channel && project.channel !== "monitor" && (
                      <span className="mr-2">· {project.channel === "direct" ? "Direct sale" : project.channel === "crosssell" ? "Cross-sell" : project.channel}</span>
                    )}
                    {project.location}
                  </div>
                </div>
                <ContactCTABadge project={project} />
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </div>
            ))}
          </div>
        </CollapsibleSection>

      </main>
    </div>
  );
}

// ── Gate Summary Banner ──
// Shows digest readiness status: how many demoted projects are gated as digest-safe,
// whether the territory threshold is met, and a link to the validation workflow.
function GateSummaryBanner() {
  const { data, isLoading } = trpc.contactValidation.getGateSummary.useQuery(undefined, {
    staleTime: 120_000,
  });

  if (isLoading || !data) return null;

  const { demotedTotal, digestSafeCount, thresholdMet, totalDigestSafe, minThreshold } = data;

  // Only show the banner if there are demoted projects or the threshold is not yet met
  if (demotedTotal === 0 && thresholdMet) return null;

  const allDemotedGated = digestSafeCount >= demotedTotal && demotedTotal > 0;

  return (
    <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 flex-wrap ${
      thresholdMet
        ? "bg-emerald-50 border-emerald-200"
        : "bg-amber-50 border-amber-200"
    }`}>
      <Shield className={`w-4 h-4 shrink-0 ${
        thresholdMet ? "text-emerald-600" : "text-amber-500"
      }`} />
      <div className="flex-1 min-w-0">
        {thresholdMet ? (
          <p className="text-sm font-semibold text-emerald-700">
            Digest threshold met — {totalDigestSafe} digest-safe items ready
            {demotedTotal > 0 && !allDemotedGated && (
              <span className="font-normal text-emerald-600">
                {" "}({digestSafeCount} of {demotedTotal} demoted projects gated)
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm font-semibold text-amber-700">
            Digest on hold — {totalDigestSafe} of {minThreshold} required digest-safe items validated
            {demotedTotal > 0 && (
              <span className="font-normal text-amber-600">
                {" "}({digestSafeCount}/{demotedTotal} demoted projects gated)
              </span>
            )}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">
          {thresholdMet
            ? "WA digest will send on the next scheduled run."
            : `Validate ${minThreshold - totalDigestSafe} more project${minThreshold - totalDigestSafe !== 1 ? "s" : ""} in the Contact Validation workflow before the digest can send.`
          }
        </p>
      </div>
      <Link
        href="/contact-validation"
        className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${
          thresholdMet
            ? "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200"
            : "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200"
        }`}
      >
        {thresholdMet ? "Review gates" : "Validate now"}
      </Link>
    </div>
  );
}

// ── Validate First KPI Strip ──
// Fetches the named_unverified count and renders the full 6-pill strip.
// The "Validate First" pill links to /contact-validation (admin only).
function ValidateFirstKPIStrip({
  hotCount, warmCount, actionReadyCount, waitingOnDiscoveryCount, closingSoonCount,
}: {
  hotCount: number;
  warmCount: number;
  actionReadyCount: number;
  waitingOnDiscoveryCount: number;
  closingSoonCount: number;
}) {
  const validateFirstQuery = trpc.contactValidation.getValidateFirstCount.useQuery(undefined, {
    staleTime: 120_000,
  });
  const validateFirstCount = validateFirstQuery.data?.count ?? 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <KPIPill icon={<Flame className="w-5 h-5 text-hot" />} value={hotCount} label="Hot" accent="hot" />
      <KPIPill icon={<TrendingUp className="w-5 h-5 text-warm" />} value={warmCount} label="Warm" accent="warm" />
      <KPIPill icon={<Zap className="w-5 h-5 text-emerald-600" />} value={actionReadyCount} label="Action-ready" accent="emerald" />
      <KPIPill icon={<Users className="w-5 h-5 text-amber-500" />} value={waitingOnDiscoveryCount} label="Need discovery" accent="amber" />
      <KPIPill icon={<Clock className="w-5 h-5 text-navy" />} value={closingSoonCount} label="Closing soon" accent="navy" />
      <KPIPill
        icon={<Shield className="w-5 h-5 text-purple-600" />}
        value={validateFirstCount}
        label="Validate First"
        accent="purple"
        href="/contact-validation"
      />
    </div>
  );
}

// ── KPI Pill Component ──
function KPIPill({ icon, value, label, accent, href }: { icon: React.ReactNode; value: number; label: string; accent: string; href?: string }) {
  const accentColors: Record<string, string> = {
    hot: "text-hot",
    warm: "text-warm",
    emerald: "text-emerald-600",
    amber: "text-amber-500",
    navy: "text-navy",
    purple: "text-purple-600",
  };
  const inner = (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border bg-card transition-colors ${href ? "cursor-pointer hover:bg-muted/40 border-border" : "border-border"}`}>
      {icon}
      <div>
        <div className={`text-xl font-bold ${accentColors[accent] || "text-navy"}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground font-medium">{label}</div>
      </div>
    </div>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}
