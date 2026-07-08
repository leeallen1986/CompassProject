import { useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { AlertCircle, Building2, Calendar, CheckCircle2, Database, ExternalLink, FileText, HelpCircle, Layers, Loader2, Plus, Shield, TrendingUp, Users, WalletCards, X } from "lucide-react";
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

type UpdateRequestState = {
  ownerName: string;
  channelOwner: string;
  fpStatus: string;
  priorityTier: string;
  platformPushDecision: string;
  installedBaseStatus: string;
  installedBaseNotes: string;
  currentSupplier: string;
  nextAction: string;
  nextActionDate: string;
  notes: string;
};

const EMPTY_UPDATE_REQUEST: UpdateRequestState = {
  ownerName: "",
  channelOwner: "",
  fpStatus: "",
  priorityTier: "",
  platformPushDecision: "",
  installedBaseStatus: "",
  installedBaseNotes: "",
  currentSupplier: "",
  nextAction: "",
  nextActionDate: "",
  notes: "",
};

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

function labelFor(value: string | null | undefined, map: Record<string, string>) {
  if (!value) return "—";
  return map[value] || value;
}

function listValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(/[;,|]/).map(v => v.trim()).filter(Boolean);
  return [];
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

function FieldInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">{label}</label>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
      />
    </div>
  );
}

function FieldSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Record<string, string> }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">{label}</label>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
      >
        <option value="">No change</option>
        {Object.entries(options).map(([optionValue, labelText]) => <option key={optionValue} value={optionValue}>{labelText}</option>)}
      </select>
    </div>
  );
}

function buildRequestedChanges(state: UpdateRequestState) {
  const labels: Record<keyof UpdateRequestState, string> = {
    ownerName: "Owner",
    channelOwner: "Channel owner",
    fpStatus: "FP status",
    priorityTier: "Priority tier",
    platformPushDecision: "Platform push decision",
    installedBaseStatus: "Installed-base status",
    installedBaseNotes: "Installed-base notes",
    currentSupplier: "Current supplier",
    nextAction: "Next action",
    nextActionDate: "Next action date",
    notes: "Notes / reason",
  };

  return Object.entries(state)
    .filter(([, value]) => String(value ?? "").trim().length > 0)
    .map(([key, value]) => `- ${labels[key as keyof UpdateRequestState]}: ${value}`);
}

