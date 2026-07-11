import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  Search,
  X,
  Zap,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

type SignalReviewQueueProps = {
  open: boolean;
  onClose: () => void;
  onOpenAccount: (account: any) => void;
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  reviewed: "Reviewed",
  promoted: "Promoted",
  dismissed: "Dismissed",
  archived: "Archived",
};

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  drilling_campaign: "Drilling campaign",
  awarded_project: "Awarded project",
  live_tender: "Live tender",
  shutdown_turnaround: "Shutdown / turnaround",
  pipeline_commissioning: "Pipeline commissioning",
  mine_site_activity: "Mine-site activity",
  civil_application: "Civil application",
  rental_fleet_signal: "Rental fleet",
  competitor_channel_signal: "Competitor / channel",
  installed_base_signal: "Installed base",
  contact_discovery_signal: "Contact discovery",
  manual: "Manual",
  other: "Other",
};

const URGENCY_CLASSES: Record<string, string> = {
  hot: "bg-red-50 text-red-700 border-red-200",
  warm: "bg-amber-50 text-amber-700 border-amber-200",
  cold: "bg-slate-50 text-slate-600 border-slate-200",
  unknown: "bg-slate-50 text-slate-500 border-slate-200",
};

const CONFIDENCE_CLASSES: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-blue-50 text-blue-700 border-blue-200",
  low: "bg-slate-50 text-slate-600 border-slate-200",
  unknown: "bg-slate-50 text-slate-500 border-slate-200",
};

const STATUS_CLASSES: Record<string, string> = {
  new: "bg-blue-50 text-blue-700 border-blue-200",
  reviewed: "bg-slate-50 text-slate-700 border-slate-200",
  promoted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  dismissed: "bg-amber-50 text-amber-700 border-amber-200",
  archived: "bg-slate-100 text-slate-500 border-slate-200",
};

