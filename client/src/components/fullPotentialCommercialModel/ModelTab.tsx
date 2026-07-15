import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Pencil, Plus, Save, Send, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  FP_CONFIDENCE_LEVELS,
  FP_PRODUCT_FAMILIES,
  FP_PRODUCT_FAMILY_LABELS,
  FP_ROUTE_LABELS,
  FP_ROUTE_VALUES,
  calculateModelLinePreview,
  commercialModelApi,
  formatAud,
  lineEvidenceIds,
  modelApprovalReadiness,
  modelLineValidationErrors,
  modelSubmissionReadiness,
  nullIfBlank,
  optionalNumber,
  type CommercialModelLine,
  type CommercialWorkspace,
  type FpConfidenceLevel,
  type FpProductFamily,
  type FpRouteToMarket,
  type ModelLineDraftPayload,
} from "@/lib/fullPotentialCommercialModel";
import { Area, Card, Field, Readiness, Select, StatusBadge } from "./Ui";

type Form = {
  productFamily: FpProductFamily;
  application: string;
  routeToMarket: FpRouteToMarket;
  currentSupplier: string;
  currentRevenueAud: string;
  knownAtlasFleetUnits: string;
  estimatedTotalFleetUnits: string;
  replacementCycleYears: string;
  annualReplacementUnits: string;
  averageSellingPriceAud: string;
  addressableSharePct: string;
  specialtyPotentialAud: string;
  replacementCycleSource: string;
  assumptions: string;
  confidenceLevel: FpConfidenceLevel;
  evidenceIds: number[];
};

function emptyForm(route: unknown): Form {
  return {
    productFamily: "portable_air_large",
    application: "",
    routeToMarket: FP_ROUTE_VALUES.includes(route as FpRouteToMarket) ? route as FpRouteToMarket : "manual_review",
    currentSupplier: "",
    currentRevenueAud: "",
    knownAtlasFleetUnits: "",
    estimatedTotalFleetUnits: "",
    replacementCycleYears: "",
    annualReplacementUnits: "",
    averageSellingPriceAud: "",
    addressableSharePct: "",
    specialtyPotentialAud: "",
    replacementCycleSource: "",
    assumptions: "",
    confidenceLevel: "medium",
    evidenceIds: [],
  };
}

function fromLine(line: CommercialModelLine, evidenceIds: number[]): Form {
  return {
    productFamily: line.productFamily,
    application: line.application,
    routeToMarket: line.routeToMarket,
    currentSupplier: line.currentSupplier ?? "",
    currentRevenueAud: String(line.currentRevenueAud ?? ""),
    knownAtlasFleetUnits: String(line.knownAtlasFleetUnits ?? ""),
    estimatedTotalFleetUnits: String(line.estimatedTotalFleetUnits ?? ""),
    replacementCycleYears: String(line.replacementCycleYears ?? ""),
    annualReplacementUnits: String(line.annualReplacementUnits ?? ""),
    averageSellingPriceAud: String(line.averageSellingPriceAud ?? ""),
    addressableSharePct: String(line.addressableSharePct ?? ""),
    specialtyPotentialAud: String(line.specialtyPotentialAud ?? ""),
    replacementCycleSource: line.replacementCycleSource ?? "",
    assumptions: typeof line.assumptions?.notes === "string" ? line.assumptions.notes : line.assumptions ? JSON.stringify(line.assumptions) : "",
    confidenceLevel: line.confidenceLevel,
    evidenceIds,
  };
}

