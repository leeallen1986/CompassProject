import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CheckCircle2, GitCommitHorizontal, XCircle } from "lucide-react";

export default function DeploymentProvenanceBadge() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const diagnostics = trpc.system.deploymentDiagnostics.useQuery(undefined, {
    enabled: isAdmin,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (!isAdmin || !diagnostics.data) return null;

  const { provenance } = diagnostics.data;
  const presentation = provenance.syncState === "aligned"
    ? {
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        label: "Aligned",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      }
    : provenance.syncState === "out_of_sync"
      ? {
          icon: <XCircle className="h-3.5 w-3.5" />,
          label: "Out of sync",
          className: "border-red-200 bg-red-50 text-red-700",
        }
      : {
          icon: <AlertTriangle className="h-3.5 w-3.5" />,
          label: "Metadata missing",
          className: "border-amber-200 bg-amber-50 text-amber-700",
        };

  return (
    <a
      href="/admin/deployment"
      className={`fixed bottom-3 right-3 z-40 hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold shadow-sm transition-shadow hover:shadow-md sm:inline-flex ${presentation.className}`}
      title="Open deployment diagnostics"
    >
      {presentation.icon}
      <GitCommitHorizontal className="h-3.5 w-3.5" />
      <span>{provenance.deployedGitShaShort}</span>
      <span className="opacity-70">·</span>
      <span>{presentation.label}</span>
    </a>
  );
}
