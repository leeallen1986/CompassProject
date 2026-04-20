/**
 * StagingReview.tsx
 *
 * Stage 1 review UI — shown after a file is staged but before it is committed
 * to campaignContacts.
 *
 * Props:
 *   campaignId    — target campaign
 *   batchId       — UUID returned by campaign.stageUpload
 *   stageSummary  — { fileType, totalRows, cleanRows, reviewRows, skippedRows }
 *   onCommit      — called with the importResult after successful commit
 *   onDiscard     — called when the user discards the batch
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp,
  Loader2, Eye, EyeOff, RefreshCw
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StageSummary {
  fileType: string;
  totalRows: number;
  cleanRows: number;
  reviewRows: number;
  skippedRows: number;
}

interface StagingReviewProps {
  campaignId: number;
  batchId: string;
  stageSummary: StageSummary;
  onCommit: (result: { imported: number; excluded: number }) => void;
  onDiscard: () => void;
}

// ─── Flag badge colours ───────────────────────────────────────────────────────

const FLAG_COLOURS: Record<string, string> = {
  no_name: "bg-red-100 text-red-700",
  no_company: "bg-orange-100 text-orange-700",
  no_email: "bg-yellow-100 text-yellow-700",
  duplicate_email: "bg-purple-100 text-purple-700",
  duplicate_name_company: "bg-purple-100 text-purple-700",
  invalid_email: "bg-red-100 text-red-700",
  suspicious_email: "bg-orange-100 text-orange-700",
  generic_email: "bg-yellow-100 text-yellow-700",
  name_parse_ambiguous: "bg-blue-100 text-blue-700",
  title_excluded: "bg-gray-100 text-gray-600",
  title_generic: "bg-gray-100 text-gray-600",
  company_generic: "bg-gray-100 text-gray-600",
  linkedin_invalid: "bg-gray-100 text-gray-600",
};

function FlagBadge({ flag }: { flag: string }) {
  const cls = FLAG_COLOURS[flag] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1 ${cls}`}>
      {flag.replace(/_/g, " ")}
    </span>
  );
}

// ─── Row status icon ─────────────────────────────────────────────────────────

function StatusIcon({ status, classification }: { status: string; classification: string }) {
  if (status === "approved") return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
  if (status === "rejected") return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
  if (classification === "clean") return <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />;
  return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
}

// ─── Single staged row ────────────────────────────────────────────────────────

function StagedRow({ row, onUpdate }: {
  row: any;
  onUpdate: (id: number, status: "approved" | "rejected") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const flags: string[] = Array.isArray(row.reviewFlags) ? row.reviewFlags : [];
  const displayName = [row.firstName, row.lastName].filter(Boolean).join(" ") || row.fullNameRaw || "—";
  const isPending = row.reviewStatus === "pending";

  return (
    <div className={`border rounded-lg mb-2 transition-colors ${
      row.reviewStatus === "rejected" ? "border-red-200 bg-red-50/30 opacity-60" :
      row.reviewStatus === "approved" ? "border-green-200 bg-green-50/20" :
      row.classification === "clean" ? "border-green-100 bg-green-50/10" :
      "border-amber-200 bg-amber-50/20"
    }`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <StatusIcon status={row.reviewStatus} classification={row.classification} />

        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">{displayName}</span>
            {row.title && <span className="text-xs text-muted-foreground truncate">{row.title}</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {row.company && <span className="text-xs text-muted-foreground">{row.companyCanonical || row.company}</span>}
            {row.email && <span className="text-xs text-blue-600">{row.email}</span>}
          </div>
        </div>

        {/* Flags */}
        <div className="hidden sm:flex flex-wrap gap-0.5 max-w-[200px]">
          {flags.slice(0, 3).map(f => <FlagBadge key={f} flag={f} />)}
          {flags.length > 3 && <span className="text-[10px] text-muted-foreground">+{flags.length - 3}</span>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isPending && (
            <>
              <button
                onClick={() => onUpdate(row.id, "approved")}
                className="p-1 rounded hover:bg-green-100 text-green-600 transition-colors"
                title="Approve"
              >
                <CheckCircle2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => onUpdate(row.id, "rejected")}
                className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
                title="Reject"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </>
          )}
          {!isPending && (
            <button
              onClick={() => onUpdate(row.id, "pending" as any)}
              className="p-1 rounded hover:bg-gray-100 text-muted-foreground transition-colors"
              title="Reset to pending"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1 rounded hover:bg-gray-100 text-muted-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 text-xs space-y-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-muted-foreground">
            {row.firstName && <span><b>First:</b> {row.firstName}</span>}
            {row.lastName && <span><b>Last:</b> {row.lastName}</span>}
            {row.fullNameRaw && <span><b>Raw name:</b> {row.fullNameRaw}</span>}
            {row.titleRaw && row.titleRaw !== row.title && <span><b>Raw title:</b> {row.titleRaw}</span>}
            {row.companyRaw && row.companyRaw !== row.company && <span><b>Raw company:</b> {row.companyRaw}</span>}
            {row.domain && <span><b>Domain:</b> {row.domain}</span>}
            {row.phone && <span><b>Phone:</b> {row.phone}</span>}
            {row.mobile && <span><b>Mobile:</b> {row.mobile}</span>}
            {row.linkedin && <span><b>LinkedIn:</b> <a href={row.linkedin} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">link</a></span>}
            {row.notes && <span className="col-span-2"><b>Notes:</b> {row.notes}</span>}
            <span><b>Row #:</b> {row.sourceRow}</span>
            <span><b>File type:</b> {row.uploadFileType}</span>
          </div>
          {flags.length > 0 && (
            <div className="mt-1">
              <b className="text-foreground">Review flags:</b>{" "}
              {flags.map(f => <FlagBadge key={f} flag={f} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StagingReview({
  campaignId, batchId, stageSummary, onCommit, onDiscard,
}: StagingReviewProps) {
  const [showClean, setShowClean] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const batchQuery = trpc.campaign.getStagingBatch.useQuery({ batchId });
  const updateRow = trpc.campaign.updateStagedRow.useMutation({
    onSuccess: () => batchQuery.refetch(),
  });
  const commitBatch = trpc.campaign.commitStagingBatch.useMutation();
  const discardBatch = trpc.campaign.discardStagingBatch.useMutation();

  const rows = batchQuery.data ?? [];

  const reviewRows = useMemo(() => rows.filter(r => r.classification !== "clean"), [rows]);
  const cleanRows = useMemo(() => rows.filter(r => r.classification === "clean"), [rows]);

  const filteredRows = useMemo(() => {
    const base = showClean ? rows : reviewRows;
    if (filter === "all") return base;
    return base.filter(r => r.reviewStatus === filter);
  }, [rows, reviewRows, showClean, filter]);

  const pendingCount = rows.filter(r => r.reviewStatus === "pending" && r.classification !== "clean").length;
  const approvedCount = rows.filter(r => r.reviewStatus === "approved").length;
  const rejectedCount = rows.filter(r => r.reviewStatus === "rejected").length;

  const handleUpdate = (id: number, status: "approved" | "rejected" | "pending") => {
    updateRow.mutate({ stagedId: id, reviewStatus: status as any });
  };

  const handleApproveAll = () => {
    const pending = rows.filter(r => r.reviewStatus === "pending");
    pending.forEach(r => updateRow.mutate({ stagedId: r.id, reviewStatus: "approved" }));
  };

  const handleCommit = async () => {
    setIsCommitting(true);
    try {
      const result = await commitBatch.mutateAsync({ campaignId, batchId });
      toast.success(`${result.imported} contacts committed to campaign`);
      onCommit({ imported: result.imported, excluded: result.excluded });
    } catch (err) {
      toast.error("Commit failed: " + (err as Error).message);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleDiscard = async () => {
    if (!confirm("Discard this entire batch? This cannot be undone.")) return;
    setIsDiscarding(true);
    try {
      await discardBatch.mutateAsync({ batchId });
      toast.info("Batch discarded");
      onDiscard();
    } catch (err) {
      toast.error("Discard failed: " + (err as Error).message);
    } finally {
      setIsDiscarding(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          Stage 1 Ingestion Summary — {stageSummary.fileType.replace(/_/g, " ")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{stageSummary.totalRows}</div>
            <div className="text-xs text-muted-foreground">Total rows</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{stageSummary.cleanRows}</div>
            <div className="text-xs text-muted-foreground">Clean</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-500">{stageSummary.reviewRows}</div>
            <div className="text-xs text-muted-foreground">Need review</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-muted-foreground">{stageSummary.skippedRows}</div>
            <div className="text-xs text-muted-foreground">Skipped</div>
          </div>
        </div>
      </div>

      {/* Review status bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <span className="text-muted-foreground">{approvedCount} approved</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-muted-foreground">{pendingCount} pending review</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <XCircle className="w-4 h-4 text-red-400" />
          <span className="text-muted-foreground">{rejectedCount} rejected</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {pendingCount > 0 && (
            <Button variant="outline" size="sm" onClick={handleApproveAll}>
              Approve all pending
            </Button>
          )}
          <button
            onClick={() => setShowClean(s => !s)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showClean ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showClean ? "Hide" : "Show"} {cleanRows.length} clean rows
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border pb-1">
        {(["all", "pending", "approved", "rejected"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs font-medium rounded-t transition-colors ${
              filter === f
                ? "bg-card border border-b-card border-border text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Row list */}
      <div className="max-h-[420px] overflow-y-auto pr-1">
        {batchQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No rows match this filter
          </div>
        ) : (
          filteredRows.map(row => (
            <StagedRow key={row.id} row={row} onUpdate={handleUpdate} />
          ))
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDiscard}
          disabled={isDiscarding || isCommitting}
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          {isDiscarding ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Discard batch
        </Button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {approvedCount + cleanRows.length} rows will be committed
          </span>
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={isCommitting || isDiscarding || (approvedCount + cleanRows.length === 0)}
          >
            {isCommitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Commit to campaign
          </Button>
        </div>
      </div>
    </div>
  );
}
