import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Database,
  ExternalLink,
  Filter,
  Gauge,
  ListChecks,
  Loader2,
  LogIn,
  RefreshCw,
  SearchCheck,
  ShieldAlert,
  Target,
  Users,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useLocation } from "wouter";

const ISSUE_KEYS = [
  "missing_owner",
  "channel_owner_missing",
  "tier_a_no_next_action",
  "push_now_no_activity",
  "installed_base_unknown",
  "supplier_missing",
  "financial_potential_missing",
  "evidence_missing",
  "confidence_unknown",
  "c4c_unknown",
  "priority_unassigned",
  "segment_missing",
  "state_missing",
] as const;

type QualityIssueKey = typeof ISSUE_KEYS[number];
type DimensionKey = "segment" | "subsegment" | "state" | "routeToMarket" | "owner" | "priorityTier";

type AccountSummary = {
  id: number;
  canonicalName: string;
  displayName: string | null;
  state: string | null;
  segment: string | null;
  subsegment: string | null;
  routeToMarket: string | null;
  ownerName: string | null;
  channelOwner: string | null;
  responsibleOwner: string;
  priorityTier: string | null;
  platformPushDecision: string | null;
  fullPotentialAud: number;
  target2026Aud: number;
  qualityScore: number;
  missingFields: string[];
  reviewUrl: string;
};

type DataQualityResponse = {
  generatedAt: string;
  summary: {
    totalAccounts: number;
    averageCompletenessPct: number;
    accountsAtLeast80Pct: number;
    accountsAtLeast90Pct: number;
    criticalGapAccounts: number;
    accountsWithOpenActions: number;
    totalFullPotentialAud: number;
  };
  fieldCoverage: Array<{
    key: string;
    label: string;
    complete: number;
    incomplete: number;
    applicable: number;
    completenessPct: number;
  }>;
  issues: Array<{
    key: QualityIssueKey;
    label: string;
    description: string;
    severity: "critical" | "warning" | "info";
    count: number;
    sampleAccounts: AccountSummary[];
  }>;
  selectedIssue: QualityIssueKey;
  issueAccounts: AccountSummary[];
  issueAccountTotal: number;
  limit: number;
  offset: number;
  dimensions: Record<DimensionKey, Array<{
    value: string;
    count: number;
    averageCompletenessPct: number;
    criticalIssueAccounts: number;
    missingOwner: number;
    missingNextActivity: number;
    unknownInstalledBase: number;
    missingSupplier: number;
    missingFinancialPotential: number;
  }>>;
  filterOptions: {
    segments: string[];
    states: string[];
    routeToMarkets: string[];
    ownerNames: string[];
    priorityTiers: string[];
    rowClasses: string[];
  };
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

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  segment: "Segment",
  subsegment: "Subsegment",
  state: "State / Territory",
  routeToMarket: "Route to Market",
  owner: "Responsible Owner",
  priorityTier: "Priority Tier",
};

