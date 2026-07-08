import { useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Database,
  Filter,
  Loader2,
  LogIn,
  Search,
  Shield,
  Target,
  Upload,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import FullPotentialDetailDrawer from "@/components/FullPotentialDetailDrawer";
import FullPotentialImportModal from "@/components/FullPotentialImportModal";
import FullPotentialSignalImportModal from "@/components/FullPotentialSignalImportModal";

const STATUS_LABELS: Record<string, string> = {
  active_target: "Active Target",
  develop: "Develop",
  watch: "Watch",
  qualify: "Qualify",
  park: "Park",
  exclude: "Exclude",
};

const PUSH_LABELS: Record<string, string> = {
  push_now: "Push Now",
  push_context: "Push Context",
  channel_view: "Channel View",
  qualify_first: "Qualify First",
  park_do_not_push: "Park / Do Not Push",
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

type ActionCounts = {
  overdue: number;
  due: number;
  upcoming: number;
  total: number;
};

const EMPTY_ACTION_COUNTS: ActionCounts = { overdue: 0, due: 0, upcoming: 0, total: 0 };

function getInitialSearch() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("search") ?? "";
}

function formatCurrency(value?: number | null) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount === 0) return "—";
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `$${(amount / 1_000).toFixed(0)}k`;
  return `$${amount.toLocaleString()}`;
}

