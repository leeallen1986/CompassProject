/**
 * ContractorPatterns — Contractor & Delivery Pattern Intelligence
 *
 * Shows:
 * - Contractor leaderboard with role, sector, state breakdowns
 * - Recurring pairings (owner/EPC, contractor/consultant, etc.)
 * - Emerging patterns with signal strength and suggested actions
 * - Contractor profiles with project links
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Users, TrendingUp, Link2, Sparkles, Building, Pickaxe, Fuel,
  Shield, ChevronRight, ArrowUpRight, Loader2, AlertTriangle,
  BarChart3, Target, RefreshCw, Zap, MapPin, Clock, Award
} from "lucide-react";
import { toast } from "sonner";

// ── Types ──

interface ContractorEntry {
  id: number;
  canonicalName: string;
  primaryRole: string;
  projectCount: number;
  confirmedCount: number;
  predictedCount: number;
  sectorBreakdown: Record<string, number> | null;
  stateBreakdown: Record<string, number> | null;
  momentumScore: number | null;
  recurrenceScore: number | null;
  atlasRelevanceScore: number | null;
  earlySignalScore: number | null;
  compositeScore: number | null;
  lastSeenAt: string | null;
}

interface PatternEntry {
  id: number;
  patternType: string;
  title: string;
  description: string;
  signalStrength: string;
  contractorIds: number[] | null;
  sectors: string[] | null;
  states: string[] | null;
  atlasRelevance: string | null;
  suggestedAction: string | null;
  detectedAt: string;
}

// ── Role & Sector Helpers ──

const roleLabels: Record<string, string> = {
  owner: "Owner / Proponent",
  epc: "EPC Contractor",
  contractor: "Contractor",
  subcontractor: "Subcontractor",
  consultant: "Consultant",
  supplier: "Supplier",
  rental: "Equipment Supplier",
  government: "Government",
  unknown: "Unknown",
};

const roleColors: Record<string, string> = {
  owner: "bg-blue-100 text-blue-800",
  epc: "bg-purple-100 text-purple-800",
  contractor: "bg-amber-100 text-amber-800",
  subcontractor: "bg-orange-100 text-orange-800",
  consultant: "bg-teal-100 text-teal-800",
  supplier: "bg-green-100 text-green-800",
  rental: "bg-gold/15 text-gold-dark",
  government: "bg-slate-100 text-slate-800",
  unknown: "bg-gray-100 text-gray-600",
};

const sectorIcons: Record<string, React.ReactNode> = {
  mining: <Pickaxe className="w-3 h-3" />,
  oil_gas: <Fuel className="w-3 h-3" />,
  infrastructure: <Building className="w-3 h-3" />,
  energy: <TrendingUp className="w-3 h-3" />,
  defence: <Shield className="w-3 h-3" />,
};

const signalColors: Record<string, string> = {
  strong: "bg-hot text-white",
  moderate: "bg-warm text-navy",
  emerging: "bg-teal/20 text-teal",
};

const patternTypeLabels: Record<string, string> = {
  contractor_cluster: "Contractor Cluster",
  owner_epc_pairing: "Owner-EPC Pairing",
  regional_momentum: "Regional Momentum",
  supply_chain_signal: "Supply Chain Signal",
  early_stage_signal: "Early Stage Signal",
};

const patternTypeIcons: Record<string, React.ReactNode> = {
  contractor_cluster: <Users className="w-4 h-4" />,
  owner_epc_pairing: <Link2 className="w-4 h-4" />,
  regional_momentum: <MapPin className="w-4 h-4" />,
  supply_chain_signal: <Zap className="w-4 h-4" />,
  early_stage_signal: <Clock className="w-4 h-4" />,
};

// ── Score Bar ──

function ScoreBar({ score, label, color }: { score: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="text-[10px] font-semibold w-8 text-right">{score}</span>
    </div>
  );
}

// ── Contractor Card ──

function ContractorCard({ contractor, onSelect }: { contractor: ContractorEntry; onSelect: () => void }) {
  const topSectors = contractor.sectorBreakdown
    ? Object.entries(contractor.sectorBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];
  const topStates = contractor.stateBreakdown
    ? Object.entries(contractor.stateBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];

  return (
    <div
      className="bg-card rounded-lg border border-border p-4 hover:shadow-md hover:border-gold/30 transition-all cursor-pointer group"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-navy text-sm truncate group-hover:text-gold-dark transition-colors">
            {contractor.canonicalName}
          </h3>
          <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-semibold ${roleColors[contractor.primaryRole] || roleColors.unknown}`}>
            {roleLabels[contractor.primaryRole] || contractor.primaryRole}
          </span>
        </div>
        <div className="text-right shrink-0 ml-2">
          <div className="text-2xl font-bold text-navy">{contractor.projectCount}</div>
          <div className="text-[10px] text-muted-foreground">projects</div>
        </div>
      </div>

      {/* Sector & State Tags */}
      <div className="flex flex-wrap gap-1 mb-3">
        {topSectors.map(([sector, count]) => (
          <span key={sector} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 text-[10px] text-muted-foreground">
            {sectorIcons[sector]} {sector} ({count})
          </span>
        ))}
        {topStates.map(([state, count]) => (
          <span key={state} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-[10px] text-blue-600">
            <MapPin className="w-2.5 h-2.5" /> {state} ({count})
          </span>
        ))}
      </div>

      {/* Score Bars */}
      <div className="space-y-1.5">
        <ScoreBar score={contractor.momentumScore || 0} label="Momentum" color="bg-hot" />
        <ScoreBar score={contractor.atlasRelevanceScore || 0} label="Atlas Fit" color="bg-gold" />
        <ScoreBar score={contractor.earlySignalScore || 0} label="Early Signal" color="bg-teal" />
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>{contractor.confirmedCount} confirmed</span>
          <span>{contractor.predictedCount} predicted</span>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-gold transition-colors" />
      </div>
    </div>
  );
}

