/**
 * Admin Pipeline Dashboard — Manage business lines, RSS sources, and data pipeline.
 * Admin-only page with tabbed interface.
 */
import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  Loader2, ArrowLeft, Shield, Rss, Building2, Database, Play,
  Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw, Zap,
  BarChart3, Clock, AlertTriangle, CheckCircle2, XCircle, Filter, Users,
  UserPlus, Copy, KeyRound, Mail, Landmark, FileSearch, Network,
  CreditCard, TrendingUp, Activity, Eye, Wifi, WifiOff, CircleDot, Hash, Target, Search,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { runClientSideScrape, type ClientScrapeProgress, type ScrapedArticleData } from "@/lib/projectoryScraper";
import PilotEnrichmentPanel from "@/components/PilotEnrichmentPanel";

// ── Pipeline Stats Card ──

function StatsCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className={`${color}`}>{icon}</span>
      </div>
      <div className="text-2xl font-bold text-navy tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wider">{label}</div>
    </div>
  );
}

// ── Business Lines Tab ──

function BusinessLinesTab() {
  const { data: lines, isLoading } = trpc.businessLines.list.useQuery();
  const utils = trpc.useUtils();
  const createBL = trpc.businessLines.create.useMutation({
    onSuccess: () => { utils.businessLines.list.invalidate(); toast.success("Business line created"); },
    onError: (e) => toast.error(e.message),
  });
  const updateBL = trpc.businessLines.update.useMutation({
    onSuccess: () => { utils.businessLines.list.invalidate(); toast.success("Updated"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteBL = trpc.businessLines.delete.useMutation({
    onSuccess: () => { utils.businessLines.list.invalidate(); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formKeywords, setFormKeywords] = useState("");
  const [formSectors, setFormSectors] = useState("");
  const [formEquipment, setFormEquipment] = useState("");

  const handleCreate = () => {
    if (!formName.trim()) return toast.error("Name is required");
    createBL.mutate({
      name: formName.trim(),
      description: formDesc.trim() || undefined,
      keywords: formKeywords.split(",").map(k => k.trim()).filter(Boolean),
      sectors: formSectors.split(",").map(s => s.trim()).filter(Boolean),
      equipmentTypes: formEquipment ? formEquipment.split(",").map(e => e.trim()).filter(Boolean) : undefined,
    });
    setShowForm(false);
    setFormName(""); setFormDesc(""); setFormKeywords(""); setFormSectors(""); setFormEquipment("");
  };

  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-gold mx-auto my-8" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-navy">Business Lines ({lines?.length || 0})</h3>
        <Button onClick={() => setShowForm(!showForm)} size="sm" className="bg-gold hover:bg-gold-light text-navy gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add Business Line
        </Button>
      </div>

      {showForm && (
        <div className="bg-card rounded-lg border border-gold/30 p-4 space-y-3">
          <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Business Line Name (e.g., Power Technique)"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:ring-2 focus:ring-gold/40" />
          <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Description"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:ring-2 focus:ring-gold/40" />
          <input value={formKeywords} onChange={e => setFormKeywords(e.target.value)} placeholder="Keywords (comma-separated: compressor, drilling, portable air)"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:ring-2 focus:ring-gold/40" />
          <input value={formSectors} onChange={e => setFormSectors(e.target.value)} placeholder="Sectors (comma-separated: mining, oil_gas, infrastructure)"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:ring-2 focus:ring-gold/40" />
          <input value={formEquipment} onChange={e => setFormEquipment(e.target.value)} placeholder="Equipment Types (comma-separated, optional)"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:ring-2 focus:ring-gold/40" />
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={createBL.isPending} size="sm" className="bg-navy hover:bg-navy-light text-white">
              {createBL.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Create"}
            </Button>
            <Button onClick={() => setShowForm(false)} variant="outline" size="sm">Cancel</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {lines?.map(bl => (
          <div key={bl.id} className="bg-card rounded-lg border border-border p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="w-4 h-4 text-gold shrink-0" />
                  <h4 className="text-sm font-bold text-navy">{bl.name}</h4>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${bl.isActive ? "bg-teal/15 text-teal" : "bg-slate-200 text-slate-500"}`}>
                    {bl.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                {bl.description && <p className="text-xs text-muted-foreground mb-2">{bl.description}</p>}
                <div className="flex flex-wrap gap-1 mb-1">
                  {(bl.keywords as string[] || []).map((kw, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-navy/8 text-navy text-[10px] font-medium">{kw}</span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(bl.sectors as string[] || []).map((s, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-gold/10 text-gold-dark text-[10px] font-medium">{s}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => updateBL.mutate({ id: bl.id, isActive: !bl.isActive })}
                  className="p-1.5 rounded hover:bg-slate-100 transition-colors"
                  title={bl.isActive ? "Deactivate" : "Activate"}
                >
                  {bl.isActive ? <ToggleRight className="w-4 h-4 text-teal" /> : <ToggleLeft className="w-4 h-4 text-slate-400" />}
                </button>
                <button
                  onClick={() => { if (confirm("Delete this business line?")) deleteBL.mutate({ id: bl.id }); }}
                  className="p-1.5 rounded hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {(!lines || lines.length === 0) && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No business lines configured. Add one to start filtering articles.
          </div>
        )}
      </div>
    </div>
  );
}

// ── RSS Sources Tab ──

function getSourceHealth(src: { isActive: boolean; consecutiveErrors: number | null; lastSuccessAt: Date | string | null; lastFetchedAt: Date | string | null; failureCount: number | null; successCount: number | null }) {
  if (!src.isActive) return { color: "text-slate-400", bg: "bg-slate-100", label: "Inactive", icon: "inactive" as const };
  const consec = src.consecutiveErrors || 0;
  const success = src.successCount || 0;
  const failure = src.failureCount || 0;
  const total = success + failure;
  const successRate = total > 0 ? (success / total) * 100 : 100;
  if (consec >= 3) return { color: "text-hot", bg: "bg-hot/10", label: "Failing", icon: "error" as const };
  if (consec >= 1 || successRate < 80) return { color: "text-warm", bg: "bg-warm/10", label: "Degraded", icon: "warning" as const };
  if (!src.lastFetchedAt) return { color: "text-slate-400", bg: "bg-slate-100", label: "Never Fetched", icon: "unknown" as const };
  return { color: "text-teal", bg: "bg-teal/10", label: "Healthy", icon: "ok" as const };
}

function formatTimeAgo(date: Date | string | null): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function RssSourcesTab() {
  const { data: sources, isLoading } = trpc.rssSources.list.useQuery();
  const utils = trpc.useUtils();
  const createSrc = trpc.rssSources.create.useMutation({
    onSuccess: () => { utils.rssSources.list.invalidate(); toast.success("Source added"); },
    onError: (e) => toast.error(e.message),
  });
  const updateSrc = trpc.rssSources.update.useMutation({
    onSuccess: () => { utils.rssSources.list.invalidate(); toast.success("Updated"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteSrc = trpc.rssSources.delete.useMutation({
    onSuccess: () => { utils.rssSources.list.invalidate(); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });
  const quarantineSrc = trpc.rssSources.quarantine.useMutation({
    onSuccess: () => { utils.rssSources.list.invalidate(); toast.success("Source quarantined — will be skipped by harvester"); },
    onError: (e) => toast.error(e.message),
  });
  const unquarantineSrc = trpc.rssSources.unquarantine.useMutation({
    onSuccess: () => { utils.rssSources.list.invalidate(); toast.success("Source quarantine lifted"); },
    onError: (e) => toast.error(e.message),
  });

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formCategory, setFormCategory] = useState("industry");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleCreate = () => {
    if (!formName.trim() || !formUrl.trim()) return toast.error("Name and URL are required");
    createSrc.mutate({ name: formName.trim(), feedUrl: formUrl.trim(), category: formCategory });
    setShowForm(false);
    setFormName(""); setFormUrl(""); setFormCategory("industry");
  };

  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-gold mx-auto my-8" />;

  const categoryColors: Record<string, string> = {
    industry: "bg-teal/15 text-teal",
    news: "bg-hot/15 text-hot",
    government: "bg-cold/15 text-cold",
    asx: "bg-gold/15 text-gold-dark",
  };

  // Compute summary stats
  const activeSources = sources?.filter(s => s.isActive) || [];
  const inactiveSources = sources?.filter(s => !s.isActive) || [];
  const quarantinedSources = sources?.filter((s: any) => s.quarantined) || [];
  const healthySources = activeSources.filter(s => getSourceHealth(s).icon === "ok");
  const degradedSources = activeSources.filter(s => getSourceHealth(s).icon === "warning");
  const failingSources = activeSources.filter(s => getSourceHealth(s).icon === "error");
  const totalArticlesAll = sources?.reduce((sum, s) => sum + (s.totalArticles || 0), 0) || 0;
  const totalSuccesses = sources?.reduce((sum, s) => sum + (s.successCount || 0), 0) || 0;
  const totalFailures = sources?.reduce((sum, s) => sum + (s.failureCount || 0), 0) || 0;
  const overallSuccessRate = (totalSuccesses + totalFailures) > 0
    ? Math.round((totalSuccesses / (totalSuccesses + totalFailures)) * 100)
    : 100;

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-card rounded-lg border border-border p-3">
          <div className="text-2xl font-bold text-navy">{activeSources.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Active</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <div className="text-2xl font-bold text-teal">{healthySources.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Healthy</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <div className="text-2xl font-bold text-warm">{degradedSources.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Degraded</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <div className="text-2xl font-bold text-hot">{failingSources.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Failing</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <div className="text-2xl font-bold text-navy">{totalArticlesAll.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total Articles</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <div className="text-2xl font-bold text-teal">{overallSuccessRate}%</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Success Rate</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <div className="text-2xl font-bold text-slate-400">{inactiveSources.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Inactive</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-3">
          <div className="text-2xl font-bold text-hot">{quarantinedSources.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Quarantined</div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-navy">RSS Sources ({sources?.length || 0})</h3>
        <Button onClick={() => setShowForm(!showForm)} size="sm" className="bg-gold hover:bg-gold-light text-navy gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add Source
        </Button>
      </div>

      {showForm && (
        <div className="bg-card rounded-lg border border-gold/30 p-4 space-y-3">
          <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Source Name (e.g., Australian Mining)"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:ring-2 focus:ring-gold/40" />
          <input value={formUrl} onChange={e => setFormUrl(e.target.value)} placeholder="RSS Feed URL"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:ring-2 focus:ring-gold/40" />
          <select value={formCategory} onChange={e => setFormCategory(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:ring-2 focus:ring-gold/40">
            <option value="industry">Industry Publication</option>
            <option value="news">News</option>
            <option value="government">Government</option>
            <option value="asx">ASX / Financial</option>
          </select>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={createSrc.isPending} size="sm" className="bg-navy hover:bg-navy-light text-white">
              {createSrc.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Add Source"}
            </Button>
            <Button onClick={() => setShowForm(false)} variant="outline" size="sm">Cancel</Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy text-white">
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider w-6"></th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Source</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Category</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Health</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Last Fetch</th>
              <th className="text-right px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Last Items</th>
              <th className="text-right px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Total Articles</th>
              <th className="text-center px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Success / Fail</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources?.map((src, i) => {
              const health = getSourceHealth(src);
              const isExpanded = expandedId === src.id;
              return (
                <>
                  <tr
                    key={src.id}
                    className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors cursor-pointer`}
                    onClick={() => setExpandedId(isExpanded ? null : src.id)}
                  >
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <span className={`text-[10px] transition-transform inline-block ${isExpanded ? "rotate-90" : ""}`}>&#9654;</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-navy">{src.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{src.feedUrl}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${categoryColors[src.category] || "bg-slate-200 text-slate-600"}`}>
                        {src.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${health.bg} ${health.color}`}>
                        {health.icon === "ok" && <Wifi className="w-3 h-3" />}
                        {health.icon === "warning" && <AlertTriangle className="w-3 h-3" />}
                        {health.icon === "error" && <WifiOff className="w-3 h-3" />}
                        {health.icon === "inactive" && <XCircle className="w-3 h-3" />}
                        {health.icon === "unknown" && <CircleDot className="w-3 h-3" />}
                        {health.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {formatTimeAgo(src.lastFetchedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-right">{src.lastFetchCount || 0}</td>
                    <td className="px-4 py-2.5 text-xs text-right font-medium">{(src.totalArticles || 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-xs text-center">
                      <span className="text-teal font-medium">{src.successCount || 0}</span>
                      <span className="text-muted-foreground mx-1">/</span>
                      <span className={`font-medium ${(src.failureCount || 0) > 0 ? "text-hot" : "text-muted-foreground"}`}>{src.failureCount || 0}</span>
                    </td>
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateSrc.mutate({ id: src.id, isActive: !src.isActive })}
                          className="p-1 rounded hover:bg-slate-100" title={src.isActive ? "Deactivate" : "Activate"}>
                          {src.isActive ? <ToggleRight className="w-3.5 h-3.5 text-teal" /> : <ToggleLeft className="w-3.5 h-3.5 text-slate-400" />}
                        </button>
                        <button
                          onClick={() => {
                            const isQ = (src as any).quarantined;
                            if (isQ) {
                              unquarantineSrc.mutate({ id: src.id });
                            } else {
                              const reason = prompt("Quarantine reason (optional):") ?? "Admin quarantine";
                              quarantineSrc.mutate({ id: src.id, reason });
                            }
                          }}
                          className={`p-1 rounded hover:bg-orange-50 ${(src as any).quarantined ? "bg-orange-100" : ""}`}
                          title={(src as any).quarantined ? "Lift quarantine" : "Quarantine source (skip in harvester)"}
                        >
                          <Ban className={`w-3.5 h-3.5 ${(src as any).quarantined ? "text-hot" : "text-slate-400"}`} />
                        </button>
                        <button onClick={() => { if (confirm("Delete this source?")) deleteSrc.mutate({ id: src.id }); }}
                          className="p-1 rounded hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${src.id}-detail`} className="border-t border-border bg-slate-50/50">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                          <div>
                            <div className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium mb-1">Last Success</div>
                            <div className="font-medium text-navy">{src.lastSuccessAt ? new Date(src.lastSuccessAt as unknown as string).toLocaleString() : "Never"}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium mb-1">Last Error</div>
                            <div className="font-medium text-navy">{src.lastErrorAt ? new Date(src.lastErrorAt as unknown as string).toLocaleString() : "Never"}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium mb-1">Consecutive Errors</div>
                            <div className={`font-medium ${(src.consecutiveErrors || 0) > 0 ? "text-hot" : "text-teal"}`}>{src.consecutiveErrors || 0}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium mb-1">Success Rate</div>
                            <div className="font-medium text-navy">
                              {((src.successCount || 0) + (src.failureCount || 0)) > 0
                                ? `${Math.round(((src.successCount || 0) / ((src.successCount || 0) + (src.failureCount || 0))) * 100)}%`
                                : "N/A"}
                            </div>
                          </div>
                        </div>
                        {src.lastError && (
                          <div className="mt-3 p-2 rounded bg-hot/5 border border-hot/20">
                            <div className="text-[10px] text-hot font-semibold uppercase tracking-wider mb-1">Last Error Message</div>
                            <div className="text-xs text-foreground/80 font-mono">{src.lastError}</div>
                          </div>
                        )}
                        {(src as any).quarantined && (
                          <div className="mt-3 p-2 rounded bg-orange-50 border border-orange-200">
                            <div className="text-[10px] text-orange-700 font-semibold uppercase tracking-wider mb-1">Quarantined — Skipped by Harvester</div>
                            <div className="text-xs text-orange-800">{(src as any).quarantineReason || "No reason provided"}</div>
                          </div>
                        )}
                        <div className="mt-3 text-[10px] text-muted-foreground">
                          Feed URL: <a href={src.feedUrl} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline">{src.feedUrl}</a>
                          {" | "}Created: {new Date(src.createdAt).toLocaleDateString()}
                          {" | "}Total fetches: {(src.successCount || 0) + (src.failureCount || 0)}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Pipeline Operations Tab ──

function PipelineOpsTab() {
  const { data: stats, isLoading, refetch: refetchStats } = trpc.dataPipeline.stats.useQuery();
  const harvestMut = trpc.dataPipeline.harvest.useMutation({
    onSuccess: (data) => {
      toast.success(`Harvested ${data.totalNew} new articles from ${data.totalSources} sources`);
      refetchStats();
    },
    onError: (e) => toast.error(`Harvest failed: ${e.message}`),
  });
  const extractMut = trpc.dataPipeline.extract.useMutation({
    onSuccess: (data) => {
      toast.success(`Extracted ${data.extracted} projects from ${data.processed} articles`);
      refetchStats();
    },
    onError: (e) => toast.error(`Extraction failed: ${e.message}`),
  });

  const { data: recentArticles } = trpc.dataPipeline.recentArticles.useQuery({ limit: 20 });
  const seedMut = trpc.seed.defaults.useMutation({
    onSuccess: (data) => {
      toast.success(`Seeded ${data.businessLinesCreated} business lines and ${data.rssSourcesCreated} RSS sources`);
      refetchStats();
    },
    onError: (e) => toast.error(`Seed failed: ${e.message}`),
  });
  const enrichMut = trpc.dataPipeline.enrich.useMutation({
    onSuccess: (data) => {
      toast.success(`Enriched ${data.enriched} contacts. ${data.notFound} not found, ${data.failed} failed.`);
      refetchStats();
    },
    onError: (e) => toast.error(`Enrichment failed: ${e.message}`),
  });
  const { data: enrichStats } = trpc.dataPipeline.enrichmentStats.useQuery();
  const fullPipelineMut = trpc.dailyPipeline.run.useMutation({
    onSuccess: (data) => {
      toast.success(`Full pipeline complete in ${data.duration}s: ${data.extraction.extracted} projects, ${data.enrichment.enriched} contacts enriched`);
      refetchStats();
    },
    onError: (e) => toast.error(`Pipeline failed: ${e.message}`),
  });
  const weeklyPipelineMut = trpc.weeklyPipeline.run.useMutation({
    onSuccess: (data) => {
      toast.success(`Weekly mega-scrape complete in ${Math.floor(data.duration / 60)}m ${data.duration % 60}s: ${data.totalNewProjects} new projects, ${data.totalNewContacts} new contacts`);
      refetchStats();
    },
    onError: (e) => toast.error(`Weekly pipeline failed: ${e.message}`),
  });
  const projectoryIngest = trpc.projectory.ingest.useMutation({
    onSuccess: (data) => {
      toast.success(`Projectory: ${data.totalNewProjects} new projects, ${data.totalNewContacts} contacts, ${data.totalDuplicates} duplicates`);
      refetchStats();
      setProjectoryProgress(null);
    },
    onError: (e) => {
      toast.error(`Projectory ingest failed: ${e.message}`);
      setProjectoryProgress(null);
    },
  });
  const [projectoryProgress, setProjectoryProgress] = useState<ClientScrapeProgress | null>(null);
  const isProjectoryScraping = projectoryProgress !== null;

  const handleProjectoryScrape = useCallback(async () => {
    try {
      setProjectoryProgress({ phase: "listing", message: "Starting...", articlesFound: 0, articlesScraped: 0, totalArticles: 0 });
      const results = await runClientSideScrape((progress) => {
        setProjectoryProgress(progress);
      });

      // Send to server for deduplication and storage
      setProjectoryProgress({ phase: "sending", message: `Sending ${results.length} articles to server...`, articlesFound: results.length, articlesScraped: results.length, totalArticles: results.length });

      // Batch in chunks of 10 to avoid payload size limits
      const BATCH_SIZE = 10;
      for (let i = 0; i < results.length; i += BATCH_SIZE) {
        const batch = results.slice(i, i + BATCH_SIZE);
        await projectoryIngest.mutateAsync({ articles: batch });
      }

      setProjectoryProgress({ phase: "done", message: "Complete!", articlesFound: results.length, articlesScraped: results.length, totalArticles: results.length });
      setTimeout(() => setProjectoryProgress(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Projectory scrape failed: ${msg}`);
      setProjectoryProgress(null);
    }
  }, [projectoryIngest]);
  const dmirsScrape = trpc.dmirs.scrape.useMutation({
    onSuccess: (data) => {
      toast.success(`DMIRS: ${data.totalNewProjects} new projects, ${data.totalDuplicates} duplicates from ${data.totalFetched} registrations (${data.duration}s)`);
      refetchStats();
    },
    onError: (e) => toast.error(`DMIRS scrape failed: ${e.message}`),
  });
  const aemoScrape = trpc.aemo.scrape.useMutation({
    onSuccess: (data) => {
      toast.success(`AEMO: ${data.totalNewProjects} new projects, ${data.totalDuplicates} duplicates, ${data.totalSkipped} skipped (${data.duration}s)`);
      refetchStats();
    },
    onError: (e) => toast.error(`AEMO scrape failed: ${e.message}`),
  });
  const govScrape = trpc.gov.scrape.useMutation({
    onSuccess: (data) => {
      toast.success(`Gov Projects: ${data.totalNewProjects} new projects, ${data.totalDuplicates} duplicates from ${data.totalFetched} government projects (${data.duration}s)`);
      refetchStats();
    },
    onError: (e) => toast.error(`Gov scrape failed: ${e.message}`),
  });
  const austenderScrape = trpc.austender.scrape.useMutation({
    onSuccess: (data) => {
      toast.success(`AusTender: ${data.totalNewProjects} new from ${data.totalRelevant} relevant contracts (${data.totalFetched} fetched, ${data.totalDuplicates} duplicates, ${data.duration}s)`);
      refetchStats();
    },
    onError: (e) => toast.error(`AusTender scrape failed: ${e.message}`),
  });
  const icnScrape = trpc.icn.scrape.useMutation({
    onSuccess: (data) => {
      toast.success(`ICN Gateway: ${data.totalNewProjects} new projects, ${data.totalDuplicates} duplicates from ${data.totalFetched} ICN projects (${data.duration}s)`);
      refetchStats();
    },
    onError: (e) => toast.error(`ICN scrape failed: ${e.message}`),
  });
  const webDiscoveryMut = trpc.dataPipeline.bulkWebDiscovery.useMutation({
    onSuccess: (data) => {
      toast.success(`Web Discovery: ${data.contactsFound} contacts found across ${data.processed} projects`);
      refetchStats();
    },
    onError: (e) => toast.error(`Web discovery failed: ${e.message}`),
  });
  const { data: webDiscoveryStats, refetch: refetchWebStats } = trpc.dataPipeline.webDiscoveryStats.useQuery();
  const { data: apolloBudget, refetch: refetchBudget } = trpc.dataPipeline.apolloBudget.useQuery();
  const { data: apolloEligible, refetch: refetchEligible } = trpc.dataPipeline.apolloEligibleProjects.useQuery();
  const { data: unscoredCount, refetch: refetchUnscored } = trpc.dataPipeline.unscoredCount.useQuery();
  const bulkScoreMut = trpc.dataPipeline.bulkScoreProjects.useMutation({
    onSuccess: (data) => {
      toast.success(`BL Scoring: ${data.scored} projects scored, ${data.failed} failed out of ${data.total}`);
      refetchStats();
      refetchUnscored();
    },
    onError: (e) => toast.error(`BL scoring failed: ${e.message}`),
  });

  // Tier Classification
  const { data: tierDist, refetch: refetchTierDist } = trpc.tierClassification.distribution.useQuery();
  const classifyAllMut = trpc.tierClassification.classifyAll.useMutation({
    onSuccess: (data) => {
      toast.success(`Tier Classification: ${data.classified} classified — T1:${data.tier1Count} T2:${data.tier2Count} T3:${data.tier3Count}`);
      refetchStats();
      refetchTierDist();
    },
    onError: (e) => toast.error(`Tier classification failed: ${e.message}`),
  });

  // Contractor Enrichment Pass
  const { data: missingContractorCount, refetch: refetchMissingCount } = trpc.contractorEnrichment.missingCount.useQuery();
  const contractorEnrichMut = trpc.contractorEnrichment.runPass.useMutation({
    onSuccess: (data) => {
      toast.success(`Contractor Enrichment: ${data.enriched} projects enriched, ${data.contractorsDiscovered} contractors discovered`);
      refetchStats();
      refetchMissingCount();
    },
    onError: (e) => toast.error(`Contractor enrichment failed: ${e.message}`),
  });

  // Role Relevance Classification
  const { data: relevanceDist, refetch: refetchRelevanceDist } = trpc.roleRelevance.distribution.useQuery();
  const classifyRelevanceMut = trpc.roleRelevance.classifyAll.useMutation({
    onSuccess: (data) => {
      toast.success(`Role Relevance: ${data.total} contacts classified — High:${data.highCount} Medium:${data.mediumCount} Low:${data.lowCount}`);
      refetchStats();
      refetchRelevanceDist();
    },
    onError: (e) => toast.error(`Role relevance classification failed: ${e.message}`),
  });

  // Second-Pass Contact Search
  const { data: gapCount, refetch: refetchGapCount } = trpc.secondPassSearch.gapCount.useQuery();
  const secondPassMut = trpc.secondPassSearch.runBulk.useMutation({
    onSuccess: (data) => {
      toast.success(`Second-Pass Search: ${data.totalContactsAdded} contacts added across ${data.projectsImproved} projects`);
      refetchStats();
      refetchGapCount();
      refetchRelevanceDist();
    },
    onError: (e) => toast.error(`Second-pass search failed: ${e.message}`),
  });

  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-gold mx-auto my-8" />;

  const rawArticleStats = stats?.articles;
  const articleStats = {
    pending: rawArticleStats?.pending ?? 0,
    queued: rawArticleStats?.queued ?? 0,
    extracted: rawArticleStats?.extracted ?? 0,
    skipped: rawArticleStats?.skipped ?? 0,
    failed: rawArticleStats?.failed ?? 0,
    total: rawArticleStats?.total ?? 0,
  };

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatsCard label="Active Sources" value={stats?.pipeline?.activeSources ?? 0} icon={<Rss className="w-4 h-4" />} color="text-teal" />
        <StatsCard label="Business Lines" value={stats?.pipeline?.activeBusinessLines ?? 0} icon={<Building2 className="w-4 h-4" />} color="text-gold" />
        <StatsCard label="Queued" value={articleStats.queued} icon={<Clock className="w-4 h-4" />} color="text-warm" />
        <StatsCard label="Extracted" value={articleStats.extracted} icon={<CheckCircle2 className="w-4 h-4" />} color="text-teal" />
        <StatsCard label="Skipped" value={articleStats.skipped} icon={<Filter className="w-4 h-4" />} color="text-muted-foreground" />
        <StatsCard label="Failed" value={articleStats.failed} icon={<AlertTriangle className="w-4 h-4" />} color="text-hot" />
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => harvestMut.mutate()}
          disabled={harvestMut.isPending}
          className="bg-teal hover:bg-teal/90 text-white gap-1.5"
        >
          {harvestMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Harvest RSS Feeds
        </Button>
        <Button
          onClick={() => extractMut.mutate({})}
          disabled={extractMut.isPending}
          className="bg-gold hover:bg-gold-light text-navy gap-1.5"
        >
          {extractMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Run AI Extraction
        </Button>
        <Button
          onClick={() => fullPipelineMut.mutate()}
          disabled={fullPipelineMut.isPending}
          className="bg-hot hover:bg-hot/90 text-white gap-1.5"
        >
          {fullPipelineMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Run Full Pipeline
        </Button>
        <Button
          onClick={() => weeklyPipelineMut.mutate()}
          disabled={weeklyPipelineMut.isPending}
          className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
        >
          {weeklyPipelineMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          Weekly Mega-Scrape
        </Button>
        <Button onClick={() => refetchStats()} variant="outline" size="sm" className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh Stats
        </Button>
        <Button
          onClick={() => enrichMut.mutate({})}
          disabled={enrichMut.isPending}
          className="bg-navy hover:bg-navy/90 text-white gap-1.5"
        >
          {enrichMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          Enrich Contacts
        </Button>
        <Button
          onClick={() => seedMut.mutate()}
          disabled={seedMut.isPending}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          {seedMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
          Seed Defaults
        </Button>
        <Button
          onClick={handleProjectoryScrape}
          disabled={isProjectoryScraping}
          className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
        >
          {isProjectoryScraping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          {isProjectoryScraping ? "Scraping..." : "Scrape Projectory"}
        </Button>
        <Button
          onClick={() => dmirsScrape.mutate({})}
          disabled={dmirsScrape.isPending}
          className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
        >
          {dmirsScrape.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
          Scrape DMIRS
        </Button>
        <Button
          onClick={() => aemoScrape.mutate()}
          disabled={aemoScrape.isPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
        >
          {aemoScrape.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Scrape AEMO
        </Button>
        <Button
          onClick={() => govScrape.mutate()}
          disabled={govScrape.isPending}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
        >
          {govScrape.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Landmark className="w-4 h-4" />}
          Scrape Gov Projects
        </Button>
        <Button
          onClick={() => austenderScrape.mutate()}
          disabled={austenderScrape.isPending}
          className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
        >
          {austenderScrape.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
          Scrape AusTender
        </Button>
        <Button
          onClick={() => icnScrape.mutate()}
          disabled={icnScrape.isPending}
          className="bg-cyan-600 hover:bg-cyan-700 text-white gap-1.5"
        >
          {icnScrape.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />}
          Scrape ICN Gateway
        </Button>
        <Button
          onClick={() => webDiscoveryMut.mutate({})}
          disabled={webDiscoveryMut.isPending}
          className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
        >
          {webDiscoveryMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          Web Stakeholder Discovery
        </Button>
        <Button
          onClick={() => bulkScoreMut.mutate({})}
          disabled={bulkScoreMut.isPending}
          className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
        >
          {bulkScoreMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
          Score Business Lines {unscoredCount?.count ? `(${unscoredCount.count})` : ""}
        </Button>
        <Button
          onClick={() => classifyAllMut.mutate()}
          disabled={classifyAllMut.isPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
        >
          {classifyAllMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
          Classify Tiers {tierDist ? `(T1:${tierDist.tier1} T2:${tierDist.tier2} T3:${tierDist.tier3})` : ""}
        </Button>
        <Button
          onClick={() => contractorEnrichMut.mutate({})}
          disabled={contractorEnrichMut.isPending}
          className="bg-orange-600 hover:bg-orange-700 text-white gap-1.5"
        >
          {contractorEnrichMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          Enrich Contractors {missingContractorCount !== undefined ? `(${missingContractorCount} missing)` : ""}
        </Button>
        <Button
          onClick={() => classifyRelevanceMut.mutate()}
          disabled={classifyRelevanceMut.isPending}
          className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5"
        >
          {classifyRelevanceMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          Classify Roles {relevanceDist ? `(H:${relevanceDist.high} M:${relevanceDist.medium} L:${relevanceDist.low})` : ""}
        </Button>
        <Button
          onClick={() => secondPassMut.mutate({})}
          disabled={secondPassMut.isPending}
          className="bg-cyan-600 hover:bg-cyan-700 text-white gap-1.5"
        >
          {secondPassMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          2nd Pass Contacts {gapCount !== undefined ? `(${gapCount} gaps)` : ""}
        </Button>
      </div>

      {/* AusTender Status */}
      <div className="bg-card rounded-lg border border-purple-200 p-4 mb-3">
        <h3 className="text-sm font-bold text-navy mb-2 flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-purple-600" /> AusTender OCDS API
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1 text-teal">
            <CheckCircle2 className="w-3.5 h-3.5" /> Public API — no auth required
          </span>
          <span className="text-muted-foreground text-xs">Fetches recent government contracts over $1M in construction, mining, energy, water, and defence. Runs Thursdays via daily pipeline.</span>
        </div>
      </div>

      {/* ICN Gateway Status */}
      <div className="bg-card rounded-lg border border-cyan-200 p-4 mb-3">
        <h3 className="text-sm font-bold text-navy mb-2 flex items-center gap-2">
          <Network className="w-4 h-4 text-cyan-600" /> ICN Gateway Projects
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1 text-teal">
            <CheckCircle2 className="w-3.5 h-3.5" /> Curated major projects with work packages
          </span>
          <span className="text-muted-foreground text-xs">24 curated ICN projects: defence, mining, transport, energy. Open work packages = active supplier opportunities. Runs Saturdays via daily pipeline.</span>
        </div>
      </div>

      {/* Gov Projects Status */}
      <div className="bg-card rounded-lg border border-blue-200 p-4 mb-3">
        <h3 className="text-sm font-bold text-navy mb-2 flex items-center gap-2">
          <Landmark className="w-4 h-4 text-blue-600" /> Government Major Projects
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1 text-teal">
            <CheckCircle2 className="w-3.5 h-3.5" /> Infrastructure Australia + NREPL projects
          </span>
          <span className="text-muted-foreground text-xs">43 curated projects: transport, water, energy, defence. Runs Tuesdays via daily pipeline.</span>
        </div>
      </div>

      {/* AEMO Status */}
      <div className="bg-card rounded-lg border border-emerald-200 p-4 mb-3">
        <h3 className="text-sm font-bold text-navy mb-2 flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-600" /> AEMO Generation Information
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1 text-teal">
            <CheckCircle2 className="w-3.5 h-3.5" /> Curated BESS & power generation projects
          </span>
          <span className="text-muted-foreground text-xs">Major BESS, pumped hydro, and gas peaker projects across NEM. Runs Fridays via daily pipeline.</span>
        </div>
      </div>

      {/* DMIRS Status */}
      <div className="bg-card rounded-lg border border-amber-200 p-4 mb-3">
        <h3 className="text-sm font-bold text-navy mb-2 flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-600" /> DMIRS MINEDEX Integration
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1 text-teal">
            <CheckCircle2 className="w-3.5 h-3.5" /> Public API — no auth required
          </span>
          <span className="text-muted-foreground text-xs">Fetches approved WA mining proposals (last 90 days). Runs Wednesdays via daily pipeline. Zero AI credits.</span>
        </div>
      </div>

      {/* Projectory Status */}
      <div className="bg-card rounded-lg border border-purple-200 p-4">
        <h3 className="text-sm font-bold text-navy mb-2 flex items-center gap-2">
          <Database className="w-4 h-4 text-purple-600" /> Projectory Integration
        </h3>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-teal">
              <CheckCircle2 className="w-3.5 h-3.5" /> Client-side scraper (bypasses anti-bot)
            </span>
            <span className="text-muted-foreground text-xs">Scrapes 6 categories, ~60 articles per run. Zero AI credits.</span>
          </div>
          {projectoryProgress && (
            <div className="bg-purple-50 border border-purple-200 rounded p-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-purple-700">{projectoryProgress.phase.toUpperCase()}</span>
                <span className="text-purple-600">{projectoryProgress.articlesScraped}/{projectoryProgress.totalArticles || '?'}</span>
              </div>
              <p className="text-xs text-purple-600">{projectoryProgress.message}</p>
              {projectoryProgress.totalArticles > 0 && (
                <div className="mt-1 h-1.5 bg-purple-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((projectoryProgress.articlesScraped / projectoryProgress.totalArticles) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Web Stakeholder Discovery Stats */}
      {webDiscoveryStats && (webDiscoveryStats.totalWebContacts > 0 || webDiscoveryMut.isPending) && (
        <div className="bg-card rounded-lg border border-indigo-200 p-4">
          <h3 className="text-sm font-bold text-navy mb-3 flex items-center gap-2">
            <Eye className="w-4 h-4 text-indigo-600" /> Web Stakeholder Discovery
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatsCard label="Web Contacts" value={webDiscoveryStats.totalWebContacts} icon={<Users className="w-4 h-4" />} color="text-indigo-600" />
            <StatsCard label="Projects Covered" value={webDiscoveryStats.projectsWithWebContacts} icon={<CheckCircle2 className="w-4 h-4" />} color="text-teal" />
            <StatsCard label="Avg per Project" value={webDiscoveryStats.avgPerProject} icon={<BarChart3 className="w-4 h-4" />} color="text-gold" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Contacts discovered from public web sources (project announcements, company websites, news articles). Source URLs stored for attribution.</p>
        </div>
      )}

      {/* Apollo Selective Enrichment */}
      <div className="bg-card rounded-lg border border-amber-200 p-4">
        <h3 className="text-sm font-bold text-navy mb-3 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-amber-600" /> Apollo Selective Enrichment
        </h3>
        <p className="text-[11px] text-muted-foreground mb-3">
          Apollo credits are reserved for high-priority projects, pipeline-claimed projects, and explicit user requests. The daily pipeline auto-fills gaps (missing emails, insufficient contacts) on eligible projects only.
        </p>

        {/* Budget Status */}
        {apolloBudget && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-amber-50 rounded-lg border border-amber-100 p-3">
              <div className="text-lg font-bold text-amber-700">{apolloBudget.dailyUsed}/{apolloBudget.dailyCap}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Daily Credits</div>
            </div>
            <div className="bg-amber-50 rounded-lg border border-amber-100 p-3">
              <div className="text-lg font-bold text-amber-700">{apolloBudget.monthlyUsed}/{apolloBudget.monthlyCap}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Monthly Credits</div>
            </div>
            <div className="bg-amber-50 rounded-lg border border-amber-100 p-3">
              <div className="text-lg font-bold text-amber-700">{apolloBudget.dailyRemaining}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Daily Remaining</div>
            </div>
            <div className={`rounded-lg border p-3 ${apolloBudget.withinBudget ? 'bg-teal/10 border-teal/30' : 'bg-hot/10 border-hot/30'}`}>
              <div className={`text-lg font-bold ${apolloBudget.withinBudget ? 'text-teal' : 'text-hot'}`}>
                {apolloBudget.withinBudget ? 'Active' : 'Exhausted'}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Budget Status</div>
            </div>
          </div>
        )}

        {/* Eligible Projects */}
        {apolloEligible && apolloEligible.eligible.length > 0 && (
          <div className="mb-3">
            <h4 className="text-xs font-bold text-navy mb-2 flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-500" /> Auto-Eligible Projects ({apolloEligible.eligible.length})
            </h4>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {apolloEligible.eligible.map((proj: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs bg-amber-50/50 rounded px-3 py-2 border border-amber-100/50">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                      proj.reason === 'hot_priority' ? 'bg-hot text-white' :
                      proj.reason === 'pipeline_claimed' ? 'bg-gold text-navy' :
                      'bg-navy text-white'
                    }`}>{proj.reason.replace('_', ' ')}</span>
                    <span className="font-medium text-navy">{proj.projectName}</span>
                  </div>
                  <span className="text-muted-foreground">max {proj.maxCredits} credits</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {apolloEligible && apolloEligible.eligible.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No projects currently eligible for auto Apollo enrichment. Projects become eligible when marked as hot priority or claimed into the pipeline.</p>
        )}

        <div className="flex items-center gap-2 mt-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full bg-hot" /> Hot Priority
            <span className="inline-block w-2 h-2 rounded-full bg-gold ml-2" /> Pipeline Claimed
            <span className="inline-block w-2 h-2 rounded-full bg-navy ml-2" /> Explicit Request
          </div>
        </div>
      </div>

      {/* Pilot-Week Enrichment Run */}
      <PilotEnrichmentPanel />
      {/* Contact Enrichment Stats */}
      {enrichStats && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-sm font-bold text-navy mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-gold" /> Contact Enrichment
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatsCard label="Total Contacts" value={enrichStats.total} icon={<Users className="w-4 h-4" />} color="text-navy" />
            <StatsCard label="Enriched" value={enrichStats.enriched} icon={<CheckCircle2 className="w-4 h-4" />} color="text-teal" />
            <StatsCard label="Pending" value={enrichStats.pending} icon={<Clock className="w-4 h-4" />} color="text-warm" />
            <StatsCard label="Not Found" value={enrichStats.notFound} icon={<XCircle className="w-4 h-4" />} color="text-muted-foreground" />
            <StatsCard label="Failed" value={enrichStats.failed} icon={<AlertTriangle className="w-4 h-4" />} color="text-hot" />
            <StatsCard label="Daily Usage" value={`${enrichStats.dailyUsed}/${enrichStats.dailyCap}`} icon={<BarChart3 className="w-4 h-4" />} color="text-gold" />
          </div>
        </div>
      )}

      {/* Daily Extraction Chart */}
      {stats?.dailyExtractions && stats.dailyExtractions.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-sm font-bold text-navy mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-gold" /> Daily Extractions (Last 7 Days)
          </h3>
          <div className="flex items-end gap-1 h-24">
            {stats.dailyExtractions.map((d, i) => {
              const maxCount = Math.max(...stats.dailyExtractions.map(x => x.count), 1);
              const height = (d.count / maxCount) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">{d.count}</span>
                  <div className="w-full bg-gold/20 rounded-t" style={{ height: `${height}%`, minHeight: "2px" }}>
                    <div className="w-full h-full bg-gold rounded-t" />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{d.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Articles */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-sm font-bold text-navy mb-3">Recent Articles</h3>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {recentArticles?.map(article => {
            const statusColors: Record<string, string> = {
              pending: "bg-slate-200 text-slate-600",
              queued: "bg-warm/15 text-warm",
              extracted: "bg-teal/15 text-teal",
              skipped: "bg-slate-200 text-slate-500",
              failed: "bg-hot/15 text-hot",
            };
            return (
              <div key={article.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 mt-0.5 ${statusColors[article.status] || ""}`}>
                  {article.status}
                </span>
                <div className="flex-1 min-w-0">
                  <a href={article.url} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-medium text-navy hover:text-gold transition-colors line-clamp-1">
                    {article.title}
                  </a>
                  <div className="flex items-center gap-2 mt-0.5">
                    {article.matchedKeywords && (article.matchedKeywords as string[]).slice(0, 3).map((kw, i) => (
                      <span key={i} className="text-[9px] px-1 rounded bg-navy/5 text-navy">{kw}</span>
                    ))}
                    <span className="text-[9px] text-muted-foreground">
                      {article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : ""}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {(!recentArticles || recentArticles.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-4">No articles yet. Run a harvest to start collecting.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── User Management Tab ──

function UserManagementTab() {
  const utils = trpc.useUtils();
  const { data: emailUsers, isLoading } = trpc.userManagement.listEmailUsers.useQuery();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"user" | "distributor" | "admin">("distributor");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [lastResetUrl, setLastResetUrl] = useState<string | null>(null);

  const inviteMutation = trpc.userManagement.invite.useMutation({
    onSuccess: (data) => {
      setLastInviteUrl(data.registrationUrl);
      setShowInvite(false);
      setInviteName("");
      setInviteEmail("");
      utils.userManagement.listEmailUsers.invalidate();
      toast.success(`Invitation created for ${data.email}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const resetPwMutation = trpc.userManagement.resetPassword.useMutation({
    onSuccess: (data) => {
      setLastResetUrl(data.resetUrl);
      toast.success("Password reset link generated");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.userManagement.deleteUser.useMutation({
    onSuccess: () => {
      utils.userManagement.listEmailUsers.invalidate();
      toast.success("User deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="space-y-6">
      {/* Invite URL display */}
      {lastInviteUrl && (
        <div className="bg-teal/10 border border-teal/30 rounded-lg p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-teal flex items-center gap-2"><Mail className="w-4 h-4" /> Invitation Link Created</h3>
              <p className="text-xs text-muted-foreground mt-1">Send this link to the user to complete their registration. Expires in 72 hours.</p>
              <code className="text-xs bg-card border border-border rounded px-2 py-1 mt-2 block break-all">{lastInviteUrl}</code>
            </div>
            <Button size="sm" variant="outline" onClick={() => copyToClipboard(lastInviteUrl)} className="shrink-0">
              <Copy className="w-3.5 h-3.5 mr-1" /> Copy
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setLastInviteUrl(null)} className="mt-2 text-xs">Dismiss</Button>
        </div>
      )}

      {/* Reset URL display */}
      {lastResetUrl && (
        <div className="bg-gold/10 border border-gold/30 rounded-lg p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-gold-dark flex items-center gap-2"><KeyRound className="w-4 h-4" /> Password Reset Link</h3>
              <p className="text-xs text-muted-foreground mt-1">Send this link to the user to reset their password. Expires in 72 hours.</p>
              <code className="text-xs bg-card border border-border rounded px-2 py-1 mt-2 block break-all">{lastResetUrl}</code>
            </div>
            <Button size="sm" variant="outline" onClick={() => copyToClipboard(lastResetUrl)} className="shrink-0">
              <Copy className="w-3.5 h-3.5 mr-1" /> Copy
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setLastResetUrl(null)} className="mt-2 text-xs">Dismiss</Button>
        </div>
      )}

      {/* Invite form */}
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-navy flex items-center gap-2">
            <Users className="w-5 h-5 text-gold" /> Email/Password Users
          </h2>
          <Button
            size="sm"
            onClick={() => setShowInvite(!showInvite)}
            className="bg-navy hover:bg-navy-light text-white gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" /> Invite User
          </Button>
        </div>

        {showInvite && (
          <div className="bg-slate-50 border border-border rounded-lg p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Full Name</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="John Smith"
                  className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Email Address</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="john@company.com"
                  className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "user" | "distributor" | "admin")}
                  className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                >
                  <option value="distributor">Distributor</option>
                  <option value="user">Internal User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (!inviteName || !inviteEmail) { toast.error("Name and email are required"); return; }
                  inviteMutation.mutate({ name: inviteName, email: inviteEmail, role: inviteRole });
                }}
                disabled={inviteMutation.isPending}
                className="bg-teal hover:bg-teal-light text-white gap-1.5"
              >
                {inviteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                Send Invitation
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowInvite(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Users table */}
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>
        ) : !emailUsers || emailUsers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No email/password users yet. Invite your first distributor above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Email</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Last Login</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {emailUsers.map((u, i) => (
                  <tr key={u.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                    <td className="px-4 py-3 font-medium text-navy">{u.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        u.role === "admin" ? "bg-hot/15 text-hot" :
                        u.role === "distributor" ? "bg-teal/15 text-teal" :
                        "bg-gold/15 text-gold-dark"
                      }`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      {u.hasPendingInvite ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-warm/15 text-warm">Pending</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-teal/15 text-teal">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => resetPwMutation.mutate({ userId: u.id })}
                          className="px-2 py-1 rounded text-[10px] font-semibold bg-gold/15 text-gold-dark hover:bg-gold/25 transition-colors"
                          title="Generate password reset link"
                        >
                          <KeyRound className="w-3 h-3 inline mr-0.5" /> Reset PW
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete user ${u.name}?`)) deleteMutation.mutate({ userId: u.id });
                          }}
                          className="px-2 py-1 rounded text-[10px] font-semibold bg-hot/15 text-hot hover:bg-hot/25 transition-colors"
                          title="Delete user"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-gold/8 border border-gold/25 rounded-lg p-4">
        <p className="text-sm text-foreground/80">
          <strong className="text-navy">How it works:</strong> Invite a user by entering their name, email, and role. They receive a registration link to set their password. Internal team members can continue using Manus OAuth login. Both auth methods work side by side.
        </p>
      </div>

      {/* Campaign Access Management */}
      <CampaignAccessSection />
    </div>
  );
}

// ── Campaign Access Management ──

function CampaignAccessSection() {
  const utils = trpc.useUtils();
  const { data: allUsers, isLoading } = trpc.userManagement.listAllUsers.useQuery();
  const toggleMutation = trpc.userManagement.toggleCampaignAccess.useMutation({
    onSuccess: () => {
      utils.userManagement.listAllUsers.invalidate();
      toast.success("Campaign access updated");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <Target className="w-5 h-5 text-gold" /> Campaign Access
        </h2>
        <span className="text-xs text-muted-foreground">Toggle who can see the Campaigns tab</span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Admins always have campaign access. Use the toggles below to grant or revoke access for non-admin users.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>
      ) : !allUsers || allUsers.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No users found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Auth</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider">Campaign Access</th>
              </tr>
            </thead>
            <tbody>
              {allUsers.map((u, i) => {
                const isAdmin = u.role === "admin";
                const hasAccess = isAdmin || u.campaignAccess;
                return (
                  <tr key={u.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                    <td className="px-4 py-3 font-medium text-navy">{u.name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        u.role === "admin" ? "bg-hot/15 text-hot" :
                        u.role === "distributor" ? "bg-teal/15 text-teal" :
                        "bg-gold/15 text-gold-dark"
                      }`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        u.authMethod === "oauth" ? "bg-navy/10 text-navy" : "bg-teal/15 text-teal"
                      }`}>{u.authMethod}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isAdmin ? (
                        <span className="text-xs text-muted-foreground italic">Always (admin)</span>
                      ) : (
                        <button
                          onClick={() => toggleMutation.mutate({ userId: u.id, campaignAccess: !u.campaignAccess })}
                          disabled={toggleMutation.isPending}
                          className="inline-flex items-center gap-1.5 transition-colors"
                          title={hasAccess ? "Revoke campaign access" : "Grant campaign access"}
                        >
                          {u.campaignAccess ? (
                            <ToggleRight className="w-6 h-6 text-teal" />
                          ) : (
                            <ToggleLeft className="w-6 h-6 text-slate-400" />
                          )}
                          <span className={`text-xs font-semibold ${u.campaignAccess ? "text-teal" : "text-slate-400"}`}>
                            {u.campaignAccess ? "Enabled" : "Disabled"}
                          </span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Apollo Credits Tab ──

function ApolloCreditsTab() {
  const [period, setPeriod] = useState<"this_month" | "last_month" | "last_7_days" | "last_30_days" | "all_time">("this_month");
  const { data, isLoading, refetch } = trpc.dataPipeline.apolloCreditUsage.useQuery({ period });
  const { data: apiStatus, isLoading: statusLoading } = trpc.dataPipeline.apolloStatus.useQuery();

  const periodLabels: Record<string, string> = {
    this_month: "This Month",
    last_month: "Last Month",
    last_7_days: "Last 7 Days",
    last_30_days: "Last 30 Days",
    all_time: "All Time",
  };

  const actionLabels: Record<string, string> = {
    reveal: "Contact Reveal",
    enrich_project: "Project Enrichment",
    verify_email: "Email Verification",
  };

  const actionIcons: Record<string, React.ReactNode> = {
    reveal: <Eye className="w-3.5 h-3.5" />,
    enrich_project: <Users className="w-3.5 h-3.5" />,
    verify_email: <Mail className="w-3.5 h-3.5" />,
  };

  const formatDate = (d: Date | string | null) => {
    if (!d) return "—";
    const date = typeof d === "string" ? new Date(d) : d;
    return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-bold text-navy flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-gold" /> Apollo.io Credit Usage
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">Monitor API credit consumption across your team</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as typeof period)}
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:ring-2 focus:ring-gold/40 focus:border-gold"
          >
            {Object.entries(periodLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <Button onClick={() => refetch()} variant="outline" size="sm" className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* API Status Banner */}
      {!statusLoading && apiStatus && (
        <div className={`rounded-lg border p-4 flex items-center gap-3 ${
          apiStatus.valid ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
        }`}>
          {apiStatus.valid ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-red-600 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${apiStatus.valid ? "text-emerald-800" : "text-red-800"}`}>
              {apiStatus.valid ? "Apollo API Connected" : "Apollo API Error"}
            </p>
            <p className="text-xs text-muted-foreground">
              {apiStatus.valid
                ? `Plan active • API key verified`
                : (apiStatus as any).error || "Check your API key configuration"}
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gold" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card rounded-lg border border-border p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-gold"><CreditCard className="w-5 h-5" /></span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{periodLabels[period]}</span>
              </div>
              <div className="text-3xl font-bold text-navy tracking-tight">{data?.totalCredits ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1 font-medium">Total Credits Used</div>
            </div>

            <div className="bg-card rounded-lg border border-border p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-teal"><Users className="w-5 h-5" /></span>
              </div>
              <div className="text-3xl font-bold text-navy tracking-tight">{data?.byUser?.length ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1 font-medium">Active Users</div>
            </div>

            <div className="bg-card rounded-lg border border-border p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-hot"><Eye className="w-5 h-5" /></span>
              </div>
              <div className="text-3xl font-bold text-navy tracking-tight">
                {data?.byAction?.find((a: { action: string; credits: number; count: number }) => a.action === "reveal")?.count ?? 0}
              </div>
              <div className="text-xs text-muted-foreground mt-1 font-medium">Contact Reveals</div>
            </div>

            <div className="bg-card rounded-lg border border-border p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-warm"><Activity className="w-5 h-5" /></span>
              </div>
              <div className="text-3xl font-bold text-navy tracking-tight">{data?.recentActivity?.length ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1 font-medium">Recent Actions</div>
            </div>
          </div>

          {/* Usage by Action Type */}
          <div className="bg-card rounded-lg border border-border p-5">
            <h4 className="text-sm font-bold text-navy mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-gold" /> Usage by Action Type
            </h4>
            {data?.byAction && data.byAction.length > 0 ? (
              <div className="space-y-3">
                {data.byAction.map((item: { action: string; credits: number; count: number }) => {
                  const maxCredits = Math.max(...data.byAction.map((a: { action: string; credits: number; count: number }) => a.credits), 1);
                  const pct = Math.round((item.credits / maxCredits) * 100);
                  return (
                    <div key={item.action} className="flex items-center gap-3">
                      <div className="flex items-center gap-2 w-40 shrink-0">
                        {actionIcons[item.action] || <Zap className="w-3.5 h-3.5" />}
                        <span className="text-sm font-medium text-foreground">{actionLabels[item.action] || item.action}</span>
                      </div>
                      <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-gold to-gold-light transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-right shrink-0 w-24">
                        <span className="text-sm font-bold text-navy">{item.credits}</span>
                        <span className="text-xs text-muted-foreground ml-1">({item.count} ops)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No credit usage recorded for this period.</p>
            )}
          </div>

          {/* Usage by User */}
          <div className="bg-card rounded-lg border border-border p-5">
            <h4 className="text-sm font-bold text-navy mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-gold" /> Usage by User
            </h4>
            {data?.byUser && data.byUser.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-navy text-white">
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">User</th>
                      <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider">Credits Used</th>
                      <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byUser.map((u: { userId: number; userName: string; credits: number }, i: number) => (
                      <tr key={u.userId} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                        <td className="px-4 py-3 font-medium text-navy">{u.userName}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-bold text-navy">{u.credits}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {data.totalCredits > 0 ? `${Math.round((u.credits / data.totalCredits) * 100)}%` : "0%"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No user activity for this period.</p>
            )}
          </div>

          {/* Recent Activity Log */}
          <div className="bg-card rounded-lg border border-border p-5">
            <h4 className="text-sm font-bold text-navy mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gold" /> Recent Activity (Last 50)
            </h4>
            {data?.recentActivity && data.recentActivity.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-navy text-white">
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Time</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">User</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Action</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Contact</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Project</th>
                      <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider">Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentActivity.map((a: { id: number; userId: number; userName: string | null; action: string; creditsUsed: number; contactName: string | null; projectName: string | null; createdAt: Date | null }, i: number) => (
                      <tr key={a.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(a.createdAt)}</td>
                        <td className="px-4 py-2.5 font-medium text-navy">{a.userName || "System"}</td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-navy/10 text-navy">
                            {actionIcons[a.action] || <Zap className="w-3 h-3" />}
                            {actionLabels[a.action] || a.action}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground max-w-[200px] truncate">{a.contactName || "—"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground max-w-[200px] truncate">{a.projectName || "—"}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="font-bold text-gold">{a.creditsUsed}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No activity recorded for this period.</p>
            )}
          </div>

          {/* Credit Cost Reference */}
          <div className="bg-gold/8 border border-gold/25 rounded-lg p-4">
            <h4 className="text-sm font-bold text-gold-dark mb-2">Apollo.io Credit Cost Reference</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-white/60 rounded-md p-2.5">
                <div className="font-bold text-navy">Contact Reveal</div>
                <div className="text-muted-foreground">1 credit / contact</div>
              </div>
              <div className="bg-white/60 rounded-md p-2.5">
                <div className="font-bold text-navy">Email Verification</div>
                <div className="text-muted-foreground">1 credit / email</div>
              </div>
              <div className="bg-white/60 rounded-md p-2.5">
                <div className="font-bold text-navy">People Search</div>
                <div className="text-muted-foreground">Free (no credits)</div>
              </div>
              <div className="bg-white/60 rounded-md p-2.5">
                <div className="font-bold text-navy">Daily Cap</div>
                <div className="text-muted-foreground">200 credits / day</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Pipeline Run History Tab ──

interface PipelineStepDisplay {
  name: string;
  status: "completed" | "failed" | "skipped";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  counts?: Record<string, number>;
  error?: string;
}

function PipelineRunHistoryTab() {
  const { data: runs, isLoading } = trpc.dailyPipeline.history.useQuery({ limit: 30 });
  const [expandedRun, setExpandedRun] = useState<number | null>(null);

  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin text-gold mx-auto my-8" />;

  const formatDuration = (ms: number | null | undefined) => {
    if (!ms) return "—";
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}m ${remaining}s`;
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "completed": return "bg-teal/15 text-teal";
      case "failed": return "bg-hot/15 text-hot";
      case "running": return "bg-warm/15 text-warm";
      case "skipped": return "bg-slate-200 text-slate-500";
      default: return "bg-slate-200 text-slate-500";
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle2 className="w-3 h-3" />;
      case "failed": return <XCircle className="w-3 h-3" />;
      case "running": return <Loader2 className="w-3 h-3 animate-spin" />;
      case "skipped": return <Clock className="w-3 h-3" />;
      default: return null;
    }
  };

  // Compute summary stats
  const totalRuns = runs?.length || 0;
  const successRuns = runs?.filter(r => r.status === "completed").length || 0;
  const failedRuns = runs?.filter(r => r.status === "failed").length || 0;
  const avgDuration = totalRuns > 0
    ? Math.round((runs?.reduce((sum, r) => sum + (r.durationMs || 0), 0) || 0) / totalRuns / 1000)
    : 0;
  const totalProjectsCreated = runs?.reduce((sum, r) => sum + (r.projectsCreated || 0), 0) || 0;
  const totalContactsEnriched = runs?.reduce((sum, r) => sum + (r.contactsEnriched || 0), 0) || 0;

  return (
    <div className="space-y-6">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatsCard label="Total Runs" value={totalRuns} icon={<Activity className="w-4 h-4" />} color="text-navy" />
        <StatsCard label="Successful" value={successRuns} icon={<CheckCircle2 className="w-4 h-4" />} color="text-teal" />
        <StatsCard label="Failed" value={failedRuns} icon={<XCircle className="w-4 h-4" />} color="text-hot" />
        <StatsCard label="Avg Duration" value={`${avgDuration}s`} icon={<Clock className="w-4 h-4" />} color="text-warm" />
        <StatsCard label="Projects Created" value={totalProjectsCreated} icon={<Database className="w-4 h-4" />} color="text-gold" />
        <StatsCard label="Contacts Enriched" value={totalContactsEnriched} icon={<Users className="w-4 h-4" />} color="text-teal" />
      </div>

      {/* Run History Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-navy/5">
          <h3 className="text-sm font-bold text-navy flex items-center gap-2">
            <Activity className="w-4 h-4 text-gold" /> Pipeline Run History (Last {totalRuns})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy text-white">
                <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Run</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Started</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Duration</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Articles</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Projects</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Contacts</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Triggered By</th>
                <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Steps</th>
              </tr>
            </thead>
            <tbody>
              {runs?.map((run, i) => {
                const steps = (run.steps as PipelineStepDisplay[] | null) || [];
                const completedSteps = steps.filter(s => s.status === "completed").length;
                const failedSteps = steps.filter(s => s.status === "failed").length;
                const skippedSteps = steps.filter(s => s.status === "skipped").length;
                const isExpanded = expandedRun === run.id;

                return (
                  <>
                    <tr
                      key={run.id}
                      className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors cursor-pointer`}
                      onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-navy">#{run.id}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          run.runType === "daily" ? "bg-navy/10 text-navy" :
                          run.runType === "weekly" ? "bg-purple-100 text-purple-700" :
                          "bg-gold/15 text-gold-dark"
                        }`}>{run.runType}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1 w-fit ${statusBadge(run.status)}`}>
                          {statusIcon(run.status)} {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium">{formatDuration(run.durationMs)}</td>
                      <td className="px-4 py-2.5 text-xs">{run.articlesIngested || 0}</td>
                      <td className="px-4 py-2.5 text-xs font-medium text-gold-dark">{run.projectsCreated || 0}</td>
                      <td className="px-4 py-2.5 text-xs">{run.contactsEnriched || 0}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{run.triggeredBy || "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1 text-[10px]">
                          {completedSteps > 0 && <span className="text-teal font-bold">{completedSteps}✓</span>}
                          {failedSteps > 0 && <span className="text-hot font-bold">{failedSteps}✗</span>}
                          {skippedSteps > 0 && <span className="text-slate-400">{skippedSteps}⊘</span>}
                          <Eye className="w-3 h-3 text-muted-foreground ml-1" />
                        </div>
                      </td>
                    </tr>
                    {/* Expanded step detail */}
                    {isExpanded && steps.length > 0 && (
                      <tr key={`${run.id}-detail`}>
                        <td colSpan={10} className="px-4 py-3 bg-slate-50 border-t border-border">
                          <div className="space-y-3">
                            <h4 className="text-xs font-bold text-navy uppercase tracking-wider">Step-by-Step Breakdown</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {steps.map((step, si) => (
                                <div key={si} className={`rounded-md border p-3 ${
                                  step.status === "completed" ? "border-teal/30 bg-teal/5" :
                                  step.status === "failed" ? "border-hot/30 bg-hot/5" :
                                  "border-slate-200 bg-white"
                                }`}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-semibold text-navy">{step.name}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${statusBadge(step.status)}`}>
                                      {step.status}
                                    </span>
                                  </div>
                                  {step.durationMs !== undefined && step.durationMs > 0 && (
                                    <div className="text-[10px] text-muted-foreground">
                                      Duration: {formatDuration(step.durationMs)}
                                    </div>
                                  )}
                                  {step.counts && Object.keys(step.counts).length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {Object.entries(step.counts).map(([k, v]) => (
                                        <span key={k} className="px-1.5 py-0.5 rounded bg-navy/8 text-navy text-[9px] font-medium">
                                          {k}: {v}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {step.error && (
                                    <div className="mt-1 text-[10px] text-hot break-all">
                                      {step.error}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Scraper breakdown */}
                            <div className="mt-3">
                              <h4 className="text-xs font-bold text-navy uppercase tracking-wider mb-2">Source Breakdown</h4>
                              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                                <div className="bg-white rounded border border-border p-2 text-center">
                                  <div className="text-sm font-bold text-navy">{run.articlesIngested || 0}</div>
                                  <div className="text-[9px] text-muted-foreground uppercase">RSS Articles</div>
                                </div>
                                <div className="bg-white rounded border border-border p-2 text-center">
                                  <div className="text-sm font-bold text-navy">{run.articlesExtracted || 0}</div>
                                  <div className="text-[9px] text-muted-foreground uppercase">AI Extracted</div>
                                </div>
                                <div className="bg-white rounded border border-border p-2 text-center">
                                  <div className="text-sm font-bold text-purple-700">{run.projectoryProjects || 0}</div>
                                  <div className="text-[9px] text-muted-foreground uppercase">Projectory</div>
                                </div>
                                <div className="bg-white rounded border border-border p-2 text-center">
                                  <div className="text-sm font-bold text-blue-600">{run.govProjects || 0}</div>
                                  <div className="text-[9px] text-muted-foreground uppercase">Gov</div>
                                </div>
                                <div className="bg-white rounded border border-border p-2 text-center">
                                  <div className="text-sm font-bold text-amber-600">{run.dmirsProjects || 0}</div>
                                  <div className="text-[9px] text-muted-foreground uppercase">DMIRS</div>
                                </div>
                                <div className="bg-white rounded border border-border p-2 text-center">
                                  <div className="text-sm font-bold text-emerald-600">{run.aemoProjects || 0}</div>
                                  <div className="text-[9px] text-muted-foreground uppercase">AEMO</div>
                                </div>
                                <div className="bg-white rounded border border-border p-2 text-center">
                                  <div className="text-sm font-bold text-cyan-600">{run.icnProjects || 0}</div>
                                  <div className="text-[9px] text-muted-foreground uppercase">ICN</div>
                                </div>
                              </div>
                            </div>

                            {/* Errors */}
                            {run.errors && (run.errors as string[]).length > 0 && (
                              <div className="mt-2">
                                <h4 className="text-xs font-bold text-hot uppercase tracking-wider mb-1">Errors</h4>
                                <div className="space-y-1">
                                  {(run.errors as string[]).map((err, ei) => (
                                    <div key={ei} className="text-[10px] text-hot bg-hot/5 border border-hot/20 rounded px-2 py-1">
                                      {err}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        {(!runs || runs.length === 0) && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No pipeline runs recorded yet. Run the daily pipeline to start tracking.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Platform Analytics Tab ──

function PlatformAnalyticsTab() {
  // Admin view: show all projects regardless of lifecycle status
  const { data: fullReport, isLoading } = trpc.report.full.useQuery({ lifecycleFilter: "all" });

  if (isLoading || !fullReport) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gold" />
      </div>
    );
  }

  const { report, projects, contacts, drillingCampaigns, awardedProjects, lifecycleCounts } = fullReport;
  const lc = (lifecycleCounts ?? {}) as Record<string, number>;
  const totalProjects = Object.values(lc).reduce((a, b) => a + Number(b), 0);

  const dataSources = [
    { source: "RSS Feed Pipeline", type: "32 Industry Feeds", schedule: "Daily (06:00 UTC) + Sunday Mega-Scrape (9pm AWST)", coverage: "Mining, Energy, Oil & Gas, Infrastructure, Defence, Construction, Renewables, ASX", credits: "~100/day cap" },
    { source: "Projectory Australia", type: "Web Scraper", schedule: "Weekly (Mondays) + Sunday Mega-Scrape", coverage: "Resources, Infrastructure, Construction, Energy, Industrial, Defence", credits: "None" },
    { source: "DMIRS MINEDEX", type: "Government API", schedule: "Weekly (Wednesdays) + Sunday Mega-Scrape", coverage: "WA Mining Proposals & Approvals", credits: "None" },
    { source: "AEMO Generation Info", type: "Government Data", schedule: "Weekly (Fridays) + Sunday Mega-Scrape", coverage: "BESS, Pumped Hydro, Gas Peaker & Power Generation (NEM)", credits: "None" },
    { source: "Gov Major Projects", type: "Government Data", schedule: "Weekly (Tuesdays) + Sunday Mega-Scrape", coverage: "Infrastructure Australia + NREPL: Transport, Water, Energy, Defence", credits: "None" },
    { source: "AusTender OCDS", type: "Government API", schedule: "Weekly (Thursdays) + Sunday Mega-Scrape", coverage: "Federal Contracts >$1M: Construction, Mining, Energy, Water, Defence", credits: "None" },
    { source: "ICN Gateway", type: "Industry Portal", schedule: "Weekly (Saturdays) + Sunday Mega-Scrape", coverage: "Major Projects with Open Work Packages: Defence, Mining, Transport, Energy", credits: "None" },
    { source: "Apollo.io People Search", type: "Contact Enrichment", schedule: "On-demand (per project)", coverage: "275M+ contacts \u2014 verified emails, titles, LinkedIn", credits: "1 credit/reveal" },
  ];

  return (
    <div className="space-y-6">
      {/* Platform Overview KPIs */}
      <div>
        <h2 className="text-base font-bold text-navy mb-3 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-gold" /> Platform Overview
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatsCard label="Total Projects" value={totalProjects} icon={<Database className="w-4 h-4" />} color="text-navy" />
          <StatsCard label="Active" value={lc.active ?? 0} icon={<Eye className="w-4 h-4" />} color="text-teal" />
          <StatsCard label="Stale" value={lc.stale ?? 0} icon={<Clock className="w-4 h-4" />} color="text-amber-600" />
          <StatsCard label="Archived" value={lc.archived ?? 0} icon={<Activity className="w-4 h-4" />} color="text-slate-500" />
          <StatsCard label="Awarded" value={lc.awarded ?? 0} icon={<CheckCircle2 className="w-4 h-4" />} color="text-gold" />
          <StatsCard label="Completed" value={lc.completed ?? 0} icon={<Target className="w-4 h-4" />} color="text-emerald-600" />
        </div>
      </div>

      {/* Lifecycle Status Breakdown */}
      <div className="bg-card rounded-lg border border-border p-5">
        <h3 className="text-sm font-bold text-navy mb-3">Project Lifecycle Distribution</h3>
        <div className="space-y-2">
          {Object.entries(lc).map(([status, count]) => {
            const pct = totalProjects > 0 ? Math.round((count / totalProjects) * 100) : 0;
            const barColor = status === "active" ? "bg-teal" : status === "stale" ? "bg-amber-500" : status === "archived" ? "bg-slate-400" : status === "awarded" ? "bg-gold" : "bg-emerald-500";
            return (
              <div key={status} className="flex items-center gap-3">
                <span className="text-xs font-semibold text-muted-foreground w-24 capitalize">{status}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-bold text-navy w-16 text-right">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Data Counts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-navy">{(contacts as any[])?.length ?? 0}</div>
          <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-1">Total Contacts</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-navy">{(drillingCampaigns as any[])?.length ?? 0}</div>
          <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-1">Drilling Campaigns</div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-navy">{(awardedProjects as any[])?.length ?? 0}</div>
          <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-1">Awarded Projects</div>
        </div>
      </div>

      {/* Data Sources Table */}
      <div>
        <h3 className="text-base font-bold text-navy mb-3">Active Data Sources</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Source</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Schedule</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Coverage</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">AI Credits</th>
              </tr>
            </thead>
            <tbody>
              {dataSources.map((row, i) => (
                <tr key={i} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"}`}>
                  <td className="px-4 py-3 font-semibold text-navy">{row.source}</td>
                  <td className="px-4 py-3">{row.type}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.schedule}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.coverage}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${row.credits === "None" ? "bg-teal/15 text-teal" : "bg-gold/15 text-gold-dark"}`}>{row.credits}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology Note */}
      <div className="bg-gold/8 border border-gold/25 rounded-lg p-4">
        <p className="text-sm text-foreground/80">
          <strong className="text-navy">Methodology Note:</strong> All CAPEX grades are evidence-based. Contractor predictions include confidence scores and are clearly labelled. Contact information is enriched via Apollo.io (275M+ database) with verified business emails. AI-generated contacts are clearly marked and require verification before outreach. Every Sunday at 9pm AWST, a full mega-scrape runs all 8 pipeline stages across all sources.
        </p>
      </div>
    </div>
  );
}

// ── Stage 5C: Duplicates Review Tab ──
function DuplicatesTab() {
  const utils = trpc.useUtils();
  const { data: clusters, isLoading, refetch } = trpc.duplicates.listClusters.useQuery();
  const [showDismissed, setShowDismissed] = useState(false);

  const runSweep = trpc.duplicates.runSweep.useMutation({
    onSuccess: (res) => {
      toast.success(`Sweep complete: ${res.clustersFound} clusters found, ${res.newAssignments} new assignments`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const mergeProject = trpc.duplicates.mergeProject.useMutation({
    onSuccess: () => {
      toast.success("Project merged successfully");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const dismissCluster = trpc.duplicates.dismissCluster.useMutation({
    onSuccess: () => {
      toast.success("Cluster dismissed");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gold" />
      </div>
    );
  }

  const allClusters = clusters ?? [];
  const activeClusters = allClusters.filter(c => !c.dismissed);
  const dismissedClusters = allClusters.filter(c => c.dismissed);

  const priorityBadge = (p: string) => {
    if (p === "hot") return "bg-hot text-white";
    if (p === "warm") return "bg-warm text-navy";
    return "bg-cold text-white";
  };

  const lifecycleBadge = (s: string) => {
    if (s === "active") return "bg-teal/15 text-teal";
    if (s === "stale") return "bg-warm/15 text-amber-700";
    return "bg-slate-100 text-slate-500";
  };

  const renderCluster = (cluster: typeof allClusters[0], idx: number) => {
    // Pick the canonical project: highest priority, then most recent
    const priorityOrder: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
    const sorted = [...cluster.projects].sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 9;
      const pb = priorityOrder[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    const canonical = sorted[0];
    const duplicates = sorted.slice(1);
    const simPct = Math.round(cluster.similarity * 100);

    return (
      <div key={cluster.clusterId} className={`bg-card rounded-lg border ${cluster.dismissed ? "border-slate-200 opacity-60" : "border-border"} p-4 space-y-3`}>
        {/* Cluster header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Cluster {idx + 1}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                simPct >= 80 ? "bg-hot/15 text-hot" : simPct >= 65 ? "bg-warm/15 text-amber-700" : "bg-slate-100 text-slate-500"
              }`}>{simPct}% similarity</span>
              <span className="text-xs text-muted-foreground">{cluster.projects.length} projects</span>
              {cluster.dismissed && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">DISMISSED</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{cluster.clusterId}</p>
          </div>
          {!cluster.dismissed && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-slate-300 text-slate-500 hover:border-slate-400"
              onClick={() => dismissCluster.mutate({ projectIds: cluster.projects.map(p => p.id) })}
              disabled={dismissCluster.isPending}
            >
              {dismissCluster.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3 mr-1" />}
              Dismiss (not duplicates)
            </Button>
          )}
        </div>

        {/* Canonical project */}
        <div className="bg-teal/5 border border-teal/20 rounded-md p-3">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-teal shrink-0" />
            <span className="text-xs font-bold text-teal uppercase tracking-wider">Canonical (keep)</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${priorityBadge(canonical.priority)}`}>{canonical.priority}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${lifecycleBadge(canonical.lifecycleStatus)}`}>{canonical.lifecycleStatus}</span>
          </div>
          <p className="text-sm font-semibold text-navy">{canonical.name}</p>
          <p className="text-xs text-muted-foreground">{canonical.location} &middot; ID #{canonical.id}</p>
        </div>

        {/* Duplicate projects */}
        <div className="space-y-2">
          {duplicates.map(dup => (
            <div key={dup.id} className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-md p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${priorityBadge(dup.priority)}`}>{dup.priority}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${lifecycleBadge(dup.lifecycleStatus)}`}>{dup.lifecycleStatus}</span>
                  {dup.mergedIntoId && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-500">MERGED</span>}
                </div>
                <p className="text-sm font-medium text-navy truncate">{dup.name}</p>
                <p className="text-xs text-muted-foreground">{dup.location} &middot; ID #{dup.id}</p>
              </div>
              {!dup.mergedIntoId && !cluster.dismissed && (
                <Button
                  size="sm"
                  className="text-xs bg-navy hover:bg-navy/80 text-white shrink-0"
                  onClick={() => mergeProject.mutate({ duplicateId: dup.id, canonicalId: canonical.id })}
                  disabled={mergeProject.isPending}
                >
                  {mergeProject.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Merge into canonical
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-navy flex items-center gap-2">
            <Copy className="w-5 h-5 text-gold" /> Duplicate Project Clusters
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeClusters.length} active cluster{activeClusters.length !== 1 ? "s" : ""} &middot; {dismissedClusters.length} dismissed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setShowDismissed(v => !v)}
          >
            <Eye className="w-3.5 h-3.5 mr-1" />
            {showDismissed ? "Hide" : "Show"} dismissed
          </Button>
          <Button
            size="sm"
            className="text-xs bg-navy hover:bg-navy/80 text-white"
            onClick={() => runSweep.mutate()}
            disabled={runSweep.isPending}
          >
            {runSweep.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Run Detection Sweep
          </Button>
        </div>
      </div>

      {/* Active clusters */}
      {activeClusters.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-teal opacity-50" />
          <p className="text-sm font-medium">No duplicate clusters detected</p>
          <p className="text-xs mt-1">Run a detection sweep to scan for near-duplicate projects</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeClusters.map((c, i) => renderCluster(c, i))}
        </div>
      )}

      {/* Dismissed clusters (collapsed) */}
      {showDismissed && dismissedClusters.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-muted-foreground mb-3 flex items-center gap-2">
            <XCircle className="w-4 h-4" /> Dismissed Clusters ({dismissedClusters.length})
          </h3>
          <div className="space-y-4">
            {dismissedClusters.map((c, i) => renderCluster(c, activeClusters.length + i))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Admin Page ──

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-gold" />
      </div>
    );
  }

  if (!user) {
    window.location.href = "/login";
    return null;
  }

  if (user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Shield className="w-12 h-12 text-hot mx-auto mb-3" />
          <h2 className="text-lg font-bold text-navy mb-1">Admin Access Required</h2>
          <p className="text-sm text-muted-foreground mb-4">This page is restricted to administrators.</p>
          <Button onClick={() => navigate("/")} className="bg-navy hover:bg-navy-light text-white">
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-white py-4">
        <div className="container flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate("/")} className="text-white hover:bg-navy-light p-2">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <Database className="w-5 h-5 text-gold" /> Data Pipeline Admin
              </h1>
              <p className="text-xs text-slate-400">Manage business lines, sources, and data ingestion</p>
            </div>
          </div>
          <span className="text-gold font-bold text-sm tracking-wider">ATLAS COPCO</span>
        </div>
      </header>

      <main className="container py-6 sm:py-8">
        <Tabs defaultValue="pipeline" className="w-full">
          <TabsList className="w-full justify-start bg-card border border-border rounded-lg p-1 overflow-x-auto flex-nowrap mb-6">
            <TabsTrigger value="pipeline" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              <Play className="w-3.5 h-3.5 mr-1.5" /> Pipeline Operations
            </TabsTrigger>
            <TabsTrigger value="businesslines" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              <Building2 className="w-3.5 h-3.5 mr-1.5" /> Business Lines
            </TabsTrigger>
            <TabsTrigger value="sources" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              <Rss className="w-3.5 h-3.5 mr-1.5" /> RSS Sources
            </TabsTrigger>
            <TabsTrigger value="users" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              <Users className="w-3.5 h-3.5 mr-1.5" /> User Management
            </TabsTrigger>
            <TabsTrigger value="apollo" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Apollo Credits
            </TabsTrigger>
            <TabsTrigger value="runhistory" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              <Activity className="w-3.5 h-3.5 mr-1.5" /> Run History
            </TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Platform Analytics
            </TabsTrigger>
            <TabsTrigger value="duplicates" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              <Copy className="w-3.5 h-3.5 mr-1.5" /> Duplicates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pipeline">
            <PipelineOpsTab />
          </TabsContent>

          <TabsContent value="businesslines">
            <BusinessLinesTab />
          </TabsContent>

          <TabsContent value="sources">
            <RssSourcesTab />
          </TabsContent>

          <TabsContent value="users">
            <UserManagementTab />
          </TabsContent>

          <TabsContent value="apollo">
            <ApolloCreditsTab />
          </TabsContent>

          <TabsContent value="runhistory">
            <PipelineRunHistoryTab />
          </TabsContent>

          <TabsContent value="analytics">
            <PlatformAnalyticsTab />
          </TabsContent>

          <TabsContent value="duplicates">
            <DuplicatesTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
