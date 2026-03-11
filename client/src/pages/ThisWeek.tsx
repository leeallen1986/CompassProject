/**
 * "This Week" — Weekly Intelligence Summary Landing Page
 * Surfaces the most actionable intelligence: top priorities, new stakeholders,
 * stage changes, and suggested actions. The existing dashboard is the drill-down layer.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation, Link } from "wouter";
import { IMAGES } from "@/lib/images";
import {
  Flame, TrendingUp, Users, ArrowRight, ArrowUpRight,
  MapPin, Calendar, ChevronRight, Sparkles, Target,
  Building, Pickaxe, Fuel, Shield, BarChart3,
  LogOut, Settings, Database, Loader2, LogIn,
  AlertTriangle, CheckCircle2, UserPlus, Search,
  Linkedin, Mail, ExternalLink, Zap, Eye, Layers,
  HardHat, Wrench, Clock, Globe,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getLoginUrl } from "@/const";

// ── Sector helpers ──
const sectorIcons: Record<string, React.ReactNode> = {
  mining: <Pickaxe className="w-3.5 h-3.5" />,
  oil_gas: <Fuel className="w-3.5 h-3.5" />,
  infrastructure: <Building className="w-3.5 h-3.5" />,
  energy: <TrendingUp className="w-3.5 h-3.5" />,
  defence: <Shield className="w-3.5 h-3.5" />,
};
const sectorLabels: Record<string, string> = {
  mining: "Mining", oil_gas: "Oil & Gas", infrastructure: "Infrastructure", energy: "Energy", defence: "Defence",
};

// ── Priority helpers ──
function priorityBadge(priority: string) {
  if (priority === "hot") return "bg-hot text-white";
  if (priority === "warm") return "bg-warm text-navy";
  return "bg-cold text-white";
}

function tierBadge(tier: string | null) {
  if (tier === "tier1_actionable") return { bg: "bg-emerald-100 text-emerald-800 border-emerald-200", label: "T1 Actionable" };
  if (tier === "tier2_warm") return { bg: "bg-amber-100 text-amber-800 border-amber-200", label: "T2 Warm" };
  if (tier === "tier3_monitor") return { bg: "bg-slate-100 text-slate-600 border-slate-200", label: "T3 Monitor" };
  return { bg: "bg-slate-100 text-slate-500 border-slate-200", label: "Unclassified" };
}

function actionPriorityBadge(priority: string) {
  if (priority === "urgent") return "bg-hot text-white";
  if (priority === "high") return "bg-gold text-navy";
  return "bg-slate-200 text-slate-700";
}

function actionTypeIcon(type: string) {
  if (type === "contact_outreach") return <Users className="w-4 h-4" />;
  if (type === "contractor_gap") return <Search className="w-4 h-4" />;
  if (type === "tier1_new") return <Zap className="w-4 h-4" />;
  if (type === "stage_upgrade") return <ArrowUpRight className="w-4 h-4" />;
  if (type === "high_value") return <Target className="w-4 h-4" />;
  return <CheckCircle2 className="w-4 h-4" />;
}

// ── Loading skeleton ──
function ThisWeekSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <header className="relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="w-full h-full bg-navy" />
        </div>
        <div className="relative container py-8 sm:py-12">
          <Skeleton className="h-10 w-80 bg-white/20" />
          <Skeleton className="h-5 w-60 bg-white/10 mt-2" />
        </div>
      </header>
      <main className="container py-6 sm:py-8 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
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

  // Fetch the This Week summary
  const { data: summary, isLoading } = trpc.thisWeek.summary.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Check onboarding
  const { data: profile, isLoading: profileLoading } = trpc.profile.get.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 0,
  });

  if (authLoading) return <ThisWeekSkeleton />;
  if (!isAuthenticated) return <LoginPage />;
  if (profileLoading) return <ThisWeekSkeleton />;
  if (profile === null || (profile && !profile.onboardingCompleted)) {
    navigate("/onboarding");
    return <ThisWeekSkeleton />;
  }
  if (isLoading || !summary) return <ThisWeekSkeleton />;

  const { topProjects, newStakeholders, stageChanges, suggestedActions, stats, weekLabel } = summary;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero Header ── */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={IMAGES.heroBanner} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-navy/95 via-navy/85 to-navy/70" />
        </div>
        <div className="relative container py-6 sm:py-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight">
                  This Week
                </h1>
                <span className="px-3 py-1 rounded-full bg-gold/20 text-gold text-xs font-semibold border border-gold/30">
                  Week of {weekLabel}
                </span>
              </div>
              <p className="text-sm sm:text-base text-slate-300 mt-1 font-medium">
                Atlas Copco Power Technique — Weekly Intelligence Summary
              </p>
            </div>
            <div className="text-right flex flex-col items-end gap-2">
              <div className="text-xl sm:text-2xl font-bold text-gold tracking-wider">ATLAS COPCO</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-slate-400">{user?.name || user?.email}</span>
                <Link href="/dashboard" className="text-xs text-gold hover:text-gold-light flex items-center gap-1 transition-colors">
                  <BarChart3 className="w-3 h-3" /> Full Dashboard
                </Link>
                <span className="text-slate-600">|</span>
                <Link href="/pipeline" className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                  <Target className="w-3 h-3" /> Pipeline
                </Link>
                <span className="text-slate-600">|</span>
                <button onClick={() => navigate("/settings")} className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                  <Settings className="w-3 h-3" /> Settings
                </button>
                <span className="text-slate-600">|</span>
                {user?.role === "admin" && (
                  <>
                    <Link href="/admin" className="text-xs text-gold hover:text-gold-light flex items-center gap-1 transition-colors">
                      <Database className="w-3 h-3" /> Admin
                    </Link>
                    <span className="text-slate-600">|</span>
                  </>
                )}
                <button onClick={() => logout()} className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                  <LogOut className="w-3 h-3" /> Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="container py-6 sm:py-8 space-y-6">

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <KPICard value={stats.tier1Count} label="Actionable (T1)" accent="teal" icon={<Zap className="w-4 h-4" />} />
          <KPICard value={stats.hotCount} label="Hot Projects" accent="hot" icon={<Flame className="w-4 h-4" />} />
          <KPICard value={stats.newProjectsThisWeek} label="New This Week" accent="gold" icon={<Sparkles className="w-4 h-4" />} />
          <KPICard value={stats.newContactsThisWeek} label="New Contacts" accent="teal" icon={<UserPlus className="w-4 h-4" />} />
          <KPICard value={stats.highRelevanceContacts} label="Key Contacts" accent="gold" icon={<Users className="w-4 h-4" />} />
          <KPICard value={stats.projectsMissingContractors} label="Missing Contractors" accent="warm" icon={<AlertTriangle className="w-4 h-4" />} />
        </div>

        {/* ── Suggested Actions ── */}
        {suggestedActions.length > 0 && (
          <Card className="border-gold/30 bg-gradient-to-r from-gold/5 via-transparent to-transparent">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
                <Zap className="w-5 h-5 text-gold" />
                Suggested Actions
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  {suggestedActions.length} action{suggestedActions.length !== 1 ? "s" : ""} this week
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {suggestedActions.map((action, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 rounded-lg bg-card border border-border hover:border-gold/30 hover:shadow-sm transition-all cursor-pointer group"
                  onClick={() => action.projectId && navigate(`/dashboard?project=${action.projectId}`)}
                >
                  <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                    action.priority === "urgent" ? "bg-hot/15 text-hot" :
                    action.priority === "high" ? "bg-gold/15 text-gold-dark" :
                    "bg-slate-100 text-slate-500"
                  }`}>
                    {actionTypeIcon(action.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${actionPriorityBadge(action.priority)}`}>
                        {action.priority}
                      </span>
                      <span className="text-sm font-semibold text-navy truncate">{action.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{action.description}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1 group-hover:text-gold transition-colors" />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ── Two-Column Layout: Top Projects + Stakeholders ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Top Priority Projects (2/3 width) ── */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-navy flex items-center gap-2">
                <Flame className="w-5 h-5 text-hot" />
                Top Priority Projects
              </h2>
              <Link href="/dashboard" className="text-xs text-teal hover:text-teal-light flex items-center gap-1 font-semibold transition-colors">
                View all {stats.totalProjects} projects <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="space-y-3">
              {topProjects.slice(0, 8).map((project, i) => {
                const tier = tierBadge(project.actionTier);
                return (
                  <div
                    key={project.id}
                    className="group bg-card rounded-lg border border-border p-4 hover:border-gold/30 hover:shadow-md transition-all cursor-pointer"
                    onClick={() => navigate(`/dashboard?project=${project.id}`)}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs font-bold text-muted-foreground">#{i + 1}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${priorityBadge(project.priority)}`}>
                            {project.priority}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${tier.bg}`}>
                            {tier.label}
                          </span>
                          {project.isNew && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal/15 text-teal border border-teal/30">
                              NEW
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold text-navy group-hover:text-gold-dark transition-colors truncate">
                          {project.name}
                        </h3>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-navy">{project.value}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {project.location}
                      </span>
                      <span className="flex items-center gap-1">
                        {sectorIcons[project.sector] || <Building className="w-3 h-3" />}
                        {sectorLabels[project.sector] || project.sector}
                      </span>
                      {project.stage && (
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3" /> {project.stage}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Building className="w-3 h-3" /> {project.owner}
                      </span>
                    </div>

                    {/* Detected Activities */}
                    {project.detectedActivities.length > 0 && (
                      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                        <HardHat className="w-3 h-3 text-gold-dark shrink-0" />
                        {project.detectedActivities.slice(0, 4).map(a => (
                          <span key={a} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gold/10 text-gold-dark border border-gold/20">
                            {a}
                          </span>
                        ))}
                        {project.detectedActivities.length > 4 && (
                          <span className="text-[10px] text-muted-foreground">+{project.detectedActivities.length - 4} more</span>
                        )}
                      </div>
                    )}

                    {/* Contractors */}
                    {project.contractors && project.contractors.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Wrench className="w-3 h-3 text-teal shrink-0" />
                        {project.contractors.slice(0, 3).map((c: any, ci: number) => (
                          <span key={ci} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal/10 text-teal border border-teal/20">
                            {c.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {project.overview && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">{project.overview}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {topProjects.length > 8 && (
              <div className="text-center pt-2">
                <Link href="/dashboard" className="text-xs text-teal hover:text-teal-light font-semibold transition-colors">
                  View {topProjects.length - 8} more priority projects →
                </Link>
              </div>
            )}
          </div>

          {/* ── Right Sidebar: Stakeholders + Stage Changes ── */}
          <div className="space-y-6">

            {/* ── New Stakeholders ── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-teal" />
                  New Stakeholders
                  {newStakeholders.length > 0 && (
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      {newStakeholders.length} this week
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {newStakeholders.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-2">No new high-relevance stakeholders discovered this week.</p>
                ) : (
                  newStakeholders.slice(0, 6).map(contact => (
                    <div key={contact.id} className="p-3 rounded-lg bg-slate-50 border border-border hover:border-teal/30 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-navy truncate">{contact.name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{contact.title}</div>
                        </div>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                          contact.roleRelevance === "high" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}>
                          {contact.roleRelevance === "high" ? "KEY" : "MED"}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mb-1.5">{contact.company}</div>
                      <div className="text-[10px] text-teal font-medium truncate mb-2">
                        Project: {contact.project}
                      </div>
                      <div className="flex items-center gap-2">
                        {contact.email && (
                          <a href={`mailto:${contact.email}`} onClick={e => e.stopPropagation()} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal/15 text-teal hover:bg-teal/25 transition-colors">
                            <Mail className="w-3 h-3 inline mr-0.5" />Email
                          </a>
                        )}
                        {contact.linkedin && (
                          <a href={contact.linkedin} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-navy/10 text-navy hover:bg-navy/20 transition-colors">
                            <Linkedin className="w-3 h-3 inline mr-0.5" />LinkedIn
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {newStakeholders.length > 6 && (
                  <Link href="/dashboard?tab=contacts" className="block text-center text-xs text-teal hover:text-teal-light font-semibold transition-colors pt-1">
                    View all {newStakeholders.length} new contacts →
                  </Link>
                )}
              </CardContent>
            </Card>

            {/* ── Stage Changes ── */}
            {stageChanges.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
                    <ArrowUpRight className="w-5 h-5 text-gold" />
                    Stage Changes
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      {stageChanges.length} this week
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {stageChanges.slice(0, 6).map((change, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-lg bg-slate-50 border border-border hover:border-gold/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/dashboard?project=${change.projectId}`)}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {change.isUpgrade ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-gold shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-navy truncate">{change.projectName}</span>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${priorityBadge(change.priority)}`}>
                          {change.priority}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-5">
                        <span>{change.previousTier}</span>
                        <ArrowRight className="w-3 h-3" />
                        <span className="font-semibold text-navy">{change.currentTier}</span>
                      </div>
                      {change.stage && (
                        <div className="text-[10px] text-muted-foreground ml-5 mt-0.5">
                          Stage: {change.stage}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* ── Quick Stats Card ── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-navy" />
                  Pipeline Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <StatRow label="Total Active Projects" value={stats.totalProjects} />
                  <Separator />
                  <StatRow label="Tier 1 — Actionable" value={stats.tier1Count} color="text-emerald-600" />
                  <StatRow label="Tier 2 — Warm" value={stats.tier2Count} color="text-amber-600" />
                  <StatRow label="Tier 3 — Monitor" value={stats.tier3Count} color="text-slate-500" />
                  <Separator />
                  <StatRow label="Hot Priority" value={stats.hotCount} color="text-hot" />
                  <StatRow label="Warm Priority" value={stats.warmCount} color="text-warm" />
                  <Separator />
                  <StatRow label="With Contractors" value={stats.projectsWithContractors} color="text-teal" />
                  <StatRow label="Missing Contractors" value={stats.projectsMissingContractors} color="text-amber-600" />
                </div>
                <div className="mt-4 pt-3 border-t border-border">
                  <Link href="/dashboard" className="flex items-center justify-center gap-2 text-xs font-semibold text-navy hover:text-gold-dark transition-colors">
                    <Eye className="w-3.5 h-3.5" /> Open Full Dashboard
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Sub-components ──

function KPICard({ value, label, accent, icon }: { value: number; label: string; accent: "hot" | "warm" | "gold" | "teal"; icon: React.ReactNode }) {
  const accentClass =
    accent === "hot" ? "text-hot" :
    accent === "warm" ? "text-warm" :
    accent === "gold" ? "text-gold" :
    "text-teal";
  return (
    <div className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        <div className={`${accentClass}`}>{icon}</div>
      </div>
      <div className={`text-2xl sm:text-3xl font-bold ${accentClass} tracking-tight`}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-1 font-medium uppercase tracking-wider">{label}</div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold ${color ?? "text-navy"}`}>{value}</span>
    </div>
  );
}
