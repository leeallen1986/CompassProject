/*
 * Pipeline — Kanban-style sales pipeline tracker
 * Columns: Identified → Contacted → Meeting Booked → Quoted → Won/Lost
 */
import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target, Phone, Calendar, FileText, Trophy, XCircle,
  ChevronDown, ChevronUp, MapPin, ArrowRight, Clock,
  User, Trash2, Edit3, Plus, Settings, ArrowLeft
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

const PIPELINE_STAGES = [
  { key: "identified", label: "Identified", icon: Target, color: "bg-slate-500", lightBg: "bg-slate-50", border: "border-slate-200" },
  { key: "contacted", label: "Contacted", icon: Phone, color: "bg-blue-500", lightBg: "bg-blue-50", border: "border-blue-200" },
  { key: "meeting_booked", label: "Meeting Booked", icon: Calendar, color: "bg-amber-500", lightBg: "bg-amber-50", border: "border-amber-200" },
  { key: "quoted", label: "Quoted", icon: FileText, color: "bg-purple-500", lightBg: "bg-purple-50", border: "border-purple-200" },
  { key: "won", label: "Won", icon: Trophy, color: "bg-emerald-500", lightBg: "bg-emerald-50", border: "border-emerald-200" },
  { key: "lost", label: "Lost", icon: XCircle, color: "bg-red-500", lightBg: "bg-red-50", border: "border-red-200" },
] as const;

type PipelineStatus = typeof PIPELINE_STAGES[number]["key"];