export default function ModelTab({ workspace, isAdmin, refresh }: {
  workspace: CommercialWorkspace;
  isAdmin: boolean;
  refresh: () => Promise<void>;
}) {
  const latest = workspace.latestModel;
  const lines = latest ? workspace.lines.filter(line => line.modelId === latest.id) : [];
  const editable = latest?.status === "draft" || latest?.status === "returned";
  const availableEvidence = workspace.evidence.filter(item => !["rejected", "superseded"].includes(item.status));
  const [form, setForm] = useState<Form>(() => emptyForm(workspace.account.routeToMarket));
  const [showForm, setShowForm] = useState(false);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [assumptionsSummary, setAssumptionsSummary] = useState(latest?.assumptionsSummary ?? "");
  const [managerNote, setManagerNote] = useState("");
  const [busy, setBusy] = useState("");

  const preview = useMemo(() => calculateModelLinePreview(form), [form]);
  const submission = modelSubmissionReadiness(latest, workspace.lines, workspace.evidenceLinks);
  const approval = modelApprovalReadiness(latest, workspace.lines, workspace.evidenceLinks, workspace.evidence);

  useEffect(() => {
    setAssumptionsSummary(latest?.assumptionsSummary ?? "");
    setManagerNote("");
  }, [latest?.id, latest?.assumptionsSummary]);

  function resetForm() {
    setForm(emptyForm(workspace.account.routeToMarket));
    setShowForm(false);
    setEditingLineId(null);
  }

  async function perform(key: string, operation: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(key);
    try {
      await operation();
      toast.success(success);
      await refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Commercial model update failed");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function createDraft() {
    await perform("draft", () => commercialModelApi.createDraft(workspace.account.id), "Model draft ready");
  }

  function editLine(line: CommercialModelLine) {
    setEditingLineId(line.id);
    setForm(fromLine(line, lineEvidenceIds(line.id, workspace.evidenceLinks)));
    setShowForm(true);
  }

  function payload(): ModelLineDraftPayload | null {
    if (!latest) return null;
    const value: ModelLineDraftPayload = {
      modelId: latest.id,
      productFamily: form.productFamily,
      application: form.application.trim(),
      routeToMarket: form.routeToMarket,
      currentSupplier: nullIfBlank(form.currentSupplier),
      currentRevenueAud: nullIfBlank(form.currentRevenueAud),
      knownAtlasFleetUnits: optionalNumber(form.knownAtlasFleetUnits),
      estimatedTotalFleetUnits: optionalNumber(form.estimatedTotalFleetUnits),
      replacementCycleYears: nullIfBlank(form.replacementCycleYears),
      annualReplacementUnits: nullIfBlank(form.annualReplacementUnits),
      averageSellingPriceAud: nullIfBlank(form.averageSellingPriceAud),
      addressableSharePct: nullIfBlank(form.addressableSharePct),
      specialtyPotentialAud: nullIfBlank(form.specialtyPotentialAud),
      replacementCycleSource: nullIfBlank(form.replacementCycleSource),
      assumptions: form.assumptions.trim() ? { notes: form.assumptions.trim() } : null,
      confidenceLevel: form.confidenceLevel,
      evidenceIds: form.evidenceIds,
    };
    const errors = modelLineValidationErrors(value);
    if (preview.linePotentialAud <= 0) errors.push("Calculated line potential must be positive");
    if (errors.length) {
      toast.error(errors[0]);
      return null;
    }
    return value;
  }

  async function saveLine() {
    const value = payload();
    if (!value) return;
    const saved = await perform("line", () => commercialModelApi.upsertLine(value), editingLineId ? "Model line updated" : "Model line added");
    if (saved) resetForm();
  }

  async function removeLine(line: CommercialModelLine) {
    if (!window.confirm(`Remove ${FP_PRODUCT_FAMILY_LABELS[line.productFamily]} — ${line.application}?`)) return;
    await perform(`remove-${line.id}`, () => commercialModelApi.removeLine(line.id), "Model line removed");
  }

  async function submitModel() {
    if (!latest || assumptionsSummary.trim().length < 10) {
      toast.error("Add a meaningful assumptions summary");
      return;
    }
    await perform("submit", () => commercialModelApi.submit(latest.id, assumptionsSummary.trim()), "Model submitted for manager review");
  }

  async function reviewModel(decision: "approve" | "return") {
    if (!latest || managerNote.trim().length < 3) {
      toast.error("Add a manager review note");
      return;
    }
    const reviewed = await perform(`model-${decision}`, () => commercialModelApi.reviewModel(latest.id, decision, managerNote.trim()), decision === "approve" ? "Model approved" : "Model returned");
    if (reviewed) setManagerNote("");
  }

  if (!latest) {
    return (
      <Card className="text-center">
        <h3 className="font-bold text-navy">No model version yet</h3>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">Create a draft after the account has enough evidence to support a commercial hypothesis.</p>
        <Button onClick={() => void createDraft()} disabled={busy === "draft"} className="mt-4 bg-navy text-white">
          {busy === "draft" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create model draft
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><h3 className="font-bold text-navy">Model version {latest.versionNumber}</h3><StatusBadge status={latest.status}>{latest.status}</StatusBadge></div>
            <p className="mt-1 text-xs text-muted-foreground">Method {latest.methodologyVersion} · confidence {latest.confidenceLevel}</p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-right text-xs">
            <span><small className="block uppercase text-muted-foreground">Current</small><strong>{formatAud(latest.currentRevenueAud)}</strong></span>
            <span><small className="block uppercase text-muted-foreground">Potential</small><strong>{formatAud(latest.totalPotentialAud)}</strong></span>
            <span><small className="block uppercase text-muted-foreground">Remaining</small><strong>{formatAud(latest.remainingPotentialAud)}</strong></span>
          </div>
        </div>
      </Card>

      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => setShowForm(value => !value)} variant="outline">
            {showForm ? <X className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}{showForm ? "Close editor" : "Add product-family line"}
          </Button>
        </div>
      )}

      {showForm && editable && (
        <Card className="space-y-3 border-blue-200 bg-blue-50/50">
          <h4 className="font-semibold text-navy">{editingLineId ? "Edit model line" : "New model line"}</h4>
          {editingLineId && <p className="text-xs text-muted-foreground">Product family and application identify the stored line and are locked while editing.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Product family" value={form.productFamily} disabled={!!editingLineId} onChange={value => setForm(current => ({ ...current, productFamily: value }))} options={FP_PRODUCT_FAMILIES.map(value => ({ value, label: FP_PRODUCT_FAMILY_LABELS[value] }))} />
            <Field label="Application" value={form.application} disabled={!!editingLineId} onChange={value => setForm(current => ({ ...current, application: value }))} placeholder="Example: large-air rental fleet" />
            <Select label="Route to market" value={form.routeToMarket} onChange={value => setForm(current => ({ ...current, routeToMarket: value }))} options={FP_ROUTE_VALUES.map(value => ({ value, label: FP_ROUTE_LABELS[value] }))} />
            <Field label="Current supplier" value={form.currentSupplier} onChange={value => setForm(current => ({ ...current, currentSupplier: value }))} />
            <Field label="Current revenue AUD" type="number" value={form.currentRevenueAud} onChange={value => setForm(current => ({ ...current, currentRevenueAud: value }))} />
            <Field label="Known Atlas fleet units" type="number" value={form.knownAtlasFleetUnits} onChange={value => setForm(current => ({ ...current, knownAtlasFleetUnits: value }))} />
            <Field label="Estimated total fleet units" type="number" value={form.estimatedTotalFleetUnits} onChange={value => setForm(current => ({ ...current, estimatedTotalFleetUnits: value }))} />
            <Field label="Replacement cycle years" type="number" value={form.replacementCycleYears} onChange={value => setForm(current => ({ ...current, replacementCycleYears: value }))} />
            <Field label="Annual replacements override" type="number" value={form.annualReplacementUnits} onChange={value => setForm(current => ({ ...current, annualReplacementUnits: value }))} />
            <Field label="Average selling price AUD" type="number" value={form.averageSellingPriceAud} onChange={value => setForm(current => ({ ...current, averageSellingPriceAud: value }))} />
            <Field label="Addressable share %" type="number" value={form.addressableSharePct} onChange={value => setForm(current => ({ ...current, addressableSharePct: value }))} />
            <Field label="Specialty potential AUD" type="number" value={form.specialtyPotentialAud} onChange={value => setForm(current => ({ ...current, specialtyPotentialAud: value }))} />
            <Select label="Confidence" value={form.confidenceLevel} onChange={value => setForm(current => ({ ...current, confidenceLevel: value }))} options={FP_CONFIDENCE_LEVELS.map(value => ({ value, label: value }))} />
          </div>
          <Field label="Replacement-cycle source" value={form.replacementCycleSource} onChange={value => setForm(current => ({ ...current, replacementCycleSource: value }))} />
          <Area label="Assumptions" value={form.assumptions} onChange={value => setForm(current => ({ ...current, assumptions: value }))} />
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Linked evidence</div>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-border bg-background p-3">
              {availableEvidence.length === 0 ? <p className="text-xs text-amber-700">Capture evidence first.</p> : availableEvidence.map(item => (
                <label key={item.id} className="flex gap-2 text-xs">
                  <input type="checkbox" checked={form.evidenceIds.includes(item.id)} onChange={event => setForm(current => ({ ...current, evidenceIds: event.target.checked ? [...current.evidenceIds, item.id] : current.evidenceIds.filter(id => id !== item.id) }))} />
                  <span><strong>{item.title}</strong> · {item.status}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Annual units", preview.annualReplacementUnits ? preview.annualReplacementUnits.toFixed(2) : "—"],
              ["Equipment", formatAud(preview.equipmentPotentialAud)],
              ["Specialty", formatAud(preview.specialtyPotentialAud)],
              ["Line potential", formatAud(preview.linePotentialAud)],
            ].map(([label, value]) => <div key={label} className="rounded-lg bg-white p-3"><div className="text-[10px] uppercase text-muted-foreground">{label}</div><div className="font-bold text-navy">{value}</div></div>)}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void saveLine()} disabled={busy === "line" || availableEvidence.length === 0} className="bg-blue-700 text-white"><Save className="mr-2 h-4 w-4" />Save line</Button>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
          </div>
        </Card>
      )}

      {lines.length === 0 ? <Card className="text-sm text-muted-foreground">No product-family lines.</Card> : lines.map(line => (
        <Card key={line.id}>
          <div className="flex justify-between gap-3">
            <div><h4 className="font-semibold text-navy">{FP_PRODUCT_FAMILY_LABELS[line.productFamily]}</h4><p className="text-xs text-muted-foreground">{line.application} · {FP_ROUTE_LABELS[line.routeToMarket]} · {line.confidenceLevel}</p></div>
            <strong className="text-navy">{formatAud(line.linePotentialAud)}</strong>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
            <span>Fleet: <strong>{line.estimatedTotalFleetUnits ?? "—"}</strong></span><span>Cycle: <strong>{line.replacementCycleYears ?? "—"}</strong></span><span>Share: <strong>{line.addressableSharePct ? `${line.addressableSharePct}%` : "—"}</strong></span><span>Evidence: <strong>{lineEvidenceIds(line.id, workspace.evidenceLinks).length}</strong></span>
          </div>
          {editable && <div className="mt-3 flex gap-2"><button onClick={() => editLine(line)} className="inline-flex items-center rounded border px-2 py-1 text-[11px] font-semibold"><Pencil className="mr-1 h-3 w-3" />Edit</button><button onClick={() => void removeLine(line)} className="inline-flex items-center rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700"><Trash2 className="mr-1 h-3 w-3" />Remove</button></div>}
        </Card>
      ))}

      {editable && (
        <Card className="space-y-3">
          <Readiness title="Submission readiness" issues={submission.issues} />
          <Area label="Assumptions summary" value={assumptionsSummary} onChange={setAssumptionsSummary} rows={4} />
          <Button onClick={() => void submitModel()} disabled={!submission.ready || busy === "submit"} className="bg-navy text-white"><Send className="mr-2 h-4 w-4" />Submit for review</Button>
        </Card>
      )}

      {latest.status === "submitted" && (
        <Card className="space-y-3 border-gold/30 bg-gold/10">
          <Readiness title="Approval readiness" issues={approval.issues} />
          {isAdmin ? (
            <>
              <Area label="Manager review note" value={managerNote} onChange={setManagerNote} />
              <div className="flex gap-2"><Button onClick={() => void reviewModel("approve")} disabled={!approval.ready || busy.startsWith("model-")} className="bg-emerald-700 text-white"><Check className="mr-2 h-4 w-4" />Approve</Button><Button variant="outline" onClick={() => void reviewModel("return")} disabled={busy.startsWith("model-")}><Undo2 className="mr-2 h-4 w-4" />Return</Button></div>
            </>
          ) : <p className="text-xs text-muted-foreground">Waiting for manager review.</p>}
        </Card>
      )}
    </div>
  );
}
