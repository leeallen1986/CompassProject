/**
 * "This Week" — Phase 2 Redesign
 * Action-first layout: compact 64px navy header, top action cards,
 * collapsible sections (Waiting on Contact Discovery / Already Active / Warm Monitor),
 * demoted coaching panel, subordinate manager rollup.
 */
import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation, Link } from "wouter";
import {
  Flame, TrendingUp, Users, ArrowRight, ArrowUpRight,
  MapPin, Calendar, ChevronRight, Sparkles, Target,
  Building, Pickaxe, Fuel, Shield, BarChart3,
  LogOut, Settings, Database, Loader2, LogIn,
  AlertTriangle, CheckCircle2, UserPlus, Search,
  Linkedin, Mail, ExternalLink, Zap, Eye, Layers,
  HardHat, Wrench, Clock, Globe, Megaphone, X,
  ChevronDown, ChevronUp, MoreHorizontal,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getLoginUrl } from "@/const";
import NBACard from "@/components/NBACard";
import WeeklyCoachingPanel from "@/components/WeeklyCoachingPanel";
import ActionTracker from "@/components/ActionTracker";
import ManagerRollup from "@/components/ManagerRollup";
import { LaneBadge } from "@/components/LaneBadge";

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

// ── Sector helpers ──
const sectorLabels: Record<string, string> = {
  mining: "Mining", oil_gas: "Oil & Gas", infrastructure: "Infrastructure",
  energy: "Energy", defence: "Defence",
};

// ── Priority helpers ──
function priorityBadge(priority: string) {
  if (priority === "hot") return "bg-hot text-white";
  if (priority === "warm") return "bg-warm text-navy";
  return "bg-cold text-white";
}

function actionTypeIcon(type: string) {
  if (type === "contact_outreach") return <Users className="w-4 h-4" />;
  if (type === "contractor_gap") return <Search className="w-4 h-4" />;
  if (type === "tier1_new") return <Zap className="w-4 h-4" />;
  if (type === "stage_upgrade") return <ArrowUpRight className="w-4 h-4" />;
  if (type === "high_value") return <Target className="w-4 h-4" />;
  return <CheckCircle2 className="w-4 h-4" />;
}

/** Derive a plain-English "why now" sentence from project fields */
function deriveWhyNow(project: any): string {
  if (project.whyItMatters) return project.whyItMatters;
  if (project.actionTier === "tier1_actionable") return "Action required now — outreach window is open.";
  if (project.isNew) return "New project identified this week.";
  if (project.stageCode) return `Stage: ${project.stageCode}.`;
  if (project.overview) return project.overview.slice(0, 120) + (project.overview.length > 120 ? "…" : "");
  return "Review project details for latest intelligence.";
}

