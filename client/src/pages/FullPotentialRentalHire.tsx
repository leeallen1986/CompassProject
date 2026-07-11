import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Download,
  ExternalLink,
  Filter,
  Flag,
  Gauge,
  Loader2,
  LogIn,
  RefreshCw,
  Search,
  ShieldAlert,
  Signal,
  Target,
  UserCheck,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { useLocation } from "wouter";

const VIEW_KEYS = [
  "all",
  "tier_a",
  "push_now",
  "owner_gap",
  "owner_mismatch",
  "channel_owner_gap",
  "unknown_installed_base",
  "supplier_gap",
  "financial_gap",
  "no_open_activity",
  "live_signal",
] as const;

type ViewKey = typeof VIEW_KEYS[number];
type OwnerAlignment = "aligned" | "mismatch" | "unassigned" | "manual_review";

type RentalAccount = {
  id: number;
  stableKey: string;
  canonicalName: string;
  displayName: string | null;
  parentGroup: string | null;
  rowClass: string | null;
  country: string | null;
  state: string | null;
  region: string | null;
  segment: string | null;
  subsegment: string | null;
  applicationPlays: string[];
  routeToMarket: string | null;
  routeClass: "direct" | "channel" | "other";
  ownerName: string | null;
  channelOwner: string | null;
  expectedOwnerName: string | null;
  ownerAlignment: OwnerAlignment;
  specialRule: string;
  fpStatus: string | null;
  priorityTier: string | null;
  platformPushDecision: string | null;
  currentRevenueAud: number;
  fullPotentialAud: number;
  target2026Aud: number;
  remainingPotentialAud: number;
  currentSupplier: string | null;
  installedBaseStatus: string | null;
  c4cStatus: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  openActionCount: number;
  latestOpenActionType: string | null;
  latestOpenActionStatus: string | null;
  latestOpenActionDueDate: string | null;
  signalCount: number;
  liveSignalCount: number;
  highestLiveUrgency: "hot" | "warm" | "cold" | "unknown";
  latestSignalTitle: string | null;
  latestSignalStatus: string | null;
  latestSignalDate: string | null;
  gapKeys: string[];
  reviewUrl: string;
};

type WorkspaceResponse = {
  generatedAt: string;
  selectionRule: string;
  ownershipRules: Array<{ rule: string; expectedOwnerName: string }>;
  summary: {
    totalRentalAccounts: number;
    tierA: number;
    pushNow: number;
    directAccounts: number;
    channelAccounts: number;
    ownerAligned: number;
    ownerMismatch: number;
    ownerUnassigned: number;
    channelOwnerGap: number;
    unknownInstalledBase: number;
    supplierGap: number;
    financialGap: number;
    noOpenActivity: number;
    liveSignalAccounts: number;
    totalCurrentRevenueAud: number;
    totalFullPotentialAud: number;
    totalTarget2026Aud: number;
    totalRemainingPotentialAud: number;
  };
  viewCounts: Record<ViewKey, number>;
  territorySummary: Array<{
    state: string;
    count: number;
    expectedOwner: string;
    aligned: number;
    mismatch: number;
    unassigned: number;
    direct: number;
    channel: number;
    tierA: number;
    pushNow: number;
  }>;
  ownerDistribution: Array<{ value: string; count: number }>;
  routeDistribution: Array<{ value: string; count: number }>;
  subsegmentDistribution: Array<{ value: string; count: number }>;
  filterOptions: {
    states: string[];
    routeToMarkets: string[];
    ownerNames: string[];
    subsegments: string[];
    priorityTiers: string[];
    rowClasses: string[];
  };
  accounts: RentalAccount[];
  total: number;
  limit: number;
  offset: number;
};

const VIEW_LABELS: Record<ViewKey, string> = {
  all: "All Rental",
  tier_a: "Tier A",
  push_now: "Push Now",
  owner_gap: "No Owner",
  owner_mismatch: "Owner Mismatch",
  channel_owner_gap: "No Channel Owner",
  unknown_installed_base: "Unknown IB",
  supplier_gap: "No Supplier",
  financial_gap: "No FP Value",
  no_open_activity: "No Activity",
  live_signal: "Live Signal",
};

