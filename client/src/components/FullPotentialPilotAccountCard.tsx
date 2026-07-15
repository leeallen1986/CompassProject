import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  FP_PRODUCT_FAMILY_LABELS,
  commercialModelApi,
  formatAud,
  formatCommercialDate,
  numericValue,
  type CommercialModelLine,
  type CommercialWorkspace,
} from "@/lib/fullPotentialCommercialModel";
import {
  activeClaimForLine,
  approvedModelLines,
  buildPilotSnapshot,
  createPursuitDraft,
  fullPotentialClaims,
  pilotStatusLabel,
  pilotValueLabel,
  pursuitDraftErrors,
  type PilotAccountSnapshot,
  type PilotPipelineClaim,
  type PursuitDraft,
  type TopFivePilotAccount,
} from "@/lib/fullPotentialPilot";

function accountName(workspace: CommercialWorkspace | null, fallback: string): string {
  return workspace?.account.displayName || workspace?.account.canonicalName || fallback;
}

function statusClass(status: string): string {
  if (["qualified", "quoted", "won"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["contacted", "meeting_booked"].includes(status)) {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (["lost", "not_relevant"].includes(status)) {
    return "border-slate-200 bg-slate-100 text-slate-600";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function ChecklistItem({ complete, children }: { complete: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      {complete ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
      ) : (
        <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      )}
      <span className={complete ? "text-slate-700" : "font-medium text-amber-900"}>{children}</span>
    </li>
  );
}

function PursuitForm({
  workspace,
  line,
  draft,
  setDraft,
  busy,
  onCancel,
  onSubmit,
}: {
  workspace: CommercialWorkspace;
  line: CommercialModelLine;
  draft: PursuitDraft;
  setDraft: React.Dispatch<React.SetStateAction<PursuitDraft | null>>;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const errors = pursuitDraftErrors(draft);

  function update<K extends keyof PursuitDraft>(key: K, value: PursuitDraft[K]) {
    setDraft(current => (current ? { ...current, [key]: value } : current));
  }

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Start attributed pursuit</div>
          <h4 className="mt-1 font-bold text-navy">
            {FP_PRODUCT_FAMILY_LABELS[line.productFamily]} · {line.application}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Source: approved model {workspace.approvedModel?.modelKey}. This creates a Compass attribution anchor, not the formal C4C opportunity.
          </p>
        </div>
        <button onClick={onCancel} className="rounded p-1 text-muted-foreground hover:bg-white hover:text-navy" aria-label="Close pursuit form">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-navy">
          Customer contact name
          <input
            value={draft.contactName}
            onChange={event => update("contactName", event.target.value)}
            placeholder="Optional when a target role is known"
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
        <label className="text-xs font-semibold text-navy">
          Target customer role
          <input
            value={draft.contactRole}
            onChange={event => update("contactRole", event.target.value)}
            placeholder="Example: National Fleet Manager"
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
      </div>

      <label className="block text-xs font-semibold text-navy">
        Commercial hypothesis
        <textarea
          value={draft.commercialHypothesis}
          onChange={event => update("commercialHypothesis", event.target.value)}
          rows={4}
          className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-blue-300"
          placeholder="State the evidence-backed opportunity hypothesis the customer interaction will validate."
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-navy">
          Next commercial action
          <input
            value={draft.nextAction}
            onChange={event => update("nextAction", event.target.value)}
            placeholder="Example: confirm fleet and replacement timing"
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
        <label className="text-xs font-semibold text-navy">
          Next-action date
          <input
            type="date"
            value={draft.nextActionDate}
            onChange={event => update("nextActionDate", event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
        <label className="text-xs font-semibold text-navy">
          Working pursuit estimate AUD
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.estimatedValueAud}
            onChange={event => update("estimatedValueAud", event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-blue-300"
          />
          <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
            Prefilled from the approved model line. Confirm or reduce it before submission; it is not a forecast value.
          </span>
        </label>
        <label className="text-xs font-semibold text-navy">
          Attribution note
          <textarea
            value={draft.notes}
            onChange={event => update("notes", event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-gold/40 bg-gold/10 p-3 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={draft.confirmed}
          onChange={event => update("confirmed", event.target.checked)}
          className="mt-0.5"
        />
        <span>
          <strong className="text-navy">I confirm this is an attributed commercial pursuit.</strong>
          <br />
          Compass records why the pursuit started. C4C remains the system of record for a qualified opportunity, forecast, quote and formal customer activity.
        </span>
      </label>

      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>Before starting:</strong> {errors[0]}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onSubmit} disabled={busy || errors.length > 0} className="bg-blue-700 text-white">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
          Start attributed pursuit
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

export default function FullPotentialPilotAccountCard({
  pilot,
  onSnapshot,
}: {
  pilot: TopFivePilotAccount;
  onSnapshot: (snapshot: PilotAccountSnapshot) => void;
}) {
  const [workspace, setWorkspace] = useState<CommercialWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLine, setSelectedLine] = useState<CommercialModelLine | null>(null);
  const [draft, setDraft] = useState<PursuitDraft | null>(null);

  const claimsQuery = trpc.pipeline.byAccount.useQuery(
    { sourceAccountId: pilot.id },
    { staleTime: 30_000 },
  );
  const claimMutation = trpc.pipeline.claimFromFP.useMutation();
  const claims = (claimsQuery.data ?? []) as PilotPipelineClaim[];

  async function loadWorkspace() {
    setLoading(true);
    setError("");
    try {
      setWorkspace(await commercialModelApi.workspace(pilot.id));
    } catch (loadError) {
      setWorkspace(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load account activation data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, [pilot.id]);

  const snapshot = useMemo(
    () => buildPilotSnapshot(pilot.id, workspace, claims),
    [pilot.id, workspace, claims],
  );

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  const approvedLines = approvedModelLines(workspace);
  const attributedClaims = fullPotentialClaims(claims);

  function openPursuit(line: CommercialModelLine) {
    if (!workspace?.approvedModel) return;
    const active = activeClaimForLine(claims, line);
    if (active) {
      toast.info(`An active attributed pursuit already exists for this line (claim #${active.id}).`);
      return;
    }
    setSelectedLine(line);
    setDraft(createPursuitDraft(workspace, line));
  }

  async function submitPursuit() {
    if (!workspace || !selectedLine || !draft) return;
    const errors = pursuitDraftErrors(draft);
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }

    try {
      const result = await claimMutation.mutateAsync({
        sourceAccountId: pilot.id,
        productFamily: draft.productFamily,
        application: draft.application.trim(),
        commercialHypothesis: draft.commercialHypothesis.trim(),
        nextAction: draft.nextAction.trim(),
        nextActionDate: new Date(`${draft.nextActionDate}T00:00:00.000Z`),
        contactName: draft.contactName.trim() || undefined,
        contactRole: draft.contactRole.trim() || undefined,
        estimatedValueAud: numericValue(draft.estimatedValueAud).toFixed(2),
        notes: draft.notes.trim() || undefined,
      });
      toast.success(
        result.alreadyExists
          ? `Existing attributed pursuit opened (claim #${result.claimId})`
          : `Attributed pursuit created (claim #${result.claimId})`,
      );
      setSelectedLine(null);
      setDraft(null);
      await claimsQuery.refetch();
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : "Could not start attributed pursuit");
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-slate-50/80 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
              {pilot.rank}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-navy">{accountName(workspace, pilot.name)}</h2>
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{pilot.focus}</p>
            </div>
          </div>
          <div className="text-right">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusClass(snapshot.progressedClaimCount > 0 ? "qualified" : snapshot.attributedClaimCount > 0 ? "identified" : "deferred")}`}>
              {pilotStatusLabel(snapshot)}
            </span>
            <div className="mt-1 text-sm font-bold text-navy">{pilotValueLabel(snapshot)}</div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading account intelligence…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
            <button onClick={() => void loadWorkspace()} className="ml-2 inline-flex items-center font-semibold underline">
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
            </button>
          </div>
        ) : workspace ? (
          <>
            <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr_1fr]">
              <section className="rounded-xl border border-border p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Readiness</div>
                <ul className="mt-3 space-y-2">
                  <ChecklistItem complete={workspace.evidence.length > 0}>Evidence captured ({workspace.evidence.length})</ChecklistItem>
                  <ChecklistItem complete={snapshot.verifiedEvidenceCount > 0}>Evidence verified ({snapshot.verifiedEvidenceCount})</ChecklistItem>
                  <ChecklistItem complete={snapshot.approvedModel}>Commercial model approved</ChecklistItem>
                  <ChecklistItem complete={snapshot.approvedLineCount > 0}>Positive approved product-family line</ChecklistItem>
                  <ChecklistItem complete={snapshot.attributedClaimCount > 0}>Attributed pursuit started</ChecklistItem>
                </ul>
              </section>

              <section className="rounded-xl border border-border p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Next required step</div>
                <p className="mt-3 text-sm font-semibold text-navy">{snapshot.nextStep}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={`/full-potential/commercial-model?accountId=${pilot.id}`}
                    className="inline-flex items-center rounded-lg border border-border px-3 py-2 text-xs font-semibold text-navy hover:bg-slate-50"
                  >
                    Open evidence and model <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                </div>
              </section>

              <section className="rounded-xl border border-gold/40 bg-gold/10 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gold-dark">
                  <ShieldCheck className="h-3.5 w-3.5" /> System boundary
                </div>
                <p className="mt-3 text-xs text-slate-700">
                  Compass identifies, evidences and attributes the pursuit. C4C owns the qualified opportunity, forecast, quote and formal activity record.
                </p>
              </section>
            </div>

            <section>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-navy">Approved commercial plays</h3>
                  <p className="text-xs text-muted-foreground">A pursuit can start only from a positive line in the approved model.</p>
                </div>
                {workspace.approvedModel && (
                  <span className="text-xs text-muted-foreground">
                    Model {workspace.approvedModel.modelKey} · {formatAud(workspace.approvedModel.totalPotentialAud)}
                  </span>
                )}
              </div>

              {approvedLines.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  No approved positive model line is available. Complete the evidence and manager-approval workflow before starting a pursuit.
                </div>
              ) : (
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {approvedLines.map(line => {
                    const activeClaim = activeClaimForLine(claims, line);
                    return (
                      <div key={line.id} className="rounded-xl border border-border p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="font-semibold text-navy">{FP_PRODUCT_FAMILY_LABELS[line.productFamily]}</h4>
                            <p className="mt-1 text-xs text-muted-foreground">{line.application} · {line.routeToMarket.replace(/_/g, " ")}</p>
                          </div>
                          <strong className="text-sm text-navy">{formatAud(line.linePotentialAud)}</strong>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground">{line.confidenceLevel} confidence</span>
                          {activeClaim ? (
                            <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${statusClass(activeClaim.status)}`}>
                              Claim #{activeClaim.id} · {activeClaim.status.replace(/_/g, " ")}
                            </span>
                          ) : (
                            <Button onClick={() => openPursuit(line)} size="sm" className="bg-blue-700 text-white">
                              <Rocket className="mr-1.5 h-3.5 w-3.5" /> Start pursuit
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {workspace && selectedLine && draft && (
                <PursuitForm
                  workspace={workspace}
                  line={selectedLine}
                  draft={draft}
                  setDraft={setDraft}
                  busy={claimMutation.isPending}
                  onCancel={() => {
                    setSelectedLine(null);
                    setDraft(null);
                  }}
                  onSubmit={() => void submitPursuit()}
                />
              )}
            </section>

            <section>
              <h3 className="font-bold text-navy">Attributed pursuits</h3>
              <p className="text-xs text-muted-foreground">Read-only attribution view. Progression and formal opportunity management are not duplicated here.</p>
              {claimsQuery.isLoading ? (
                <div className="mt-3 text-xs text-muted-foreground">Loading pursuits…</div>
              ) : attributedClaims.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No attributed pursuit has been started for this account.</div>
              ) : (
                <div className="mt-3 space-y-2">
                  {attributedClaims.map(claim => (
                    <div key={claim.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-3 text-xs">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-navy">Claim #{claim.id}</strong>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(claim.status)}`}>
                            {claim.status.replace(/_/g, " ")}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-700">
                          {claim.productFamily ? FP_PRODUCT_FAMILY_LABELS[claim.productFamily as keyof typeof FP_PRODUCT_FAMILY_LABELS] ?? claim.productFamily : "Product family not set"}
                          {claim.application ? ` · ${claim.application}` : ""}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Next: {claim.nextAction || "not recorded"} · {formatCommercialDate(claim.nextActionDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <strong className="text-navy">{formatAud(claim.estimatedValueAud)}</strong>
                        <div className="mt-1 text-[10px] text-muted-foreground">Started {formatCommercialDate(claim.createdAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </article>
  );
}
