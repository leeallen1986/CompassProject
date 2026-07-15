import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  commercialModelApi,
  formatAud,
  modelEligibilityReasons,
  type CommercialWorkspace,
} from "@/lib/fullPotentialCommercialModel";
import EvidenceTab from "./fullPotentialCommercialModel/EvidenceTab";
import ModelTab from "./fullPotentialCommercialModel/ModelTab";
import { HistoryTab, StructureTab } from "./fullPotentialCommercialModel/StructureHistoryTabs";
import { Card, StatusBadge } from "./fullPotentialCommercialModel/Ui";

type Tab = "summary" | "evidence" | "model" | "structure" | "history";
const tabs: Array<{ value: Tab; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "evidence", label: "Evidence" },
  { value: "model", label: "Model" },
  { value: "structure", label: "Structure" },
  { value: "history", label: "History" },
];

export default function FullPotentialCommercialModelPanel({ account, defaultExpanded = false }: {
  account: any;
  defaultExpanded?: boolean;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const accountId = Number(account?.id);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [tab, setTab] = useState<Tab>("summary");
  const [workspace, setWorkspace] = useState<CommercialWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creatingDraft, setCreatingDraft] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(accountId) || accountId <= 0) return;
    setLoading(true);
    setError("");
    try {
      setWorkspace(await commercialModelApi.workspace(accountId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load commercial model workspace");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    setWorkspace(null);
    setTab("summary");
    if (expanded) void load();
  }, [accountId, expanded, load]);

  const accountForRules = workspace?.account ?? account;
  const eligibility = useMemo(() => accountForRules ? modelEligibilityReasons(accountForRules) : [], [accountForRules]);
  const latest = workspace?.latestModel ?? null;
  const approved = workspace?.approvedModel ?? null;

  async function createDraft() {
    setCreatingDraft(true);
    try {
      const result = await commercialModelApi.createDraft(accountId);
      toast.success(result.alreadyExists ? "Existing active draft opened" : "Model draft created");
      await load();
      setTab("model");
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : "Could not create model draft");
    } finally {
      setCreatingDraft(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <button onClick={() => setExpanded(value => !value)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-gold/15 p-2 text-gold-dark"><Calculator className="h-4 w-4" /></span>
          <span><strong className="block text-sm text-navy">Commercial model</strong><small className="text-muted-foreground">Evidence-backed product-family potential</small></span>
        </div>
        <span className="flex items-center gap-2">{latest && <StatusBadge status={latest.status}>{latest.status}</StatusBadge>}{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
            <nav className="flex flex-wrap gap-1">{tabs.map(item => <button key={item.value} onClick={() => setTab(item.value)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${tab === item.value ? "bg-navy text-white" : "text-muted-foreground hover:bg-slate-100 hover:text-navy"}`}>{item.label}</button>)}</nav>
            <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-navy"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</button>
          </div>

          <div className="p-4">
            {loading && !workspace ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading commercial model…</div> : error ? <Card className="border-red-200 bg-red-50 text-sm text-red-700">{error}</Card> : workspace ? (
              <>
                {tab === "summary" && <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Card><small className="uppercase text-muted-foreground">Approved potential</small><strong className="mt-1 block text-xl text-navy">{formatAud(approved?.totalPotentialAud ?? workspace.account.fullPotentialAud)}</strong></Card>
                    <Card><small className="uppercase text-muted-foreground">Remaining</small><strong className="mt-1 block text-xl text-navy">{formatAud(approved?.remainingPotentialAud ?? workspace.account.remainingPotentialAud)}</strong></Card>
                    <Card><small className="uppercase text-muted-foreground">Evidence</small><strong className="mt-1 block text-xl text-navy">{workspace.evidence.length}</strong></Card>
                    <Card><small className="uppercase text-muted-foreground">Versions</small><strong className="mt-1 block text-xl text-navy">{workspace.models.length}</strong></Card>
                  </div>
                  {eligibility.length > 0 ? <Card className="border-amber-200 bg-amber-50"><h4 className="font-semibold text-amber-900">Not eligible for a new account-level model</h4><ul className="mt-2 text-xs text-amber-900">{eligibility.map(reason => <li key={reason}>• {reason}</li>)}</ul></Card> : latest ? <Card><div className="flex flex-wrap items-center justify-between gap-3"><span><h4 className="font-semibold text-navy">Latest version: {latest.versionNumber}</h4><p className="text-xs text-muted-foreground">{latest.status} · {latest.confidenceLevel} confidence · {formatAud(latest.totalPotentialAud)}</p></span><Button variant="outline" onClick={() => setTab("model")}>Open model</Button></div></Card> : <Card className="text-center"><h4 className="font-semibold text-navy">No model version yet</h4><p className="mt-1 text-sm text-muted-foreground">Capture evidence first, then create an accountable model draft.</p><Button onClick={() => void createDraft()} disabled={creatingDraft} className="mt-3 bg-navy text-white">{creatingDraft && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create draft</Button></Card>}
                  <Card><h4 className="font-semibold text-navy">V1 operating rule</h4><p className="mt-1 text-sm text-muted-foreground">The UI never writes account potential directly. Only a manager-approved, evidence-linked model updates the account totals.</p></Card>
                </div>}
                {tab === "evidence" && <EvidenceTab workspace={workspace} isAdmin={isAdmin} refresh={load} />}
                {tab === "model" && <ModelTab workspace={workspace} isAdmin={isAdmin} refresh={load} />}
                {tab === "structure" && <StructureTab workspace={workspace} isAdmin={isAdmin} refresh={load} />}
                {tab === "history" && <HistoryTab workspace={workspace} />}
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