function StatusUpdateModal({
  claim,
  onClose,
}: {
  claim: { id: number; status: string; notes: string | null; estimatedValue: string | null; nextAction: string | null; contactName: string | null };
  onClose: () => void;
}) {
  const [status, setStatus] = useState<PipelineStatus>(claim.status as PipelineStatus);
  const [notes, setNotes] = useState(claim.notes || "");
  const [estimatedValue, setEstimatedValue] = useState(claim.estimatedValue || "");
  const [nextAction, setNextAction] = useState(claim.nextAction || "");
  const [contactName, setContactName] = useState(claim.contactName || "");

  const utils = trpc.useUtils();
  const updateMutation = trpc.pipeline.updateStatus.useMutation({
    onSuccess: () => {
      utils.pipeline.mine.invalidate();
      utils.pipeline.team.invalidate();
      toast.success("Pipeline updated");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const releaseMutation = trpc.pipeline.release.useMutation({
    onSuccess: () => {
      utils.pipeline.mine.invalidate();
      utils.pipeline.team.invalidate();
      toast.success("Project released from pipeline");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-navy mb-4">Update Pipeline Status</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Status</label>
            <div className="grid grid-cols-3 gap-2">
              {PIPELINE_STAGES.map((stage) => (
                <button
                  key={stage.key}
                  onClick={() => setStatus(stage.key)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 justify-center ${
                    status === stage.key
                      ? `${stage.color} text-white shadow-sm`
                      : `${stage.lightBg} text-slate-600 ${stage.border} border hover:opacity-80`
                  }`}
                >
                  <stage.icon className="w-3 h-3" />
                  {stage.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Contact Name</label>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="e.g. John Smith, Project Manager"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Estimated Value</label>
            <input
              type="text"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              placeholder="e.g. $50K rental, $200K purchase"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Next Action</label>
            <input
              type="text"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder="e.g. Send quote, Schedule site visit"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this opportunity..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
          <button
            onClick={() => releaseMutation.mutate({ claimId: claim.id })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Release
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                updateMutation.mutate({
                  claimId: claim.id,
                  status,
                  notes: notes || undefined,
                  estimatedValue: estimatedValue || undefined,
                  nextAction: nextAction || undefined,
                  contactName: contactName || undefined,
                })
              }
              disabled={updateMutation.isPending}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-navy text-white hover:bg-navy/90 transition-colors disabled:opacity-50"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function PipelineCard({
  claim,
  projectName,
  projectLocation,
  projectValue,
  onEdit,
}: {
  claim: {
    id: number;
    status: string;
    notes: string | null;
    estimatedValue: string | null;
    nextAction: string | null;
    contactName: string | null;
    updatedAt: Date;
  };
  projectName: string;
  projectLocation: string;
  projectValue: string;
  onEdit: () => void;
}) {
  return (
    <div
      className="bg-white rounded-lg border border-slate-200 p-3 hover:shadow-md transition-shadow cursor-pointer group"
      onClick={onEdit}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-navy leading-tight line-clamp-2">{projectName}</h4>
        <Edit3 className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500">
        <MapPin className="w-3 h-3" />
        <span>{projectLocation}</span>
      </div>
      {projectValue && (
        <div className="text-[11px] font-medium text-gold-dark mt-1">{projectValue}</div>
      )}
      {claim.contactName && (
        <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
          <User className="w-3 h-3" />
          <span>{claim.contactName}</span>
        </div>
      )}
      {claim.nextAction && (
        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-teal">
          <ArrowRight className="w-3 h-3" />
          <span className="line-clamp-1">{claim.nextAction}</span>
        </div>
      )}
      {claim.estimatedValue && (
        <div className="mt-1.5 px-2 py-0.5 rounded bg-gold/10 text-gold-dark text-[10px] font-semibold inline-block">
          {claim.estimatedValue}
        </div>
      )}
      <div className="flex items-center gap-1 mt-2 text-[10px] text-slate-400">
        <Clock className="w-2.5 h-2.5" />
        <span>Updated {new Date(claim.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export default function Pipeline() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [viewMode, setViewMode] = useState<"mine" | "team">("mine");
  const [editingClaim, setEditingClaim] = useState<any>(null);

  const myClaimsQuery = trpc.pipeline.mine.useQuery(undefined, { enabled: isAuthenticated });
  const teamClaimsQuery = trpc.pipeline.team.useQuery(undefined, { enabled: isAuthenticated && viewMode === "team" });
  const reportQuery = trpc.report.full.useQuery({}, { enabled: isAuthenticated });

  // Build a project lookup from the report data
  const projectLookup = useMemo(() => {
    const map = new Map<number, { name: string; location: string; value: string }>();
    if (reportQuery.data?.projects) {
      for (const p of reportQuery.data.projects) {
        map.set(p.id, { name: p.name, location: p.location, value: p.value });
      }
    }
    return map;
  }, [reportQuery.data]);

  // Group claims by status
  const claimsByStatus = useMemo(() => {
    const claims = viewMode === "mine" ? myClaimsQuery.data : teamClaimsQuery.data?.map(r => r.claim);
    const grouped: Record<string, any[]> = {};
    for (const stage of PIPELINE_STAGES) {
      grouped[stage.key] = [];
    }
    if (claims) {
      for (const claim of claims) {
        if (grouped[claim.status]) {
          grouped[claim.status].push(claim);
        }
      }
    }
    return grouped;
  }, [viewMode, myClaimsQuery.data, teamClaimsQuery.data]);

  // Count active (non-won/lost) claims
  const activeClaims = useMemo(() => {
    const claims = viewMode === "mine" ? myClaimsQuery.data : teamClaimsQuery.data?.map(r => r.claim);
    return claims?.filter(c => c.status !== "won" && c.status !== "lost").length || 0;
  }, [viewMode, myClaimsQuery.data, teamClaimsQuery.data]);

  const totalEstimatedValue = useMemo(() => {
    const claims = viewMode === "mine" ? myClaimsQuery.data : teamClaimsQuery.data?.map(r => r.claim);
    if (!claims) return "$0";
    let total = 0;
    for (const c of claims) {
      if (c.estimatedValue && c.status !== "lost") {
        const match = c.estimatedValue.match(/\$?([\d,.]+)\s*([KkMm])?/);
        if (match) {
          let val = parseFloat(match[1].replace(/,/g, ""));
          if (match[2]?.toUpperCase() === "K") val *= 1000;
          if (match[2]?.toUpperCase() === "M") val *= 1000000;
          total += val;
        }
      }
    }
    if (total >= 1000000) return `$${(total / 1000000).toFixed(1)}M`;
    if (total >= 1000) return `$${(total / 1000).toFixed(0)}K`;
    return `$${total.toFixed(0)}`;
  }, [viewMode, myClaimsQuery.data, teamClaimsQuery.data]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-navy font-semibold">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-navy text-white">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm">
              <ArrowLeft className="w-4 h-4" /> Dashboard
            </Link>
            <div className="w-px h-6 bg-white/20" />
            <div>
              <h1 className="text-lg font-bold">Sales Pipeline</h1>
              <p className="text-xs text-slate-400">Track your opportunities from identification to close</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg overflow-hidden border border-white/20">
              <button
                onClick={() => setViewMode("mine")}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  viewMode === "mine" ? "bg-gold text-navy" : "text-white/70 hover:text-white"
                }`}
              >
                My Pipeline
              </button>
              <button
                onClick={() => setViewMode("team")}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  viewMode === "team" ? "bg-gold text-navy" : "text-white/70 hover:text-white"
                }`}
              >
                Team View
              </button>
            </div>
            <Link href="/settings" className="p-2 rounded-lg hover:bg-white/10 transition-colors">
              <Settings className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Summary Bar */}
      <div className="bg-white border-b border-slate-200">
        <div className="container py-3 flex items-center gap-6">
          <div>
            <div className="text-2xl font-bold text-navy">{activeClaims}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Active Opportunities</div>
          </div>
          <div className="w-px h-10 bg-slate-200" />
          <div>
            <div className="text-2xl font-bold text-gold-dark">{totalEstimatedValue}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Pipeline Value</div>
          </div>
          <div className="w-px h-10 bg-slate-200" />
          <div>
            <div className="text-2xl font-bold text-emerald-600">
              {claimsByStatus["won"]?.length || 0}
            </div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Won</div>
          </div>
          <div className="w-px h-10 bg-slate-200" />
          <div>
            <div className="text-2xl font-bold text-red-500">
              {claimsByStatus["lost"]?.length || 0}
            </div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Lost</div>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <main className="container py-6">
        <div className="grid grid-cols-6 gap-3">
          {PIPELINE_STAGES.map((stage) => {
            const claims = claimsByStatus[stage.key] || [];
            return (
              <div key={stage.key} className={`rounded-xl ${stage.lightBg} ${stage.border} border p-3`}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-6 h-6 rounded-md ${stage.color} flex items-center justify-center`}>
                    <stage.icon className="w-3.5 h-3.5 text-white" />
                  </div>
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">{stage.label}</h3>
                  <span className="ml-auto text-xs font-bold text-slate-400">{claims.length}</span>
                </div>

                <div className="space-y-2 min-h-[100px]">
                  <AnimatePresence>
                    {claims.map((claim: any) => {
                      const project = projectLookup.get(claim.projectId);
                      return (
                        <motion.div
                          key={claim.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                        >
                          <PipelineCard
                            claim={claim}
                            projectName={project?.name || `Project #${claim.projectId}`}
                            projectLocation={project?.location || "Unknown"}
                            projectValue={project?.value || ""}
                            onEdit={() => setEditingClaim(claim)}
                          />
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>

                  {claims.length === 0 && (
                    <div className="flex items-center justify-center h-20 text-[11px] text-slate-400 italic">
                      No projects
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {activeClaims === 0 && (claimsByStatus["won"]?.length || 0) === 0 && (claimsByStatus["lost"]?.length || 0) === 0 && (
          <div className="text-center py-16">
            <Target className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-navy mb-2">Your pipeline is empty</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto mb-4">
              Go to the Dashboard and click "Claim" on any project card to add it to your pipeline. Track your outreach from identification through to close.
            </p>
            <Link href="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-navy text-white text-sm font-semibold hover:bg-navy/90 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Back to Dashboard
            </Link>
          </div>
        )}
      </main>

      {/* Edit Modal */}
      {editingClaim && (
        <StatusUpdateModal
          claim={editingClaim}
          onClose={() => setEditingClaim(null)}
        />
      )}
    </div>
  );
}