/** Contact state row — named contact with role, or discovery needed */
function ContactStateRow({ project }: { project: any }) {
  if (project.bestStakeholder) {
    return (
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        <span className="font-semibold text-navy truncate">{project.bestStakeholder.name}</span>
        {project.bestStakeholder.title && (
          <span className="text-muted-foreground truncate">— {project.bestStakeholder.title}</span>
        )}
        {project.bestStakeholder.email && (
          <a href={`mailto:${project.bestStakeholder.email}`} onClick={e => e.stopPropagation()} className="text-teal hover:text-teal-light shrink-0">
            <Mail className="w-3 h-3" />
          </a>
        )}
        {project.bestStakeholder.linkedin && (
          <a href={project.bestStakeholder.linkedin} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-navy hover:text-gold-dark shrink-0">
            <Linkedin className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="w-2 h-2 rounded-full border-2 border-amber-400 shrink-0" />
      <span className="text-amber-600 font-medium">Discovery needed</span>
    </div>
  );
}

// ── Collapsible Section Wrapper ──
function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  icon,
  headerRight,
  children,
  emptyMessage,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  icon: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <span className="font-semibold text-navy text-sm flex-1">{title}</span>
        <span className="text-xs font-bold text-muted-foreground bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>
        {headerRight && <span onClick={e => e.stopPropagation()}>{headerRight}</span>}
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border">
          {count === 0 ? (
            <p className="text-xs text-muted-foreground italic px-4 py-3">{emptyMessage || "Nothing here this week."}</p>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

// ── Compact Project Row (for collapsible sections) ──
function CompactProjectRow({ project, navigate }: { project: any; navigate: (path: string) => void }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors cursor-pointer border-b border-border last:border-0"
      onClick={() => navigate(`/dashboard?project=${project.id}`)}
    >
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${priorityBadge(project.priority)}`}>
        {project.priority}
      </span>
      <LaneBadge lane={(project as any).productLane} />
      <span className="flex-1 text-sm font-semibold text-navy truncate">{project.name}</span>
      <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
        <MapPin className="w-3 h-3" />{project.location}
      </span>
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}

// ── Top Action Card ──
function TopActionCard({ action, navigate }: { action: any; navigate: (path: string) => void }) {
  const isUrgent = action.priority === "urgent";
  const isHigh = action.priority === "high";
  return (
    <div
      className={`relative flex flex-col gap-2 p-4 rounded-xl border bg-card cursor-pointer hover:shadow-md transition-all group min-w-[220px] max-w-xs w-full ${
        isUrgent ? "border-hot/40 hover:border-hot/60" :
        isHigh ? "border-gold/30 hover:border-gold/50" :
        "border-border hover:border-navy/30"
      }`}
      onClick={() => action.projectId && navigate(`/dashboard?project=${action.projectId}`)}
    >
      {/* Header: priority + lane */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
          isUrgent ? "bg-hot text-white" : isHigh ? "bg-gold text-navy" : "bg-slate-200 text-slate-700"
        }`}>
          {action.priority}
        </span>
        {action.productLane && <LaneBadge lane={action.productLane} />}
        {action.actionKey && (
          <span className="ml-auto">
            <DismissButton actionKey={action.actionKey} />
          </span>
        )}
      </div>

      {/* Title */}
      <div className="flex items-start gap-2">
        <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${
          isUrgent ? "bg-hot/15 text-hot" : isHigh ? "bg-gold/15 text-gold-dark" : "bg-slate-100 text-slate-500"
        }`}>
          {actionTypeIcon(action.type)}
        </div>
        <p className="text-sm font-bold text-navy leading-snug line-clamp-2">{action.title}</p>
      </div>

      {/* Why now */}
      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{action.description}</p>

      {/* Contact state */}
      {action.project && <ContactStateRow project={action.project} />}

      {/* Footer */}
      <div className="mt-auto pt-1 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {action.project?.value || ""}
        </span>
        <span className="text-[11px] text-teal font-semibold flex items-center gap-1 group-hover:text-teal-light transition-colors">
          Open <ChevronRight className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
}

// ── Loading skeleton ──
function ThisWeekSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy h-16" />
      <main className="container py-6 space-y-6">
        <div className="flex gap-4 overflow-x-auto pb-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-44 w-60 shrink-0 rounded-xl" />)}
        </div>
        <Skeleton className="h-14 rounded-lg" />
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
          href={getLoginUrl()}
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
  const [showCoaching, setShowCoaching] = useState(false);
  const [showNavMenu, setShowNavMenu] = useState(false);

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

  // ── All hooks must be before early returns ──

  // Destructure summary safely (null-safe)
  const topProjects: any[] = summary?.topProjects ?? [];
  const newStakeholders: any[] = summary?.newStakeholders ?? [];
  const stageChanges: any[] = summary?.stageChanges ?? [];
  const suggestedActions: any[] = summary?.suggestedActions ?? [];
  const stats = summary?.stats ?? { totalInScope: 0, tier1Count: 0, tier2Count: 0, tier3Count: 0, hotCount: 0, warmCount: 0, newProjectsThisWeek: 0, projectsWithContractors: 0, projectsMissingContractors: 0 };
  const weekLabel: string = summary?.weekLabel ?? "";
  const userContext = summary?.userContext;
  const lastSuccessfulPipelineRun = summary?.lastSuccessfulPipelineRun;
  const dataFreshnessWarning = summary?.dataFreshnessWarning;

  // Freshness line
  const freshnessText = lastSuccessfulPipelineRun
    ? `Data: ${new Date(lastSuccessfulPipelineRun).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`
    : "Data: unknown";
  const freshnessStale = lastSuccessfulPipelineRun
    ? Date.now() - new Date(lastSuccessfulPipelineRun).getTime() > 7 * 24 * 60 * 60 * 1000
    : false;

  // Top Actions — up to 5 suggested actions, enriched with project data
  const topActions = useMemo(() => {
    return suggestedActions.slice(0, 5).map((action: any) => {
      const project = topProjects.find((p: any) => p.id === action.projectId);
      return { ...action, project };
    });
  }, [suggestedActions, topProjects]);

  // Waiting on Contact Discovery
  const waitingOnDiscovery = useMemo(() => {
    return topProjects.filter((p: any) =>
      !p.bestStakeholder && (p.contactDepth === 0 || p.sendReadiness === "contact_discovery_needed")
    );
  }, [topProjects]);

  // Already Active / Claimed
  const alreadyActive = useMemo(() => {
    return topProjects.filter((p: any) =>
      p.lifecycleStatus === "contacted" || p.hasLoggedActionThisWeek
    );
  }, [topProjects]);

  // Warm Monitor
  const warmMonitor = useMemo(() => {
    const topActionIds = new Set(suggestedActions.slice(0, 5).map((a: any) => a.projectId).filter(Boolean));
    const activeIds = new Set(topProjects.filter((p: any) => p.lifecycleStatus === "contacted" || p.hasLoggedActionThisWeek).map((p: any) => p.id));
    return topProjects.filter((p: any) =>
      p.priority === "warm" &&
      (p.actionTier === "tier2_warm" || p.actionTier === "tier3_monitor") &&
      !topActionIds.has(p.id) &&
      !activeIds.has(p.id)
    );
  }, [topProjects, suggestedActions]);

  // Micro-summary counts
  const hotCount = useMemo(() => topProjects.filter((p: any) => p.priority === "hot").length, [topProjects]);
  const warmCount = useMemo(() => topProjects.filter((p: any) => p.priority === "warm").length, [topProjects]);
  const discoveryCount = waitingOnDiscovery.length;

  // Week key for manager rollup
  const weekKey = useMemo(() => {
    if (!weekLabel) return undefined;
    const d = new Date(weekLabel + "T00:00:00Z");
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}W${String(weekNo).padStart(2, "0")}`;
  }, [weekLabel]);

  // ── Early returns (after all hooks) ──
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

      {/* ── Compact Header — 64px flat navy bar ── */}
      <header className="bg-navy h-16 flex items-center px-4 sm:px-6 gap-4 sticky top-0 z-30 shadow-sm">
        {/* Left: title + week + territory */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <h1 className="text-white font-bold text-base sm:text-lg tracking-tight whitespace-nowrap">
            This Week
          </h1>
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 text-slate-300 text-[11px] font-medium border border-white/10 whitespace-nowrap">
            <Calendar className="w-3 h-3 mr-1" />
            {weekLabel}
          </span>
          {(userContext?.territories?.length ?? 0) > 0 && (
            <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full bg-gold/15 text-gold text-[11px] font-medium border border-gold/20 whitespace-nowrap">
              <MapPin className="w-3 h-3 mr-1" />
              {userContext?.territories?.join(", ")}
            </span>
          )}
        </div>

        {/* Right: freshness + nav */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Freshness */}
          <span className={`hidden sm:block text-[11px] ${freshnessStale ? "text-amber-400" : "text-slate-400"}`}>
            {freshnessText}
          </span>

          {/* Nav links — desktop */}
          <nav className="hidden lg:flex items-center gap-3 text-[11px]">
            <Link href="/dashboard" className="text-slate-300 hover:text-white flex items-center gap-1 transition-colors">
              <BarChart3 className="w-3 h-3" /> Dashboard
            </Link>
            <span className="text-slate-700">|</span>
            <Link href="/pipeline" className="text-slate-300 hover:text-white flex items-center gap-1 transition-colors">
              <Target className="w-3 h-3" /> Pipeline
            </Link>
            <span className="text-slate-700">|</span>
            <Link href="/my-profile" className="text-slate-300 hover:text-white flex items-center gap-1 transition-colors">
              <Sparkles className="w-3 h-3" /> My Style
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

          {/* Nav menu — mobile/tablet */}
          <div className="lg:hidden relative">
            <button
              onClick={() => setShowNavMenu(v => !v)}
              className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {showNavMenu && (
              <div className="absolute right-0 top-full mt-2 w-44 bg-navy border border-white/10 rounded-lg shadow-xl z-50 py-1">
                <Link href="/dashboard" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setShowNavMenu(false)}>
                  <BarChart3 className="w-4 h-4" /> Dashboard
                </Link>
                <Link href="/pipeline" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setShowNavMenu(false)}>
                  <Target className="w-4 h-4" /> Pipeline
                </Link>
                <Link href="/my-profile" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setShowNavMenu(false)}>
                  <Sparkles className="w-4 h-4" /> My Style
                </Link>
                <Link href="/collateral" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setShowNavMenu(false)}>
                  <Layers className="w-4 h-4" /> Collateral
                </Link>
                {(user?.role === "admin" || (user as any)?.campaignAccess) && (
                  <Link href="/campaigns" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors" onClick={() => setShowNavMenu(false)}>
                    <Megaphone className="w-4 h-4" /> Campaigns
                  </Link>
                )}
                {user?.role === "admin" && (
                  <Link href="/admin" className="flex items-center gap-2 px-4 py-2 text-sm text-gold hover:text-gold-light hover:bg-white/10 transition-colors" onClick={() => setShowNavMenu(false)}>
                    <Database className="w-4 h-4" /> Admin
                  </Link>
                )}
                <button onClick={() => navigate("/settings")} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
                  <Settings className="w-4 h-4" /> Settings
                </button>
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

        {/* ── Micro-summary strip ── */}
        <div className="flex items-center gap-3 flex-wrap text-sm">
          {hotCount > 0 && (
            <span className="flex items-center gap-1.5 font-bold text-hot">
              <Flame className="w-4 h-4" /> {hotCount} HOT
            </span>
          )}
          {hotCount > 0 && warmCount > 0 && <span className="text-slate-300">·</span>}
          {warmCount > 0 && (
            <span className="flex items-center gap-1.5 font-semibold text-warm">
              <TrendingUp className="w-4 h-4" /> {warmCount} WARM
            </span>
          )}
          {discoveryCount > 0 && (
            <>
              <span className="text-slate-300">·</span>
              <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                <Search className="w-4 h-4" /> {discoveryCount} need contact discovery
              </span>
            </>
          )}
          {dataFreshnessWarning && (
            <>
              <span className="text-slate-300">·</span>
              <span className="flex items-center gap-1.5 text-amber-500 text-xs">
                <AlertTriangle className="w-3.5 h-3.5" /> {dataFreshnessWarning}
              </span>
            </>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {stats.totalInScope} projects in scope
          </span>
        </div>

        {/* ── Top Actions strip ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-navy flex items-center gap-2">
              <Zap className="w-4 h-4 text-gold" />
              Top Actions
            </h2>
            <Link href="/dashboard" className="text-xs text-teal hover:text-teal-light font-semibold flex items-center gap-1 transition-colors">
              View all projects <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {topActions.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No urgent actions this week. Check the sections below for projects to monitor.
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {topActions.map((action: any, i: number) => (
                <TopActionCard key={action.actionKey || i} action={action} navigate={navigate} />
              ))}
            </div>
          )}
        </section>

        {/* ── Closing Soon (live tenders) ── */}
{(() => {
          // Only show HOT and WARM in the collapsed Closing Soon view
          const hotWarmClosing = (closingSoonProjects ?? []).filter((p: any) => p.priority === 'hot' || p.priority === 'warm');
          return hotWarmClosing.length > 0 ? (
          <CollapsibleSection
            title="Closing Soon — Live Tenders"
            count={hotWarmClosing.length}
            defaultOpen={true}
            icon={<Clock className="w-4 h-4 text-hot" />}
            headerRight={
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-hot bg-hot/10 px-2 py-0.5 rounded-full border border-hot/20">
                  Closing within 14 days
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); navigate("/dashboard?tab=live-tenders"); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); navigate("/dashboard?tab=live-tenders"); } }}
                  className="text-[10px] font-semibold text-hot hover:text-hot/70 flex items-center gap-0.5 transition-colors cursor-pointer"
                >
                  View all <ChevronRight className="w-3 h-3" />
                </span>
              </div>
            }
            emptyMessage="No hot or warm live tenders closing within 14 days."
          >
            <div>
              {hotWarmClosing.map((project: any) => {
                const daysLeft = project.tenderCloseDate
                  ? Math.ceil((new Date(project.tenderCloseDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  : null;
                const priorityBadge = project.priority === 'hot'
                  ? 'bg-hot text-white'
                  : project.priority === 'warm'
                  ? 'bg-warm text-navy'
                  : 'bg-slate-400 text-white';
                const dateColor = daysLeft !== null && daysLeft <= 7
                  ? 'text-hot'
                  : daysLeft !== null && daysLeft <= 14
                  ? 'text-amber-600'
                  : 'text-muted-foreground';
                const rowHover = project.priority === 'hot' ? 'hover:bg-red-50' : 'hover:bg-amber-50';
                return (
                  <div
                    key={project.id}
                    className={`flex items-center gap-3 px-4 py-2.5 ${rowHover} transition-colors cursor-pointer border-b border-border last:border-0`}
                    onClick={() => navigate(`/dashboard?project=${project.id}`)}
                  >
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${priorityBadge}`}>
                      {project.priority}
                    </span>
                    <span className="flex-1 text-sm font-semibold text-navy truncate">{project.name}</span>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
                      <MapPin className="w-3 h-3" />{project.location}
                    </span>
                    {project.tenderCloseDate && (
                      <span className={`text-[11px] font-bold flex items-center gap-1 shrink-0 ${dateColor}`}>
                        <Clock className="w-3 h-3" />
                        Closes {new Date(project.tenderCloseDate).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                        {daysLeft !== null && (
                          <span className={`ml-1 px-1 py-0.5 rounded text-[9px] font-bold ${
                            daysLeft <= 7 ? 'bg-hot/15 text-hot' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {daysLeft <= 0 ? 'today' : `${daysLeft}d`}
                          </span>
                        )}
                      </span>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>
          ) : null;
        })()}

        {/* ── Waiting on Contact Discovery ── */}
        <CollapsibleSection
          title="Waiting on Contact Discovery"
          count={waitingOnDiscovery.length}
          defaultOpen={waitingOnDiscovery.length > 0}
          icon={<Search className="w-4 h-4" />}
          emptyMessage="All projects in scope have at least one identified contact."
        >
          <div>
            {waitingOnDiscovery.map((project: any) => (
              <CompactProjectRow key={project.id} project={project} navigate={navigate} />
            ))}
          </div>
        </CollapsibleSection>

        {/* ── Already Active / Claimed ── */}
        <CollapsibleSection
          title="Already Active / Claimed"
          count={alreadyActive.length}
          defaultOpen={false}
          icon={<CheckCircle2 className="w-4 h-4" />}
          emptyMessage="No projects marked as contacted or claimed this week."
        >
          <div>
            {alreadyActive.map((project: any) => (
              <CompactProjectRow key={project.id} project={project} navigate={navigate} />
            ))}
          </div>
        </CollapsibleSection>

        {/* ── Warm Monitor ── */}
        <CollapsibleSection
          title="Warm Monitor"
          count={warmMonitor.length}
          defaultOpen={false}
          icon={<TrendingUp className="w-4 h-4" />}
          emptyMessage="No warm projects to monitor this week."
        >
          <div>
            {warmMonitor.map((project: any) => (
              <CompactProjectRow key={project.id} project={project} navigate={navigate} />
            ))}
          </div>
        </CollapsibleSection>

        {/* ── New Stakeholders (compact card) ── */}
        {newStakeholders.length > 0 && (
          <CollapsibleSection
            title="New Stakeholders This Week"
            count={newStakeholders.length}
            defaultOpen={newStakeholders.length > 0}
            icon={<UserPlus className="w-4 h-4" />}
          >
            <div className="divide-y divide-border">
              {newStakeholders.slice(0, 6).map((contact: any) => (
                <div key={contact.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-navy truncate">{contact.name}</span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                        contact.roleRelevance === "high" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        {contact.roleRelevance === "high" ? "KEY" : "MED"}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{contact.title} · {contact.company}</div>
                    <div className="text-[10px] text-teal font-medium truncate">Project: {contact.project}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} className="px-2 py-1 rounded text-[10px] font-semibold bg-teal/15 text-teal hover:bg-teal/25 transition-colors">
                        <Mail className="w-3 h-3 inline mr-0.5" />Email
                      </a>
                    )}
                    {contact.linkedin && (
                      <a href={contact.linkedin} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded text-[10px] font-semibold bg-navy/10 text-navy hover:bg-navy/20 transition-colors">
                        <Linkedin className="w-3 h-3 inline mr-0.5" />LI
                      </a>
                    )}
                  </div>
                </div>
              ))}
              {newStakeholders.length > 6 && (
                <div className="px-4 py-2.5">
                  <Link href="/dashboard?tab=contacts" className="text-xs text-teal hover:text-teal-light font-semibold transition-colors">
                    View all {newStakeholders.length} new contacts →
                  </Link>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Stage Changes (compact card) ── */}
        {stageChanges.length > 0 && (
          <CollapsibleSection
            title="Stage Changes"
            count={stageChanges.length}
            defaultOpen={false}
            icon={<ArrowUpRight className="w-4 h-4" />}
          >
            <div className="divide-y divide-border">
              {stageChanges.slice(0, 8).map((change: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/dashboard?project=${change.projectId}`)}
                >
                  {change.isUpgrade ? (
                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-gold shrink-0" />
                  )}
                  <span className="flex-1 text-sm font-semibold text-navy truncate">{change.projectName}</span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${priorityBadge(change.priority)}`}>
                    {change.priority}
                  </span>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                    <span>{change.previousTier}</span>
                    <ArrowRight className="w-3 h-3" />
                    <span className="font-semibold text-navy">{change.currentTier}</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Coaching Panel — demoted, dismissible ── */}
        <div>
          <button
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-navy transition-colors mb-2"
            onClick={() => setShowCoaching(v => !v)}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Weekly Coaching
            {showCoaching ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showCoaching && <WeeklyCoachingPanel />}
        </div>

        {/* ── Manager Rollup — admin only, visually subordinate ── */}
        {user?.role === "admin" && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-navy mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              Manager Rollup
            </h3>
            <ManagerRollup weekKey={weekKey} />
          </div>
        )}

        {/* ── Pipeline Overview (compact, at bottom) ── */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-navy flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              Pipeline Overview
            </h3>
            <Link href="/dashboard" className="text-xs text-teal hover:text-teal-light font-semibold flex items-center gap-1 transition-colors">
              <Eye className="w-3.5 h-3.5" /> Full Dashboard
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-xl font-bold text-teal">{stats.totalInScope}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">In Scope</div>
            </div>
            <div>
              <div className="text-xl font-bold text-hot">{stats.tier1Count}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Action Now</div>
            </div>
            <div>
              <div className="text-xl font-bold text-gold">{stats.hotCount}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Hot</div>
            </div>
            <div>
              <div className="text-xl font-bold text-warm">{stats.newProjectsThisWeek}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">New This Week</div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
