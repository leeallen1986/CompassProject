/**
 * ProjectDetail — True deep-link page for individual projects.
 * Route: /project/:id
 *
 * Fetches the project by ID independently of the dashboard list.
 * Renders the full ProjectCard in expanded context with:
 *   - Scope banners (stale, archived, suppressed, awarded, completed)
 *   - Error state if project not found
 *   - "Back to dashboard" and "View in list" navigation
 */
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation, Link } from "wouter";
import {
  ArrowLeft, AlertTriangle, Loader2, ExternalLink,
  MapPin, Calendar, Flame, Building, Shield,
  Pickaxe, Fuel, TrendingUp, BarChart3, Eye,
  Info, XCircle, Archive, Clock, CheckCircle2,
  ChevronRight, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ProjectCard, { type ProjectData, type ContactData } from "@/components/ProjectCard";

// ── Sector icons (same as dashboard) ──
const sectorIcons: Record<string, React.ReactNode> = {
  mining: <Pickaxe className="w-4 h-4" />,
  oil_gas: <Fuel className="w-4 h-4" />,
  infrastructure: <Building className="w-4 h-4" />,
  energy: <TrendingUp className="w-4 h-4" />,
  defence: <Shield className="w-4 h-4" />,
};

const sectorLabels: Record<string, string> = {
  mining: "Mining",
  oil_gas: "Oil & Gas",
  infrastructure: "Infrastructure",
  energy: "Energy",
  defence: "Defence",
};

const lifecycleLabels: Record<string, { label: string; color: string; icon: React.ReactNode; description: string }> = {
  active: { label: "Active", color: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: <CheckCircle2 className="w-4 h-4" />, description: "This project is active and within your normal scope." },
  stale: { label: "Stale", color: "bg-amber-100 text-amber-800 border-amber-300", icon: <Clock className="w-4 h-4" />, description: "This project has not been updated recently and may be outdated." },
  archived: { label: "Archived", color: "bg-slate-100 text-slate-600 border-slate-300", icon: <Archive className="w-4 h-4" />, description: "This project has been archived and is no longer in active scope." },
  awarded: { label: "Awarded", color: "bg-blue-100 text-blue-800 border-blue-300", icon: <CheckCircle2 className="w-4 h-4" />, description: "This project has been awarded to a contractor." },
  completed: { label: "Completed", color: "bg-purple-100 text-purple-800 border-purple-300", icon: <CheckCircle2 className="w-4 h-4" />, description: "This project has been completed." },
};

export default function ProjectDetail({ params }: { params: { id: string } }) {
  const { user, loading: authLoading } = useAuth();
  const [location, navigate] = useLocation();
  const projectId = parseInt(params.id, 10);

  // Detect if user arrived from Top 3 Actions section
  const fromTop3 = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("from") === "top3"
    : false;
  const backLabel = fromTop3 ? "Back to Top 3 Actions" : "Back to Dashboard";
  const backPath = fromTop3 ? "/?section=top3" : "/dashboard";

  // Fetch project by ID — independent of dashboard filters
  const { data, isLoading, error } = trpc.projectLifecycle.byId.useQuery(
    { id: projectId },
    { enabled: !isNaN(projectId) && !authLoading && !!user, retry: 1 }
  );

  // Fetch user profile for buyerRoles
  const { data: profile } = trpc.profile.get.useQuery(undefined, {
    enabled: !!user,
  });

  // Fetch feedback for this project
  const { data: feedbackData } = trpc.feedback.byReport.useQuery(
    { reportId: data?.project?.reportId ?? 0 },
    { enabled: !!data?.project?.reportId && !!user }
  );

  const existingFeedback = useMemo(() => {
    if (!feedbackData || !data?.project) return null;
    return feedbackData.find((f: any) => f.projectId === projectId) ?? null;
  }, [feedbackData, data?.project, projectId]);

  // ── Auth guard ──
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gold" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
          <h2 className="text-xl font-bold text-navy">Authentication Required</h2>
          <p className="text-muted-foreground">Please log in to view project details.</p>
          <Button onClick={() => navigate("/login")} className="bg-navy text-white">
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  // ── Invalid ID ──
  if (isNaN(projectId)) {
    return (
      <div className="min-h-screen bg-background">
        <ProjectDetailHeader onBack={() => navigate("/dashboard")} />
        <div className="container py-12">
          <ErrorState
            title="Invalid Project ID"
            message={`"${params.id}" is not a valid project identifier.`}
            onBack={() => navigate("/dashboard")}
          />
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <ProjectDetailHeader onBack={() => navigate("/dashboard")} />
        <div className="container py-12 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-gold" />
          <p className="text-sm text-muted-foreground">Loading project #{projectId}...</p>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <ProjectDetailHeader onBack={() => navigate("/dashboard")} />
        <div className="container py-12">
          <ErrorState
            title="Failed to Load Project"
            message={error.message || "An unexpected error occurred while loading this project."}
            onBack={() => navigate("/dashboard")}
          />
        </div>
      </div>
    );
  }

  // ── Project not found ──
  if (!data?.project) {
    return (
      <div className="min-h-screen bg-background">
        <ProjectDetailHeader onBack={() => navigate("/dashboard")} />
        <div className="container py-12">
          <ErrorState
            title="Project Not Found"
            message={`Project #${projectId} does not exist or has been permanently removed from the system.`}
            onBack={() => navigate("/dashboard")}
          />
        </div>
      </div>
    );
  }

  const { project, contacts, userClaim, businessLineNames, scopeFlags } = data;

  // Determine if project is outside normal active scope
  const isOutOfScope = scopeFlags && (!scopeFlags.isActive || scopeFlags.isSuppressed);
  const lifecycle = lifecycleLabels[scopeFlags?.lifecycleStatus ?? "active"] ?? lifecycleLabels.active;

  return (
    <div className="min-h-screen bg-background">
        <ProjectDetailHeader
        onBack={() => navigate(backPath)}
        projectName={project.name}
        sector={project.sector}
        priority={project.priority}
      />

      <main className="container py-6 max-w-4xl mx-auto">
        {/* ── Scope Banner ── */}
        {isOutOfScope && (
          <div className={`mb-4 rounded-lg border p-4 ${lifecycle.color}`}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5">{lifecycle.icon}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">
                    This project is outside your current scope filters
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${lifecycle.color} border`}>
                    {lifecycle.label}
                  </span>
                  {scopeFlags?.isSuppressed && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-700 border border-red-300">
                      Suppressed
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1 opacity-80">{lifecycle.description}</p>
                {scopeFlags?.suppressionReason && (
                  <p className="text-xs mt-1 opacity-70">Reason: {scopeFlags.suppressionReason}</p>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => navigate("/dashboard")}
                  >
                    <Filter className="w-3 h-3 mr-1" /> Return to Scoped View
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => navigate(`/dashboard?project=${projectId}&expandFilters=true`)}
                  >
                    <Eye className="w-3 h-3 mr-1" /> Show in Dashboard
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Active scope info (not a warning, just context) ── */}
        {!isOutOfScope && scopeFlags && (
          <div className="mb-4 rounded-lg border border-border bg-card p-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="w-4 h-4 text-teal shrink-0" />
            <span>
              Viewing project directly. This project is{" "}
              <span className="font-semibold text-foreground">{lifecycle.label.toLowerCase()}</span>{" "}
              and within your normal scope.
            </span>
            <Link href={`/dashboard?project=${projectId}`} className="ml-auto text-navy hover:underline font-medium flex items-center gap-1">
              View in list <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        )}

        {/* ── Project Card (expanded) ── */}
        <ProjectCard
          project={project as ProjectData}
          existingFeedback={existingFeedback}
          pipelineClaim={userClaim ? { id: userClaim.id, status: userClaim.status } : null}
          businessLineNames={businessLineNames ?? {}}
          allContacts={(contacts ?? []) as ContactData[]}
          buyerRoles={profile?.buyerRoles as string[] | undefined}
        />

        {/* ── Navigation footer ── */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-navy"
            onClick={() => navigate(backPath)}
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> {backLabel}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => navigate("/")}
            >
              This Week
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => navigate(`/account-attack?account=${encodeURIComponent(project.owner)}`)}
            >
              Account Attack: {project.owner}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Sub-components ──

function ProjectDetailHeader({
  onBack,
  projectName,
  sector,
  priority,
}: {
  onBack: () => void;
  projectName?: string;
  sector?: string;
  priority?: string;
}) {
  return (
    <header className="bg-navy text-white">
      <div className="container py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {projectName ? (
            <>
              {sector && sectorIcons[sector] && (
                <span className="opacity-70">{sectorIcons[sector]}</span>
              )}
              <h1 className="text-sm sm:text-base font-bold truncate">{projectName}</h1>
              {sector && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/15 font-medium uppercase tracking-wider hidden sm:inline">
                  {sectorLabels[sector] ?? sector}
                </span>
              )}
              {priority && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                  priority === "hot" ? "bg-hot text-white" :
                  priority === "warm" ? "bg-warm text-navy" :
                  "bg-cold text-white"
                }`}>
                  {priority}
                </span>
              )}
            </>
          ) : (
            <h1 className="text-sm font-bold">Project Detail</h1>
          )}
        </div>
        <Link href="/dashboard" className="text-xs text-slate-300 hover:text-white transition-colors hidden sm:flex items-center gap-1">
          <BarChart3 className="w-3.5 h-3.5" /> Dashboard
        </Link>
      </div>
    </header>
  );
}

function ErrorState({
  title,
  message,
  onBack,
}: {
  title: string;
  message: string;
  onBack: () => void;
}) {
  return (
    <div className="text-center space-y-4 py-12">
      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
        <XCircle className="w-8 h-8 text-red-500" />
      </div>
      <h2 className="text-xl font-bold text-navy">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{message}</p>
      <div className="flex items-center justify-center gap-3 pt-2">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    </div>
  );
}