function formatCurrency(value: number) {
  if (!Number.isFinite(value) || value === 0) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toLocaleString("en-AU")}`;
}

function labelFor(value: string | null | undefined, labels: Record<string, string>) {
  if (!value) return "—";
  return labels[value] ?? value;
}

function scoreClass(score: number) {
  if (score >= 90) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 75) return "border-blue-200 bg-blue-50 text-blue-700";
  if (score >= 60) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-red-200 bg-red-50 text-red-700";
}

function severityClass(severity: "critical" | "warning" | "info", active: boolean) {
  const base = severity === "critical"
    ? "border-red-200 bg-red-50 text-red-800"
    : severity === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-blue-200 bg-blue-50 text-blue-800";
  return `${base} ${active ? "ring-2 ring-gold/50 shadow-sm" : "hover:border-gold/50"}`;
}

function valueLabel(value: string, dimension: DimensionKey) {
  if (dimension === "routeToMarket") return ROUTE_LABELS[value] ?? value;
  if (dimension === "priorityTier") return TIER_LABELS[value] ?? value;
  return value;
}

function buildQueryString(input: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

async function fetchDataQuality(queryString: string): Promise<DataQualityResponse> {
  const response = await fetch(`/api/full-potential/data-quality?${queryString}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Data-quality request failed (${response.status})`);
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
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
    >
      <option value="">{label}</option>
      {options.map(option => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}
    </select>
  );
}

export default function FullPotentialDataQuality() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [segment, setSegment] = useState("");
  const [state, setState] = useState("");
  const [routeToMarket, setRouteToMarket] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [priorityTier, setPriorityTier] = useState("");
  const [rowClass, setRowClass] = useState("");
  const [issue, setIssue] = useState<QualityIssueKey>("missing_owner");
  const [dimension, setDimension] = useState<DimensionKey>("segment");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const queryString = useMemo(() => buildQueryString({
    segment,
    state,
    routeToMarket,
    ownerName,
    priorityTier,
    rowClass,
    issue,
    limit,
    offset,
  }), [segment, state, routeToMarket, ownerName, priorityTier, rowClass, issue, offset]);

  const query = useQuery({
    queryKey: ["full-potential-data-quality", queryString],
    queryFn: () => fetchDataQuality(queryString),
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const data = query.data;
  const hasFilters = Boolean(segment || state || routeToMarket || ownerName || priorityTier || rowClass);
  const canPrevious = offset > 0;
  const canNext = Boolean(data && offset + limit < data.issueAccountTotal);
  const selectedIssue = data?.issues.find(item => item.key === issue);
  const dimensionRows = data?.dimensions[dimension] ?? [];

  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setOffset(0);
  }

  function clearFilters() {
    setSegment("");
    setState("");
    setRouteToMarket("");
    setOwnerName("");
    setPriorityTier("");
    setRowClass("");
    setOffset(0);
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-bold text-navy">Authentication Required</h2>
        <a href={getLoginUrl()} className="inline-flex items-center gap-2 rounded-lg bg-navy px-6 py-3 font-semibold text-white hover:bg-navy-light">
          <LogIn className="h-4 w-4" /> Sign In
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-white">
        <div className="container flex items-center justify-between gap-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => navigate("/full-potential")} className="rounded p-1.5 transition-colors hover:bg-white/10">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold">
                <SearchCheck className="h-5 w-5 text-gold" /> Full Potential Data Quality
              </h1>
              <p className="text-xs text-slate-300">Coverage, completeness and the account gaps blocking execution</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <Filter className="h-4 w-4 text-gold" /> Scope the dashboard
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label="All segments" value={segment} options={data?.filterOptions.segments ?? []} onChange={value => changeFilter(setSegment, value)} />
            <FilterSelect label="All states" value={state} options={data?.filterOptions.states ?? []} onChange={value => changeFilter(setState, value)} />
            <FilterSelect label="All routes" value={routeToMarket} options={data?.filterOptions.routeToMarkets ?? []} labels={ROUTE_LABELS} onChange={value => changeFilter(setRouteToMarket, value)} />
            <FilterSelect label="All owners" value={ownerName} options={data?.filterOptions.ownerNames ?? []} onChange={value => changeFilter(setOwnerName, value)} />
            <FilterSelect label="All tiers" value={priorityTier} options={data?.filterOptions.priorityTiers ?? []} labels={TIER_LABELS} onChange={value => changeFilter(setPriorityTier, value)} />
            <FilterSelect label="All row classes" value={rowClass} options={data?.filterOptions.rowClasses ?? []} labels={ROW_CLASS_LABELS} onChange={value => changeFilter(setRowClass, value)} />
            {hasFilters && (
              <button onClick={clearFilters} className="rounded-lg px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-slate-100 hover:text-navy">
                Clear filters
              </button>
            )}
          </div>
        </section>

        {query.isLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-lg" />)}
            </div>
            <Skeleton className="h-72 rounded-lg" />
            <Skeleton className="h-96 rounded-lg" />
          </div>
        ) : query.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">
            <div className="flex items-center gap-2 font-bold"><XCircle className="h-5 w-5" /> Data-quality dashboard unavailable</div>
            <p className="mt-2 text-sm">{query.error.message}</p>
          </div>
        ) : data ? (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Database className="h-3.5 w-3.5" /> Accounts</div>
                <div className="mt-2 text-3xl font-bold text-navy">{data.summary.totalAccounts}</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Gauge className="h-3.5 w-3.5" /> Avg completeness</div>
                <div className="mt-2 text-3xl font-bold text-navy">{data.summary.averageCompletenessPct}%</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> 80%+ ready</div>
                <div className="mt-2 text-3xl font-bold text-emerald-600">{data.summary.accountsAtLeast80Pct}</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><ShieldAlert className="h-3.5 w-3.5" /> Critical gaps</div>
                <div className="mt-2 text-3xl font-bold text-red-600">{data.summary.criticalGapAccounts}</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><ListChecks className="h-3.5 w-3.5" /> Open actions</div>
                <div className="mt-2 text-3xl font-bold text-blue-700">{data.summary.accountsWithOpenActions}</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><WalletCards className="h-3.5 w-3.5" /> FP value</div>
                <div className="mt-2 text-3xl font-bold text-navy">{formatCurrency(data.summary.totalFullPotentialAud)}</div>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 font-bold text-navy"><Target className="h-4 w-4 text-gold" /> Priority gap queues</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Select a gap to review the affected accounts. Counts reflect the filters above.</p>
                </div>
                <div className="text-xs text-muted-foreground">Generated {new Date(data.generatedAt).toLocaleString("en-AU")}</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.issues.map(item => (
                  <button
                    key={item.key}
                    onClick={() => { setIssue(item.key); setOffset(0); }}
                    className={`rounded-lg border p-3 text-left transition-all ${severityClass(item.severity, issue === item.key)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-xs font-bold">{item.label}</div>
                      <div className="text-xl font-bold">{item.count}</div>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed opacity-80">{item.description}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[420px_1fr]">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-4">
                  <h2 className="flex items-center gap-2 font-bold text-navy"><BarChart3 className="h-4 w-4 text-gold" /> Field coverage</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Completeness of the core fields needed to prioritise and execute.</p>
                </div>
                <div className="space-y-3">
                  {[...data.fieldCoverage].sort((left, right) => left.completenessPct - right.completenessPct).map(field => (
                    <div key={field.key}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-navy">{field.label}</span>
                        <span className="font-bold text-navy">{field.completenessPct}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-navy transition-all" style={{ width: `${field.completenessPct}%` }} />
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">{field.complete} complete · {field.incomplete} incomplete · {field.applicable} applicable</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <h2 className="flex items-center gap-2 font-bold text-navy"><Users className="h-4 w-4 text-gold" /> Coverage by dimension</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Identify which teams, regions and segments have the weakest account foundations.</p>
                  </div>
                  <select value={dimension} onChange={event => setDimension(event.target.value as DimensionKey)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    {(Object.keys(DIMENSION_LABELS) as DimensionKey[]).map(key => <option key={key} value={key}>{DIMENSION_LABELS[key]}</option>)}
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-navy text-white">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">{DIMENSION_LABELS[dimension]}</th>
                        <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Accounts</th>
                        <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Complete</th>
                        <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Critical</th>
                        <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">No owner</th>
                        <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">No activity</th>
                        <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Unknown IB</th>
                        <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">No supplier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dimensionRows.map((row, index) => (
                        <tr key={row.value} className={`border-t border-border ${index % 2 ? "bg-slate-50/60" : "bg-card"}`}>
                          <td className="px-4 py-3 font-semibold text-navy">{valueLabel(row.value, dimension)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-navy">{row.count}</td>
                          <td className="px-4 py-3 text-right"><span className={`inline-flex rounded border px-2 py-0.5 text-xs font-bold ${scoreClass(row.averageCompletenessPct)}`}>{row.averageCompletenessPct}%</span></td>
                          <td className="px-4 py-3 text-right font-semibold text-red-600">{row.criticalIssueAccounts}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground">{row.missingOwner}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground">{row.missingNextActivity}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground">{row.unknownInstalledBase}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground">{row.missingSupplier}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h2 className="font-bold text-navy">{selectedIssue?.label ?? "Gap accounts"}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Showing {data.issueAccounts.length} of {data.issueAccountTotal}. Open an account in the existing Full Potential workflow to review or correct it.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={!canPrevious} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={!canNext} onClick={() => setOffset(offset + limit)}>Next</Button>
                </div>
              </div>
              {data.issueAccounts.length === 0 ? (
                <div className="p-12 text-center">
                  <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
                  <h3 className="text-lg font-bold text-navy">No accounts in this gap queue</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Change the issue or broaden the filters.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-navy text-white">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Account</th>
                        <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Quality</th>
                        <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Missing fields</th>
                        <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Owner</th>
                        <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Segment / State</th>
                        <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">Route / Tier</th>
                        <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">FP</th>
                        <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.issueAccounts.map((account, index) => (
                        <tr key={account.id} className={`border-t border-border ${index % 2 ? "bg-slate-50/60" : "bg-card"}`}>
                          <td className="min-w-[240px] px-4 py-3">
                            <div className="font-semibold text-navy">{account.displayName || account.canonicalName}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">#{account.id}</div>
                          </td>
                          <td className="px-4 py-3"><span className={`inline-flex rounded border px-2 py-1 text-xs font-bold ${scoreClass(account.qualityScore)}`}>{account.qualityScore}%</span></td>
                          <td className="min-w-[260px] px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {account.missingFields.slice(0, 4).map(field => <span key={field} className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{field}</span>)}
                              {account.missingFields.length > 4 && <span className="text-[10px] text-muted-foreground">+{account.missingFields.length - 4}</span>}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{account.responsibleOwner}</td>
                          <td className="min-w-[180px] px-4 py-3 text-muted-foreground">{account.segment || "—"}<div className="text-[11px]">{account.state || "No state"}</div></td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{labelFor(account.routeToMarket, ROUTE_LABELS)}<div className="text-[11px]">{labelFor(account.priorityTier, TIER_LABELS)}</div></td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-navy">{formatCurrency(account.fullPotentialAud)}</td>
                          <td className="px-4 py-3 text-right">
                            <a href={account.reviewUrl} className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-2.5 py-1.5 text-xs font-bold text-navy hover:bg-gold/20">
                              Open <ExternalLink className="h-3 w-3" />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-900">
              <div className="flex items-start gap-3">
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-bold">How to read this dashboard</div>
                  <p className="mt-1 text-xs leading-relaxed text-blue-900/80">
                    Completeness measures whether the core account fields needed for prioritisation and execution are present. Open workflow actions count as current activity. The dashboard is read-only and never updates C4C, creates actions or changes account records automatically.
                  </p>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
