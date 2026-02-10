/**
 * Admin Pipeline Dashboard — Manage business lines, RSS sources, and data pipeline.
 * Admin-only page with tabbed interface.
 */
import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  Loader2, ArrowLeft, Shield, Rss, Building2, Database, Play,
  Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw, Zap,
  BarChart3, Clock, AlertTriangle, CheckCircle2, XCircle, Filter, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
          <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Business Line Name (e.g., Portable Air)"
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

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formCategory, setFormCategory] = useState("industry");

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

  return (
    <div className="space-y-4">
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
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Source</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Category</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Last Fetch</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Items</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources?.map((src, i) => (
              <tr key={src.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-navy">{src.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{src.feedUrl}</div>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${categoryColors[src.category] || "bg-slate-200 text-slate-600"}`}>
                    {src.category}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">
                  {src.lastFetchedAt ? new Date(src.lastFetchedAt).toLocaleString() : "Never"}
                </td>
                <td className="px-4 py-2.5 text-xs">{src.lastFetchCount || 0}</td>
                <td className="px-4 py-2.5">
                  {src.isActive ? (
                    <span className="flex items-center gap-1 text-teal text-xs"><CheckCircle2 className="w-3 h-3" /> Active</span>
                  ) : (
                    <span className="flex items-center gap-1 text-slate-400 text-xs"><XCircle className="w-3 h-3" /> Inactive</span>
                  )}
                  {(src.errorCount || 0) > 0 && (
                    <span className="text-[10px] text-hot ml-1">({src.errorCount} errors)</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateSrc.mutate({ id: src.id, isActive: !src.isActive })}
                      className="p-1 rounded hover:bg-slate-100" title={src.isActive ? "Deactivate" : "Activate"}>
                      {src.isActive ? <ToggleRight className="w-3.5 h-3.5 text-teal" /> : <ToggleLeft className="w-3.5 h-3.5 text-slate-400" />}
                    </button>
                    <button onClick={() => { if (confirm("Delete this source?")) deleteSrc.mutate({ id: src.id }); }}
                      className="p-1 rounded hover:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
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
  const projectoryScrape = trpc.projectory.scrape.useMutation({
    onSuccess: (data) => {
      toast.success(`Projectory: ${data.totalNewProjects} new projects, ${data.totalNewContacts} contacts from ${data.totalScraped} articles (${data.duration}s)`);
      refetchStats();
    },
    onError: (e) => toast.error(`Projectory scrape failed: ${e.message}`),
  });
  const { data: projectoryStatus } = trpc.projectory.status.useQuery();
  const dmirsScrape = trpc.dmirs.scrape.useMutation({
    onSuccess: (data) => {
      toast.success(`DMIRS: ${data.totalNewProjects} new projects, ${data.totalDuplicates} duplicates from ${data.totalFetched} registrations (${data.duration}s)`);
      refetchStats();
    },
    onError: (e) => toast.error(`DMIRS scrape failed: ${e.message}`),
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
          onClick={() => projectoryScrape.mutate({})}
          disabled={projectoryScrape.isPending}
          className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
        >
          {projectoryScrape.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          Scrape Projectory
        </Button>
        <Button
          onClick={() => dmirsScrape.mutate({})}
          disabled={dmirsScrape.isPending}
          className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
        >
          {dmirsScrape.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
          Scrape DMIRS
        </Button>
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
        <div className="flex items-center gap-3 text-sm">
          <span className={`flex items-center gap-1 ${projectoryStatus?.hasCookies ? 'text-teal' : 'text-hot'}`}>
            {projectoryStatus?.hasCookies ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {projectoryStatus?.hasCookies ? 'Session active' : 'No session cookies'}
          </span>
          <span className="text-muted-foreground text-xs">Scrapes 6 categories, ~60 articles per run. Zero AI credits.</span>
        </div>
      </div>

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
    window.location.href = getLoginUrl("/admin");
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
        </Tabs>
      </main>
    </div>
  );
}
