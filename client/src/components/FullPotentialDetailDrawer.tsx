import { useState, type ReactNode } from "react";
import { Building2, Calendar, CheckCircle2, Clock, Database, FileText, Layers, Loader2, Plus, Shield, Users, WalletCards, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

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

const C4C_LABELS: Record<string, string> = {
  not_in_c4c: "Not in C4C",
  lead: "Lead",
  prospect: "Prospect",
  opportunity: "Opportunity",
  quote: "Quote",
  won: "Won",
  lost: "Lost",
  unknown: "Unknown",
};

const INSTALLED_BASE_LABELS: Record<string, string> = {
  known: "Known",
  partial: "Partial",
  unknown: "Unknown",
  not_applicable: "Not applicable",
};

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

const ACTION_STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  contacted: "Contacted",
  meeting_booked: "Meeting booked",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  deferred: "Deferred",
  not_relevant: "Not relevant",
  completed: "Completed",
};

const QUICK_STATUSES = ["in_progress", "contacted", "meeting_booked", "completed", "deferred", "not_relevant"] as const;

function formatCurrency(value?: number | null) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount === 0) return "—";
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `$${(amount / 1_000).toFixed(0)}k`;
  return `$${amount.toLocaleString()}`;
}

function formatDate(value?: string | Date | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function toDateInputValue(value?: string | Date | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function labelFor(value: string | null | undefined, map: Record<string, string>) {
  if (!value) return "—";
  return map[value] || value;
}

function listValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(/[;,|]/).map(v => v.trim()).filter(Boolean);
  return [];
}

function cleanFormValue(value: unknown) {
  return String(value ?? "").trim();
}

function displayFormValue(value: unknown) {
  const cleaned = cleanFormValue(value);
  return cleaned || "—";
}

function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "blue" | "green" | "red" | "gold" | "amber" }) {
  const toneClass = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
    gold: "bg-gold/15 text-gold-dark border-gold/30",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
  }[tone];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${toneClass}`}>{children}</span>;
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="text-sm font-medium text-navy mt-0.5 break-words">{value || "—"}</div>
    </div>
  );
}

function DetailSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function AccountActionsSection({ accountId }: { accountId: number }) {
  const utils = trpc.useUtils();
  const [actionType, setActionType] = useState("account_review");
  const [recommendedAction, setRecommendedAction] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: actions = [], isLoading } = trpc.fullPotential.actionsForAccount.useQuery({ accountId }, { enabled: !!accountId });

  const createMutation = trpc.fullPotential.createAction.useMutation({
    onSuccess: async () => {
      toast.success("Account action added");
      setRecommendedAction("");
      setDueDate("");
      setNotes("");
      setActionType("account_review");
      await utils.fullPotential.actionsForAccount.invalidate({ accountId });
    },
    onError: error => toast.error(error.message),
  });

  const updateMutation = trpc.fullPotential.updateActionStatus.useMutation({
    onSuccess: async () => {
      toast.success("Action updated");
      await utils.fullPotential.actionsForAccount.invalidate({ accountId });
    },
    onError: error => toast.error(error.message),
  });

  async function handleCreate() {
    if (!recommendedAction.trim()) {
      toast.error("Add a recommended action first");
      return;
    }
    await createMutation.mutateAsync({
      accountId,
      actionType: actionType as any,
      recommendedAction: recommendedAction.trim(),
      dueDate: dueDate || null,
      notes: notes.trim() || null,
    });
  }

  return (
    <DetailSection title="Account actions" icon={<CheckCircle2 className="w-3.5 h-3.5" />}>
      <div className="rounded-lg border border-border bg-slate-50/60 p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Action type</label>
            <select value={actionType} onChange={event => setActionType(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40">
              {Object.entries(ACTION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Due date</label>
            <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Recommended action</label>
          <textarea value={recommendedAction} onChange={event => setRecommendedAction(event.target.value)} rows={2} placeholder="Example: Call maintenance manager to validate installed base and current supplier." className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Notes</label>
          <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} placeholder="Optional context for the rep or channel owner." className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        </div>
        <Button onClick={handleCreate} disabled={createMutation.isPending} className="bg-navy text-white hover:bg-navy-light">
          {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Add account action
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading actions...</div>
      ) : actions.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">No account actions recorded yet.</div>
      ) : (
        <div className="space-y-3">
          {actions.map((action: any) => (
            <div key={action.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-navy text-sm">{action.recommendedAction}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                    <Badge tone="blue">{labelFor(action.actionType, ACTION_TYPE_LABELS)}</Badge>
                    <Badge tone={action.status === "completed" || action.status === "won" ? "green" : action.status === "deferred" || action.status === "not_relevant" ? "amber" : "slate"}>{labelFor(action.status, ACTION_STATUS_LABELS)}</Badge>
                  </div>
                </div>
                <div className="text-right text-[11px] text-muted-foreground shrink-0">
                  <div className="flex items-center gap-1 justify-end"><Calendar className="w-3 h-3" /> {formatDate(action.dueDate)}</div>
                  <div className="mt-1">{action.ownerName || "—"}</div>
                </div>
              </div>
              {action.notes && <p className="text-xs text-muted-foreground leading-relaxed">{action.notes}</p>}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {QUICK_STATUSES.map(status => (
                  <button
                    key={status}
                    disabled={updateMutation.isPending || action.status === status}
                    onClick={() => updateMutation.mutate({ actionId: action.id, status, notes: action.notes ?? null })}
                    className="px-2 py-1 rounded border border-border text-[10px] font-semibold text-muted-foreground hover:text-navy hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {labelFor(status, ACTION_STATUS_LABELS)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

function AccountUpdateRequestSection({ account }: { account: any }) {
  const utils = trpc.useUtils();
  const accountName = account.displayName || account.canonicalName || "this account";
  const [ownerName, setOwnerName] = useState(cleanFormValue(account.ownerName));
  const [channelOwner, setChannelOwner] = useState(cleanFormValue(account.channelOwner));
  const [fpStatus, setFpStatus] = useState(cleanFormValue(account.fpStatus));
  const [priorityTier, setPriorityTier] = useState(cleanFormValue(account.priorityTier));
  const [platformPushDecision, setPlatformPushDecision] = useState(cleanFormValue(account.platformPushDecision));
  const [installedBaseStatus, setInstalledBaseStatus] = useState(cleanFormValue(account.installedBaseStatus));
  const [installedBaseNotes, setInstalledBaseNotes] = useState(cleanFormValue(account.installedBaseNotes));
  const [currentSupplier, setCurrentSupplier] = useState(cleanFormValue(account.currentSupplier));
  const [nextAction, setNextAction] = useState(cleanFormValue(account.nextAction));
  const [nextActionDate, setNextActionDate] = useState(toDateInputValue(account.nextActionDate));
  const [reviewDueDate, setReviewDueDate] = useState("");
  const [reason, setReason] = useState("");

  const createMutation = trpc.fullPotential.createAction.useMutation({
    onSuccess: async () => {
      toast.success("Account update request created");
      setReason("");
      setReviewDueDate("");
      await utils.fullPotential.actionsForAccount.invalidate({ accountId: account.id });
    },
    onError: error => toast.error(error.message),
  });

  const requestedFields = [
    { label: "Owner", current: account.ownerName, requested: ownerName },
    { label: "Channel owner", current: account.channelOwner, requested: channelOwner },
    { label: "FP status", current: account.fpStatus, requested: fpStatus },
    { label: "Priority tier", current: account.priorityTier, requested: priorityTier },
    { label: "Platform push decision", current: account.platformPushDecision, requested: platformPushDecision },
    { label: "Installed-base status", current: account.installedBaseStatus, requested: installedBaseStatus },
    { label: "Installed-base notes", current: account.installedBaseNotes, requested: installedBaseNotes },
    { label: "Current supplier", current: account.currentSupplier, requested: currentSupplier },
    { label: "Next action", current: account.nextAction, requested: nextAction },
    { label: "Next action date", current: toDateInputValue(account.nextActionDate), requested: nextActionDate },
  ].filter(field => cleanFormValue(field.current) !== cleanFormValue(field.requested));

  async function submitUpdateRequest() {
    if (requestedFields.length === 0 && !reason.trim()) {
      toast.error("Change at least one field or add a reason before submitting");
      return;
    }

    const changes = requestedFields.length
      ? requestedFields.map(field => `- ${field.label}: ${displayFormValue(field.current)} → ${displayFormValue(field.requested)}`).join("\n")
      : "- No field value change captured; review note only.";

    const notes = [
      "Portable Air Full Potential account update request",
      `Account: ${accountName}`,
      `Stable key: ${account.stableKey || "—"}`,
      "",
      "Requested changes:",
      changes,
      "",
      "Reason / context:",
      reason.trim() || "—",
      "",
      "Scope note: this request does not update C4C and does not directly change the account record.",
    ].join("\n");

    await createMutation.mutateAsync({
      accountId: account.id,
      actionType: "manager_review" as any,
      recommendedAction: `Review requested Portable Air FP account update for ${accountName}`,
      dueDate: reviewDueDate || null,
      notes,
    });
  }

  return (
    <DetailSection title="Request account update" icon={<FileText className="w-3.5 h-3.5" />}>
      <div className="rounded-lg border border-border bg-amber-50/50 p-3 space-y-3">
        <p className="text-xs text-amber-900/80 leading-relaxed">
          Creates a manager-review action only. This does not directly edit the account, update C4C, or change any financial fields.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Owner</label>
            <input value={ownerName} onChange={event => setOwnerName(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Channel owner</label>
            <input value={channelOwner} onChange={event => setChannelOwner(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">FP status</label>
            <select value={fpStatus} onChange={event => setFpStatus(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40">
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Priority tier</label>
            <select value={priorityTier} onChange={event => setPriorityTier(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40">
              {Object.entries(TIER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Platform push decision</label>
            <select value={platformPushDecision} onChange={event => setPlatformPushDecision(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40">
              {Object.entries(PUSH_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Installed-base status</label>
            <select value={installedBaseStatus} onChange={event => setInstalledBaseStatus(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40">
              {Object.entries(INSTALLED_BASE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Current supplier</label>
            <input value={currentSupplier} onChange={event => setCurrentSupplier(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Next action date</label>
            <input type="date" value={nextActionDate} onChange={event => setNextActionDate(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Manager review due date</label>
            <input type="date" value={reviewDueDate} onChange={event => setReviewDueDate(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Installed-base notes</label>
          <textarea value={installedBaseNotes} onChange={event => setInstalledBaseNotes(event.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Next action</label>
          <textarea value={nextAction} onChange={event => setNextAction(event.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Notes / reason</label>
          <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} placeholder="Explain why this change is needed." className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        </div>
        <Button onClick={submitUpdateRequest} disabled={createMutation.isPending} className="bg-gold text-navy hover:bg-gold/90">
          {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Submit update request
        </Button>
      </div>
    </DetailSection>
  );
}

export default function FullPotentialDetailDrawer({ account, onClose }: { account: any; onClose: () => void }) {
  const applicationPlays = listValues(account?.applicationPlays);
  const evidenceSources = listValues(account?.evidenceSources);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy/25" onClick={onClose}>
      <aside className="h-full w-full max-w-[560px] bg-card border-l border-border shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-card border-b border-border z-10 px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-1">
              <Building2 className="w-4 h-4" /> Portable Air Full Potential account
            </div>
            <h2 className="text-lg font-bold text-navy leading-tight">{account.displayName || account.canonicalName}</h2>
            {account.parentGroup && <p className="text-xs text-muted-foreground mt-1">Parent group: {account.parentGroup}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div className="flex flex-wrap gap-2">
            <Badge tone={account.fpStatus === "active_target" ? "red" : account.fpStatus === "develop" ? "green" : "slate"}>{labelFor(account.fpStatus, STATUS_LABELS)}</Badge>
            <Badge tone="gold">{labelFor(account.priorityTier, TIER_LABELS)}</Badge>
            <Badge tone={account.platformPushDecision === "push_now" ? "green" : account.platformPushDecision === "channel_view" ? "blue" : "slate"}>{labelFor(account.platformPushDecision, PUSH_LABELS)}</Badge>
            <Badge tone="blue">{labelFor(account.rowClass, ROW_CLASS_LABELS)}</Badge>
          </div>

          <DetailSection title="Route and ownership" icon={<Users className="w-3.5 h-3.5" />}>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem label="Route to market" value={labelFor(account.routeToMarket, ROUTE_LABELS)} />
              <DetailItem label="Owner" value={account.ownerName || "—"} />
              <DetailItem label="Channel owner" value={account.channelOwner || "—"} />
              <DetailItem label="C4C status" value={labelFor(account.c4cStatus, C4C_LABELS)} />
            </div>
          </DetailSection>

          <DetailSection title="Segment and application" icon={<Layers className="w-3.5 h-3.5" />}>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem label="Segment" value={account.segment || "—"} />
              <DetailItem label="Subsegment" value={account.subsegment || "—"} />
              <DetailItem label="State" value={account.state || "—"} />
              <DetailItem label="Region" value={account.region || "—"} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Application plays</div>
              {applicationPlays.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <div className="flex flex-wrap gap-1.5">{applicationPlays.map(play => <Badge key={play}>{play}</Badge>)}</div>}
            </div>
          </DetailSection>

          <DetailSection title="Commercial potential" icon={<WalletCards className="w-3.5 h-3.5" />}>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem label="Current revenue" value={formatCurrency(account.currentRevenueAud)} />
              <DetailItem label="Full Potential" value={formatCurrency(account.fullPotentialAud)} />
              <DetailItem label="2026 target" value={formatCurrency(account.target2026Aud)} />
              <DetailItem label="Remaining potential" value={formatCurrency(account.remainingPotentialAud)} />
            </div>
          </DetailSection>

          <DetailSection title="Installed base and supplier" icon={<Shield className="w-3.5 h-3.5" />}>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem label="Current supplier" value={account.currentSupplier || "—"} />
              <DetailItem label="Installed base" value={labelFor(account.installedBaseStatus, INSTALLED_BASE_LABELS)} />
            </div>
            <DetailItem label="Installed-base notes" value={account.installedBaseNotes || "—"} />
          </DetailSection>

          <DetailSection title="Evidence and next action" icon={<FileText className="w-3.5 h-3.5" />}>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Evidence sources</div>
              {evidenceSources.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <div className="flex flex-wrap gap-1.5">{evidenceSources.map(source => <Badge key={source} tone="blue">{source}</Badge>)}</div>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem label="Confidence" value={account.confidenceLevel || "—"} />
              <DetailItem label="Next action date" value={formatDate(account.nextActionDate)} />
            </div>
            <DetailItem label="Next action" value={account.nextAction || "—"} />
          </DetailSection>

          <AccountUpdateRequestSection account={account} />
          <AccountActionsSection accountId={account.id} />

          <DetailSection title="Import source" icon={<Database className="w-3.5 h-3.5" />}>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem label="Workbook version" value={account.sourceWorkbookVersion || "—"} />
              <DetailItem label="Source sheet" value={account.sourceSheet || "—"} />
              <DetailItem label="Source row" value={account.sourceRowNumber ?? "—"} />
              <DetailItem label="Stable key" value={<span className="text-[11px] font-mono text-muted-foreground">{account.stableKey}</span>} />
            </div>
          </DetailSection>
        </div>
      </aside>
    </div>
  );
}