const ROUTE_LABELS: Record<string, string> = {
  direct_ape: "Direct APE",
  cea: "CEA",
  cp_aps: "CP — APS",
  cp_blastone: "CP — BlastOne",
  cp_pneumatic_engineering: "CP — Pneumatic Engineering",
  cp_more_air: "CP — More Air",
  nz_distributor: "NZ Distributor",
  png_oceania: "PNG / Oceania",
  hybrid_strategic: "Hybrid Strategic",
  product_support: "Product Support",
  manual_review: "Manual Review",
  exclude: "Exclude",
};

const TIER_LABELS: Record<string, string> = {
  tier_a: "Tier A",
  tier_b: "Tier B",
  tier_c: "Tier C",
  tier_d: "Tier D",
  unassigned: "Unassigned",
};

const ROW_CLASS_LABELS: Record<string, string> = {
  account: "Account",
  site_context: "Site Context",
  channel_managed: "Channel Managed",
  competitor_watch: "Competitor Watch",
  cluster_signal: "Cluster / Signal",
};

const GAP_LABELS: Record<string, string> = {
  owner_gap: "No owner",
  owner_mismatch: "Owner mismatch",
  channel_owner_gap: "No channel owner",
  unknown_installed_base: "Unknown IB",
  supplier_gap: "No supplier",
  financial_gap: "No FP value",
  no_open_activity: "No activity",
  live_signal: "Live signal",
};

function formatCurrency(value: number) {
  if (!Number.isFinite(value) || value === 0) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toLocaleString("en-AU")}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function labelFor(value: string | null, labels: Record<string, string>) {
  return value ? labels[value] ?? value : "—";
}

function buildQueryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

async function fetchWorkspace(queryString: string): Promise<WorkspaceResponse> {
  const response = await fetch(`/api/full-potential/rental-hire?${queryString}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Rental Hire request failed (${response.status})`);
  }
  return response.json();
}

