import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Database,
  GitBranch,
  Loader2,
  RefreshCw,
  ServerCog,
  Shield,
  XCircle,
} from "lucide-react";
import { useLocation } from "wouter";

function formatTimestamp(value: string) {
  if (!value || value === "unknown") return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-AU");
}

function syncStatePresentation(state: "aligned" | "out_of_sync" | "unknown") {
  if (state === "aligned") {
    return {
      label: "Aligned",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      icon: <CheckCircle2 className="h-4 w-4" />,
    };
  }
  if (state === "out_of_sync") {
    return {
      label: "Out of sync",
      className: "border-red-200 bg-red-50 text-red-700",
      icon: <XCircle className="h-4 w-4" />,
    };
  }
  return {
    label: "Unknown",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    icon: <AlertTriangle className="h-4 w-4" />,
  };
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[220px_1fr] sm:gap-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`break-all text-sm text-navy ${mono ? "font-mono" : "font-medium"}`}>{value}</div>
    </div>
  );
}

function ConfigurationRow({ label, configured }: { label: string; configured: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-b-0">
      <span className="text-sm font-medium text-navy">{label}</span>
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
        configured
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}>
        {configured ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
        {configured ? "Configured" : "Missing"}
      </span>
    </div>
  );
}

export default function DeploymentDiagnostics() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const isAdmin = user?.role === "admin";
  const diagnostics = trpc.system.deploymentDiagnostics.useQuery(undefined, {
    enabled: isAdmin,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    );
  }

  if (!user) {
    window.location.href = "/login";
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <Shield className="mx-auto mb-3 h-12 w-12 text-red-600" />
          <h1 className="text-xl font-bold text-navy">Admin access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">Deployment provenance is restricted to administrators.</p>
          <Button className="mt-5 bg-navy text-white hover:bg-navy-light" onClick={() => navigate("/")}>Back to dashboard</Button>
        </div>
      </div>
    );
  }

  const data = diagnostics.data;
  const sync = data ? syncStatePresentation(data.provenance.syncState) : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy py-4 text-white">
        <div className="container flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate("/admin")} className="p-2 text-white hover:bg-navy-light">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <ServerCog className="h-5 w-5 text-gold" /> Deployment Diagnostics
              </h1>
              <p className="text-xs text-slate-400">GitHub, Manus and runtime provenance</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => diagnostics.refetch()}
            disabled={diagnostics.isFetching}
            className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${diagnostics.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      <main className="container space-y-5 py-6 sm:py-8">
        {diagnostics.isLoading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-gold" /> Loading deployment metadata…
          </div>
        )}

        {diagnostics.error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-bold">Diagnostics unavailable</div>
              <div className="mt-1">{diagnostics.error.message}</div>
            </div>
          </div>
        )}

        {data && sync && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-navy">
                      <GitBranch className="h-5 w-5 text-gold" /> Source alignment
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Compares the deployed revision supplied by the deployment with the expected GitHub main revision.
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${sync.className}`}>
                    {sync.icon} {sync.label}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <DetailRow label="Source repository" value={`${data.provenance.sourceRepository} · ${data.provenance.sourceBranch}`} />
                <DetailRow label="Deployed Git SHA" value={data.provenance.deployedGitSha} mono />
                <DetailRow label="Expected GitHub main SHA" value={data.provenance.expectedMainSha} mono />
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                  A mismatch only proves that the two supplied revisions differ. This panel does not infer which commit is newer or inspect Git history at runtime.
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-navy">
                    <Clock3 className="h-5 w-5 text-gold" /> Build provenance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DetailRow label="Application" value={data.provenance.appName} />
                  <DetailRow label="Version" value={data.provenance.appVersion} />
                  <DetailRow label="Environment" value={data.provenance.deploymentEnvironment} />
                  <DetailRow label="Manus checkpoint" value={data.provenance.manusCheckpointId} mono />
                  <DetailRow label="Build timestamp" value={formatTimestamp(data.provenance.buildTimestamp)} />
                  <DetailRow label="Schema version" value={data.provenance.schemaVersion} mono />
                  <DetailRow label="Last checked" value={formatTimestamp(data.provenance.checkedAt)} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-navy">
                    <Database className="h-5 w-5 text-gold" /> Safe configuration checks
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Only presence checks are returned. Secret values and connection strings are never exposed.</p>
                </CardHeader>
                <CardContent>
                  <ConfigurationRow label="Database configuration" configured={data.configuration.databaseConfigured} />
                  <ConfigurationRow label="Authentication configuration" configured={data.configuration.authenticationConfigured} />
                  <ConfigurationRow label="Published site URL" configured={data.configuration.appSiteUrlConfigured} />
                  <ConfigurationRow label="Required provenance metadata" configured={data.configuration.requiredMetadataConfigured} />
                </CardContent>
              </Card>
            </div>

            {data.missingMetadata.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="h-4 w-4" /> Deployment metadata is incomplete
                </div>
                <p className="mt-1 text-xs">Configure these non-secret deployment variables:</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.missingMetadata.map((name) => (
                    <code key={name} className="rounded border border-amber-200 bg-white px-2 py-1 text-[11px]">{name}</code>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
