/*
 * Home — Atlas Copco Market Intelligence Dashboard
 * Design: Nordic Industrial Precision
 * Deep navy header, gold accents, tabbed layout, priority-coded cards
 * Now fetches data from the database via tRPC API
 */
import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import {
  Flame, TrendingUp, Users, Search, Download, ExternalLink,
  BarChart3, Pickaxe, Fuel, Building, Shield,
  ArrowUpRight, Database, FileText, Loader2, LogIn, LogOut, ChevronDown, Settings, Target
} from "lucide-react";
import { Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProjectCard, { type ProjectData } from "@/components/ProjectCard";
import { IMAGES } from "@/lib/images";
import { scoreAndRankProjects, type UserProfileData, type FeedbackData } from "@/lib/personalization";

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

// ── KPI Card ──
function KPICard({ value, label, accent }: { value: string | number; label: string; accent?: "hot" | "warm" | "gold" | "teal" }) {
  const accentClass = accent === "hot" ? "text-hot" : accent === "warm" ? "text-warm" : accent === "gold" ? "text-gold" : accent === "teal" ? "text-teal" : "text-navy";
  return (
    <div className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-shadow">
      <div className={`text-3xl font-bold ${accentClass} tracking-tight`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wider">{label}</div>
    </div>
  );
}

// ── Priority Filter ──
function PriorityFilter({ active, onChange, stats }: { active: string; onChange: (v: string) => void; stats: { total: number; hot: number; warm: number; cold: number } }) {
  const filters = [
    { key: "all", label: "All", count: stats.total },
    { key: "hot", label: "Hot", count: stats.hot, color: "bg-hot" },
    { key: "warm", label: "Warm", count: stats.warm, color: "bg-warm" },
    { key: "cold", label: "Cold", count: stats.cold, color: "bg-cold" },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {filters.map(f => (
        <button key={f.key} onClick={() => onChange(f.key)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${active === f.key ? "bg-navy text-white shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-navy/30"}`}>
          {f.color && <span className={`inline-block w-2 h-2 rounded-full ${f.color} mr-1.5`} />}
          {f.label} ({f.count})
        </button>
      ))}
    </div>
  );
}

// ── Sector Filter ──
function SectorFilter({ active, onChange }: { active: string; onChange: (v: string) => void }) {
  const sectors = ["all", "mining", "oil_gas", "infrastructure", "energy", "defence"];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {sectors.map(s => (
        <button key={s} onClick={() => onChange(s)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${active === s ? "bg-navy text-white shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-navy/30"}`}>
          {s !== "all" && sectorIcons[s]}
          {s === "all" ? "All Sectors" : sectorLabels[s]}
        </button>
      ))}
    </div>
  );
}

// ── Contacts Table ──
interface ContactRow {
  id: number;
  name: string;
  title: string;
  company: string;
  project: string;
  priority: "hot" | "warm" | "cold";
  roleBucket: string;
  email: string | null;
  linkedin: string | null;
}

function ContactsTable({ data, weekEnding }: { data: ContactRow[]; weekEnding: string }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.company.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.project.toLowerCase().includes(q)
    );
  }, [data, search]);

  const exportCSV = () => {
    const headers = ["Name", "Title", "Company", "Project", "Priority", "Role Bucket", "Email", "LinkedIn"];
    const rows = filtered.map(c => [c.name, c.title, c.company, c.project, c.priority, c.roleBucket, c.email || "", c.linkedin || ""]);
    const csv = [headers, ...rows].map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-copco-contacts-${weekEnding.replace(/\s/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const priorityBadge = (p: string) => {
    if (p === "hot") return "bg-hot text-white";
    if (p === "warm") return "bg-warm text-navy";
    return "bg-cold text-white";
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search by name, company, title, or project..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold" />
        </div>
        <button onClick={exportCSV}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gold text-navy text-sm font-semibold hover:bg-gold-light transition-colors">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground italic mb-3">Contact details require verification via People Data Labs or Coresignal before outreach. Emails shown are corporate domain patterns.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy text-white">
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Title</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Company</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Project</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Priority</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => (
              <tr key={c.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                <td className="px-4 py-3 font-medium text-navy">{c.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.title}</td>
                <td className="px-4 py-3">{c.company}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.project}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${priorityBadge(c.priority)}`}>{c.priority}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{c.roleBucket}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="px-2 py-1 rounded text-[10px] font-semibold bg-teal/15 text-teal hover:bg-teal/25 transition-colors">Email</a>
                    )}
                    {c.linkedin && (
                      <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded text-[10px] font-semibold bg-navy/10 text-navy hover:bg-navy/20 transition-colors">LI</a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {data.length} contacts shown</p>
    </div>
  );
}

// ── Login Page ──
function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-6">
        <div className="mb-8">
          <img src={IMAGES.heroBanner} alt="" className="w-full h-32 object-cover rounded-lg mb-6" />
          <h1 className="text-2xl font-bold text-navy tracking-tight mb-2">Atlas Copco Portable Air</h1>
          <p className="text-sm text-muted-foreground">Weekly Market Intelligence Dashboard</p>
        </div>
        <a href={getLoginUrl()}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-navy text-white font-semibold hover:bg-navy-light transition-colors shadow-md">
          <LogIn className="w-5 h-5" /> Sign In to Access Dashboard
        </a>
        <p className="text-xs text-muted-foreground mt-4">Login required to view market intelligence data.</p>
      </div>
    </div>
  );
}

// ── Loading Page ──
function LoadingPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-10 h-10 text-gold animate-spin mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">Loading intelligence data...</p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ── Main Dashboard ──
// ══════════════════════════════════════════════════════════════
export default function Home() {
  const { user, loading: authLoading, isAuthenticated, logout } = useAuth();
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [businessLineFilter, setBusinessLineFilter] = useState("all");

  const [, navigate] = useLocation();

  // Fetch user profile to check onboarding status
  const { data: profile, isLoading: profileLoading } = trpc.profile.get.useQuery(undefined, { enabled: isAuthenticated });

  // Fetch the unified dashboard data (all projects across all sources)
  const { data: fullReport, isLoading: reportLoading } = trpc.report.full.useQuery(
    {},
    { enabled: isAuthenticated }
  );

  // Fetch feedback for personalization
  const reportIdForFeedback = fullReport?.report?.id;
  const { data: feedbackList } = trpc.feedback.byReport.useQuery(
    { reportId: reportIdForFeedback! },
    { enabled: isAuthenticated && !!reportIdForFeedback }
  );

  // Fetch pipeline claims for the current user
  const { data: myClaims } = trpc.pipeline.mine.useQuery(undefined, { enabled: isAuthenticated });

  // Fetch active business lines for the filter
  const { data: activeBusinessLines } = trpc.businessLines.active.useQuery(undefined, { enabled: isAuthenticated });

  // ── Auth gates ──
  if (authLoading) return <LoadingPage />;
  if (!isAuthenticated) return <LoginPage />;

  // Redirect to onboarding if profile not completed
  if (!profileLoading && profile === null) {
    navigate("/onboarding");
    return <LoadingPage />;
  }
  if (!profileLoading && profile && !profile.onboardingCompleted) {
    navigate("/onboarding");
    return <LoadingPage />;
  }

  if (reportLoading || !fullReport || profileLoading) return <LoadingPage />;

  const { report, projects, contacts, drillingCampaigns, awardedProjects } = fullReport;

  const actionItems: string[] = (report.actionItems as string[]) ?? [];

  // ── Personalization: score and rank projects ──
  const profileData: UserProfileData | null = profile ? {
    territories: profile.territories as string[] | null,
    industries: profile.industries as string[] | null,
    offerCategories: profile.offerCategories as string[] | null,
    customerTypes: profile.customerTypes as string[] | null,
    keyAccounts: profile.keyAccounts as string[] | null,
    excludeAccounts: profile.excludeAccounts as string[] | null,
    dealSizeMin: profile.dealSizeMin,
    dealSizeMax: profile.dealSizeMax,
    stageTiming: profile.stageTiming as string[] | null,
    buyerRoles: profile.buyerRoles as string[] | null,
  } : null;

  const feedbackData: FeedbackData[] = (feedbackList ?? []).map((f: any) => ({
    projectId: f.projectId,
    vote: f.vote as "up" | "down",
    reason: f.reason,
  }));

  const feedbackMap = new Map(feedbackData.map(f => [f.projectId, f]));

  // Build pipeline claims lookup by projectId
  const claimsMap = new Map(
    (myClaims ?? []).map((c: any) => [c.projectId, { id: c.id, status: c.status }])
  );

  const personalizedProjects = scoreAndRankProjects(
    projects as ProjectData[],
    profileData,
    feedbackData
  );

  // Apply business line filter first, then priority/sector
  const businessLineFiltered = businessLineFilter === "all"
    ? personalizedProjects
    : personalizedProjects.filter((p: ProjectData) => {
        const blIds = p.matchedBusinessLines;
        if (!blIds || blIds.length === 0) return false;
        return blIds.includes(Number(businessLineFilter));
      });

  const filteredProjects = businessLineFiltered.filter((p: ProjectData) => {
    if (priorityFilter !== "all" && p.priority !== priorityFilter) return false;
    if (sectorFilter !== "all" && p.sector !== sectorFilter) return false;
    return true;
  });

  const hotProjects = businessLineFiltered.filter((p: ProjectData) => p.priority === "hot");
  const warmProjects = businessLineFiltered.filter((p: ProjectData) => p.priority === "warm");
  const coldProjects = businessLineFiltered.filter((p: ProjectData) => p.priority === "cold");

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Header */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={IMAGES.heroBanner} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-navy/95 via-navy/85 to-navy/70" />
        </div>
        <div className="relative container py-8 sm:py-12">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight">
                Atlas Copco Portable Air
              </h1>
              <p className="text-sm sm:text-base text-slate-300 mt-1 font-medium">
                Market Intelligence Dashboard — Personalised for You
              </p>
            </div>
            <div className="text-right flex flex-col items-end gap-2">
              <div className="text-xl sm:text-2xl font-bold text-gold tracking-wider">ATLAS COPCO</div>
              <div className="text-xs text-slate-400">
                Multi-Source Intelligence | Updated: {new Date(report.generatedTime).toLocaleDateString()}
              </div>
              {/* User info & settings & logout */}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-slate-400">{user?.name || user?.email}</span>
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

      {/* Main Content */}
      <main className="container py-6 sm:py-8">
        {/* Business Line Filter */}
        {activeBusinessLines && activeBusinessLines.length > 0 && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Division:</span>
            <button
              onClick={() => setBusinessLineFilter("all")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                businessLineFilter === "all"
                  ? "bg-navy text-white shadow-sm"
                  : "bg-card text-muted-foreground border border-border hover:border-navy/30"
              }`}
            >
              All Divisions ({personalizedProjects.length})
            </button>
            {activeBusinessLines.map((bl: any) => {
              const count = personalizedProjects.filter((p: ProjectData) => {
                const ids = p.matchedBusinessLines;
                return ids && ids.includes(bl.id);
              }).length;
              return (
                <button
                  key={bl.id}
                  onClick={() => setBusinessLineFilter(String(bl.id))}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    businessLineFilter === String(bl.id)
                      ? "bg-navy text-white shadow-sm"
                      : "bg-card text-muted-foreground border border-border hover:border-navy/30"
                  }`}
                >
                  {bl.name} ({count})
                </button>
              );
            })}
          </div>
        )}

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="w-full justify-start bg-card border border-border rounded-lg p-1 overflow-x-auto flex-nowrap mb-6">
            <TabsTrigger value="overview" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">Overview</TabsTrigger>
            <TabsTrigger value="projects" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">All Projects ({projects.length})</TabsTrigger>
            <TabsTrigger value="awarded" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">Awarded Projects</TabsTrigger>
            <TabsTrigger value="drilling" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">Drilling & Exploration</TabsTrigger>
            <TabsTrigger value="contacts" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">Contacts ({contacts.length})</TabsTrigger>
            <TabsTrigger value="sources" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">Sources & Methodology</TabsTrigger>
          </TabsList>

          {/* ===== OVERVIEW TAB ===== */}
          <TabsContent value="overview" className="space-y-6">
            {/* Executive Summary */}
            <div className="bg-card rounded-lg border border-border p-5 sm:p-6">
              <h2 className="text-lg font-bold text-navy flex items-center gap-2 mb-3">
                <FileText className="w-5 h-5 text-gold" />
                Market Intelligence Overview
              </h2>
              <p className="text-sm text-foreground/80 leading-relaxed mb-4">
                {report.executiveSummaryMain || `Tracking ${report.totalProjects} projects across mining, infrastructure, energy, and defence sectors. Projects are ranked by your personal preferences — use thumbs up/down on project cards to improve your recommendations.`}
              </p>
              {actionItems.length > 0 && (
                <div className="bg-gold/8 border border-gold/25 rounded-lg p-4 mb-4">
                  <h3 className="text-sm font-bold text-gold-dark mb-2 flex items-center gap-2">
                    <ArrowUpRight className="w-4 h-4" /> Top Action Items for Sales
                  </h3>
                  <ol className="space-y-2">
                    {actionItems.map((item: string, i: number) => (
                      <li key={i} className="text-sm text-foreground/80 flex gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-gold text-navy text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                        {item}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <p className="text-sm text-foreground/70">{report.executiveSummaryChanges}</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <KPICard value={businessLineFiltered.length} label="Total Projects" accent="teal" />
              <KPICard value={hotProjects.length} label="Hot Projects" accent="hot" />
              <KPICard value={warmProjects.length} label="Warm Projects" accent="warm" />
              <KPICard value={coldProjects.length} label="Cold / Monitor" />
              <KPICard value={awardedProjects.length} label="Awarded" accent="gold" />
              <KPICard value={drillingCampaigns.length} label="Drilling Campaigns" />
              <KPICard value={contacts.length} label="Contacts" />
              <KPICard value="4" label="Data Sources" accent="teal" />
            </div>

            {/* Hot Projects */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Flame className="w-5 h-5 text-hot" />
                <h2 className="text-lg font-bold text-navy">Hot Projects</h2>
                <span className="px-2 py-0.5 rounded-full bg-hot/15 text-hot text-xs font-bold">{hotProjects.length}</span>
              </div>
              <div className="space-y-3">
                {hotProjects.map((p: ProjectData) => <ProjectCard key={p.id} project={p} existingFeedback={feedbackMap.get(p.id) ?? null} pipelineClaim={claimsMap.get(p.id) ?? null} />)}
              </div>
            </div>
          </TabsContent>

          {/* ===== ALL PROJECTS TAB ===== */}
          <TabsContent value="projects" className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <PriorityFilter active={priorityFilter} onChange={setPriorityFilter} stats={{ total: businessLineFiltered.length, hot: hotProjects.length, warm: warmProjects.length, cold: coldProjects.length }} />
              <SectorFilter active={sectorFilter} onChange={setSectorFilter} />
            </div>

            {(["hot", "warm", "cold"] as const).map(priority => {
              const group = filteredProjects.filter((p: ProjectData) => p.priority === priority);
              if (group.length === 0) return null;
              const icon = priority === "hot" ? <Flame className="w-4 h-4 text-hot" /> : priority === "warm" ? <TrendingUp className="w-4 h-4 text-warm" /> : <BarChart3 className="w-4 h-4 text-cold" />;
              const label = priority === "hot" ? "Hot Projects" : priority === "warm" ? "Warm Projects" : "Cold / Monitor Projects";
              const badgeClass = priority === "hot" ? "bg-hot/15 text-hot" : priority === "warm" ? "bg-warm/15 text-warm" : "bg-cold/15 text-cold";
              return (
                <div key={priority}>
                  <div className="flex items-center gap-2 mb-3">
                    {icon}
                    <h2 className="text-base font-bold text-navy">{label}</h2>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${badgeClass}`}>{group.length}</span>
                  </div>
                  <div className="space-y-3">
                    {group.map((p: ProjectData) => <ProjectCard key={p.id} project={p} existingFeedback={feedbackMap.get(p.id) ?? null} pipelineClaim={claimsMap.get(p.id) ?? null} />)}
                  </div>
                </div>
              );
            })}
          </TabsContent>

          {/* ===== AWARDED PROJECTS TAB ===== */}
          <TabsContent value="awarded" className="space-y-5">
            <div className="bg-card rounded-lg border border-border p-5">
              <h2 className="text-lg font-bold text-navy mb-2">Awarded Projects — Confirmed Contractor Opportunities</h2>
              <p className="text-sm text-foreground/70 mb-4">These projects have confirmed contract awards with named contractors. These are the highest-confidence opportunities — the contractor is known, the work is funded, and mobilisation is underway or imminent.</p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Project</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Value</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Winning Contractor</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Location</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Stage</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Opportunity</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {awardedProjects.map((ap: any, i: number) => {
                    const oppClass = ap.opportunity === "Direct" ? "bg-teal/15 text-teal" : ap.opportunity === "Fleet" ? "bg-gold/15 text-gold-dark" : "bg-slate-200 text-slate-600";
                    return (
                      <tr key={ap.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                        <td className="px-4 py-3 font-semibold text-navy">{ap.project}</td>
                        <td className="px-4 py-3 font-medium">{ap.value}</td>
                        <td className="px-4 py-3">{ap.winningContractor}</td>
                        <td className="px-4 py-3 text-muted-foreground">{ap.location}</td>
                        <td className="px-4 py-3 text-muted-foreground">{ap.stage}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${oppClass}`}>{ap.opportunity}</span></td>
                        <td className="px-4 py-3">
                          {ap.sourceUrl && (
                            <a href={ap.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-teal hover:text-teal-light text-xs flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" />{ap.sourceLabel || "Source"}
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ===== DRILLING TAB ===== */}
          <TabsContent value="drilling" className="space-y-5">
            <div className="bg-card rounded-lg border border-border p-5">
              <h2 className="text-lg font-bold text-navy mb-2">Drilling & Exploration Campaigns</h2>
              <p className="text-sm text-foreground/70">Active and upcoming drilling campaigns represent direct demand for portable air compressors. RC drilling rigs require 600-1200 CFM at 350 psi. Diamond drilling requires 200-400 CFM. These are time-sensitive opportunities.</p>
            </div>
            <div className="relative rounded-lg overflow-hidden h-48 sm:h-56">
              <img src={IMAGES.miningOps} alt="Mining operations" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-navy/80 to-transparent" />
              <div className="absolute bottom-4 left-5 text-white">
                <h3 className="text-lg font-bold">Portable Air in Action</h3>
                <p className="text-xs text-slate-300">Compressed air is critical for drilling, blasting, and maintenance operations</p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Campaign</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Operator</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Location</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Drill Type</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Timing</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Air Requirement</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {drillingCampaigns.map((dc: any, i: number) => (
                    <tr key={dc.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                      <td className="px-4 py-3 font-semibold text-navy">{dc.campaign}</td>
                      <td className="px-4 py-3">{dc.operator}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dc.location}</td>
                      <td className="px-4 py-3">{dc.drillType}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dc.timing}</td>
                      <td className="px-4 py-3 font-medium text-teal">{dc.airRequirement}</td>
                      <td className="px-4 py-3">
                        {dc.sourceUrl && (
                          <a href={dc.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-teal hover:text-teal-light text-xs flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" />{dc.sourceLabel || "Source"}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ===== CONTACTS TAB ===== */}
          <TabsContent value="contacts" className="space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-gold" />
              <h2 className="text-lg font-bold text-navy">Contact Database</h2>
              <span className="px-2 py-0.5 rounded-full bg-gold/15 text-gold-dark text-xs font-bold">{contacts.length} contacts</span>
            </div>
            <ContactsTable data={contacts as ContactRow[]} weekEnding={report.weekEnding} />
          </TabsContent>

          {/* ===== SOURCES TAB ===== */}
          <TabsContent value="sources" className="space-y-5">
            <div className="bg-card rounded-lg border border-border p-5">
              <h2 className="text-lg font-bold text-navy mb-2 flex items-center gap-2">
                <Database className="w-5 h-5 text-gold" /> Data Sources & Pipeline
              </h2>
              <p className="text-sm text-foreground/70">Projects are aggregated from multiple automated data sources, each running on a scheduled pipeline. New projects are automatically extracted, deduplicated, and ranked by your personal preferences.</p>
            </div>

            <div>
              <h3 className="text-base font-bold text-navy mb-3">Active Data Sources</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-navy text-white">
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Source</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Type</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Schedule</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Coverage</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">AI Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { source: "RSS Feed Pipeline", type: "18+ Industry Feeds", schedule: "Daily (06:00 UTC)", coverage: "Mining, Energy, Infrastructure, Defence", credits: "~50/day cap" },
                      { source: "Projectory", type: "Web Scraper", schedule: "Weekly (Mondays)", coverage: "Resources, Infrastructure, Construction, Energy, Industrial, Defence", credits: "None" },
                      { source: "DMIRS MINEDEX", type: "Government API", schedule: "Weekly (Wednesdays)", coverage: "WA Mining Proposals & Approvals", credits: "None" },
                      { source: "LinkedIn People Search", type: "Contact Enrichment", schedule: "On new projects", coverage: "Contact verification & enrichment", credits: "30 lookups/day" },
                    ].map((row, i) => (
                      <tr key={i} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"}`}>
                        <td className="px-4 py-3 font-semibold text-navy">{row.source}</td>
                        <td className="px-4 py-3">{row.type}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.schedule}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.coverage}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${row.credits === "None" ? "bg-teal/15 text-teal" : "bg-gold/15 text-gold-dark"}`}>{row.credits}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-base font-bold text-navy mb-3">How Personalisation Works</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-2xl font-bold text-gold mb-1">1</div>
                  <h4 className="text-sm font-bold text-navy mb-1">Profile Matching</h4>
                  <p className="text-xs text-muted-foreground">Your onboarding preferences (territories, industries, deal size) are matched against each project to calculate a relevance score.</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-2xl font-bold text-gold mb-1">2</div>
                  <h4 className="text-sm font-bold text-navy mb-1">Feedback Learning</h4>
                  <p className="text-xs text-muted-foreground">Every thumbs up/down adjusts your personal weights via Bayesian learning. The more feedback you give, the better your rankings become.</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-2xl font-bold text-gold mb-1">3</div>
                  <h4 className="text-sm font-bold text-navy mb-1">Smart Ranking</h4>
                  <p className="text-xs text-muted-foreground">Projects are scored combining profile match, feedback boost, and priority signals. Hot projects with high relevance appear first.</p>
                </div>
              </div>
            </div>

            <div className="bg-gold/8 border border-gold/25 rounded-lg p-4">
              <p className="text-sm text-foreground/80">
                <strong className="text-navy">Methodology Note:</strong> All CAPEX grades are evidence-based. Contractor predictions include confidence scores and are clearly labelled. Contact information is enriched via LinkedIn but requires verification before outreach.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="bg-navy text-slate-400 py-6 mt-8">
        <div className="container text-center">
          <p className="text-xs font-medium text-gold mb-1">Powered by Multi-Source Intelligence Pipeline</p>
          <p className="text-xs">Atlas Copco Portable Air — Market Intelligence Dashboard</p>
          <p className="text-xs mt-1">Data sourced from RSS feeds, Projectory, DMIRS MINEDEX, ASX releases, and industry publications. Ranked by your preferences.</p>
        </div>
      </footer>
    </div>
  );
}