function AccountUpdateRequestSection({ account }: { account: any }) {
  const utils = trpc.useUtils();
  const [request, setRequest] = useState<UpdateRequestState>(EMPTY_UPDATE_REQUEST);

  const createMutation = trpc.fullPotential.createAction.useMutation({
    onSuccess: async () => {
      toast.success("Account update request created");
      setRequest(EMPTY_UPDATE_REQUEST);
      await utils.fullPotential.actionsForAccount.invalidate({ accountId: account.id });
    },
    onError: error => toast.error(error.message),
  });

  function setField<K extends keyof UpdateRequestState>(key: K, value: UpdateRequestState[K]) {
    setRequest(current => ({ ...current, [key]: value }));
  }

  async function submitRequest() {
    const changes = buildRequestedChanges(request);
    if (changes.length === 0) {
      toast.error("Add at least one requested field change");
      return;
    }

    const accountName = account.displayName || account.canonicalName;
    const notes = [
      `Portable Air FP account update request for ${accountName}`,
      "",
      "Requested changes:",
      ...changes,
      "",
      "Current reference values:",
      `- Owner: ${account.ownerName || "—"}`,
      `- Channel owner: ${account.channelOwner || "—"}`,
      `- FP status: ${labelFor(account.fpStatus, STATUS_LABELS)}`,
      `- Priority tier: ${labelFor(account.priorityTier, TIER_LABELS)}`,
      `- Platform push decision: ${labelFor(account.platformPushDecision, PUSH_LABELS)}`,
      `- Installed-base status: ${labelFor(account.installedBaseStatus, INSTALLED_BASE_LABELS)}`,
      `- Current supplier: ${account.currentSupplier || "—"}`,
    ].join("\n");

    await createMutation.mutateAsync({
      accountId: account.id,
      actionType: "manager_review" as any,
      recommendedAction: `Review requested Portable Air FP account update for ${accountName}`,
      dueDate: request.nextActionDate || null,
      notes,
    });
  }

  return (
    <DetailSection title="Request account update" icon={<FileText className="w-3.5 h-3.5" />}>
      <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-3">
        <p className="text-xs text-blue-900/80 leading-relaxed">
          This creates a manager review action only. It does not directly change Portable Air FP fields, C4C, financial values or importer data.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldInput label="Owner" value={request.ownerName} onChange={value => setField("ownerName", value)} placeholder={account.ownerName || "No change"} />
          <FieldInput label="Channel owner" value={request.channelOwner} onChange={value => setField("channelOwner", value)} placeholder={account.channelOwner || "No change"} />
          <FieldSelect label="FP status" value={request.fpStatus} onChange={value => setField("fpStatus", value)} options={STATUS_LABELS} />
          <FieldSelect label="Priority tier" value={request.priorityTier} onChange={value => setField("priorityTier", value)} options={TIER_LABELS} />
          <FieldSelect label="Platform push decision" value={request.platformPushDecision} onChange={value => setField("platformPushDecision", value)} options={PUSH_LABELS} />
          <FieldSelect label="Installed-base status" value={request.installedBaseStatus} onChange={value => setField("installedBaseStatus", value)} options={INSTALLED_BASE_LABELS} />
          <FieldInput label="Current supplier" value={request.currentSupplier} onChange={value => setField("currentSupplier", value)} placeholder={account.currentSupplier || "No change"} />
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Next action date</label>
            <input type="date" value={request.nextActionDate} onChange={event => setField("nextActionDate", event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Next action</label>
          <textarea value={request.nextAction} onChange={event => setField("nextAction", event.target.value)} rows={2} placeholder="Requested next action change" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Installed-base notes</label>
          <textarea value={request.installedBaseNotes} onChange={event => setField("installedBaseNotes", event.target.value)} rows={2} placeholder="Requested installed-base note update" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Notes / reason</label>
          <textarea value={request.notes} onChange={event => setField("notes", event.target.value)} rows={2} placeholder="Why this update is requested" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        </div>
        <Button onClick={submitRequest} disabled={createMutation.isPending} className="bg-navy text-white hover:bg-navy-light">
          {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Create update request
        </Button>
      </div>
    </DetailSection>
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
              {action.notes && <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{action.notes}</p>}
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

// ── Matched signals (read-only) ─────────────────────────────────────────────

function SignalConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-emerald-50 text-emerald-700 border-emerald-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    low: "bg-red-50 text-red-700 border-red-200",
  };
  const icons = {
    high: <CheckCircle2 className="w-2.5 h-2.5" />,
    medium: <HelpCircle className="w-2.5 h-2.5" />,
    low: <AlertCircle className="w-2.5 h-2.5" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${styles[level]}`}>
      {icons[level]} {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  );
}

const ACTION_TYPE_OPTIONS = [
  { value: "account_review", label: "Account Review" },
  { value: "contact_discovery", label: "Contact Discovery" },
  { value: "customer_call", label: "Customer Call" },
  { value: "site_visit", label: "Site Visit" },
  { value: "channel_handover", label: "Channel Handover" },
  { value: "installed_base_validation", label: "Installed Base Validation" },
  { value: "c4c_create_update", label: "C4C Create/Update" },
  { value: "proposal_followup", label: "Proposal Follow-up" },
  { value: "manager_review", label: "Manager Review" },
  { value: "other", label: "Other" },
];

function PromoteSignalForm({
  accountId,
  sourceType,
  sourceId,
  onSuccess,
  onCancel,
}: {
  accountId: number;
  sourceType: "fp_signal" | "project";
  sourceId: number;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [actionType, setActionType] = useState("account_review");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const utils = trpc.useUtils();

  const promote = trpc.fullPotential.promoteMatchedSignalToAction.useMutation({
    onSuccess: () => {
      toast.success("Action created from signal");
      utils.fullPotential.actionsForAccount.invalidate({ accountId });
      utils.fullPotential.myWeekActions.invalidate();
      utils.fullPotential.matchedSignalsForAccount.invalidate({ accountId });
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to create action";
      toast.error(msg);
    },
  });

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
      <div className="text-xs font-semibold text-blue-800 mb-1">Create action from this signal</div>
      <div>
        <label className="block text-[10px] font-medium text-muted-foreground mb-1">Action type</label>
        <select
          value={actionType}
          onChange={e => setActionType(e.target.value)}
          className="w-full rounded border border-border bg-background text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {ACTION_TYPE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-medium text-muted-foreground mb-1">Due date (optional)</label>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="w-full rounded border border-border bg-background text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>
      <div>
        <label className="block text-[10px] font-medium text-muted-foreground mb-1">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Additional context..."
          className="w-full rounded border border-border bg-background text-xs px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="text-xs h-7 px-3"
          disabled={promote.isPending}
          onClick={() => promote.mutate({ accountId, sourceType, sourceId, actionType: actionType as any, dueDate: dueDate || undefined, notes: notes || undefined })}
        >
          {promote.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          Create action
        </Button>
        <Button size="sm" variant="outline" className="text-xs h-7 px-3" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function MatchedSignalCard({ accountId, match, idx }: { accountId: number; match: any; idx: number }) {
  const [showForm, setShowForm] = useState(false);
  return (
    <div key={`${match.sourceType}-${match.sourceId}-${idx}`} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-navy text-sm leading-snug">{match.title}</div>
        <SignalConfidenceBadge level={match.confidence} />
      </div>
      {match.summary && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{match.summary}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        {match.state && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{match.state}</span>}
        {match.signalDate && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {new Date(match.signalDate).toLocaleDateString()}
          </span>
        )}
        {match.sourceName && <span className="text-muted-foreground">{match.sourceName}</span>}
        <span className="text-muted-foreground italic">{match.matchReason}</span>
      </div>
      {match.suggestedAction && (
        <p className="text-xs text-navy/80 font-medium">Suggested: {match.suggestedAction}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {match.sourceUrl && (
          <a
            href={match.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-teal hover:underline"
          >
            <ExternalLink className="w-3 h-3" /> View source
          </a>
        )}
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline"
          >
            <Plus className="w-3 h-3" /> Create action
          </button>
        )}
      </div>
      {showForm && (
        <PromoteSignalForm
          accountId={accountId}
          sourceType={match.sourceType}
          sourceId={match.sourceId}
          onSuccess={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function MatchedSignalsSection({ accountId }: { accountId: number }) {
  const { data, isLoading, isError } = trpc.fullPotential.matchedSignalsForAccount.useQuery(
    { accountId },
    { staleTime: 60_000 }
  );

  return (
    <DetailSection title="Matched signals" icon={<TrendingUp className="w-3.5 h-3.5" />}>
      {isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading signals...
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Could not load matched signals.
        </div>
      ) : !data || data.matches.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          No matched signals found for this account.
        </div>
      ) : (
        <div className="space-y-3">
          {data.matches.map((match: any, idx: number) => (
            <MatchedSignalCard key={`${match.sourceType}-${match.sourceId}-${idx}`} accountId={accountId} match={match} idx={idx} />
          ))}
          <p className="text-[10px] text-muted-foreground italic">
            Showing up to 10 highest-confidence matches. Signals are matched by account name, aliases, and state.
          </p>
        </div>
      )}
    </DetailSection>
  );
}

// ── Apply approved account update (admin-only) ───────────────────────────────

type ApplyState = {
  ownerName: string;
  channelOwner: string;
  fpStatus: string;
  priorityTier: string;
  platformPushDecision: string;
  installedBaseStatus: string;
  installedBaseNotes: string;
  currentSupplier: string;
  nextAction: string;
  nextActionDate: string;
};

function buildApplyState(account: any): ApplyState {
  function toDateInputValue(value: unknown): string {
    if (!value) return "";
    const parsed = new Date(value as string);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
  }
  return {
    ownerName: account.ownerName ?? "",
    channelOwner: account.channelOwner ?? "",
    fpStatus: account.fpStatus ?? "",
    priorityTier: account.priorityTier ?? "",
    platformPushDecision: account.platformPushDecision ?? "",
    installedBaseStatus: account.installedBaseStatus ?? "",
    installedBaseNotes: account.installedBaseNotes ?? "",
    currentSupplier: account.currentSupplier ?? "",
    nextAction: account.nextAction ?? "",
    nextActionDate: toDateInputValue(account.nextActionDate),
  };
}

function AccountApplySection({ account }: { account: any }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const utils = trpc.useUtils();
  const [fields, setFields] = useState<ApplyState>(() => buildApplyState(account));
  const [resolveActionId, setResolveActionId] = useState<string>("");

  const { data: actions = [] } = trpc.fullPotential.actionsForAccount.useQuery(
    { accountId: account.id },
    { enabled: isAdmin && !!account.id },
  );

  const managerReviewActions = (actions as any[]).filter(
    (a: any) => a.actionType === "manager_review" && !["completed", "won", "lost", "not_relevant", "deferred"].includes(a.status),
  );

  const applyMutation = trpc.fullPotential.updateAccountFields.useMutation({
    onSuccess: async () => {
      toast.success("Account updated");
      await Promise.all([
        utils.fullPotential.list.invalidate(),
        utils.fullPotential.stats.invalidate(),
        utils.fullPotential.filterOptions.invalidate(),
        utils.fullPotential.actionsForAccount.invalidate({ accountId: account.id }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  function setField<K extends keyof ApplyState>(key: K, value: ApplyState[K]) {
    setFields(current => ({ ...current, [key]: value }));
  }

  async function handleApply() {
    const patch: Record<string, unknown> = {};
    const orig = buildApplyState(account);
    if (fields.ownerName !== orig.ownerName) patch.ownerName = fields.ownerName || null;
    if (fields.channelOwner !== orig.channelOwner) patch.channelOwner = fields.channelOwner || null;
    if (fields.fpStatus !== orig.fpStatus) patch.fpStatus = fields.fpStatus || undefined;
    if (fields.priorityTier !== orig.priorityTier) patch.priorityTier = fields.priorityTier || undefined;
    if (fields.platformPushDecision !== orig.platformPushDecision) patch.platformPushDecision = fields.platformPushDecision || undefined;
    if (fields.installedBaseStatus !== orig.installedBaseStatus) patch.installedBaseStatus = fields.installedBaseStatus || undefined;
    if (fields.installedBaseNotes !== orig.installedBaseNotes) patch.installedBaseNotes = fields.installedBaseNotes || null;
    if (fields.currentSupplier !== orig.currentSupplier) patch.currentSupplier = fields.currentSupplier || null;
    if (fields.nextAction !== orig.nextAction) patch.nextAction = fields.nextAction || null;
    if (fields.nextActionDate !== orig.nextActionDate) patch.nextActionDate = fields.nextActionDate || null;

    if (Object.keys(patch).length === 0) {
      toast.error("No fields have changed — edit at least one field before applying");
      return;
    }

    await applyMutation.mutateAsync({
      accountId: account.id,
      ...patch,
      resolveActionId: resolveActionId ? Number(resolveActionId) : null,
    } as any);
  }

  if (!isAdmin) return null;

  return (
    <DetailSection title="Apply approved account update" icon={<Shield className="w-3.5 h-3.5" />}>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-3">
        <p className="text-xs text-emerald-900/80 leading-relaxed">
          Admin only. Directly updates Portable Air FP account fields. Does not write to C4C, financial values, or importer data.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldInput label="Owner" value={fields.ownerName} onChange={value => setField("ownerName", value)} placeholder={account.ownerName || "No change"} />
          <FieldInput label="Channel owner" value={fields.channelOwner} onChange={value => setField("channelOwner", value)} placeholder={account.channelOwner || "No change"} />
          <FieldSelect label="FP status" value={fields.fpStatus} onChange={value => setField("fpStatus", value)} options={STATUS_LABELS} />
          <FieldSelect label="Priority tier" value={fields.priorityTier} onChange={value => setField("priorityTier", value)} options={TIER_LABELS} />
          <FieldSelect label="Platform push decision" value={fields.platformPushDecision} onChange={value => setField("platformPushDecision", value)} options={PUSH_LABELS} />
          <FieldSelect label="Installed-base status" value={fields.installedBaseStatus} onChange={value => setField("installedBaseStatus", value)} options={INSTALLED_BASE_LABELS} />
          <FieldInput label="Current supplier" value={fields.currentSupplier} onChange={value => setField("currentSupplier", value)} placeholder={account.currentSupplier || "No change"} />
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Next action date</label>
            <input type="date" value={fields.nextActionDate} onChange={event => setField("nextActionDate", event.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Next action</label>
          <textarea value={fields.nextAction} onChange={event => setField("nextAction", event.target.value)} rows={2} placeholder="Next action text" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Installed-base notes</label>
          <textarea value={fields.installedBaseNotes} onChange={event => setField("installedBaseNotes", event.target.value)} rows={2} placeholder="Installed-base notes" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y" />
        </div>
        {managerReviewActions.length > 0 && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Mark manager review action as completed (optional)</label>
            <select
              value={resolveActionId}
              onChange={event => setResolveActionId(event.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              <option value="">— None —</option>
              {managerReviewActions.map((a: any) => (
                <option key={a.id} value={String(a.id)}>
                  #{a.id} — {a.recommendedAction?.slice(0, 60) ?? "Manager review"}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button onClick={handleApply} disabled={applyMutation.isPending} className="bg-emerald-700 text-white hover:bg-emerald-800">
          {applyMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
          Apply account update
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

          <MatchedSignalsSection accountId={account.id} />
          <AccountUpdateRequestSection account={account} />
          <AccountApplySection account={account} />
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
