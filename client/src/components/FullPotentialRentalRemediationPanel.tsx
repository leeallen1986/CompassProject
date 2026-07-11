import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, PlayCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type RentalRemediationType = "ownership_review" | "financial_potential" | "installed_base" | "supplier_validation";

export type RentalRemediationCatalogItem = {
  type: RentalRemediationType;
  label: string;
  actionType: string;
  recommendedAction: string;
  description: string;
};

type PreviewItem = {
  accountId: number;
  canonicalName: string | null;
  status: "eligible" | "already_managed" | "not_eligible" | "not_rental" | "not_found";
  reason: string;
  existingActionId: number | null;
};

type PreviewResponse = {
  dryRun: boolean;
  dueDate: string;
  created: number;
  remediationType: RentalRemediationType;
  definition: RentalRemediationCatalogItem;
  requested: number;
  eligible: number;
  alreadyManaged: number;
  notEligible: number;
  notRental: number;
  notFound: number;
  items: PreviewItem[];
};

type Props = {
  selectedAccountIds: number[];
  catalog: RentalRemediationCatalogItem[];
  onCompleted: (created: number) => Promise<void> | void;
  onClearSelection: () => void;
};

function defaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

async function postRemediation(input: {
  accountIds: number[];
  remediationType: RentalRemediationType;
  dueDate: string;
  notes?: string;
  dryRun: boolean;
}): Promise<PreviewResponse> {
  const response = await fetch("/api/full-potential/rental-hire/remediation", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Remediation request failed (${response.status})`);
  }
  return response.json();
}

export default function FullPotentialRentalRemediationPanel({
  selectedAccountIds,
  catalog,
  onCompleted,
  onClearSelection,
}: Props) {
  const [remediationType, setRemediationType] = useState<RentalRemediationType>("financial_potential");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedDefinition = useMemo(
    () => catalog.find(item => item.type === remediationType),
    [catalog, remediationType],
  );

  async function runPreview() {
    if (selectedAccountIds.length === 0) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await postRemediation({
        accountIds: selectedAccountIds,
        remediationType,
        dueDate,
        notes: notes.trim() || undefined,
        dryRun: true,
      });
      setPreview(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to preview remediation actions");
      setPreview(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function createActions() {
    if (!preview || preview.eligible === 0) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await postRemediation({
        accountIds: selectedAccountIds,
        remediationType,
        dueDate,
        notes: notes.trim() || undefined,
        dryRun: false,
      });
      setSuccess(`${result.created} remediation action${result.created === 1 ? "" : "s"} created.`);
      setPreview(null);
      onClearSelection();
      await onCompleted(result.created);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create remediation actions");
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetPreview() {
    setPreview(null);
    setError(null);
    setSuccess(null);
  }

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-bold text-navy">
            <ClipboardCheck className="h-4 w-4 text-blue-700" /> Managed remediation actions
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Select visible accounts, preview eligibility and create deduplicated Full Potential actions with a due date.
          </p>
        </div>
        <div className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-bold text-blue-800">
          {selectedAccountIds.length} selected
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[240px_180px_1fr_auto]">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Remediation</span>
          <select
            value={remediationType}
            onChange={event => { setRemediationType(event.target.value as RentalRemediationType); resetPreview(); }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
          >
            {catalog.map(item => <option key={item.type} value={item.type}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Due date</span>
          <input
            type="date"
            value={dueDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={event => { setDueDate(event.target.value); resetPreview(); }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Optional note</span>
          <input
            value={notes}
            onChange={event => { setNotes(event.target.value); resetPreview(); }}
            placeholder="Context for the salesperson or manager..."
            maxLength={1000}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
          />
        </label>
        <div className="flex items-end">
          <Button
            type="button"
            onClick={runPreview}
            disabled={selectedAccountIds.length === 0 || !dueDate || isSubmitting}
            className="w-full bg-navy text-white hover:bg-navy-light lg:w-auto"
          >
            {isSubmitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-1.5 h-4 w-4" />}
            Preview actions
          </Button>
        </div>
      </div>

      {selectedDefinition && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-white/70 p-3 text-xs text-blue-900">
          <div className="font-bold">{selectedDefinition.recommendedAction}</div>
          <div className="mt-1 text-blue-900/75">{selectedDefinition.description}</div>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {success && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {success}
        </div>
      )}

      {preview && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-bold text-navy">Preview result</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {preview.eligible} eligible · {preview.alreadyManaged} already managed · {preview.notEligible} no longer eligible · {preview.notRental + preview.notFound} invalid
              </div>
            </div>
            <Button
              type="button"
              onClick={createActions}
              disabled={preview.eligible === 0 || isSubmitting}
              className="bg-emerald-700 text-white hover:bg-emerald-800"
            >
              {isSubmitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-1.5 h-4 w-4" />}
              Create {preview.eligible} eligible action{preview.eligible === 1 ? "" : "s"}
            </Button>
          </div>

          {preview.items.some(item => item.status !== "eligible") && (
            <div className="mt-3 max-h-40 overflow-y-auto rounded border border-border bg-slate-50/70 p-2">
              {preview.items.filter(item => item.status !== "eligible").map(item => (
                <div key={`${item.accountId}-${item.status}`} className="flex items-start gap-2 border-b border-border py-2 text-xs last:border-b-0">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <div>
                    <span className="font-semibold text-navy">{item.canonicalName || `Account #${item.accountId}`}</span>
                    <span className="ml-2 text-muted-foreground">{item.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