function Badge({ value, classes }: { value: string | null | undefined; classes: Record<string, string> }) {
  const label = value || "unknown";
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold ${classes[label] ?? classes.unknown}`}>
      {label}
    </span>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function accountName(account: any) {
  return account?.displayName || account?.canonicalName || "Linked account";
}

export default function FullPotentialSignalReviewQueue({
  open,
  onClose,
  onOpenAccount,
}: SignalReviewQueueProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [urgency, setUrgency] = useState("");
  const [confidenceLevel, setConfidenceLevel] = useState("");
  const [signalType, setSignalType] = useState("");
  const [state, setState] = useState("");
  const [linked, setLinked] = useState<"all" | "linked" | "unlinked">("all");
  const [actionState, setActionState] = useState<"any" | "open" | "closed" | "none">("any");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const input = useMemo(() => ({
    search: search || undefined,
    status: status || undefined,
    urgency: urgency || undefined,
    confidenceLevel: confidenceLevel || undefined,
    signalType: signalType || undefined,
    state: state || undefined,
    linked,
    actionState,
    limit,
    offset,
  }), [search, status, urgency, confidenceLevel, signalType, state, linked, actionState, offset]);

  const query = trpc.fullPotential.listSignals.useQuery(input, {
    enabled: open,
    keepPreviousData: true,
  } as any);

  if (!open) return null;

  const rows = query.data?.signals ?? [];
  const total = query.data?.total ?? 0;
  const summary = query.data?.summary;
  const filters = query.data?.filterOptions;
  const canPrevious = offset > 0;
  const canNext = offset + limit < total;
  const hasFilters = Boolean(search || status || urgency || confidenceLevel || signalType || state || linked !== "all" || actionState !== "any");

  function resetFilters() {
    setSearch("");
    setStatus("");
    setUrgency("");
    setConfidenceLevel("");
    setSignalType("");
    setState("");
    setLinked("all");
    setActionState("any");
    setOffset(0);
  }

  function applyQuickFilter(kind: "all" | "new" | "hot" | "unlinked" | "reviewed" | "promoted" | "dismissed") {
    resetFilters();
    if (kind === "new") setStatus("new");
    if (kind === "hot") setUrgency("hot");
    if (kind === "unlinked") setLinked("unlinked");
    if (["reviewed", "promoted", "dismissed"].includes(kind)) setStatus(kind);
  }

  const quickFilters = [
    { key: "all", label: "All", value: summary?.total ?? 0 },
    { key: "new", label: "New", value: summary?.new ?? 0 },
    { key: "hot", label: "Hot", value: summary?.hot ?? 0 },
    { key: "unlinked", label: "Unlinked", value: summary?.unlinked ?? 0 },
    { key: "reviewed", label: "Reviewed", value: summary?.reviewed ?? 0 },
    { key: "promoted", label: "Promoted", value: summary?.promoted ?? 0 },
    { key: "dismissed", label: "Dismissed", value: summary?.dismissed ?? 0 },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/45 p-3 sm:p-5" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Activity className="h-4 w-4 text-gold" /> Portable Air Full Potential
            </div>
            <h2 className="text-xl font-bold text-navy">Signal Review Queue</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Review imported market signals, locate unlinked evidence and open the existing account workflow for deliberate follow-up.
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 transition-colors hover:bg-slate-100" aria-label="Close signal review queue">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {quickFilters.map(item => (
              <button
                key={item.key}
                onClick={() => applyQuickFilter(item.key)}
                className="rounded-lg border border-border bg-slate-50/60 p-3 text-left transition-colors hover:border-gold/50 hover:bg-gold/5"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</div>
                <div className="mt-1 text-xl font-bold text-navy">{item.value}</div>
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-slate-50/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={event => { setSearch(event.target.value); setOffset(0); }}
                  placeholder="Search signal, source, account or owner..."
                  className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                />
              </div>
              <select value={status} onChange={event => { setStatus(event.target.value); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
                <option value="">All statuses</option>
                {(filters?.statuses ?? []).map((value: string) => <option key={value} value={value}>{STATUS_LABELS[value] ?? value}</option>)}
              </select>
              <select value={urgency} onChange={event => { setUrgency(event.target.value); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
                <option value="">All urgency</option>
                {(filters?.urgencies ?? []).map((value: string) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={signalType} onChange={event => { setSignalType(event.target.value); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
                <option value="">All signal types</option>
                {(filters?.signalTypes ?? []).map((value: string) => <option key={value} value={value}>{SIGNAL_TYPE_LABELS[value] ?? value}</option>)}
              </select>
              <select value={state} onChange={event => { setState(event.target.value); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
                <option value="">All states</option>
                {(filters?.states ?? []).map((value: string) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={linked} onChange={event => { setLinked(event.target.value as typeof linked); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
                <option value="all">Linked + unlinked</option>
                <option value="linked">Linked only</option>
                <option value="unlinked">Unlinked only</option>
              </select>
              <select value={actionState} onChange={event => { setActionState(event.target.value as typeof actionState); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
                <option value="any">Any action state</option>
                <option value="open">Open action</option>
                <option value="closed">Closed action</option>
                <option value="none">No action</option>
              </select>
              {hasFilters && (
                <button onClick={resetFilters} className="rounded-lg px-3 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-slate-100 hover:text-navy">
                  Clear filters
                </button>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
              <div>
                <div className="font-bold text-navy">Signals</div>
                <div className="text-xs text-muted-foreground">Showing {rows.length} of {total}. Queue is read-only; open a linked account to use the existing promotion workflow.</div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={!canPrevious} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={!canNext} onClick={() => setOffset(offset + limit)}>Next</Button>
              </div>
            </div>

            {query.isLoading ? (
              <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading signals...
              </div>
            ) : query.error ? (
              <div className="flex items-start gap-2 bg-red-50 p-5 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {query.error.message}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-12 text-center">
                <Activity className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <div className="font-bold text-navy">No signals match these filters</div>
                <div className="mt-1 text-sm text-muted-foreground">Clear or broaden the filters to review more evidence.</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-xs">
                  <thead className="bg-navy text-white">
                    <tr>
                      <th className="px-4 py-3 text-left uppercase tracking-wider">Signal</th>
                      <th className="px-4 py-3 text-left uppercase tracking-wider">Account</th>
                      <th className="px-4 py-3 text-left uppercase tracking-wider">Type / state</th>
                      <th className="px-4 py-3 text-left uppercase tracking-wider">Quality</th>
                      <th className="px-4 py-3 text-left uppercase tracking-wider">Date / source</th>
                      <th className="px-4 py-3 text-left uppercase tracking-wider">Status / action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((signal: any, index: number) => (
                      <tr key={signal.id} className={`border-t border-border align-top ${index % 2 ? "bg-slate-50/60" : "bg-card"}`}>
                        <td className="max-w-[320px] px-4 py-3">
                          <div className="font-semibold text-navy">{signal.signalTitle}</div>
                          {signal.signalSummary && <div className="mt-1 line-clamp-2 text-muted-foreground">{signal.signalSummary}</div>}
                          {signal.suggestedAction && (
                            <div className="mt-2 flex items-start gap-1.5 rounded bg-gold/10 px-2 py-1.5 text-[11px] text-navy">
                              <Zap className="mt-0.5 h-3 w-3 shrink-0 text-gold-dark" /> {signal.suggestedAction}
                            </div>
                          )}
                        </td>
                        <td className="min-w-[220px] px-4 py-3">
                          {signal.account ? (
                            <>
                              <button
                                onClick={() => { onClose(); onOpenAccount(signal.account); }}
                                className="text-left font-semibold text-blue-700 hover:underline"
                              >
                                {accountName(signal.account)}
                              </button>
                              <div className="mt-1 text-muted-foreground">{signal.account.ownerName || signal.account.channelOwner || "Unassigned"}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold">{signal.account.routeToMarket || "—"}</span>
                                <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold">{signal.account.priorityTier || "—"}</span>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center gap-2 font-semibold text-amber-700">
                              <Link2Off className="h-4 w-4" /> Unlinked
                            </div>
                          )}
                        </td>
                        <td className="min-w-[180px] px-4 py-3">
                          <div className="font-medium text-navy">{SIGNAL_TYPE_LABELS[signal.signalType] ?? signal.signalType}</div>
                          <div className="mt-1 text-muted-foreground">{signal.state || "No state"}</div>
                        </td>
                        <td className="min-w-[150px] px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <Badge value={signal.urgency} classes={URGENCY_CLASSES} />
                            <Badge value={signal.confidenceLevel} classes={CONFIDENCE_CLASSES} />
                          </div>
                        </td>
                        <td className="min-w-[190px] px-4 py-3">
                          <div className="font-medium text-navy">{formatDate(signal.signalDate || signal.createdAt)}</div>
                          <div className="mt-1 text-muted-foreground">{signal.sourceName || "No source"}</div>
                          {signal.sourceUrl && (
                            <a href={signal.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-blue-700 hover:underline">
                              Open source <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </td>
                        <td className="min-w-[190px] px-4 py-3">
                          <Badge value={signal.status} classes={STATUS_CLASSES} />
                          <div className="mt-2">
                            {signal.actionState?.hasOpenAction ? (
                              <div className="flex items-center gap-1.5 text-emerald-700">
                                <Link2 className="h-3.5 w-3.5" /> Open action: {signal.actionState.openActionStatus}
                              </div>
                            ) : signal.actionState?.hasClosedAction ? (
                              <div className="flex items-center gap-1.5 text-slate-600">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Closed: {signal.actionState.closedActionStatus}
                              </div>
                            ) : (
                              <div className="text-muted-foreground">No action</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