function FilterSelect({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={event => onChange(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40">
      <option value="">{label}</option>
      {options.map(option => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}
    </select>
  );
}

function AlignmentBadge({ value }: { value: OwnerAlignment }) {
  const config = value === "aligned"
    ? { label: "Aligned", className: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: <CheckCircle2 className="h-3 w-3" /> }
    : value === "mismatch"
      ? { label: "Mismatch", className: "border-red-200 bg-red-50 text-red-700", icon: <XCircle className="h-3 w-3" /> }
      : value === "unassigned"
        ? { label: "Unassigned", className: "border-amber-200 bg-amber-50 text-amber-700", icon: <AlertTriangle className="h-3 w-3" /> }
        : { label: "Manual review", className: "border-slate-200 bg-slate-50 text-slate-600", icon: <Gauge className="h-3 w-3" /> };
  return <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold ${config.className}`}>{config.icon}{config.label}</span>;
}

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportAccounts(accounts: RentalAccount[]) {
  const headers = [
    "Account",
    "Parent Group",
    "State",
    "Region",
    "Subsegment",
    "Route to Market",
    "Actual Owner",
    "Expected Owner",
    "Owner Alignment",
    "Channel Owner",
    "Priority Tier",
    "Push Decision",
    "Current Revenue AUD",
    "Full Potential AUD",
    "2026 Target AUD",
    "Remaining Potential AUD",
    "Current Supplier",
    "Installed Base Status",
    "C4C Status",
    "Open Actions",
    "Live Signals",
    "Latest Signal",
    "Gaps",
    "Application Plays",
  ];
  const rows = accounts.map(account => [
    account.displayName || account.canonicalName,
    account.parentGroup,
    account.state,
    account.region,
    account.subsegment,
    labelFor(account.routeToMarket, ROUTE_LABELS),
    account.ownerName,
    account.expectedOwnerName,
    account.ownerAlignment,
    account.channelOwner,
    labelFor(account.priorityTier, TIER_LABELS),
    account.platformPushDecision,
    account.currentRevenueAud,
    account.fullPotentialAud,
    account.target2026Aud,
    account.remainingPotentialAud,
    account.currentSupplier,
    account.installedBaseStatus,
    account.c4cStatus,
    account.openActionCount,
    account.liveSignalCount,
    account.latestSignalTitle,
    account.gapKeys.map(key => GAP_LABELS[key] ?? key),
    account.applicationPlays,
  ]);
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `portable-air-rental-hire-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function FullPotentialRentalHire() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [routeToMarket, setRouteToMarket] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [subsegment, setSubsegment] = useState("");
  const [priorityTier, setPriorityTier] = useState("");
  const [rowClass, setRowClass] = useState("");
  const [view, setView] = useState<ViewKey>("all");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const queryString = useMemo(() => buildQueryString({
    search,
    state,
    routeToMarket,
    ownerName,
    subsegment,
    priorityTier,
    rowClass,
    view,
    limit,
    offset,
  }), [search, state, routeToMarket, ownerName, subsegment, priorityTier, rowClass, view, offset]);

  const query = useQuery({
    queryKey: ["full-potential-rental-hire", queryString],
    queryFn: () => fetchWorkspace(queryString),
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const data = query.data;
  const hasFilters = Boolean(search || state || routeToMarket || ownerName || subsegment || priorityTier || rowClass || view !== "all");
  const canPrevious = offset > 0;
  const canNext = Boolean(data && offset + limit < data.total);

  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setOffset(0);
  }

  function clearFilters() {
    setSearch("");
    setState("");
    setRouteToMarket("");
    setOwnerName("");
    setSubsegment("");
    setPriorityTier("");
    setRowClass("");
    setView("all");
    setOffset(0);
  }

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-gold" /></div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-bold text-navy">Authentication Required</h2>
        <a href={getLoginUrl()} className="inline-flex items-center gap-2 rounded-lg bg-navy px-6 py-3 font-semibold text-white hover:bg-navy-light"><LogIn className="h-4 w-4" /> Sign In</a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-white">
        <div className="container flex items-center justify-between gap-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => navigate("/full-potential")} className="rounded p-1.5 transition-colors hover:bg-white/10"><ArrowLeft className="h-5 w-5" /></button>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold"><Building2 className="h-5 w-5 text-gold" /> Rental Hire Workspace</h1>
              <p className="text-xs text-slate-300">Segment 1 account universe, territory ownership, commercial gaps and focus queue</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => data && exportAccounts(data.accounts)} disabled={!data?.accounts.length} className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"><Download className="mr-1.5 h-3.5 w-3.5" /> Export page</Button>
            <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching} className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
          </div>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        {query.isLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-lg" />)}</div>
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-96 rounded-lg" />
          </div>
        ) : query.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800"><div className="flex items-center gap-2 font-bold"><XCircle className="h-5 w-5" /> Rental Hire workspace unavailable</div><p className="mt-2 text-sm">{query.error.message}</p></div>
        ) : data ? (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <div className="rounded-lg border border-border bg-card p-4"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> Rental accounts</div><div className="mt-2 text-3xl font-bold text-navy">{data.summary.totalRentalAccounts}</div></div>
              <div className="rounded-lg border border-border bg-card p-4"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Target className="h-3.5 w-3.5" /> Tier A / Push Now</div><div className="mt-2 text-3xl font-bold text-hot">{data.summary.tierA}<span className="text-base text-muted-foreground"> / {data.summary.pushNow}</span></div></div>
              <div className="rounded-lg border border-border bg-card p-4"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Users className="h-3.5 w-3.5" /> Direct / Channel</div><div className="mt-2 text-3xl font-bold text-blue-700">{data.summary.directAccounts}<span className="text-base text-muted-foreground"> / {data.summary.channelAccounts}</span></div></div>
              <div className="rounded-lg border border-border bg-card p-4"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><UserCheck className="h-3.5 w-3.5" /> Owner aligned</div><div className="mt-2 text-3xl font-bold text-emerald-600">{data.summary.ownerAligned}</div><div className="mt-1 text-[10px] text-muted-foreground">{data.summary.ownerMismatch} mismatch · {data.summary.ownerUnassigned} unassigned</div></div>
              <div className="rounded-lg border border-border bg-card p-4"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><ShieldAlert className="h-3.5 w-3.5" /> No activity</div><div className="mt-2 text-3xl font-bold text-amber-600">{data.summary.noOpenActivity}</div><div className="mt-1 text-[10px] text-muted-foreground">{data.summary.liveSignalAccounts} accounts with live signals</div></div>
              <div className="rounded-lg border border-border bg-card p-4"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><CircleDollarSign className="h-3.5 w-3.5" /> FP / Remaining</div><div className="mt-2 text-2xl font-bold text-navy">{formatCurrency(data.summary.totalFullPotentialAud)}</div><div className="mt-1 text-xs font-semibold text-muted-foreground">{formatCurrency(data.summary.totalRemainingPotentialAud)} remaining</div></div>
            </section>

            <section className="rounded-lg border border-gold/30 bg-gold/5 p-4">
              <div className="flex items-start gap-3">
                <Flag className="mt-0.5 h-5 w-5 shrink-0 text-gold-dark" />
                <div>
                  <h2 className="font-bold text-navy">Territory ownership rules</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.ownershipRules.map(rule => <span key={rule.rule} className="rounded-full border border-gold/30 bg-card px-3 py-1 text-xs text-navy"><strong>{rule.rule}:</strong> {rule.expectedOwnerName}</span>)}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Actual owner alignment uses the internal sales owner field. Channel owner is assessed separately. Records without state are held for manual review.</p>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-navy"><Filter className="h-4 w-4 text-gold" /> Focus queue and filters</div>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11">
                {VIEW_KEYS.map(key => (
                  <button key={key} onClick={() => { setView(key); setOffset(0); }} className={`rounded-lg border p-2 text-left transition-colors ${view === key ? "border-gold bg-gold/10 shadow-sm" : "border-border bg-slate-50/50 hover:border-gold/50"}`}>
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{VIEW_LABELS[key]}</div>
                    <div className="mt-1 text-lg font-bold text-navy">{data.viewCounts[key]}</div>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[240px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} placeholder="Search rental account, group, owner, supplier or signal..." className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40" /></div>
                <FilterSelect label="All states" value={state} options={data.filterOptions.states} onChange={value => changeFilter(setState, value)} />
                <FilterSelect label="All routes" value={routeToMarket} options={data.filterOptions.routeToMarkets} labels={ROUTE_LABELS} onChange={value => changeFilter(setRouteToMarket, value)} />
                <FilterSelect label="All owners" value={ownerName} options={data.filterOptions.ownerNames} onChange={value => changeFilter(setOwnerName, value)} />
                <FilterSelect label="All subsegments" value={subsegment} options={data.filterOptions.subsegments} onChange={value => changeFilter(setSubsegment, value)} />
                <FilterSelect label="All tiers" value={priorityTier} options={data.filterOptions.priorityTiers} labels={TIER_LABELS} onChange={value => changeFilter(setPriorityTier, value)} />
                <FilterSelect label="All row classes" value={rowClass} options={data.filterOptions.rowClasses} labels={ROW_CLASS_LABELS} onChange={value => changeFilter(setRowClass, value)} />
                {hasFilters && <button onClick={clearFilters} className="rounded-lg px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-slate-100 hover:text-navy">Clear filters</button>}
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-3"><h2 className="font-bold text-navy">Territory coverage</h2><p className="mt-1 text-xs text-muted-foreground">Expected owner and direct/channel shape for the current filter scope.</p></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-navy text-white"><tr><th className="px-4 py-3 text-left text-xs uppercase tracking-wider">State</th><th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Expected Owner</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Accounts</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Aligned</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Mismatch</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Unassigned</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Direct</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Channel</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Tier A</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Push Now</th></tr></thead>
                  <tbody>{data.territorySummary.map((item, index) => <tr key={item.state} className={`border-t border-border ${index % 2 ? "bg-slate-50/60" : "bg-card"}`}><td className="px-4 py-3 font-bold text-navy">{item.state}</td><td className="px-4 py-3 text-muted-foreground">{item.expectedOwner}</td><td className="px-4 py-3 text-right font-semibold text-navy">{item.count}</td><td className="px-4 py-3 text-right text-emerald-600">{item.aligned}</td><td className="px-4 py-3 text-right text-red-600">{item.mismatch}</td><td className="px-4 py-3 text-right text-amber-600">{item.unassigned}</td><td className="px-4 py-3 text-right">{item.direct}</td><td className="px-4 py-3 text-right">{item.channel}</td><td className="px-4 py-3 text-right">{item.tierA}</td><td className="px-4 py-3 text-right">{item.pushNow}</td></tr>)}</tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div><h2 className="font-bold text-navy">Rental Hire focus queue</h2><p className="mt-1 text-xs text-muted-foreground">Showing {data.accounts.length} of {data.total}. Order: Coates, tier, Push Now, signal urgency, ownership issue, activity gap and remaining potential.</p></div>
                <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={!canPrevious} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button><Button variant="outline" size="sm" disabled={!canNext} onClick={() => setOffset(offset + limit)}>Next</Button></div>
              </div>
              {data.accounts.length === 0 ? (
                <div className="p-12 text-center"><CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" /><h3 className="text-lg font-bold text-navy">No rental accounts in this view</h3><p className="mt-1 text-sm text-muted-foreground">Change the focus view or broaden the filters.</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-navy text-white"><tr><th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Account</th><th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Ownership</th><th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Route / Tier</th><th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Commercial Gaps</th><th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Actions / Signals</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Revenue</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">FP</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Remaining</th><th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Review</th></tr></thead>
                    <tbody>{data.accounts.map((account, index) => (
                      <tr key={account.id} className={`border-t border-border align-top ${index % 2 ? "bg-slate-50/60" : "bg-card"}`}>
                        <td className="min-w-[260px] px-4 py-3"><div className="font-semibold text-navy">{account.displayName || account.canonicalName}</div><div className="mt-1 text-[11px] text-muted-foreground">{account.parentGroup || account.subsegment || "No group/subsegment"} · {account.state || "No state"}</div>{account.specialRule === "Coates national strategic account" && <span className="mt-1 inline-flex rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold text-gold-dark">National strategic rule</span>}</td>
                        <td className="min-w-[210px] px-4 py-3"><AlignmentBadge value={account.ownerAlignment} /><div className="mt-1 text-xs text-navy">Actual: {account.ownerName || "—"}</div><div className="text-[11px] text-muted-foreground">Expected: {account.expectedOwnerName || "Manual review"}</div>{account.routeClass === "channel" && <div className="mt-1 text-[11px] text-muted-foreground">Channel: {account.channelOwner || "—"}</div>}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground"><div>{labelFor(account.routeToMarket, ROUTE_LABELS)}</div><div className="mt-1 text-[11px]">{labelFor(account.priorityTier, TIER_LABELS)} · {account.platformPushDecision || "—"}</div></td>
                        <td className="min-w-[240px] px-4 py-3"><div className="flex flex-wrap gap-1">{account.gapKeys.filter(key => key !== "live_signal").length === 0 ? <span className="text-xs text-muted-foreground">No core gaps</span> : account.gapKeys.filter(key => key !== "live_signal").map(key => <span key={key} className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{GAP_LABELS[key] ?? key}</span>)}</div><div className="mt-1 text-[11px] text-muted-foreground">Supplier: {account.currentSupplier || "—"} · IB: {account.installedBaseStatus || "—"}</div></td>
                        <td className="min-w-[220px] px-4 py-3"><div className="text-xs text-navy">{account.openActionCount} open action{account.openActionCount === 1 ? "" : "s"}</div><div className="text-[11px] text-muted-foreground">{account.nextAction || account.latestOpenActionType || "No current activity"}</div>{account.liveSignalCount > 0 && <div className="mt-1 flex items-center gap-1 text-[11px] text-gold-dark"><Signal className="h-3 w-3" /> {account.liveSignalCount} live · {account.highestLiveUrgency} · {account.latestSignalTitle || "signal"}</div>}{account.latestOpenActionDueDate && <div className="mt-1 text-[10px] text-muted-foreground">Due {formatDate(account.latestOpenActionDueDate)}</div>}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-navy">{formatCurrency(account.currentRevenueAud)}</td><td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-navy">{formatCurrency(account.fullPotentialAud)}</td><td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-navy">{formatCurrency(account.remainingPotentialAud)}</td>
                        <td className="px-4 py-3 text-right"><a href={account.reviewUrl} className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-2.5 py-1.5 text-xs font-bold text-navy hover:bg-gold/20">Open <ExternalLink className="h-3 w-3" /></a></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              {[
                { title: "Owner distribution", icon: <Users className="h-4 w-4 text-gold" />, rows: data.ownerDistribution },
                { title: "Route distribution", icon: <Wrench className="h-4 w-4 text-gold" />, rows: data.routeDistribution.map(row => ({ ...row, value: ROUTE_LABELS[row.value] ?? row.value })) },
                { title: "Subsegment distribution", icon: <Target className="h-4 w-4 text-gold" />, rows: data.subsegmentDistribution },
              ].map(section => <div key={section.title} className="rounded-lg border border-border bg-card p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-navy">{section.icon}{section.title}</h3><div className="mt-3 space-y-2">{section.rows.slice(0, 10).map(item => <div key={item.value} className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-muted-foreground">{item.value}</span><span className="font-bold text-navy">{item.count}</span></div>)}</div></div>)}
            </section>

            <section className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-xs leading-relaxed text-blue-900">
              This workspace is read-only. It does not create accounts, reassign ownership, update C4C or generate actions automatically. Rental selection uses segment/subsegment/name evidence plus the explicit Coates national rule. Contact coverage will be added only after the dedicated Full Potential contact foundation is approved.
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
