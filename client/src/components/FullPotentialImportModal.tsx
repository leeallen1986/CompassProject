import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

type ImportSummary = {
  dryRun: boolean;
  fileName: string;
  selectedSheet: string;
  workbookVersion?: string;
  rowsParsed: number;
  rowsProcessed: number;
  createdAccounts: number;
  updatedAccounts: number;
  aliasesCreated: number;
  aliasesSkippedDuplicate: number;
  skippedRows: number;
  errorCount: number;
  errors: { rowNumber: number; reason: string; raw?: Record<string, unknown> }[];
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function SummaryCard({ title, summary }: { title: string; summary: ImportSummary }) {
  return (
    <div className="rounded-lg border border-border bg-slate-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        {summary.errorCount === 0 ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
        <h3 className="font-bold text-navy text-sm">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div><span className="text-muted-foreground">Sheet</span><div className="font-semibold text-navy break-words">{summary.selectedSheet}</div></div>
        <div><span className="text-muted-foreground">Version</span><div className="font-semibold text-navy">{summary.workbookVersion || "—"}</div></div>
        <div><span className="text-muted-foreground">Rows parsed</span><div className="font-semibold text-navy">{summary.rowsParsed}</div></div>
        <div><span className="text-muted-foreground">Processed</span><div className="font-semibold text-navy">{summary.rowsProcessed}</div></div>
        <div><span className="text-muted-foreground">Created</span><div className="font-semibold text-navy">{summary.createdAccounts}</div></div>
        <div><span className="text-muted-foreground">Updated</span><div className="font-semibold text-navy">{summary.updatedAccounts}</div></div>
        <div><span className="text-muted-foreground">Aliases</span><div className="font-semibold text-navy">{summary.aliasesCreated}</div></div>
        <div><span className="text-muted-foreground">Alias dupes</span><div className="font-semibold text-navy">{summary.aliasesSkippedDuplicate}</div></div>
        <div><span className="text-muted-foreground">Skipped</span><div className="font-semibold text-navy">{summary.skippedRows}</div></div>
        <div><span className="text-muted-foreground">Errors</span><div className="font-semibold text-navy">{summary.errorCount}</div></div>
      </div>
      {summary.errors.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 max-h-40 overflow-y-auto">
          <div className="text-xs font-bold text-amber-900 mb-2">First row errors</div>
          <ul className="space-y-1 text-xs text-amber-900">
            {summary.errors.slice(0, 10).map((error, index) => (
              <li key={`${error.rowNumber}-${index}`}>Row {error.rowNumber}: {error.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function FullPotentialImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [file, setFile] = useState<File | null>(null);
  const [sourceWorkbookVersion, setSourceWorkbookVersion] = useState("portable-air-v2.4-ui");
  const [clearBlankValues, setClearBlankValues] = useState(false);
  const [dryRunSummary, setDryRunSummary] = useState<ImportSummary | null>(null);
  const [liveSummary, setLiveSummary] = useState<ImportSummary | null>(null);
  const [isReading, setIsReading] = useState(false);

  const importMutation = trpc.fullPotential.import.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.fullPotential.list.invalidate(),
        utils.fullPotential.stats.invalidate(),
        utils.fullPotential.filterOptions.invalidate(),
        utils.fullPotential.importHistory.invalidate(),
      ]);
    },
  });

  if (!open) return null;

  const isAdmin = user?.role === "admin";
  const isBusy = isReading || importMutation.isPending;
  const canCommit = !!dryRunSummary && dryRunSummary.errorCount === 0 && dryRunSummary.rowsProcessed > 0 && !isBusy;

  async function runImport(dryRun: boolean) {
    if (!file) {
      toast.error("Choose an XLSX, XLS or CSV file first");
      return;
    }

    setIsReading(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const summary = await importMutation.mutateAsync({
        fileName: file.name,
        fileBase64,
        sourceWorkbookVersion: sourceWorkbookVersion || undefined,
        dryRun,
        clearBlankValues,
      }) as ImportSummary;

      if (dryRun) {
        setDryRunSummary(summary);
        setLiveSummary(null);
        if (summary.errorCount === 0) toast.success(`Dry-run clean: ${summary.rowsProcessed} Portable Air rows processed`);
        else toast.warning(`Dry-run finished with ${summary.errorCount} errors`);
      } else {
        setLiveSummary(summary);
        toast.success(`Portable Air import complete: ${summary.rowsProcessed} rows processed`);
      }
    } catch (error) {
      toast.error((error as Error).message || "Import failed");
    } finally {
      setIsReading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-card border border-border shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-start justify-between gap-4 z-10">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-1">
              <Upload className="w-4 h-4" /> Admin import
            </div>
            <h2 className="text-lg font-bold text-navy">Portable Air Full Potential workbook import</h2>
            <p className="text-xs text-muted-foreground mt-1">Run dry-run first. Live import writes Portable Air accounts, aliases and the import audit row only.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {!isAdmin && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              Portable Air Full Potential imports are admin-only.
            </div>
          )}

          <div className="grid md:grid-cols-[1fr_220px] gap-4">
            <label className="rounded-lg border border-dashed border-border bg-slate-50/50 p-4 cursor-pointer hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                <div>
                  <div className="font-semibold text-navy">{file ? file.name : "Choose XLSX, XLS or CSV"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Workbook files are uploaded to the admin endpoint only; not committed to GitHub.</div>
                </div>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                disabled={!isAdmin || isBusy}
                onChange={event => {
                  const selected = event.target.files?.[0] ?? null;
                  setFile(selected);
                  setDryRunSummary(null);
                  setLiveSummary(null);
                }}
              />
            </label>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">Workbook version</label>
                <input
                  value={sourceWorkbookVersion}
                  onChange={event => setSourceWorkbookVersion(event.target.value)}
                  disabled={!isAdmin || isBusy}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                />
              </div>
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={clearBlankValues}
                  onChange={event => setClearBlankValues(event.target.checked)}
                  disabled={!isAdmin || isBusy}
                  className="mt-0.5"
                />
                Allow blank spreadsheet cells to clear existing values. Leave off unless intentionally replacing data.
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => runImport(true)}
              disabled={!isAdmin || !file || isBusy}
              className="bg-navy text-white hover:bg-navy-light"
            >
              {isBusy && importMutation.variables?.dryRun !== false ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Run dry-run
            </Button>
            <Button
              onClick={() => runImport(false)}
              disabled={!isAdmin || !canCommit}
              className="bg-gold text-navy hover:bg-gold/90"
            >
              {isBusy && importMutation.variables?.dryRun === false ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              Commit import
            </Button>
            <span className="text-xs text-muted-foreground">Commit is enabled only after a clean dry-run.</span>
          </div>

          {dryRunSummary && <SummaryCard title="Dry-run summary" summary={dryRunSummary} />}
          {liveSummary && <SummaryCard title="Committed import summary" summary={liveSummary} />}
        </div>
      </div>
    </div>
  );
}
