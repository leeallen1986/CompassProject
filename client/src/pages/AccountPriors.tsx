/**
 * Account Priors — WA Top 100 Target Accounts
 * Searchable table with priority/state/segment filters and inline edit panel.
 * Pump/Flow lane reps and admins can track outreach status and add sales notes.
 */
import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation, Link } from "wouter";
import { getLoginUrl } from "@/const";
import {
  Search, Target, Building2, MapPin, ChevronDown, ChevronUp,
  Loader2, LogIn, ArrowLeft, X, Save, Calendar, User,
  Crosshair, FileText, AlertTriangle, CheckCircle2, Clock,
  Sparkles, BarChart3, Filter, SortAsc, SortDesc, Edit3,
  Flame, TrendingUp, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

// ── Status config ──
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  not_started: { label: "Not Started", color: "bg-slate-100 text-slate-600 border-slate-200", icon: <Clock className="w-3 h-3" /> },
  in_progress: { label: "In Progress", color: "bg-blue-50 text-blue-700 border-blue-200", icon: <Loader2 className="w-3 h-3" /> },
  contacted: { label: "Contacted", color: "bg-amber-50 text-amber-700 border-amber-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  qualified: { label: "Qualified", color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <Target className="w-3 h-3" /> },
  won: { label: "Won", color: "bg-green-100 text-green-800 border-green-300", icon: <CheckCircle2 className="w-3 h-3" /> },
  lost: { label: "Lost", color: "bg-red-50 text-red-600 border-red-200", icon: <X className="w-3 h-3" /> },
  parked: { label: "Parked", color: "bg-slate-50 text-slate-500 border-slate-200", icon: <Clock className="w-3 h-3" /> },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  A: { label: "Priority A", color: "bg-hot text-white" },
  B: { label: "Priority B", color: "bg-warm text-navy" },
  C: { label: "Priority C", color: "bg-cold text-white" },
};

// ── Detail Panel ──
function DetailPanel({
  account,
  onClose,
  onSave,
}: {
  account: any;
  onClose: () => void;
  onSave: (data: any) => void;
}) {
  const [salesNotes, setSalesNotes] = useState(account.salesNotes || "");
  const [status, setStatus] = useState(account.status || "not_started");
  const [owner, setOwner] = useState(account.owner || "");
  const [nextActionDate, setNextActionDate] = useState(
    account.nextActionDate ? new Date(account.nextActionDate).toISOString().split("T")[0] : ""
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      id: account.id,
      salesNotes,
      status,
      owner,
      nextActionDate: nextActionDate || null,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-card border-l border-border shadow-2xl z-50 overflow-y-auto">
      <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-navy" />
          <h2 className="text-base font-bold text-navy truncate">{account.canonicalName}</h2>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100 transition-colors">
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Header badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {account.priorityLevel && (
            <span className={`px-2.5 py-1 rounded text-xs font-bold ${PRIORITY_CONFIG[account.priorityLevel]?.color || "bg-slate-100 text-slate-600"}`}>
              {PRIORITY_CONFIG[account.priorityLevel]?.label || account.priorityLevel}
            </span>
          )}
          <span className="px-2.5 py-1 rounded text-xs font-semibold bg-navy/10 text-navy">
            Rank #{account.rank}
          </span>
          {account.scoreOutOf100 && (
            <span className="px-2.5 py-1 rounded text-xs font-semibold bg-gold/15 text-gold-dark">
              Score: {account.scoreOutOf100}/100
            </span>
          )}
        </div>

        {/* Key info */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">State</span>
            <p className="font-medium text-navy">{account.state || "—"}</p>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Segment</span>
            <p className="font-medium text-navy">{account.segment || "—"}</p>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Confidence</span>
            <p className="font-medium text-navy">{account.confidenceLevel || "—"}</p>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Lane</span>
            <p className="font-medium text-navy capitalize">{account.lane || "pump"}</p>
          </div>
        </div>

        <Separator />

        {/* Intelligence section */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Intelligence</h3>
          {account.productFit && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Product Fit</span>
              <p className="text-sm text-foreground/80 mt-0.5">{account.productFit}</p>
            </div>
          )}
          {account.likelyApplication && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Likely Application</span>
              <p className="text-sm text-foreground/80 mt-0.5">{account.likelyApplication}</p>
            </div>
          )}
          {account.whyTarget && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Why Target</span>
              <p className="text-sm text-foreground/80 mt-0.5">{account.whyTarget}</p>
            </div>
          )}
          {account.firstSalesAction && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">First Sales Action</span>
              <p className="text-sm text-foreground/80 mt-0.5">{account.firstSalesAction}</p>
            </div>
          )}
          {account.suggestedOpeningAngle && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Suggested Opening Angle</span>
              <p className="text-sm text-foreground/80 mt-0.5">{account.suggestedOpeningAngle}</p>
            </div>
          )}
        </div>

        <Separator />

        {/* CRM History */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">CRM History</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pump Sales (LC)</span>
              <p className="font-medium text-navy">{account.pumpSalesLC ? `$${Number(account.pumpSalesLC).toLocaleString()}` : "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pump Qty Since 2021</span>
              <p className="font-medium text-navy">{account.pumpQtySince2021 ?? "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Latest Pump Sale</span>
              <p className="font-medium text-navy">{account.latestPumpSaleYear ?? "—"}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">CRM Records</span>
              <p className="font-medium text-navy">{account.crmRecordsGrouped ?? "—"}</p>
            </div>
          </div>
          {account.existingHistory && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Existing History</span>
              <p className="text-sm text-foreground/80 mt-0.5">{account.existingHistory}</p>
            </div>
          )}
        </div>

        <Separator />

        {/* Editable fields */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tracking</h3>

          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Assigned To</label>
            <input
              type="text"
              value={owner}
              onChange={e => setOwner(e.target.value)}
              placeholder="e.g., John Smith"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Next Action Date</label>
            <input
              type="date"
              value={nextActionDate}
              onChange={e => setNextActionDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Sales Notes</label>
            <textarea
              value={salesNotes}
              onChange={e => setSalesNotes(e.target.value)}
              rows={4}
              placeholder="Add notes about outreach, conversations, next steps..."
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y"
            />
          </div>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-navy text-white hover:bg-navy-light"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──
export default function AccountPriors() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState<string>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Queries
  const { data, isLoading, refetch } = trpc.accountPriors.list.useQuery({
    search: search || undefined,
    priorityLevel: priorityFilter || undefined,
    state: stateFilter || undefined,
    segment: segmentFilter || undefined,
    status: statusFilter || undefined,
    sortBy: sortBy as any,
    sortDir,
  }, { enabled: !!user });

  const { data: filterOptions } = trpc.accountPriors.filterOptions.useQuery(undefined, { enabled: !!user });
  const { data: selectedAccount } = trpc.accountPriors.getById.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId }
  );

  const updateMutation = trpc.accountPriors.update.useMutation({
    onSuccess: () => {
      toast.success("Account updated");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSort = useCallback((field: string) => {
    if (sortBy === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  }, [sortBy]);

  const handleSave = async (data: any) => {
    await updateMutation.mutateAsync(data);
    setSelectedId(null);
  };

  const accounts = data?.accounts ?? [];

  // Stats
  const stats = useMemo(() => {
    const all = accounts;
    return {
      total: all.length,
      priorityA: all.filter((a: any) => a.priorityLevel === "A").length,
      priorityB: all.filter((a: any) => a.priorityLevel === "B").length,
      contacted: all.filter((a: any) => ["contacted", "qualified", "won"].includes(a.status)).length,
      notStarted: all.filter((a: any) => a.status === "not_started").length,
    };
  }, [accounts]);

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
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <AlertTriangle className="w-12 h-12 text-amber-500" />
        <h2 className="text-xl font-bold text-navy">Authentication Required</h2>
        <a href={getLoginUrl()} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-navy text-white font-semibold hover:bg-navy-light transition-colors">
          <LogIn className="w-4 h-4" /> Sign In
        </a>
      </div>
    );
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return null;
    return sortDir === "asc" ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-navy text-white">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="p-1.5 rounded hover:bg-white/10 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-lg font-bold flex items-center gap-2">
                <Target className="w-5 h-5 text-gold" />
                WA Target Accounts
              </h1>
              <p className="text-xs text-slate-300">Pump/Flow Top 100 — Account Prior Library</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-gold tracking-wider">ATLAS COPCO</div>
          </div>
        </div>
      </header>

      <main className="container py-6">
        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <div className="bg-card rounded-lg border border-border p-3">
            <div className="text-2xl font-bold text-navy">{stats.total}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total Accounts</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-3">
            <div className="text-2xl font-bold text-hot">{stats.priorityA}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Priority A</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-3">
            <div className="text-2xl font-bold text-warm">{stats.priorityB}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Priority B</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-3">
            <div className="text-2xl font-bold text-teal">{stats.contacted}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Contacted+</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-3">
            <div className="text-2xl font-bold text-slate-400">{stats.notStarted}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Not Started</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-card rounded-lg border border-border p-4 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by name, segment, state, application..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
              />
            </div>
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              <option value="">All Priorities</option>
              {(filterOptions?.priorityLevels ?? []).map(p => (
                <option key={p} value={p}>Priority {p}</option>
              ))}
            </select>
            <select
              value={stateFilter}
              onChange={e => setStateFilter(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              <option value="">All States</option>
              {(filterOptions?.states ?? []).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={segmentFilter}
              onChange={e => setSegmentFilter(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              <option value="">All Segments</option>
              {(filterOptions?.segments ?? []).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              <option value="">All Statuses</option>
              {(filterOptions?.statuses ?? []).map(s => (
                <option key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</option>
              ))}
            </select>
            {(search || priorityFilter || stateFilter || segmentFilter || statusFilter) && (
              <button
                onClick={() => { setSearch(""); setPriorityFilter(""); setStateFilter(""); setSegmentFilter(""); setStatusFilter(""); }}
                className="px-3 py-2.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-navy hover:bg-slate-100 transition-colors flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-card rounded-lg border border-border p-12 text-center">
            <Target className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-bold text-navy mb-1">No accounts found</h3>
            <p className="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:bg-white/10 transition-colors" onClick={() => handleSort("rank")}>
                      <span className="flex items-center gap-1"># <SortIcon field="rank" /></span>
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:bg-white/10 transition-colors" onClick={() => handleSort("canonicalName")}>
                      <span className="flex items-center gap-1">Account <SortIcon field="canonicalName" /></span>
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">State</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Segment</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:bg-white/10 transition-colors" onClick={() => handleSort("priorityLevel")}>
                      <span className="flex items-center gap-1">Priority <SortIcon field="priorityLevel" /></span>
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:bg-white/10 transition-colors" onClick={() => handleSort("scoreOutOf100")}>
                      <span className="flex items-center gap-1">Score <SortIcon field="scoreOutOf100" /></span>
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider cursor-pointer hover:bg-white/10 transition-colors" onClick={() => handleSort("status")}>
                      <span className="flex items-center gap-1">Status <SortIcon field="status" /></span>
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Application</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account: any, i: number) => {
                    const statusCfg = STATUS_CONFIG[account.status] || STATUS_CONFIG.not_started;
                    const priorityCfg = PRIORITY_CONFIG[account.priorityLevel] || { label: "—", color: "bg-slate-100 text-slate-600" };
                    return (
                      <tr
                        key={account.id}
                        className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50/50"} hover:bg-gold/5 transition-colors cursor-pointer`}
                        onClick={() => setSelectedId(account.id)}
                      >
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{account.rank}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-navy">{account.canonicalName}</div>
                          {account.owner && (
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                              <User className="w-2.5 h-2.5" /> {account.owner}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{account.state || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{account.segment || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${priorityCfg.color}`}>
                            {priorityCfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {account.scoreOutOf100 ? (
                            <span className="font-semibold text-navy">{account.scoreOutOf100}</span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${statusCfg.color}`}>
                            {statusCfg.icon} {statusCfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                          {account.likelyApplication || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedId(account.id); }}
                            className="px-2.5 py-1 rounded text-[10px] font-semibold bg-navy/10 text-navy hover:bg-navy/20 transition-colors"
                          >
                            <Edit3 className="w-3 h-3 inline mr-1" />
                            Detail
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
              {accounts.length} accounts shown
            </div>
          </div>
        )}
      </main>

      {/* Detail panel overlay */}
      {selectedId && selectedAccount && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelectedId(null)} />
          <DetailPanel
            account={selectedAccount}
            onClose={() => setSelectedId(null)}
            onSave={handleSave}
          />
        </>
      )}
    </div>
  );
}
