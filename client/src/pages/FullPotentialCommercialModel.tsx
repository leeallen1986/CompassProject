import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calculator,
  Loader2,
  LogIn,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { commercialModelApi, type CommercialAccount } from "@/lib/fullPotentialCommercialModel";
import FullPotentialCommercialModelPanel from "@/components/FullPotentialCommercialModelPanel";
import { Button } from "@/components/ui/button";

function initialAccountId(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("accountId");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function accountName(account: any): string {
  return account?.displayName || account?.canonicalName || `Account ${account?.id ?? ""}`;
}

function badgeClass(value: string) {
  if (value === "tier_a" || value === "push_now") return "border-red-200 bg-red-50 text-red-700";
  if (value === "tier_b" || value === "active_target") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export default function FullPotentialCommercialModel() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(initialAccountId);
  const [selectedAccountDetails, setSelectedAccountDetails] = useState<CommercialAccount | null>(null);
  const [selectedAccountLoading, setSelectedAccountLoading] = useState(false);
  const [selectedAccountError, setSelectedAccountError] = useState("");

  const queryInput = useMemo(() => ({
    search: search.trim() || undefined,
    limit: 50,
    offset: 0,
  }), [search]);

  const listQuery = trpc.fullPotential.list.useQuery(queryInput, {
    enabled: !!user && user.role !== "distributor",
  });

  const accounts = listQuery.data?.accounts ?? [];
  const selectedFromList = useMemo(
    () => selectedAccountId
      ? accounts.find((account: any) => Number(account.id) === selectedAccountId) ?? null
      : null,
    [accounts, selectedAccountId],
  );
  const selectedAccount = selectedFromList ?? selectedAccountDetails;

  useEffect(() => {
    if (!selectedAccountId || !user || user.role === "distributor" || selectedFromList) {
      if (selectedFromList) setSelectedAccountDetails(selectedFromList as CommercialAccount);
      setSelectedAccountLoading(false);
      setSelectedAccountError("");
      return;
    }

    let cancelled = false;
    setSelectedAccountLoading(true);
    setSelectedAccountError("");
    void commercialModelApi.workspace(selectedAccountId)
      .then(data => {
        if (!cancelled) setSelectedAccountDetails(data.account);
      })
      .catch(loadError => {
        if (!cancelled) {
          setSelectedAccountDetails(null);
          setSelectedAccountError(loadError instanceof Error ? loadError.message : "Could not load the selected account");
        }
      })
      .finally(() => {
        if (!cancelled) setSelectedAccountLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, selectedFromList, user]);

  function selectAccount(account: any) {
    const id = Number(account.id);
    if (!Number.isInteger(id) || id <= 0) return;
    setSelectedAccountId(id);
    setSelectedAccountDetails(account as CommercialAccount);
    const url = `/full-potential/commercial-model?accountId=${id}`;
    window.history.replaceState({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-bold text-navy">Authentication Required</h2>
        <a href={getLoginUrl()} className="inline-flex items-center gap-2 rounded-lg bg-navy px-6 py-3 font-semibold text-white hover:bg-navy-light">
          <LogIn className="h-4 w-4" /> Sign In
        </a>
      </div>
    );
  }

  if (user.role === "distributor") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
        <ShieldAlert className="h-12 w-12 text-red-500" />
        <h2 className="text-xl font-bold text-navy">Internal Sales Access Required</h2>
        <p className="max-w-lg text-sm text-muted-foreground">
          Full Potential commercial models contain internal account assumptions and approval records and are not available to distributor users.
        </p>
        <Button variant="outline" onClick={() => navigate("/full-potential")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Full Potential
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-white">
        <div className="container flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => navigate("/full-potential")} className="rounded p-1.5 transition-colors hover:bg-white/10">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold">
                <Calculator className="h-5 w-5 text-gold" />
                Full Potential Commercial Model
              </h1>
              <p className="text-xs text-slate-300">Evidence → product-family calculation → manager approval</p>
            </div>
          </div>
          <div className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-slate-200">
            Internal sales · V1
          </div>
        </div>
      </header>

      <main className="container grid gap-6 py-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-navy" />
              <h2 className="font-bold text-navy">Select an account</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Search the Portable Air Full Potential universe. No values are written until a manager approves a model.
            </p>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Account, owner, segment, supplier…"
                className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
              />
            </div>
          </section>

          <section className="max-h-[calc(100vh-230px)] overflow-y-auto rounded-xl border border-border bg-card">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Accounts</span>
              <span className="text-xs text-muted-foreground">{listQuery.data?.total ?? 0}</span>
            </div>
            {listQuery.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
              </div>
            ) : listQuery.isError ? (
              <div className="p-4 text-sm text-red-700">Could not load accounts: {listQuery.error.message}</div>
            ) : accounts.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No accounts match the current search.</div>
            ) : (
              <div className="divide-y divide-border">
                {accounts.map((account: any) => {
                  const selected = Number(account.id) === selectedAccountId;
                  return (
                    <button
                      key={account.id}
                      onClick={() => selectAccount(account)}
                      className={`w-full px-4 py-3 text-left transition-colors ${selected ? "bg-gold/15" : "hover:bg-slate-50"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-navy">{accountName(account)}</div>
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                            #{account.id} · {account.segment || "No segment"} · {account.state || "No state"}
                          </div>
                        </div>
                        <Building2 className={`h-4 w-4 shrink-0 ${selected ? "text-gold-dark" : "text-muted-foreground"}`} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${badgeClass(account.priorityTier)}`}>
                          {account.priorityTier || "unassigned"}
                        </span>
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${badgeClass(account.platformPushDecision)}`}>
                          {account.platformPushDecision || "qualify"}
                        </span>
                        <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-700">
                          {account.routeToMarket || "manual_review"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </aside>

        <section className="min-w-0">
          {!selectedAccountId ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
              <Calculator className="h-12 w-12 text-gold-dark" />
              <h2 className="mt-4 text-xl font-bold text-navy">Select an account to begin</h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Capture evidence, calculate product-family potential, submit the model and maintain the complete manager-review trail from one workspace.
              </p>
            </div>
          ) : selectedAccountLoading && !selectedAccount ? (
            <div className="flex min-h-[520px] items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading selected account…
            </div>
          ) : !selectedAccount ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
              {selectedAccountError || `Account #${selectedAccountId} was not found in the current Full Potential universe.`}
            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Selected account</div>
                    <h2 className="mt-1 text-xl font-bold text-navy">{accountName(selectedAccount)}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      #{selectedAccount.id} · {(selectedAccount as any).ownerName || "Unassigned"} · {selectedAccount.routeToMarket}
                    </p>
                  </div>
                  <a
                    href={`/full-potential?search=${encodeURIComponent(accountName(selectedAccount))}`}
                    className="text-xs font-semibold text-blue-700 hover:underline"
                  >
                    Open in account universe
                  </a>
                </div>
              </section>
              <FullPotentialCommercialModelPanel account={selectedAccount} defaultExpanded />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