function labelFor(value: string | null | undefined, map: Record<string, string>) {
  if (!value) return "—";
  return map[value] || value;
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" | "gold" }) {
  const toneClass = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    gold: "bg-gold/15 text-gold-dark border-gold/30",
  }[tone];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${toneClass}`}>{children}</span>;
}

function FilterSelect({
  value,
  onChange,
  label,
  options,
  labels = {},
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
    >
      <option value="">{label}</option>
      {options.map(option => (
        <option key={option} value={option}>{labels[option] || option}</option>
      ))}
    </select>
  );
}

function addActionCount(map: Record<number, ActionCounts>, action: any, bucket: keyof Omit<ActionCounts, "total">) {
  const accountId = Number(action.account?.id);
  if (!Number.isFinite(accountId)) return;
  const current = map[accountId] ?? { overdue: 0, due: 0, upcoming: 0, total: 0 };
  current[bucket] += 1;
  current.total += 1;
  map[accountId] = current;
}

function ActionIndicator({ counts }: { counts: ActionCounts }) {
  if (!counts.total) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1 justify-start">
      {counts.overdue > 0 && <Badge tone="red">{counts.overdue} overdue</Badge>}
      {counts.due > 0 && <Badge tone="green">{counts.due} due</Badge>}
      {counts.upcoming > 0 && <Badge tone="slate">{counts.upcoming} upcoming</Badge>}
    </div>
  );
}

function accountDisplayName(account: any) {
  return account?.displayName || account?.canonicalName || "Unnamed account";
}

function ownerLabel(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || "Unassigned";
}

function countByOwner(actions: any[]) {
  const counts: Record<string, number> = {};
  actions.forEach(action => {
    const owner = ownerLabel(action.account?.ownerName || action.account?.channelOwner || action.ownerName);
    counts[owner] = (counts[owner] ?? 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function ManagerHealthPanel({ accounts, myWeekActions, isLoading }: { accounts: any[]; myWeekActions: any; isLoading: boolean }) {
  const overdueActions = myWeekActions?.overdueActions ?? [];
  const dueActions = myWeekActions?.dueActions ?? [];
  const upcomingActions = myWeekActions?.upcomingActions ?? [];
  const openActionAccountIds = new Set<number>();

  [...overdueActions, ...dueActions, ...upcomingActions].forEach((action: any) => {
    const accountId = Number(action.account?.id);
    if (Number.isFinite(accountId)) openActionAccountIds.add(accountId);
  });

  const managerReviewActions = [...overdueActions, ...dueActions, ...upcomingActions]
    .filter((action: any) => action.actionType === "manager_review")
    .slice(0, 6);

  const tierAWithoutOpenAction = accounts
    .filter(account => account.priorityTier === "tier_a" && !openActionAccountIds.has(Number(account.id)))
    .slice(0, 6);

  const pushNowWithoutOpenAction = accounts
    .filter(account => account.platformPushDecision === "push_now" && !openActionAccountIds.has(Number(account.id)))
    .slice(0, 6);

  const unknownInstalledBaseAccounts = accounts
    .filter(account => !account.installedBaseStatus || account.installedBaseStatus === "unknown")
    .slice(0, 6);

  const directApeWithoutOwner = accounts
    .filter(account => account.routeToMarket === "direct_ape" && !String(account.ownerName ?? "").trim())
    .slice(0, 6);

  const channelManagedWithoutChannelOwner = accounts
    .filter(account => account.rowClass === "channel_managed" && !String(account.channelOwner ?? "").trim())
    .slice(0, 6);

  const overdueByOwner = countByOwner(overdueActions).slice(0, 5);
  const dueByOwner = countByOwner(dueActions).slice(0, 5);

  const issueCards = [
    { label: "Manager reviews", value: managerReviewActions.length, tone: "amber" as const },
    { label: "Tier A no action", value: tierAWithoutOpenAction.length, tone: "red" as const },
    { label: "Push Now no action", value: pushNowWithoutOpenAction.length, tone: "red" as const },
    { label: "Unknown IB", value: unknownInstalledBaseAccounts.length, tone: "slate" as const },
  ];

  return (
    <div className="bg-card rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-navy" />
        <h3 className="font-bold text-navy text-sm">Manager Health</h3>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading health signals...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {issueCards.map(card => (
              <div key={card.label} className="rounded-lg border border-border bg-slate-50/50 p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{card.label}</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xl font-bold text-navy">{card.value}</span>
                  {card.value > 0 && <Badge tone={card.tone}>review</Badge>}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <HealthList title="Open manager reviews" items={managerReviewActions.map((action: any) => accountDisplayName(action.account))} />
            <OwnerCountList title="Overdue by owner" items={overdueByOwner} />
            <OwnerCountList title="Due this week by owner" items={dueByOwner} />
            <HealthList title="Tier A without open action" items={tierAWithoutOpenAction.map(accountDisplayName)} />
            <HealthList title="Push Now without open action" items={pushNowWithoutOpenAction.map(accountDisplayName)} />
            <HealthList title="Unknown installed base" items={unknownInstalledBaseAccounts.map(accountDisplayName)} />
            <HealthList title="Direct APE without owner" items={directApeWithoutOwner.map(accountDisplayName)} />
            <HealthList title="Channel-managed without channel owner" items={channelManagedWithoutChannelOwner.map(accountDisplayName)} />
          </div>
        </>
      )}
    </div>
  );
}

function HealthList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">No issues found.</div>
      ) : (
        <ul className="space-y-1">
          {items.map((item, index) => (
            <li key={`${title}-${item}-${index}`} className="text-xs text-navy truncate">• {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OwnerCountList({ title, items }: { title: string; items: [string, number][] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">No actions found.</div>
      ) : (
        <ul className="space-y-1">
          {items.map(([owner, count]) => (
            <li key={`${title}-${owner}`} className="text-xs text-navy flex justify-between gap-2">
              <span className="truncate">{owner}</span>
              <span className="font-bold">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function FullPotential() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState(getInitialSearch);
  const [fpStatus, setFpStatus] = useState("");
  const [pushDecision, setPushDecision] = useState("");
  const [route, setRoute] = useState("");
  const [owner, setOwner] = useState("");
  const [segment, setSegment] = useState("");
  const [state, setState] = useState("");
  const [tier, setTier] = useState("");
  const [rowClass, setRowClass] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState<any | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSignalImportModal, setShowSignalImportModal] = useState(false);
  const limit = 100;

  const queryInput = useMemo(() => ({
    search: search || undefined,
    fpStatus: fpStatus || undefined,
    platformPushDecision: pushDecision || undefined,
    routeToMarket: route || undefined,
    ownerName: owner || undefined,
    segment: segment || undefined,
    state: state || undefined,
    priorityTier: tier || undefined,
    rowClass: rowClass || undefined,
    limit,
    offset,
  }), [search, fpStatus, pushDecision, route, owner, segment, state, tier, rowClass, offset]);

  const { data: stats, isLoading: statsLoading } = trpc.fullPotential.stats.useQuery(undefined, { enabled: !!user });
  const { data: filterOptions } = trpc.fullPotential.filterOptions.useQuery(undefined, { enabled: !!user });
  const { data: listData, isLoading: listLoading } = trpc.fullPotential.list.useQuery(queryInput, { enabled: !!user });
  const { data: importHistory } = trpc.fullPotential.importHistory.useQuery({ limit: 5 }, { enabled: !!user });
  const { data: myWeekActions } = trpc.fullPotential.myWeekActions.useQuery(undefined, { enabled: !!user });
  const healthPage0 = trpc.fullPotential.list.useQuery({ limit: 500, offset: 0 }, { enabled: !!user });
  const healthPage1 = trpc.fullPotential.list.useQuery({ limit: 500, offset: 500 }, { enabled: !!user });
  const healthPage2 = trpc.fullPotential.list.useQuery({ limit: 500, offset: 1000 }, { enabled: !!user });

  const healthAccounts = useMemo(() => {
    const rows = [
      ...(healthPage0.data?.accounts ?? []),
      ...(healthPage1.data?.accounts ?? []),
      ...(healthPage2.data?.accounts ?? []),
    ];
    return Array.from(new Map(rows.map((account: any) => [String(account.id), account])).values());
  }, [healthPage0.data, healthPage1.data, healthPage2.data]);

  const actionCountsByAccount = useMemo(() => {
    const map: Record<number, ActionCounts> = {};
    (myWeekActions?.overdueActions ?? []).forEach((action: any) => addActionCount(map, action, "overdue"));
    (myWeekActions?.dueActions ?? []).forEach((action: any) => addActionCount(map, action, "due"));
    (myWeekActions?.upcomingActions ?? []).forEach((action: any) => addActionCount(map, action, "upcoming"));
    return map;
  }, [myWeekActions]);

  const accounts = listData?.accounts ?? [];
  const total = listData?.total ?? 0;
  const hasFilters = !!(search || fpStatus || pushDecision || route || owner || segment || state || tier || rowClass);
  const canPrevious = offset > 0;
  const canNext = offset + limit < total;
  const isAdmin = user?.role === "admin";
  const isHealthLoading = healthPage0.isLoading || healthPage1.isLoading || healthPage2.isLoading;

  function clearFilters() {
    setSearch("");
    setFpStatus("");
    setPushDecision("");
    setRoute("");
    setOwner("");
    setSegment("");
    setState("");
    setTier("");
    setRowClass("");
    setOffset(0);
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gold" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <AlertTriangle className="w-12 h-12 text-amber-500" />
        <h2 className="text-xl font-bold text-navy">Authentication Required</h2>
        <a href={getLoginUrl()} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-navy text-white font-semibold hover:bg-navy-light transition-colors">
          <LogIn className="w-4 h-4" /> Sign In
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-white">
        <div className="container py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => navigate("/")} className="p-1.5 rounded hover:bg-white/10 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold flex items-center gap-2">
                <Target className="w-5 h-5 text-gold" />
                Portable Air Full Potential
              </h1>
              <p className="text-xs text-slate-300">Portable Air account universe, route-to-market, priority and action rhythm</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={!isAdmin}
              onClick={() => setShowSignalImportModal(true)}
              variant="outline"
              className="border-gold/60 text-gold bg-transparent hover:bg-gold/10 disabled:opacity-60"
              title={isAdmin ? "Import Portable Air signals" : "Admin only"}
            >
              <Zap className="w-4 h-4 mr-2" /> Import Signals
            </Button>
            <Button
              disabled={!isAdmin}
              onClick={() => setShowImportModal(true)}
              className="bg-gold text-navy hover:bg-gold/90 disabled:opacity-60"
              title={isAdmin ? "Import Portable Air Full Potential workbook" : "Admin only"}
            >
              <Upload className="w-4 h-4 mr-2" /> Import
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {statsLoading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />) : (
            <>
              <div className="bg-card rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-wider"><Database className="w-3.5 h-3.5" /> Accounts</div>
                <div className="text-3xl font-bold text-navy mt-2">{stats?.totalAccounts ?? 0}</div>
              </div>
              <div className="bg-card rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-wider"><Target className="w-3.5 h-3.5" /> Active Target</div>
                <div className="text-3xl font-bold text-hot mt-2">{stats?.byFpStatus?.active_target ?? 0}</div>
              </div>
              <div className="bg-card rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-wider"><Filter className="w-3.5 h-3.5" /> Push Now</div>
                <div className="text-3xl font-bold text-emerald-600 mt-2">{stats?.byPlatformPushDecision?.push_now ?? 0}</div>
              </div>
              <div className="bg-card rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-wider"><Users className="w-3.5 h-3.5" /> Direct APE</div>
                <div className="text-3xl font-bold text-blue-700 mt-2">{stats?.byRouteToMarket?.direct_ape ?? 0}</div>
              </div>
              <div className="bg-card rounded-lg border border-border p-4 col-span-2 lg:col-span-1">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-wider"><WalletCards className="w-3.5 h-3.5" /> FP Value</div>
                <div className="text-3xl font-bold text-navy mt-2">{formatCurrency(stats?.totalFullPotentialAud)}</div>
              </div>
            </>
          )}
        </section>

        <section className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search account, segment, owner, supplier, application..."
                value={search}
                onChange={e => { setOffset(0); setSearch(e.target.value); }}
                className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
              />
            </div>
            <FilterSelect value={fpStatus} onChange={v => { setOffset(0); setFpStatus(v); }} label="All Statuses" options={filterOptions?.fpStatuses ?? []} labels={STATUS_LABELS} />
            <FilterSelect value={pushDecision} onChange={v => { setOffset(0); setPushDecision(v); }} label="All Push Decisions" options={filterOptions?.platformPushDecisions ?? []} labels={PUSH_LABELS} />
            <FilterSelect value={route} onChange={v => { setOffset(0); setRoute(v); }} label="All Routes" options={filterOptions?.routeToMarkets ?? []} labels={ROUTE_LABELS} />
            <FilterSelect value={owner} onChange={v => { setOffset(0); setOwner(v); }} label="All Owners" options={filterOptions?.ownerNames ?? []} />
            <FilterSelect value={segment} onChange={v => { setOffset(0); setSegment(v); }} label="All Segments" options={filterOptions?.segments ?? []} />
            <FilterSelect value={state} onChange={v => { setOffset(0); setState(v); }} label="All States" options={filterOptions?.states ?? []} />
            <FilterSelect value={tier} onChange={v => { setOffset(0); setTier(v); }} label="All Tiers" options={filterOptions?.priorityTiers ?? []} labels={TIER_LABELS} />
            <FilterSelect value={rowClass} onChange={v => { setOffset(0); setRowClass(v); }} label="All Row Classes" options={filterOptions?.rowClasses ?? []} labels={ROW_CLASS_LABELS} />
            {hasFilters && (
              <button onClick={clearFilters} className="px-3 py-2.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-navy hover:bg-slate-100 transition-colors">
                Clear filters
              </button>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-navy">Portable Air Account Universe</h2>
                <p className="text-xs text-muted-foreground">Showing {accounts.length} of {total} records. Click a row to review the account logic and actions.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={!canPrevious} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={!canNext} onClick={() => setOffset(offset + limit)}>Next</Button>
              </div>
            </div>
            {listLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
              </div>
            ) : accounts.length === 0 ? (
              <div className="p-12 text-center">
                <Target className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <h3 className="text-lg font-bold text-navy">No Portable Air Full Potential records found</h3>
                <p className="text-sm text-muted-foreground">Try changing the search or filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-navy text-white">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wider">Account</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wider">Push</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wider">Route</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wider">Owner</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wider">Segment</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wider">State</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wider">Actions</th>
                      <th className="text-right px-4 py-3 text-xs uppercase tracking-wider">FP</th>
                      <th className="text-right px-4 py-3 text-xs uppercase tracking-wider">2026</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((account: any, index: number) => {
                      const actionCounts = actionCountsByAccount[Number(account.id)] ?? EMPTY_ACTION_COUNTS;
                      return (
                        <tr
                          key={account.id}
                          className={`border-t border-border ${index % 2 ? "bg-slate-50/60" : "bg-card"} hover:bg-gold/5 transition-colors cursor-pointer`}
                          onClick={() => setSelectedAccount(account)}
                        >
                          <td className="px-4 py-3 min-w-[260px]">
                            <div className="font-semibold text-navy">{account.displayName || account.canonicalName}</div>
                            <div className="text-[11px] text-muted-foreground flex flex-wrap gap-1 mt-1">
                              <Badge>{labelFor(account.priorityTier, TIER_LABELS)}</Badge>
                              <Badge tone="blue">{labelFor(account.rowClass, ROW_CLASS_LABELS)}</Badge>
                              {account.signalCount > 0 && (
                                <Badge tone="gold">
                                  {account.signalCount} {account.signalCount === 1 ? "signal" : "signals"}
                                </Badge>
                              )}
                            </div>
                            {account.signalCount > 0 && (
                              <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                                {account.latestSignalUrgency && account.latestSignalUrgency !== "unknown" && (
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                                    account.latestSignalUrgency === "hot" ? "bg-red-50 text-red-700 border-red-200" :
                                    account.latestSignalUrgency === "warm" ? "bg-amber-50 text-amber-700 border-amber-200" :
                                    "bg-slate-50 text-slate-600 border-slate-200"
                                  }`}>{account.latestSignalUrgency}</span>
                                )}
                                {account.latestSignalTitle && (
                                  <span className="truncate max-w-[180px]" title={account.latestSignalTitle}>
                                    {account.latestSignalTitle}
                                  </span>
                                )}
                                {account.latestSignalDate && (
                                  <span className="text-muted-foreground/70 shrink-0">{account.latestSignalDate}</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3"><Badge tone={account.fpStatus === "active_target" ? "red" : account.fpStatus === "develop" ? "green" : "slate"}>{labelFor(account.fpStatus, STATUS_LABELS)}</Badge></td>
                          <td className="px-4 py-3"><Badge tone={account.platformPushDecision === "push_now" ? "green" : account.platformPushDecision === "channel_view" ? "blue" : "slate"}>{labelFor(account.platformPushDecision, PUSH_LABELS)}</Badge></td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{labelFor(account.routeToMarket, ROUTE_LABELS)}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{account.ownerName || account.channelOwner || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground min-w-[180px]">{account.segment || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{account.state || "—"}</td>
                          <td className="px-4 py-3 min-w-[150px]"><ActionIndicator counts={actionCounts} /></td>
                          <td className="px-4 py-3 text-right font-semibold text-navy whitespace-nowrap">{formatCurrency(account.fullPotentialAud)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-navy whitespace-nowrap">{formatCurrency(account.target2026Aud)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <ManagerHealthPanel accounts={healthAccounts} myWeekActions={myWeekActions} isLoading={isHealthLoading} />
            <div className="bg-card rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-navy" />
                <h3 className="font-bold text-navy text-sm">Import History</h3>
              </div>
              {(importHistory ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No imports found.</p>
              ) : (
                <div className="space-y-3">
                  {(importHistory ?? []).map((item: any) => (
                    <div key={item.id} className="rounded-lg border border-border bg-slate-50/50 p-3">
                      <div className="font-semibold text-navy text-sm">{item.workbookVersion}</div>
                      <div className="text-[11px] text-muted-foreground mt-1 break-words">{item.sourceFileName}</div>
                      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                        <div><span className="text-muted-foreground">Rows</span><div className="font-bold text-navy">{item.rowCount}</div></div>
                        <div><span className="text-muted-foreground">Errors</span><div className="font-bold text-navy">{item.errorCount}</div></div>
                        <div><span className="text-muted-foreground">Created</span><div className="font-bold text-navy">{item.createdCount}</div></div>
                        <div><span className="text-muted-foreground">Updated</span><div className="font-bold text-navy">{item.updatedCount}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-4">
              <h3 className="font-bold text-blue-900 text-sm mb-2">What this page is</h3>
              <p className="text-xs text-blue-900/80 leading-relaxed">
                Read-only first shell for the imported Portable Air Full Potential universe. Action badges show overdue, due and upcoming Portable Air FP actions from the weekly rhythm. Manager Health highlights coverage gaps using the current account universe and action feed. Editing, Account Attack links and signal matching are intentionally left for later sprints.
              </p>
            </div>
          </aside>
        </section>
      </main>
      {selectedAccount && <FullPotentialDetailDrawer account={selectedAccount} onClose={() => setSelectedAccount(null)} />}
      {showImportModal && <FullPotentialImportModal open={showImportModal} onClose={() => setShowImportModal(false)} />}
      {showSignalImportModal && (
        <FullPotentialSignalImportModal
          open={showSignalImportModal}
          onClose={() => setShowSignalImportModal(false)}
        />
      )}
    </div>
  );
}
