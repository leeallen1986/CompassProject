import { useState } from "react";
import { GitBranch, History, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  FP_RECORD_STATUSES,
  FP_RECORD_STATUS_LABELS,
  FP_RELATIONSHIP_LABELS,
  FP_RELATIONSHIP_TYPES,
  commercialModelApi,
  formatAud,
  formatCommercialDate,
  optionalNumber,
  type CommercialWorkspace,
  type FpRecordStatus,
  type FpRelationshipType,
} from "@/lib/fullPotentialCommercialModel";
import { Card, Field, Select, StatusBadge } from "./Ui";

type Form = {
  parentAccountId: string;
  mergedIntoAccountId: string;
  relationshipType: FpRelationshipType;
  recordStatus: FpRecordStatus;
  countsTowardPotential: boolean;
};

export function StructureTab({ workspace, isAdmin, refresh }: {
  workspace: CommercialWorkspace;
  isAdmin: boolean;
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<Form>({
    parentAccountId: workspace.account.parentAccountId ? String(workspace.account.parentAccountId) : "",
    mergedIntoAccountId: workspace.account.mergedIntoAccountId ? String(workspace.account.mergedIntoAccountId) : "",
    relationshipType: workspace.account.relationshipType,
    recordStatus: workspace.account.recordStatus,
    countsTowardPotential: workspace.account.countsTowardPotential,
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await commercialModelApi.updateRelationship(workspace.account.id, {
        parentAccountId: optionalNumber(form.parentAccountId),
        mergedIntoAccountId: optionalNumber(form.mergedIntoAccountId),
        relationshipType: form.relationshipType,
        recordStatus: form.recordStatus,
        countsTowardPotential: form.countsTowardPotential,
      });
      toast.success("Account structure updated");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update account structure");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex items-center gap-2"><GitBranch className="h-4 w-4" /><h4 className="font-semibold text-navy">Canonical account structure</h4></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Relationship" value={form.relationshipType} onChange={value => setForm(current => ({ ...current, relationshipType: value }))} options={FP_RELATIONSHIP_TYPES.map(value => ({ value, label: FP_RELATIONSHIP_LABELS[value] }))} />
          <Select label="Record status" value={form.recordStatus} onChange={value => setForm(current => ({ ...current, recordStatus: value }))} options={FP_RECORD_STATUSES.map(value => ({ value, label: FP_RECORD_STATUS_LABELS[value] }))} />
          <Field label="Parent account ID" type="number" value={form.parentAccountId} onChange={value => setForm(current => ({ ...current, parentAccountId: value }))} />
          <Field label="Merge target ID" type="number" value={form.mergedIntoAccountId} onChange={value => setForm(current => ({ ...current, mergedIntoAccountId: value }))} />
        </div>
        <label className="flex gap-2 rounded-lg bg-slate-50 p-3 text-xs"><input type="checkbox" checked={form.countsTowardPotential} onChange={event => setForm(current => ({ ...current, countsTowardPotential: event.target.checked }))} /><span><strong>Count toward Full Potential</strong><br /><span className="text-muted-foreground">Merged, duplicate and excluded rows are forced to non-counting by the server.</span></span></label>
        {isAdmin ? <Button onClick={() => void save()} disabled={busy} className="bg-navy text-white"><Save className="mr-2 h-4 w-4" />Save structure</Button> : <p className="text-xs text-muted-foreground">Structure changes are admin only.</p>}
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card><h4 className="text-xs font-bold uppercase text-muted-foreground">Child records</h4>{workspace.children.length ? <ul className="mt-2 space-y-1 text-xs">{workspace.children.map(child => <li key={child.id}><strong>{child.displayName || child.canonicalName}</strong> · {FP_RELATIONSHIP_LABELS[child.relationshipType]}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">None</p>}</Card>
        <Card><h4 className="text-xs font-bold uppercase text-muted-foreground">Aliases</h4>{workspace.aliases.length ? <ul className="mt-2 space-y-1 text-xs">{workspace.aliases.map(alias => <li key={alias.id}><strong>{alias.aliasName}</strong> · {alias.aliasType.replace(/_/g, " ")}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">None</p>}</Card>
      </div>
    </div>
  );
}

export function HistoryTab({ workspace }: { workspace: CommercialWorkspace }) {
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-2"><History className="h-4 w-4" /><h4 className="font-semibold text-navy">Model versions</h4></div>
        <div className="mt-3 space-y-2">{workspace.models.length ? workspace.models.map(model => <div key={model.id} className="flex justify-between rounded-lg border p-3 text-xs"><span><strong className="text-navy">Version {model.versionNumber}</strong> <StatusBadge status={model.status}>{model.status}</StatusBadge><br /><span className="text-muted-foreground">{formatCommercialDate(model.createdAt)} · {model.createdByName || `User ${model.createdBy}`}</span></span><strong>{formatAud(model.totalPotentialAud)}</strong></div>) : <p className="text-xs text-muted-foreground">No versions.</p>}</div>
      </Card>
      <Card>
        <h4 className="font-semibold text-navy">Review trail</h4>
        <div className="mt-3 space-y-3">{workspace.reviews.length ? workspace.reviews.map(review => <div key={review.id} className="border-l-2 border-gold/40 pl-3 text-xs"><strong className="text-navy">{review.action}</strong> · {review.fromStatus || "—"} → {review.toStatus}<p className="mt-1 text-muted-foreground">{review.note || "No note"}</p><span className="text-[10px] text-muted-foreground">{review.userName || `User ${review.userId}`} · {formatCommercialDate(review.createdAt)}</span></div>) : <p className="text-xs text-muted-foreground">No review events.</p>}</div>
      </Card>
    </div>
  );
}
