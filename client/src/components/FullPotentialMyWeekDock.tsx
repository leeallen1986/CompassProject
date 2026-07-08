import { useState } from "react";
import { Link } from "wouter";
import { Calendar, ChevronDown, ChevronUp, Clock, Target } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

const ACTION_TYPE_LABELS: Record<string, string> = {
  account_review: "Account review",
  contact_discovery: "Contact discovery",
  customer_call: "Customer call",
  site_visit: "Site visit",
  channel_handover: "Channel handover",
  installed_base_validation: "Installed-base validation",
  proposal_followup: "Proposal follow-up",
  manager_review: "Manager review",
  other: "Other",
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

function labelFor(value: string | null | undefined, map: Record<string, string>) {
  if (!value) return "—";
  return map[value] || value;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
}

function ActionRow({ action, overdue = false }: { action: any; overdue?: boolean }) {
  const accountName = action.account?.displayName || action.account?.canonicalName || "Unknown account";
  const owner = action.account?.ownerName || action.account?.channelOwner || action.ownerName || "—";
  return (
    <div className="rounded-lg border border-border bg-card p-3 hover:bg-gold/5 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-navy text-sm truncate">{accountName}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-1.5">
            <span>{labelFor(action.account?.routeToMarket, ROUTE_LABELS)}</span>
            <span>·</span>
            <span>{owner}</span>
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${overdue ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
          <Calendar className="w-3 h-3" /> {formatDate(action.dueDate)}
        </span>
      </div>
      <div className="mt-2 text-xs text-foreground/80 line-clamp-2">{action.recommendedAction}</div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-semibold">{labelFor(action.actionType, ACTION_TYPE_LABELS)}</span>
        <span>{String(action.status).replace(/_/g, " ")}</span>
      </div>
    </div>
  );
}

export default function FullPotentialMyWeekDock() {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(true);
  const { data, isLoading } = trpc.fullPotential.myWeekActions.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  if (!isAuthenticated) return null;

  const overdue = data?.overdueActions ?? [];
  const due = data?.dueActions ?? [];
  const upcoming = data?.upcomingActions ?? [];
  const total = overdue.length + due.length;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
      <button
        onClick={() => setOpen(value => !value)}
        className="w-full bg-navy text-white px-4 py-3 flex items-center gap-3 text-left hover:bg-navy-light transition-colors"
      >
        <Target className="w-4 h-4 text-gold shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">Full Potential actions</div>
          <div className="text-[11px] text-slate-300">{isLoading ? "Loading..." : `${overdue.length} overdue · ${due.length} due this week`}</div>
        </div>
        {total > 0 && <span className="rounded-full bg-gold text-navy text-xs font-bold px-2 py-0.5">{total}</span>}
        {open ? <ChevronDown className="w-4 h-4 text-slate-300" /> : <ChevronUp className="w-4 h-4 text-slate-300" />}
      </button>

      {open && (
        <div className="max-h-[520px] overflow-y-auto p-3 space-y-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2 px-2 py-4">
              <Clock className="w-4 h-4 animate-pulse" /> Loading Full Potential actions...
            </div>
          ) : total === 0 ? (
            <div className="rounded-lg border border-border bg-slate-50/60 p-4 text-sm text-muted-foreground">
              No due or overdue Full Potential actions. Upcoming actions are still visible below if scheduled.
            </div>
          ) : null}

          {overdue.length > 0 && (
            <section className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-red-700">Overdue</div>
              {overdue.slice(0, 5).map((action: any) => <ActionRow key={action.id} action={action} overdue />)}
            </section>
          )}

          {due.length > 0 && (
            <section className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Due this week</div>
              {due.slice(0, 5).map((action: any) => <ActionRow key={action.id} action={action} />)}
            </section>
          )}

          {upcoming.length > 0 && (
            <section className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Upcoming</div>
              {upcoming.slice(0, 3).map((action: any) => <ActionRow key={action.id} action={action} />)}
            </section>
          )}

          <Link href="/full-potential" className="block text-center px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-navy transition-colors">
            Open Full Potential
          </Link>
        </div>
      )}
    </div>
  );
}
