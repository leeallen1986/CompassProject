import { useState } from "react";
import { Check, FilePlus2, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  FP_CONFIDENCE_LEVELS,
  FP_EVIDENCE_TYPES,
  FP_EVIDENCE_TYPE_LABELS,
  FP_PRODUCT_FAMILIES,
  FP_PRODUCT_FAMILY_LABELS,
  commercialModelApi,
  formatCommercialDate,
  nullIfBlank,
  type CommercialEvidence,
  type CommercialWorkspace,
  type FpConfidenceLevel,
  type FpEvidenceType,
  type FpProductFamily,
} from "@/lib/fullPotentialCommercialModel";
import { Area, Card, Field, Select, StatusBadge } from "./Ui";

type Form = {
  productFamily: "" | FpProductFamily;
  evidenceType: FpEvidenceType;
  title: string;
  summary: string;
  sourceName: string;
  sourceReference: string;
  sourceUrl: string;
  observedAt: string;
  confidenceLevel: FpConfidenceLevel;
};

const emptyForm: Form = {
  productFamily: "",
  evidenceType: "customer_discovery",
  title: "",
  summary: "",
  sourceName: "",
  sourceReference: "",
  sourceUrl: "",
  observedAt: "",
  confidenceLevel: "medium",
};

export default function EvidenceTab({ workspace, isAdmin, refresh }: {
  workspace: CommercialWorkspace;
  isAdmin: boolean;
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<Form>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [review, setReview] = useState<{ evidence: CommercialEvidence; decision: "verified" | "rejected" | "superseded"; note: string } | null>(null);

  async function saveEvidence() {
    if (form.title.trim().length < 3 || form.summary.trim().length < 3) {
      toast.error("Add an evidence title and summary");
      return;
    }
    setBusy("create");
    try {
      await commercialModelApi.addEvidence({
        accountId: workspace.account.id,
        productFamily: form.productFamily || null,
        evidenceType: form.evidenceType,
        title: form.title.trim(),
        summary: form.summary.trim(),
        sourceName: nullIfBlank(form.sourceName),
        sourceReference: nullIfBlank(form.sourceReference),
        sourceUrl: nullIfBlank(form.sourceUrl),
        observedAt: form.observedAt || null,
        confidenceLevel: form.confidenceLevel,
      });
      toast.success("Evidence captured");
      setForm(emptyForm);
      setShowForm(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not capture evidence");
    } finally {
      setBusy("");
    }
  }

  async function reviewEvidence() {
    if (!review || review.note.trim().length < 3) {
      toast.error("Add a review note");
      return;
    }
    setBusy(`review-${review.evidence.id}`);
    try {
      await commercialModelApi.reviewEvidence(review.evidence.id, review.decision, review.note.trim());
      toast.success(`Evidence marked ${review.decision}`);
      setReview(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review evidence");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-navy">Evidence register</h3>
          <p className="text-xs text-muted-foreground">Capture source-backed facts before modelling commercial value.</p>
        </div>
        <Button onClick={() => setShowForm(value => !value)} variant="outline">
          {showForm ? <X className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showForm ? "Cancel" : "Add evidence"}
        </Button>
      </div>

      {showForm && (
        <Card className="space-y-3 border-blue-200 bg-blue-50/50">
          <div className="flex items-center gap-2 font-semibold text-navy"><FilePlus2 className="h-4 w-4" />New evidence</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Evidence type" value={form.evidenceType} onChange={value => setForm(current => ({ ...current, evidenceType: value }))} options={FP_EVIDENCE_TYPES.map(value => ({ value, label: FP_EVIDENCE_TYPE_LABELS[value] }))} />
            <Select label="Product family" value={form.productFamily} onChange={value => setForm(current => ({ ...current, productFamily: value }))} options={[{ value: "" as const, label: "Account-wide" }, ...FP_PRODUCT_FAMILIES.map(value => ({ value, label: FP_PRODUCT_FAMILY_LABELS[value] }))]} />
            <Field label="Title" value={form.title} onChange={value => setForm(current => ({ ...current, title: value }))} placeholder="Example: 20-unit large-air fleet" />
            <Select label="Confidence" value={form.confidenceLevel} onChange={value => setForm(current => ({ ...current, confidenceLevel: value }))} options={FP_CONFIDENCE_LEVELS.map(value => ({ value, label: value }))} />
          </div>
          <Area label="Evidence summary" value={form.summary} onChange={value => setForm(current => ({ ...current, summary: value }))} placeholder="What is known, who confirmed it and how it affects the model?" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Source name" value={form.sourceName} onChange={value => setForm(current => ({ ...current, sourceName: value }))} placeholder="Customer discovery, C4C, CEA…" />
            <Field label="Source reference" value={form.sourceReference} onChange={value => setForm(current => ({ ...current, sourceReference: value }))} placeholder="Meeting note, order number, report…" />
            <Field label="Source URL" type="url" value={form.sourceUrl} onChange={value => setForm(current => ({ ...current, sourceUrl: value }))} />
            <Field label="Observed date" type="date" value={form.observedAt} onChange={value => setForm(current => ({ ...current, observedAt: value }))} />
          </div>
          <Button onClick={() => void saveEvidence()} disabled={busy === "create"} className="bg-blue-700 text-white">
            {busy === "create" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Save evidence
          </Button>
        </Card>
      )}

      {workspace.evidence.length === 0 ? (
        <Card className="text-sm text-muted-foreground">No evidence has been captured for this account.</Card>
      ) : workspace.evidence.map(item => (
        <Card key={item.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-semibold text-navy">{item.title}</h4>
                <StatusBadge status={item.status}>{item.status}</StatusBadge>
                <StatusBadge>{item.confidenceLevel}</StatusBadge>
              </div>
              <p className="mt-2 text-sm text-slate-700">{item.summary}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {FP_EVIDENCE_TYPE_LABELS[item.evidenceType]} · {item.productFamily ? FP_PRODUCT_FAMILY_LABELS[item.productFamily] : "Account-wide"} · {item.sourceName || "No source label"} · {formatCommercialDate(item.observedAt || item.createdAt)}
              </p>
              {item.reviewNote && <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-muted-foreground">Review: {item.reviewNote}</p>}
            </div>
            {isAdmin && (
              <button onClick={() => setReview({ evidence: item, decision: item.status === "verified" ? "superseded" : "verified", note: "" })} className="rounded border border-border px-2 py-1 text-[11px] font-semibold text-navy hover:bg-slate-50">
                Review
              </button>
            )}
          </div>
        </Card>
      ))}

      {review && (
        <Card className="space-y-3 border-gold/40 bg-gold/10">
          <h4 className="font-semibold text-navy">Review: {review.evidence.title}</h4>
          <Select label="Decision" value={review.decision} onChange={decision => setReview(current => current ? { ...current, decision } : null)} options={[
            { value: "verified", label: "Verify" },
            { value: "rejected", label: "Reject" },
            { value: "superseded", label: "Supersede" },
          ]} />
          <Area label="Review note" value={review.note} onChange={note => setReview(current => current ? { ...current, note } : null)} />
          <div className="flex gap-2">
            <Button onClick={() => void reviewEvidence()} disabled={busy.startsWith("review-")} className="bg-navy text-white">Save review</Button>
            <Button variant="outline" onClick={() => setReview(null)}>Cancel</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