// ── Pattern Card ──

function PatternCard({ pattern }: { pattern: PatternEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
          pattern.signalStrength === "strong" ? "bg-hot/10 text-hot" :
          pattern.signalStrength === "moderate" ? "bg-warm/10 text-warm" :
          "bg-teal/10 text-teal"
        }`}>
          {patternTypeIcons[pattern.patternType] || <Sparkles className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${signalColors[pattern.signalStrength] || "bg-gray-100 text-gray-600"}`}>
              {pattern.signalStrength}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {patternTypeLabels[pattern.patternType] || pattern.patternType}
            </span>
          </div>
          <h4 className="font-semibold text-navy text-sm">{pattern.title}</h4>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{pattern.description}</p>

          {expanded && (
            <div className="mt-3 space-y-2">
              {pattern.atlasRelevance && (
                <div className="bg-gold/5 border border-gold/20 rounded-md p-3">
                  <div className="text-[10px] font-bold text-gold-dark uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Target className="w-3 h-3" /> Atlas Copco Relevance
                  </div>
                  <p className="text-xs text-foreground/80">{pattern.atlasRelevance}</p>
                </div>
              )}
              {pattern.suggestedAction && (
                <div className="bg-teal/5 border border-teal/20 rounded-md p-3">
                  <div className="text-[10px] font-bold text-teal uppercase tracking-wider mb-1 flex items-center gap-1">
                    <ArrowUpRight className="w-3 h-3" /> Suggested Action
                  </div>
                  <p className="text-xs text-foreground/80">{pattern.suggestedAction}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {(pattern.sectors || []).map(s => (
                  <span key={s} className="px-1.5 py-0.5 rounded bg-slate-50 text-[10px] text-muted-foreground">{s}</span>
                ))}
                {(pattern.states || []).map(s => (
                  <span key={s} className="px-1.5 py-0.5 rounded bg-blue-50 text-[10px] text-blue-600">{s}</span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 text-[11px] font-medium text-gold hover:text-gold-dark transition-colors"
          >
            {expanded ? "Show less" : "Show relevance & actions"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Contractor Profile Modal ──

function ContractorProfile({ contractorId, onClose }: { contractorId: number; onClose: () => void }) {
  const { data: profile, isLoading } = trpc.contractorEngine.profile.useQuery({ contractorId });

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
        <div className="bg-card rounded-xl p-8 shadow-2xl" onClick={e => e.stopPropagation()}>
          <Loader2 className="w-8 h-8 animate-spin text-gold mx-auto" />
          <p className="text-sm text-muted-foreground mt-3">Loading contractor profile...</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  // profile is a flat object: { ...contractor, projectLinks, relatedProjects, pairings }
  const c = profile;
  const topSectors = c.sectorBreakdown
    ? Object.entries(c.sectorBreakdown as Record<string, number>).sort((a, b) => b[1] - a[1])
    : [];
  const topStates = c.stateBreakdown
    ? Object.entries(c.stateBreakdown as Record<string, number>).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-navy text-white p-5 rounded-t-xl">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">{c.canonicalName}</h2>
              <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-white/20 text-white`}>
                {roleLabels[c.primaryRole] || c.primaryRole}
              </span>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-gold">{c.projectCount}</div>
              <div className="text-xs text-slate-300">projects linked</div>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Scores */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Momentum", score: c.momentumScore, color: "text-hot" },
              { label: "Recurrence", score: c.recurrenceScore, color: "text-purple-600" },
              { label: "Atlas Relevance", score: c.atlasRelevanceScore, color: "text-gold-dark" },
              { label: "Early Signal", score: c.earlySignalScore, color: "text-teal" },
            ].map(s => (
              <div key={s.label} className="bg-slate-50 rounded-lg p-3 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.score || 0}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-bold text-navy uppercase tracking-wider mb-2">Sector Distribution</h4>
              <div className="space-y-1">
                {topSectors.map(([sector, count]) => (
                  <div key={sector} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {sectorIcons[sector]} {sector}
                    </span>
                    <span className="font-semibold text-navy">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold text-navy uppercase tracking-wider mb-2">State Distribution</h4>
              <div className="space-y-1">
                {topStates.map(([state, count]) => (
                  <div key={state} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="w-3 h-3" /> {state}
                    </span>
                    <span className="font-semibold text-navy">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Pairings */}
          {profile.pairings && profile.pairings.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-navy uppercase tracking-wider mb-2">Recurring Pairings</h4>
              <div className="space-y-2">
                {profile.pairings.map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2.5 text-xs">
                    <Link2 className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-navy">{p.companyAName}</span>
                      <span className="text-muted-foreground mx-1">&</span>
                      <span className="font-semibold text-navy">{p.companyBName}</span>
                    </div>
                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 text-[10px] font-semibold">
                      {p.coOccurrenceCount}x
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Projects */}
          {profile.relatedProjects && profile.relatedProjects.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-navy uppercase tracking-wider mb-2">Recent Projects</h4>
              <div className="space-y-1.5">
                {profile.relatedProjects.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg p-2.5">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-navy truncate block">{p.name}</span>
                      <span className="text-[10px] text-muted-foreground">{p.sector} · {p.location}</span>
                    </div>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                      p.priority === "hot" ? "bg-hot text-white" :
                      p.priority === "warm" ? "bg-warm text-navy" :
                      "bg-cold text-white"
                    }`}>
                      {p.priority}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-navy text-white text-sm font-semibold hover:bg-navy/90 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function ContractorPatterns() {
  const [selectedContractorId, setSelectedContractorId] = useState<number | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [sectorFilter, setSectorFilter] = useState<string>("");
  const [activeView, setActiveView] = useState<"leaderboard" | "patterns" | "pairings">("patterns");

  const runEngine = trpc.contractorEngine.runFull.useMutation({
    onSuccess: (data) => {
      toast.success(`Engine complete: ${data.registry.totalCompanies} companies, ${data.pairings.totalPairings} pairings, ${data.patterns.totalPatterns} patterns`);
      leaderboard.refetch();
      patterns.refetch();
    },
    onError: (err) => toast.error(`Engine failed: ${err.message}`),
  });

  const leaderboard = trpc.contractorEngine.leaderboard.useQuery({
    limit: 50,
    role: roleFilter || undefined,
    sector: sectorFilter || undefined,
  });

  const patterns = trpc.contractorEngine.activePatterns.useQuery();
  const emergingSection = trpc.contractorEngine.emergingPatternsSection.useQuery();

  const isAdmin = true; // Simplified — in production, check useAuth().user?.role

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-bold text-navy flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-gold" />
            Contractor & Delivery Pattern Intelligence
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Role classification, recurring pairings, momentum scoring, and early opportunity signals
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => runEngine.mutate()}
            disabled={runEngine.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold text-navy text-sm font-semibold hover:bg-gold-light transition-colors disabled:opacity-50"
          >
            {runEngine.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {runEngine.isPending ? "Running Engine..." : "Run Engine"}
          </button>
        )}
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        {[
          { key: "patterns" as const, label: "Emerging Patterns", icon: <Sparkles className="w-3.5 h-3.5" /> },
          { key: "leaderboard" as const, label: "Contractor Leaderboard", icon: <Award className="w-3.5 h-3.5" /> },
          { key: "pairings" as const, label: "Delivery Chain Pairings", icon: <Link2 className="w-3.5 h-3.5" /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveView(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-md text-xs font-semibold transition-all ${
              activeView === tab.key
                ? "bg-navy text-white"
                : "text-muted-foreground hover:text-navy hover:bg-slate-50"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Emerging Patterns View ── */}
      {activeView === "patterns" && (
        <div className="space-y-4">
          {/* Weekly Brief Section */}
          {emergingSection.data && (
            <div className="bg-gold/5 border border-gold/25 rounded-lg p-5">
              <h3 className="text-sm font-bold text-gold-dark flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4" />
                {emergingSection.data.title || "Emerging Patterns — Weekly Intelligence Brief"}
              </h3>
              <p className="text-xs text-muted-foreground italic mb-3">
                These signals are derived from contractor activity patterns and delivery-chain analysis. They indicate potential future project activity before full project publication. Treat as opportunity signals, not guaranteed predictions.
              </p>
              {/* Pattern Cards */}
              <div className="space-y-2">
                {emergingSection.data.patterns.map((item: any, j: number) => (
                  <div key={j} className="bg-white rounded-md p-3 border border-border/50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${signalColors[item.strength] || "bg-gray-100"}`}>
                        {item.strength}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{item.type}</span>
                      <span className="text-xs font-semibold text-navy">{item.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                    {item.suggestedAction && (
                      <p className="text-xs text-teal mt-1 flex items-center gap-1">
                        <ArrowUpRight className="w-3 h-3" /> {item.suggestedAction}
                      </p>
                    )}
                    {item.atlasRelevance && (
                      <p className="text-xs text-gold-dark mt-1 flex items-center gap-1">
                        <Target className="w-3 h-3" /> {item.atlasRelevance}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Top Contractor Leaderboard */}
              {emergingSection.data.contractorLeaderboard.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-bold text-navy uppercase tracking-wider mb-2">Top Contractors by Composite Score</h4>
                  <div className="overflow-x-auto rounded-lg border border-border/50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-navy/5">
                          <th className="text-left px-3 py-2 font-semibold">#</th>
                          <th className="text-left px-3 py-2 font-semibold">Company</th>
                          <th className="text-left px-3 py-2 font-semibold">Role</th>
                          <th className="text-right px-3 py-2 font-semibold">Projects</th>
                          <th className="text-right px-3 py-2 font-semibold">Score</th>
                          <th className="text-right px-3 py-2 font-semibold">Momentum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emergingSection.data.contractorLeaderboard.slice(0, 10).map((c: any) => (
                          <tr key={c.rank} className="border-t border-border/30">
                            <td className="px-3 py-2 font-bold text-gold">{c.rank}</td>
                            <td className="px-3 py-2 font-medium text-navy">{c.name}</td>
                            <td className="px-3 py-2 text-muted-foreground">{c.role}</td>
                            <td className="px-3 py-2 text-right">{c.projectCount}</td>
                            <td className="px-3 py-2 text-right font-semibold">{c.compositeScore}</td>
                            <td className="px-3 py-2 text-right">{c.momentum}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="text-[10px] text-muted-foreground mt-3 pt-2 border-t border-gold/20">
                Generated {emergingSection.data.generatedAt ? new Date(emergingSection.data.generatedAt).toLocaleDateString() : "recently"} · {emergingSection.data.patterns.length} patterns detected
              </div>
            </div>
          )}

          {/* All Patterns */}
          {patterns.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
              <span className="ml-2 text-sm text-muted-foreground">Loading patterns...</span>
            </div>
          ) : patterns.data && patterns.data.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {patterns.data.map((pattern: any) => (
                <PatternCard key={pattern.id} pattern={pattern} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-card rounded-lg border border-border">
              <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No emerging patterns detected yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Run the contractor engine to detect patterns from project data.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Leaderboard View ── */}
      {activeView === "leaderboard" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              <option value="">All Roles</option>
              {Object.entries(roleLabels).filter(([k]) => k !== "unknown").map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={sectorFilter}
              onChange={e => setSectorFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              <option value="">All Sectors</option>
              <option value="mining">Mining</option>
              <option value="oil_gas">Oil & Gas</option>
              <option value="infrastructure">Infrastructure</option>
              <option value="energy">Energy</option>
              <option value="defence">Defence</option>
            </select>
          </div>

          {leaderboard.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
              <span className="ml-2 text-sm text-muted-foreground">Loading leaderboard...</span>
            </div>
          ) : leaderboard.data && leaderboard.data.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {leaderboard.data.map((contractor: any) => (
                <ContractorCard
                  key={contractor.id}
                  contractor={contractor}
                  onSelect={() => setSelectedContractorId(contractor.id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-card rounded-lg border border-border">
              <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No contractors in the registry yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Run the contractor engine to build the registry from project data.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Pairings View ── */}
      {activeView === "pairings" && (
        <div className="space-y-4">
          {emergingSection.data?.topPairings && emergingSection.data.topPairings.length > 0 ? (
            <div className="space-y-3">
              {emergingSection.data.topPairings.map((pair: any, i: number) => (
                <div key={i} className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center">
                      <Link2 className="w-4 h-4 text-purple-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-bold text-navy">{pair.companyA}</span>
                        <span className="text-muted-foreground">&amp;</span>
                        <span className="font-bold text-navy">{pair.companyB}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 text-[10px] font-semibold">
                          {pair.type}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {pair.count} co-occurrences · Strength: {pair.strength}/100
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-card rounded-lg border border-border">
              <Link2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No delivery chain pairings detected yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Run the contractor engine to detect recurring pairings.</p>
            </div>
          )}
        </div>
      )}

      {/* Contractor Profile Modal */}
      {selectedContractorId && (
        <ContractorProfile
          contractorId={selectedContractorId}
          onClose={() => setSelectedContractorId(null)}
        />
      )}
    </div>
  );
}
