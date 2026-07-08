import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

// ── Types mirroring server/routers/fullPotential.ts ──────────────────────────

type SignalImportRowError = {
  rowNumber: number;
  field?: string;
  message: string;
};

type SignalImportPreviewRow = {
  rowNumber: number;
  signalTitle: string;
  accountId: number | null;
  accountMatchReason: string | null;
  signalDate: string | null;
  confidenceLevel: string | null;
  urgency: string | null;
  status: string | null;
};

type SignalImportSummary = {
  dryRun: boolean;
  workbookVersion: string | null;
  rowsParsed: number;
  rowsValid: number;
  createdSignals: number;
  skippedDuplicates: number;
  linkedAccounts: number;
  unlinkedSignals: number;
  errors: SignalImportRowError[];
  preview: SignalImportPreviewRow[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

const URGENCY_BADGE: Record<string, string> = {
  hot: "bg-red-100 text-red-700 border-red-200",
  warm: "bg-amber-100 text-amber-700 border-amber-200",
  cold: "bg-slate-100 text-slate-600 border-slate-200",
  unknown: "bg-slate-100 text-slate-500 border-slate-200",
};

const CONFIDENCE_BADGE: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700 border-emerald-200",
  medium: "bg-blue-100 text-blue-700 border-blue-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
  unknown: "bg-slate-100 text-slate-500 border-slate-200",
};

const MATCH_REASON_LABEL: Record<string, string> = {
  account_id: "ID",
  stable_key: "Key",
  canonical_name: "Canonical",
  display_name: "Display",
  alias: "Alias",
  unlinked: "Unlinked",
};

function SmallBadge({ value, map }: { value: string | null | undefined; map: Record<string, string> }) {
  const cls = map[value ?? "unknown"] ?? "bg-slate-100 text-slate-500 border-slate-200";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${cls}`}>
      {value ?? "—"}
    </span>
  );
}

// ── Dry-run summary card ──────────────────────────────────────────────────────

function DryRunSummaryCard({ summary }: { summary: SignalImportSummary }) {
  const isClean = summary.errors.length === 0;
  return (
    <div className="rounded-lg border border-border bg-slate-50/60 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        {isClean
          ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          : <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />}
        <h3 className="font-bold text-navy text-sm">
          {isClean ? "Dry-run clean — ready to commit" : `Dry-run finished with ${summary.errors.length} error${summary.errors.length !== 1 ? "s" : ""}`}
        </h3>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground block">Rows parsed</span>
          <span className="font-semibold text-navy">{summary.rowsParsed}</span>
        </div>
        <div>
          <span className="text-muted-foreground block">Valid rows</span>
          <span className="font-semibold text-navy">{summary.rowsValid}</span>
        </div>
        <div>
          <span className="text-muted-foreground block">Linked accounts</span>
          <span className="font-semibold text-emerald-700">{summary.linkedAccounts}</span>
        </div>
        <div>
          <span className="text-muted-foreground block">Unlinked signals</span>
          <span className="font-semibold text-amber-700">{summary.unlinkedSignals}</span>
        </div>
      </div>

      {/* Errors */}
      {summary.errors.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 max-h-36 overflow-y-auto">
          <div className="text-xs font-bold text-amber-900 mb-2">Row errors (first 10)</div>
          <ul className="space-y-1 text-xs text-amber-900">
            {summary.errors.slice(0, 10).map((error, i) => (
              <li key={`${error.rowNumber}-${i}`}>
                Row {error.rowNumber}{error.field ? ` [${error.field}]` : ""}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Preview table */}
      {summary.preview.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">
            Preview (up to {summary.preview.length} row{summary.preview.length !== 1 ? "s" : ""})
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider whitespace-nowrap">#</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Signal title</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider whitespace-nowrap">Account</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider whitespace-nowrap">Match</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider whitespace-nowrap">Date</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider whitespace-nowrap">Confidence</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider whitespace-nowrap">Urgency</th>
                </tr>
              </thead>
              <tbody>
                {summary.preview.map((row, i) => (
                  <tr
                    key={`${row.rowNumber}-${i}`}
                    className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}
                  >
                    <td className="px-3 py-2 text-muted-foreground">{row.rowNumber}</td>
                    <td className="px-3 py-2 font-medium text-navy max-w-[220px] truncate" title={row.signalTitle}>
                      {row.signalTitle}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {row.accountId ? `#${row.accountId}` : <span className="text-amber-600 font-medium">unlinked</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <SmallBadge
                        value={row.accountMatchReason ? (MATCH_REASON_LABEL[row.accountMatchReason] ?? row.accountMatchReason) : null}
                        map={{}}
                      />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {row.signalDate ?? "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <SmallBadge value={row.confidenceLevel} map={CONFIDENCE_BADGE} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <SmallBadge value={row.urgency} map={URGENCY_BADGE} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary.rowsValid > summary.preview.length && (
            <p className="text-[11px] text-muted-foreground mt-1.5 italic">
              Preview capped at {summary.preview.length} rows. All {summary.rowsValid} valid rows will be committed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Commit summary card ───────────────────────────────────────────────────────

function CommitSummaryCard({ summary }: { summary: SignalImportSummary }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <h3 className="font-bold text-emerald-900 text-sm">Import committed</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <span className="text-emerald-700/70 block">Signals created</span>
          <span className="font-bold text-emerald-900 text-base">{summary.createdSignals}</span>
        </div>
        <div>
          <span className="text-emerald-700/70 block">Linked accounts</span>
          <span className="font-semibold text-emerald-900">{summary.linkedAccounts}</span>
        </div>
        <div>
          <span className="text-emerald-700/70 block">Unlinked</span>
          <span className="font-semibold text-emerald-900">{summary.unlinkedSignals}</span>
        </div>
        <div>
          <span className="text-emerald-700/70 block">Duplicates skipped</span>
          <span className="font-semibold text-emerald-900">{summary.skippedDuplicates}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function FullPotentialSignalImportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [file, setFile] = useState<File | null>(null);
  const [dryRunSummary, setDryRunSummary] = useState<SignalImportSummary | null>(null);
  const [commitSummary, setCommitSummary] = useState<SignalImportSummary | null>(null);
  const [isReading, setIsReading] = useState(false);

  const importMutation = trpc.fullPotential.importSignals.useMutation();

  if (!open) return null;

  const isAdmin = user?.role === "admin";
  const isBusy = isReading || importMutation.isPending;
  const canCommit =
    !!dryRunSummary &&
    dryRunSummary.errors.length === 0 &&
    dryRunSummary.rowsValid > 0 &&
    !commitSummary &&
    !isBusy;

  async function runImport(dryRun: boolean) {
    if (!file) {
      toast.error("Choose an XLSX or CSV file first");
      return;
    }
    setIsReading(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const summary = (await importMutation.mutateAsync({
        fileName: file.name,
        fileBase64,
        dryRun,
      })) as SignalImportSummary;

      if (dryRun) {
        setDryRunSummary(summary);
        setCommitSummary(null);
        if (summary.errors.length === 0) {
          toast.success(
            `Dry-run clean: ${summary.rowsValid} signal row${summary.rowsValid !== 1 ? "s" : ""} ready to commit`
          );
        } else {
          toast.warning(`Dry-run finished with ${summary.errors.length} error${summary.errors.length !== 1 ? "s" : ""}`);
        }
      } else {
        setCommitSummary(summary);
        // Invalidate all signal-related caches so the FullPotentialDetailDrawer
        // and account table pick up the new signals immediately.
        await Promise.all([
          utils.fullPotential.matchedSignalsForAccount.invalidate(),
          utils.fullPotential.list.invalidate(),
          utils.fullPotential.stats.invalidate(),
        ]);
        toast.success(
          `Signal import complete: ${summary.createdSignals} signal${summary.createdSignals !== 1 ? "s" : ""} created`
        );
      }
    } catch (error) {
      toast.error((error as Error).message || "Import failed");
    } finally {
      setIsReading(false);
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setDryRunSummary(null);
    setCommitSummary(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-card border border-border shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-start justify-between gap-4 z-10">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-1">
              <Zap className="w-4 h-4 text-gold" /> Admin import
            </div>
            <h2 className="text-lg font-bold text-navy">Import Portable Air signals</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Upload an XLSX or CSV of market signals. Run dry-run first — commit is enabled only after a clean dry-run.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Admin guard */}
          {!isAdmin && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              Signal imports are admin-only.
            </div>
          )}

          {/* File picker */}
          <label className="rounded-lg border border-dashed border-border bg-slate-50/50 p-4 cursor-pointer hover:bg-slate-50 transition-colors block">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-8 h-8 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-navy truncate">
                  {file ? file.name : "Choose XLSX or CSV"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Required columns: signalTitle, signalType, signalDate, sourceName, confidenceLevel, urgency, status.
                  Optional: accountId, stableKey, accountName, canonicalName, displayName, aliasName.
                </div>
              </div>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={!isAdmin || isBusy}
              onChange={handleFileChange}
            />
          </label>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => runImport(true)}
              disabled={!isAdmin || !file || isBusy}
              className="bg-navy text-white hover:bg-navy-light"
            >
              {isBusy && importMutation.variables?.dryRun !== false ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Run dry-run
            </Button>
            <Button
              onClick={() => runImport(false)}
              disabled={!isAdmin || !canCommit}
              className="bg-gold text-navy hover:bg-gold/90"
            >
              {isBusy && importMutation.variables?.dryRun === false ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              Commit import
            </Button>
            <span className="text-xs text-muted-foreground">
              Commit is enabled only after a clean dry-run with no errors.
            </span>
          </div>

          {/* Results */}
          {dryRunSummary && !commitSummary && (
            <DryRunSummaryCard summary={dryRunSummary} />
          )}
          {commitSummary && (
            <CommitSummaryCard summary={commitSummary} />
          )}
        </div>
      </div>
    </div>
  );
}
