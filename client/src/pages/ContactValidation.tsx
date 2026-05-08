/*
 * Contact Validation Page — Scoped Rollout
 *
 * Tab order:
 *   1. Demoted (13 hot/warm projects that lost send_ready_contact status)
 *   2. Top-20 (hot/warm projects for second-wave validation)
 *   3. Source Report (candidates / accepted / rejected / promoted by source)
 *
 * Per-project controls:
 *   - Generate slate (scoped to this project)
 *   - Hunter verify all named_unverified contacts
 *   - Project-level gates: Primary acceptable / Backup acceptable / Digest-safe
 *
 * Global "Generate All Slates" is intentionally removed.
 * Digest stays in review-first mode until gates are confirmed.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import {
  CheckCircle2, XCircle, AlertTriangle, UserX, ArrowDownCircle,
  RefreshCw, Zap, Shield, ShieldCheck, ShieldAlert,
  ChevronDown, ChevronUp, ExternalLink, Mail, Building2,
  Flame, TrendingUp, BarChart3, Users, ClipboardCheck,
  CheckSquare, Square, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

// ── Types ──

type TrustTier = "send_ready" | "named_unverified" | "llm_inferred";
type ValidationAction = "accept" | "reject" | "wrong_company" | "wrong_role" | "backup_only";

interface SlotSnapshot {
  contactId: number;
  name: string;
  title: string;
  company: string;
  email: string | null;
  linkedin: string | null;
  enrichmentSource: string;
  contactTrustTier: TrustTier;
  confidenceScore: string;
  roleRelevance: string;
  roleLane: string;
}

interface ProjectGate {
  primaryAcceptable: boolean;
  backupAcceptable: boolean;
  digestSafe: boolean;
  gateSetBy: string | null;
  gateSetAt: Date | null;
  gateNote: string | null;
}

interface ProjectRow {
  projectId: number;
  projectName: string | null;
  priority: string | null;
  sector: string | null;
  owner: string | null;
  location: string | null;
  capexGrade: string | null;
  discoveryStatus: string | null;
  isDemoted: boolean;
  slate: {
    totalSlotsFilled: number;
    sendReadySlots: number;
    namedUnverifiedSlots: number;
    llmSlots: number;
    sourcesUsed: string[] | null;
    isStale: boolean;
    generatedAt: Date | null;
    primarySnapshot: SlotSnapshot | null;
    commercialSnapshot: SlotSnapshot | null;
    technicalSnapshot: SlotSnapshot | null;
  } | null;
  hasSlate: boolean;
  slateIsStale: boolean;
  gate: ProjectGate | null;
}

// ── Trust Tier Badge ──

function TrustBadge({ tier }: { tier: TrustTier }) {
  if (tier === "send_ready") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1 text-[10px] font-semibold">
        <ShieldCheck className="w-3 h-3" /> Send-Ready
      </Badge>
    );
  }
  if (tier === "named_unverified") {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 gap-1 text-[10px] font-semibold">
        <Shield className="w-3 h-3" /> Validate First
      </Badge>
    );
  }
  return (
    <Badge className="bg-slate-100 text-slate-600 border-slate-200 gap-1 text-[10px] font-semibold">
      <ShieldAlert className="w-3 h-3" /> AI Only
    </Badge>
  );
}

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    apollo: "bg-blue-100 text-blue-700 border-blue-200",
    hunter: "bg-purple-100 text-purple-700 border-purple-200",
    linkedin: "bg-sky-100 text-sky-700 border-sky-200",
    web_search: "bg-teal-100 text-teal-700 border-teal-200",
    projectory: "bg-orange-100 text-orange-700 border-orange-200",
    llm: "bg-slate-100 text-slate-500 border-slate-200",
  };
  const cls = colors[source] || "bg-slate-100 text-slate-500 border-slate-200";
  return <Badge className={`${cls} text-[10px] font-medium`}>{source}</Badge>;
}

function LaneBadge({ lane }: { lane: string }) {
  const colors: Record<string, string> = {
    primary: "bg-navy/10 text-navy border-navy/20",
    commercial: "bg-gold/15 text-amber-800 border-gold/30",
    technical: "bg-teal/10 text-teal-800 border-teal/20",
    backup: "bg-slate-100 text-slate-500 border-slate-200",
  };
  const cls = colors[lane] || "bg-slate-100 text-slate-500 border-slate-200";
  return <Badge className={`${cls} text-[10px] font-medium capitalize`}>{lane}</Badge>;
}

// ── Contact Slot Card ──

interface ContactSlotCardProps {
  slotLabel: string;
  slotKey: string;
  snapshot: SlotSnapshot | null;
  projectId: number;
  onActionComplete: () => void;
}

function ContactSlotCard({ slotLabel, slotKey: _slotKey, snapshot, projectId, onActionComplete }: ContactSlotCardProps) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [pendingAction, setPendingAction] = useState<ValidationAction | null>(null);

  const submitAction = trpc.contactValidation.submitAction.useMutation({
    onSuccess: (data) => {
      toast(data.promoted ? "Contact promoted to Send-Ready" : "Action recorded", {
        description: `${snapshot?.name} — ${pendingAction?.replace("_", " ")}`,
      });
      setShowNote(false);
      setNote("");
      setPendingAction(null);
      onActionComplete();
    },
    onError: (err) => toast.error("Action failed", { description: err.message }),
  });

  const hunterVerify = trpc.contactValidation.hunterVerifyContact.useMutation({
    onSuccess: (data) => {
      const msg = data.action === "email_found"
        ? `Email found and contact promoted: ${data.emailFound}`
        : data.action === "kept_unverified"
        ? `Email found but low confidence (score: ${data.hunterConfidence})`
        : `Hunter could not find email: ${data.reason}`;
      toast(`Hunter: ${data.action}`, { description: msg });
      onActionComplete();
    },
    onError: (err) => toast.error("Hunter verification failed", { description: err.message }),
  });

  const handleAction = (action: ValidationAction) => {
    if (action === "reject" || action === "wrong_company") {
      setPendingAction(action);
      setShowNote(true);
      return;
    }
    submitAction.mutate({ contactId: snapshot!.contactId, projectId, action });
  };

  if (!snapshot) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 flex flex-col items-center justify-center min-h-[120px] gap-1">
        <p className="text-xs text-muted-foreground italic">No contact in {slotLabel} slot</p>
        <p className="text-[10px] text-muted-foreground/60">Generate slate to populate</p>
      </div>
    );
  }

  const isLlm = snapshot.contactTrustTier === "llm_inferred";

  return (
    <>
      <div className={`rounded-lg border p-4 space-y-3 ${isLlm ? "border-amber-200 bg-amber-50/40" : "border-border bg-card"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-foreground truncate">{snapshot.name}</span>
              <LaneBadge lane={snapshot.roleLane} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{snapshot.title}</p>
            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
              <Building2 className="w-3 h-3 shrink-0" />
              <span className="truncate">{snapshot.company}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <TrustBadge tier={snapshot.contactTrustTier} />
            <SourceBadge source={snapshot.enrichmentSource} />
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {snapshot.email ? (
            <span className="flex items-center gap-1 text-emerald-700">
              <Mail className="w-3 h-3" />
              <span className="truncate max-w-[180px]">{snapshot.email}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-muted-foreground italic">
              <Mail className="w-3 h-3" /> No email
            </span>
          )}
          {snapshot.linkedin && (
            <a
              href={snapshot.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sky-600 hover:text-sky-800 transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> LinkedIn
            </a>
          )}
        </div>

        {isLlm && (
          <div className="flex items-start gap-2 p-2 rounded bg-amber-100 border border-amber-200 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>AI-inferred — verify independently before outreach. Cannot be promoted by rep action.</span>
          </div>
        )}

        {!isLlm && (
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border">
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
              onClick={() => handleAction("accept")} disabled={submitAction.isPending}>
              <CheckCircle2 className="w-3 h-3" /> Accept
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => handleAction("reject")} disabled={submitAction.isPending}>
              <XCircle className="w-3 h-3" /> Reject
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-orange-600 border-orange-200 hover:bg-orange-50"
              onClick={() => handleAction("wrong_company")} disabled={submitAction.isPending}>
              <UserX className="w-3 h-3" /> Wrong company
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-slate-600 border-slate-200 hover:bg-slate-50"
              onClick={() => handleAction("wrong_role")} disabled={submitAction.isPending}>
              <ArrowDownCircle className="w-3 h-3" /> Wrong role
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-slate-600 border-slate-200 hover:bg-slate-50"
              onClick={() => handleAction("backup_only")} disabled={submitAction.isPending}>
              <ArrowDownCircle className="w-3 h-3" /> Backup only
            </Button>
            {!snapshot.email && (
              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-purple-700 border-purple-200 hover:bg-purple-50"
                onClick={() => hunterVerify.mutate({ contactId: snapshot.contactId, projectId })}
                disabled={hunterVerify.isPending}>
                <Zap className="w-3 h-3" />
                {hunterVerify.isPending ? "Searching…" : "Hunter verify"}
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog open={showNote} onOpenChange={setShowNote}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pendingAction === "reject" ? "Reject contact" : "Flag wrong company"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pendingAction === "reject"
              ? `Rejecting ${snapshot.name}. This will remove them from primary slots.`
              : `Flagging ${snapshot.name} as wrong company.`}
          </p>
          <Textarea
            placeholder="Optional note (e.g. left company, wrong project, duplicate)"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="resize-none"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNote(false)}>Cancel</Button>
            <Button variant="destructive"
              onClick={() => submitAction.mutate({ contactId: snapshot.contactId, projectId, action: pendingAction!, note: note || undefined })}
              disabled={submitAction.isPending}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Project-Level Validation Gates ──

interface ProjectGateControlsProps {
  project: ProjectRow;
  onGateSet: () => void;
}

function ProjectGateControls({ project, onGateSet }: ProjectGateControlsProps) {
  const [showGateDialog, setShowGateDialog] = useState(false);
  const [primary, setPrimary] = useState(project.gate?.primaryAcceptable ?? false);
  const [backup, setBackup] = useState(project.gate?.backupAcceptable ?? false);
  const [digest, setDigest] = useState(project.gate?.digestSafe ?? false);
  const [gateNote, setGateNote] = useState(project.gate?.gateNote ?? "");

  const setGates = trpc.contactValidation.setProjectValidationGates.useMutation({
    onSuccess: () => {
      toast("Validation gates saved", {
        description: digest ? "Project is now digest-safe." : "Project kept in review-first mode.",
      });
      setShowGateDialog(false);
      onGateSet();
    },
    onError: (err) => toast.error("Failed to save gates", { description: err.message }),
  });

  const gate = project.gate;
  const allGreen = gate?.primaryAcceptable && gate?.backupAcceptable && gate?.digestSafe;
  const partialGreen = gate && (gate.primaryAcceptable || gate.backupAcceptable || gate.digestSafe);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className={`h-8 text-xs gap-1.5 ${
          allGreen
            ? "text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
            : partialGreen
            ? "text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"
            : "text-slate-600 border-slate-200 hover:bg-slate-50"
        }`}
        onClick={() => {
          setPrimary(project.gate?.primaryAcceptable ?? false);
          setBackup(project.gate?.backupAcceptable ?? false);
          setDigest(project.gate?.digestSafe ?? false);
          setGateNote(project.gate?.gateNote ?? "");
          setShowGateDialog(true);
        }}
      >
        <ClipboardCheck className="w-3.5 h-3.5" />
        {allGreen ? "Gates: All clear" : partialGreen ? "Gates: Partial" : "Set gates"}
      </Button>

      <Dialog open={showGateDialog} onOpenChange={setShowGateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-navy" />
              Validation Gates — {project.projectName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Set these gates after reviewing the candidate slate. Only digest-safe projects
              will have their contacts included in the weekly rep digest.
            </p>

            <button
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors text-left"
              onClick={() => setPrimary(v => !v)}
            >
              {primary ? (
                <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <Square className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium">Primary contact acceptable</p>
                <p className="text-xs text-muted-foreground">The primary slot contact is credible and relevant</p>
              </div>
            </button>

            <button
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors text-left"
              onClick={() => setBackup(v => !v)}
            >
              {backup ? (
                <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <Square className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium">Backup contacts acceptable</p>
                <p className="text-xs text-muted-foreground">At least one backup slot has a credible contact</p>
              </div>
            </button>

            <button
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors text-left"
              onClick={() => setDigest(v => !v)}
            >
              {digest ? (
                <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <Square className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium">Digest-safe</p>
                <p className="text-xs text-muted-foreground">
                  This project's contacts can appear in the rep-facing weekly digest.
                  {digest && !primary && (
                    <span className="text-amber-700 block mt-0.5">⚠ Requires primary contact to also be acceptable.</span>
                  )}
                </p>
              </div>
            </button>

            {digest && (
              <div className="flex items-start gap-2 p-2 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Marking as digest-safe will promote this project to <strong>send_ready_contact</strong> status
                  if it has at least one verified email contact.
                </span>
              </div>
            )}

            <Textarea
              placeholder="Optional note (e.g. primary confirmed via LinkedIn, backup needs Hunter run)"
              value={gateNote}
              onChange={e => setGateNote(e.target.value)}
              className="resize-none text-xs"
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGateDialog(false)}>Cancel</Button>
            <Button
              className="bg-navy text-white hover:bg-navy/90"
              onClick={() => setGates.mutate({
                projectId: project.projectId,
                primaryAcceptable: primary,
                backupAcceptable: backup,
                digestSafe: digest,
                note: gateNote || undefined,
              })}
              disabled={setGates.isPending}
            >
              Save gates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Project Slate Row ──

function ProjectSlateRow({ project, onRefresh }: { project: ProjectRow; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const slateQuery = trpc.contactValidation.getSlate.useQuery(
    { projectId: project.projectId },
    { enabled: expanded }
  );

  const regenerate = trpc.contactValidation.regenerateSlate.useMutation({
    onSuccess: () => { toast("Slate regenerated"); slateQuery.refetch(); onRefresh(); },
    onError: (err) => toast.error("Failed", { description: err.message }),
  });

  const hunterBatch = trpc.contactValidation.hunterVerifyProject.useMutation({
    onSuccess: (data) => {
      toast(`Hunter batch: ${data.promoted} promoted`, {
        description: `${data.emailsFound} emails found, ${data.keptUnverified} kept unverified`,
      });
      slateQuery.refetch();
      onRefresh();
    },
    onError: (err) => toast.error("Hunter batch failed", { description: err.message }),
  });

  const priorityColor = project.priority === "hot" ? "text-red-600" : "text-orange-500";
  const coverageColor = !project.slate
    ? "text-slate-400"
    : project.slate.sendReadySlots >= 3 ? "text-emerald-600"
    : project.slate.sendReadySlots >= 1 ? "text-amber-600"
    : "text-red-500";

  const gate = project.gate;
  const gateIcon = gate?.digestSafe
    ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
    : gate?.primaryAcceptable
    ? <Shield className="w-3.5 h-3.5 text-amber-500" />
    : <AlertCircle className="w-3.5 h-3.5 text-slate-400" />;

  const slateData = slateQuery.data;

  return (
    <div className={`border rounded-lg overflow-hidden ${project.isDemoted ? "border-red-200" : "border-border"}`}>
      {/* Summary row */}
      <div
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${project.isDemoted ? "bg-red-50/40 hover:bg-red-50/70" : "bg-card hover:bg-muted/30"}`}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-4 gap-2">
          <div className="sm:col-span-2">
            <div className="flex items-center gap-2">
              {project.priority === "hot"
                ? <Flame className="w-3.5 h-3.5 text-red-500 shrink-0" />
                : <TrendingUp className="w-3.5 h-3.5 text-orange-400 shrink-0" />}
              <span className="font-medium text-sm truncate">{project.projectName || `Project ${project.projectId}`}</span>
              {project.isDemoted && (
                <Badge className="text-[9px] bg-red-100 text-red-700 border-red-200 shrink-0">demoted</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {project.owner || "—"} · {project.location || "—"} · {project.sector || "—"}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`font-semibold uppercase ${priorityColor}`}>{project.priority}</span>
            {project.capexGrade && (
              <Badge className="text-[10px] bg-slate-100 text-slate-600 border-slate-200">{project.capexGrade}</Badge>
            )}
            <span className="flex items-center gap-1">{gateIcon}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {project.slate ? (
              <>
                <span className={`font-semibold ${coverageColor}`}>
                  {project.slate.sendReadySlots}/{project.slate.totalSlotsFilled} send-ready
                </span>
                {project.slateIsStale && (
                  <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">stale</Badge>
                )}
              </>
            ) : (
              <span className="text-muted-foreground italic text-[11px]">No slate yet</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-border p-4 bg-background space-y-4">
          {/* Actions bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
              onClick={() => regenerate.mutate({ projectId: project.projectId })}
              disabled={regenerate.isPending}>
              <RefreshCw className={`w-3 h-3 ${regenerate.isPending ? "animate-spin" : ""}`} />
              {project.hasSlate ? "Regenerate slate" : "Generate slate"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 text-purple-700 border-purple-200 hover:bg-purple-50"
              onClick={() => hunterBatch.mutate({ projectId: project.projectId })}
              disabled={hunterBatch.isPending}>
              <Zap className="w-3 h-3" />
              {hunterBatch.isPending ? "Running Hunter…" : "Hunter verify all"}
            </Button>
            <ProjectGateControls project={project} onGateSet={onRefresh} />
            {slateData && (
              <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-emerald-600" />{slateData.sendReadySlots} send-ready</span>
                <span className="flex items-center gap-1"><Shield className="w-3 h-3 text-amber-500" />{slateData.namedUnverifiedSlots} validate first</span>
                <span className="flex items-center gap-1"><ShieldAlert className="w-3 h-3 text-slate-400" />{slateData.llmSlots} AI only</span>
              </div>
            )}
          </div>

          {/* Gate status banner */}
          {project.gate && (
            <div className={`flex items-center gap-3 p-3 rounded-lg border text-xs ${
              project.gate.digestSafe
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-amber-50 border-amber-200 text-amber-800"
            }`}>
              {project.gate.digestSafe
                ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
              <span>
                {project.gate.digestSafe
                  ? "Digest-safe — contacts will appear in the weekly rep digest."
                  : "Review-first mode — contacts will NOT appear in digest until digest-safe gate is set."}
                {project.gate.gateSetBy && (
                  <span className="text-muted-foreground ml-1">Set by {project.gate.gateSetBy}</span>
                )}
              </span>
            </div>
          )}

          {slateQuery.isLoading && (
            <p className="text-sm text-muted-foreground text-center py-4">Loading slate…</p>
          )}

          {slateData && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(["primarySnapshot", "commercialSnapshot", "technicalSnapshot", "backup1Snapshot", "backup2Snapshot"] as const).map((key, i) => (
                <ContactSlotCard
                  key={key}
                  slotLabel={["Primary", "Commercial", "Technical", "Backup 1", "Backup 2"][i]}
                  slotKey={key}
                  snapshot={(slateData as any)[key] as SlotSnapshot | null}
                  projectId={project.projectId}
                  onActionComplete={() => { slateQuery.refetch(); onRefresh(); }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stats Bar ──

function StatsBar() {
  const statsQuery = trpc.contactValidation.getValidationStats.useQuery(undefined, { staleTime: 60_000 });
  const stats = statsQuery.data;
  if (!stats) return null;

  const tier = stats.tierDistribution;
  const sendReady = tier["send_ready"] || 0;
  const namedUnverified = tier["named_unverified"] || 0;
  const llmInferred = tier["llm_inferred"] || 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <Card className="border-emerald-200">
        <CardContent className="p-4">
          <div className="text-2xl font-bold text-emerald-700">{sendReady.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-600" /> Send-Ready
          </div>
        </CardContent>
      </Card>
      <Card className="border-amber-200">
        <CardContent className="p-4">
          <div className="text-2xl font-bold text-amber-700">{namedUnverified.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Shield className="w-3 h-3 text-amber-500" /> Validate First
          </div>
        </CardContent>
      </Card>
      <Card className="border-slate-200">
        <CardContent className="p-4">
          <div className="text-2xl font-bold text-slate-600">{llmInferred.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-slate-400" /> AI Only (blocked)
          </div>
        </CardContent>
      </Card>
      <Card className="border-purple-200">
        <CardContent className="p-4">
          <div className="text-2xl font-bold text-purple-700">{stats.hunterStats.promoted}</div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Zap className="w-3 h-3 text-purple-500" /> Hunter promotions
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Source Report Tab ──

function SourceReportTab() {
  const reportQuery = trpc.contactValidation.getSourceReport.useQuery(undefined, { staleTime: 120_000 });
  const report = reportQuery.data;

  if (reportQuery.isLoading) {
    return <p className="text-sm text-muted-foreground text-center py-8">Loading source report…</p>;
  }

  if (!report || report.bySource.length === 0) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No source data yet. Generate slates and validate contacts to populate this report.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Source table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-navy" />
            Contacts by Source — Hot &amp; Warm Projects
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-4 py-2.5 font-semibold">Source</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Candidates</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Send-Ready</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Validate First</th>
                  <th className="text-right px-4 py-2.5 font-semibold">AI Only</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Email Verified</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Accepted</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Rejected</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Promoted</th>
                </tr>
              </thead>
              <tbody>
                {report.bySource.map((row, i) => (
                  <tr key={row.source} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                    <td className="px-4 py-2.5">
                      <SourceBadge source={row.source} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">{row.candidates.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-700 font-semibold">{row.sendReady.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-amber-700">{row.namedUnverified.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{row.llmInferred.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-600">{row.emailVerified.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-700">{row.accepted.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-red-600">{row.rejected.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-purple-700 font-semibold">{row.promotedToSendReady.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Hunter outcomes */}
      {report.hunterOutcomes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4 text-purple-600" />
              Hunter Verification Outcomes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-purple-900 text-white">
                    <th className="text-left px-4 py-2.5 font-semibold">Outcome</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Count</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Promoted to Send-Ready</th>
                  </tr>
                </thead>
                <tbody>
                  {report.hunterOutcomes.map((row, i) => (
                    <tr key={row.outcome} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                      <td className="px-4 py-2.5 font-medium">{row.outcome}</td>
                      <td className="px-4 py-2.5 text-right">{row.count.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-purple-700 font-semibold">{row.promoted.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground text-right">
        Report generated at {new Date(report.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}

// ── Main Page ──

export default function ContactValidation() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [refreshKey, setRefreshKey] = useState(0);

  const demotedQuery = trpc.contactValidation.getDemotedProjects.useQuery(undefined, { staleTime: 30_000 });
  const top20Query = trpc.contactValidation.getTop20Scoped.useQuery(undefined, { staleTime: 30_000 });

  const generateDemoted = trpc.contactValidation.generateScopedSlates.useMutation({
    onSuccess: (data) => {
      toast(`Demoted slates: ${data.generated}/${data.total} generated`, {
        description: data.failed > 0 ? `${data.failed} failed` : "All succeeded",
      });
      demotedQuery.refetch();
      setRefreshKey(k => k + 1);
    },
    onError: (err) => toast.error("Generation failed", { description: err.message }),
  });

  const generateTop20 = trpc.contactValidation.generateScopedSlates.useMutation({
    onSuccess: (data) => {
      toast(`Top-20 slates: ${data.generated}/${data.total} generated`, {
        description: data.failed > 0 ? `${data.failed} failed` : "All succeeded",
      });
      top20Query.refetch();
      setRefreshKey(k => k + 1);
    },
    onError: (err) => toast.error("Generation failed", { description: err.message }),
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy" />
      </div>
    );
  }

  if (!user) {
    window.location.href = "/login";
    return null;
  }

  if (user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center p-8">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold">Admin access required</h2>
          <p className="text-sm text-muted-foreground mt-2">Contact validation is restricted to admins.</p>
          <Button className="mt-4" onClick={() => navigate("/")}>Go home</Button>
        </div>
      </div>
    );
  }

  const demotedProjects = (demotedQuery.data || []) as ProjectRow[];
  const top20Projects = (top20Query.data || []) as ProjectRow[];

  const demotedNoSlate = demotedProjects.filter(p => !p.hasSlate).length;
  const top20NoSlate = top20Projects.filter(p => !p.hasSlate).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="container py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Users className="w-5 h-5 text-navy" />
              Contact Validation
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Scoped rollout: 13 demoted projects first → Top-20 hot/warm → digest only after gates confirmed
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => { demotedQuery.refetch(); top20Query.refetch(); }}
            disabled={demotedQuery.isFetching || top20Query.isFetching}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(demotedQuery.isFetching || top20Query.isFetching) ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <StatsBar />

        {/* Waterfall reference */}
        <Card className="border-navy/20 bg-navy/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <BarChart3 className="w-4 h-4 text-navy mt-0.5 shrink-0" />
              <div className="text-xs text-foreground/80 space-y-1">
                <p className="font-semibold text-navy">Source waterfall (highest → lowest priority)</p>
                <p>
                  <span className="font-medium text-blue-700">1. Apollo</span> (verified email, project-linked) →{" "}
                  <span className="font-medium text-teal-700">2. Web/LinkedIn</span> (named, email may be missing) →{" "}
                  <span className="font-medium text-orange-700">3. Projectory</span> (named, often has email) →{" "}
                  <span className="font-medium text-purple-700">4. Hunter</span> (email finder for already-named contacts only) →{" "}
                  <span className="font-medium text-slate-500">5. LLM</span> (suggested only — never primary)
                </p>
                <p className="text-muted-foreground">
                  Role lanes: <strong>Primary</strong> (PM, Site Mgr, Construction Mgr) ·{" "}
                  <strong>Commercial</strong> (Procurement, Contracts, Purchasing) ·{" "}
                  <strong>Technical</strong> (Operations, Maintenance, Engineering, Hire/Rental)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="demoted">
          <TabsList className="mb-4">
            <TabsTrigger value="demoted" className="gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-red-500" />
              Demoted ({demotedProjects.length})
              {demotedNoSlate > 0 && (
                <Badge className="ml-1 text-[9px] bg-red-100 text-red-700 border-red-200">{demotedNoSlate} no slate</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="top20" className="gap-1.5">
              <Flame className="w-3.5 h-3.5 text-orange-500" />
              Top-20 ({top20Projects.length})
              {top20NoSlate > 0 && (
                <Badge className="ml-1 text-[9px] bg-amber-100 text-amber-700 border-amber-200">{top20NoSlate} no slate</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="source-report" className="gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-navy" />
              Source Report
            </TabsTrigger>
          </TabsList>

          {/* Demoted tab */}
          <TabsContent value="demoted" className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex-1 mr-4">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  These {demotedProjects.length} projects were demoted from <strong>send_ready_contact</strong> because their contacts were LLM-sourced or unverified.
                  Generate slates, run Hunter verification, then set validation gates before any digest inclusion.
                </span>
              </div>
              <Button
                size="sm"
                className="gap-1.5 bg-red-700 text-white hover:bg-red-800 shrink-0"
                onClick={() => generateDemoted.mutate({ scope: "demoted" })}
                disabled={generateDemoted.isPending}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${generateDemoted.isPending ? "animate-spin" : ""}`} />
                {generateDemoted.isPending ? "Generating…" : `Generate ${demotedNoSlate > 0 ? demotedNoSlate : "all"} slates`}
              </Button>
            </div>

            {demotedQuery.isLoading && (
              <p className="text-sm text-muted-foreground text-center py-8">Loading demoted projects…</p>
            )}
            {demotedProjects.map(p => (
              <ProjectSlateRow
                key={`${p.projectId}-${refreshKey}`}
                project={p}
                onRefresh={() => { demotedQuery.refetch(); setRefreshKey(k => k + 1); }}
              />
            ))}
            {!demotedQuery.isLoading && demotedProjects.length === 0 && (
              <div className="text-center py-12">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                <p className="text-sm font-medium text-emerald-700">No demoted projects</p>
                <p className="text-xs text-muted-foreground mt-1">All hot/warm projects have verified contacts.</p>
              </div>
            )}
          </TabsContent>

          {/* Top-20 tab */}
          <TabsContent value="top20" className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">
                Top-20 hot/warm projects by priority. Run after demoted projects are resolved.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 shrink-0"
                onClick={() => generateTop20.mutate({ scope: "top20" })}
                disabled={generateTop20.isPending}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${generateTop20.isPending ? "animate-spin" : ""}`} />
                {generateTop20.isPending ? "Generating…" : `Generate ${top20NoSlate > 0 ? top20NoSlate : "all"} slates`}
              </Button>
            </div>

            {top20Query.isLoading && (
              <p className="text-sm text-muted-foreground text-center py-8">Loading top-20 projects…</p>
            )}
            {top20Projects.map(p => (
              <ProjectSlateRow
                key={`${p.projectId}-${refreshKey}`}
                project={p}
                onRefresh={() => { top20Query.refetch(); setRefreshKey(k => k + 1); }}
              />
            ))}
            {!top20Query.isLoading && top20Projects.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No projects found.</p>
            )}
          </TabsContent>

          {/* Source Report tab */}
          <TabsContent value="source-report">
            <SourceReportTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
