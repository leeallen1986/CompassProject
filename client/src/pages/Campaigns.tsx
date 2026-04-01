/**
 * Campaigns.tsx — Campaign management dashboard
 *
 * Features:
 * - Campaign overview with stats
 * - Contact list with tier badges, scoring, and search/filter
 * - Email generation, editing, and approval workflow
 * - Enrichment and project matching controls
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Megaphone, Users, Mail, CheckCircle2, Send, Search,
  Flame, TrendingUp, Sparkles, Database, ChevronLeft, ChevronRight,
  Eye, Edit3, ThumbsUp, Loader2, Filter, BarChart3,
  Target, Zap, Clock, AlertCircle, RefreshCw, ThumbsDown, XCircle,
} from "lucide-react";

// ── Types ──

type CampaignContact = {
  id: number;
  campaignId: number;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string;
  reviewedCompanyName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  score: number;
  tier: string;
  titleRelevance: string;
  enrichmentStatus: string;
  enrichedEmail: string | null;
  enrichedTitle: string | null;
  enrichedLinkedin: string | null;
  enrichmentSource: string | null;
  hunterConfidence: number | null;
  outreachStatus: string;
  draftSubject: string | null;
  draftBody: string | null;
  draftKeyPoints: string[] | null;
  matchedProjectCount: number;
  nameCheckStatus: string | null;
};

// ── Constants ──

const TIER_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  tier1_hot: { label: "Tier 1 — Hot", color: "bg-red-500 text-white", icon: <Flame className="w-3 h-3" /> },
  tier2_warm: { label: "Tier 2 — Warm", color: "bg-amber-500 text-white", icon: <TrendingUp className="w-3 h-3" /> },
  tier3_enrich: { label: "Tier 3 — Enrich", color: "bg-blue-500 text-white", icon: <Database className="w-3 h-3" /> },
  tier4_low: { label: "Tier 4 — Low", color: "bg-slate-400 text-white", icon: <Clock className="w-3 h-3" /> },
  excluded: { label: "Excluded", color: "bg-slate-200 text-slate-600", icon: <AlertCircle className="w-3 h-3" /> },
};

const OUTREACH_CONFIG: Record<string, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "bg-slate-100 text-slate-600" },
  email_drafted: { label: "Drafted", color: "bg-blue-100 text-blue-700" },
  pending_approval: { label: "Pending Approval", color: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", color: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
  sent: { label: "Sent", color: "bg-green-500 text-white" },
  replied: { label: "Replied", color: "bg-emerald-500 text-white" },
  bounced: { label: "Bounced", color: "bg-red-100 text-red-700" },
  opted_out: { label: "Opted Out", color: "bg-slate-200 text-slate-500" },
};

const RELEVANCE_CONFIG: Record<string, { label: string; color: string }> = {
  blasting_specialist: { label: "Blasting Specialist", color: "text-red-600" },
  decision_maker: { label: "Decision Maker", color: "text-amber-600" },
  operations: { label: "Operations", color: "text-blue-600" },
  other: { label: "Other", color: "text-slate-500" },
  unknown: { label: "Unknown", color: "text-slate-400" },
};

// ── Main Component ──

const CAMPAIGN_ALLOWED_EMAILS = ['ryan.pemberton@atlascopco.com'];

export default function Campaigns() {
  const { user, loading } = useAuth();
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  // Access control: only admin + Ryan can access campaigns
  const hasAccess = user?.role === 'admin' || (user?.email && CAMPAIGN_ALLOWED_EMAILS.includes(user.email.toLowerCase()));

  const campaignsQuery = trpc.campaign.list.useQuery(undefined, {
    enabled: !!hasAccess,
  });

  if (loading) {
    return (
      <div className="container py-8 flex items-center gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-gold" />
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="container py-16 text-center">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-navy mb-2">Access Restricted</h2>
        <p className="text-muted-foreground">Campaign management is restricted to authorized users only.</p>
      </div>
    );
  }

  if (!selectedCampaignId && campaignsQuery.data?.length) {
    // Auto-select first campaign
    return <CampaignList
      campaigns={campaignsQuery.data}
      onSelect={setSelectedCampaignId}
      isLoading={campaignsQuery.isLoading}
    />;
  }

  if (selectedCampaignId) {
    return <CampaignDetail
      campaignId={selectedCampaignId}
      onBack={() => setSelectedCampaignId(null)}
    />;
  }

  return <CampaignList
    campaigns={campaignsQuery.data ?? []}
    onSelect={setSelectedCampaignId}
    isLoading={campaignsQuery.isLoading}
  />;
}

// ── Campaign List ──

function CampaignList({ campaigns, onSelect, isLoading }: {
  campaigns: any[];
  onSelect: (id: number) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="container py-8">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-gold" />
          <span className="text-muted-foreground">Loading campaigns...</span>
        </div>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="container py-8">
        <div className="text-center py-16">
          <Megaphone className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-bold text-navy mb-2">No Campaigns Yet</h2>
          <p className="text-muted-foreground mb-6">
            Campaigns will appear here once created. Contact your admin to set up the first campaign.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">Targeted outreach campaigns with collateral intelligence</p>
        </div>
      </div>

      <div className="grid gap-4">
        {campaigns.map((c: any) => (
          <Card
            key={c.id}
            className="cursor-pointer hover:shadow-md transition-shadow border-border"
            onClick={() => onSelect(c.id)}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-navy">{c.name}</h3>
                    <Badge variant="outline" className={
                      c.status === "active" ? "border-green-500 text-green-600" :
                      c.status === "paused" ? "border-amber-500 text-amber-600" :
                      c.status === "completed" ? "border-slate-400 text-slate-500" :
                      "border-blue-500 text-blue-600"
                    }>
                      {c.status}
                    </Badge>
                  </div>
                  {c.description && (
                    <p className="text-sm text-muted-foreground mb-3">{c.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {c.totalContacts} contacts</span>
                    <span className="flex items-center gap-1"><Database className="w-3.5 h-3.5" /> {c.enrichedContacts} enriched</span>
                    <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {c.emailsDrafted} drafted</span>
                    <span className="flex items-center gap-1"><Send className="w-3.5 h-3.5" /> {c.emailsSent} sent</span>
                    <span className="flex items-center gap-1"><Target className="w-3.5 h-3.5" /> {c.collateralName || "No collateral"}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">From</div>
                  <div className="text-sm font-semibold text-navy">{c.senderName}</div>
                  <div className="text-xs text-muted-foreground">{c.senderEmail}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Campaign Detail ──

function CampaignDetail({ campaignId, onBack }: { campaignId: number; onBack: () => void }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [tierFilter, setTierFilter] = useState<string>("");
  const [outreachFilter, setOutreachFilter] = useState<string>("");
  const [enrichmentFilter, setEnrichmentFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedContact, setSelectedContact] = useState<CampaignContact | null>(null);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [editingSubject, setEditingSubject] = useState("");
  const [editingBody, setEditingBody] = useState("");
  const PAGE_SIZE = 50;

  const campaignQuery = trpc.campaign.get.useQuery({ id: campaignId });
  const statsQuery = trpc.campaign.stats.useQuery({ campaignId });
  const contactsQuery = trpc.campaign.contacts.useQuery({
    campaignId,
    tier: tierFilter || undefined,
    outreachStatus: outreachFilter || undefined,
    enrichmentStatus: enrichmentFilter || undefined,
    search: searchQuery || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    sortBy: "score",
    sortDir: "desc",
  });

  const generateEmailMut = trpc.campaign.generateEmail.useMutation({
    onSuccess: (result) => {
      setEditingSubject(result.subject);
      setEditingBody(result.body);
      contactsQuery.refetch();
      toast.success("Email draft generated");
    },
    onError: (err) => toast.error(`Failed to generate email: ${err.message}`),
  });

  const updateDraftMut = trpc.campaign.updateDraft.useMutation({
    onSuccess: () => {
      contactsQuery.refetch();
      toast.success("Draft updated");
    },
    onError: (err) => toast.error(`Failed to update draft: ${err.message}`),
  });

  const approveEmailMut = trpc.campaign.approveEmail.useMutation({
    onSuccess: () => {
      contactsQuery.refetch();
      setShowEmailDialog(false);
      toast.success("Email approved for sending");
    },
    onError: (err) => toast.error(`Failed to approve: ${err.message}`),
  });

  const rejectEmailMut = trpc.campaign.rejectEmail.useMutation({
    onSuccess: () => {
      contactsQuery.refetch();
      setShowEmailDialog(false);
      toast.success("Email rejected — contact pushed back for re-generation");
    },
    onError: (err) => toast.error(`Failed to reject: ${err.message}`),
  });

  const markAsSentMut = trpc.campaign.markAsSent.useMutation({
    onSuccess: (result) => {
      contactsQuery.refetch();
      if (result.success) {
        toast.success("Email marked as sent");
      } else {
        toast.error(result.error || "Failed to mark as sent");
      }
    },
    onError: (err: { message: string }) => toast.error(`Failed to mark as sent: ${err.message}`),
  });

  /** Open the approved email in the user's default mail client (Outlook) */
  const openInOutlook = (c: CampaignContact) => {
    const to = c.enrichedEmail || c.email || "";
    const subject = encodeURIComponent(c.draftSubject || "Atlas Copco \u2014 High-Volume Air Solutions");
    const body = encodeURIComponent(
      (c.draftBody || "") +
      "\n\n---\nReminder: Please attach the XAVS1800 product flyer before sending."
    );
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, "_self");
  };

  const matchProjectsMut = trpc.campaign.matchToProjects.useMutation({
    onSuccess: (result) => {
      contactsQuery.refetch();
      statsQuery.refetch();
      toast.success(`Matched ${result.matched} of ${result.total} contacts to projects`);
    },
    onError: (err) => toast.error(`Failed to match: ${err.message}`),
  });

  const enrichMut = trpc.campaign.enrichContacts.useMutation({
    onSuccess: (result: any) => {
      contactsQuery.refetch();
      statsQuery.refetch();
      const parts = [`Enriched: ${result.enriched}`];
      if (result.apolloFound) parts.push(`Apollo: ${result.apolloFound}`);
      if (result.hunterFound) parts.push(`Hunter: ${result.hunterFound}`);
      parts.push(`Not found: ${result.notFound}`);
      if (result.creditsUsed) parts.push(`Apollo credits: ${result.creditsUsed}`);
      toast.success(parts.join(" | "));
    },
    onError: (err) => toast.error(`Failed to enrich: ${err.message}`),
  });

  const campaign = campaignQuery.data;
  const stats = statsQuery.data;
  const contacts = contactsQuery.data?.contacts ?? [];
  const totalContacts = contactsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);

  const openEmailDialog = (contact: CampaignContact) => {
    setSelectedContact(contact);
    setEditingSubject(contact.draftSubject || "");
    setEditingBody(contact.draftBody || "");
    setShowEmailDialog(true);
  };

  if (!campaign) {
    return (
      <div className="container py-8">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-gold" />
          <span className="text-muted-foreground">Loading campaign...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-navy">{campaign.name}</h1>
            <Badge variant="outline" className={
              campaign.status === "active" ? "border-green-500 text-green-600" :
              campaign.status === "paused" ? "border-amber-500 text-amber-600" :
              "border-blue-500 text-blue-600"
            }>
              {campaign.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            From: {campaign.senderName} ({campaign.senderEmail}) | Collateral: {campaign.collateralName || "None"}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({totalContacts})</TabsTrigger>
          <TabsTrigger value="approval">Approval Queue</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ── */}
        <TabsContent value="overview" className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <KPICard value={stats?.total ?? 0} label="Total Contacts" icon={<Users className="w-4 h-4" />} />
            <KPICard value={stats?.byTier?.tier1_hot ?? 0} label="Tier 1 — Hot" icon={<Flame className="w-4 h-4" />} accent="red" />
            <KPICard value={stats?.byTier?.tier2_warm ?? 0} label="Tier 2 — Warm" icon={<TrendingUp className="w-4 h-4" />} accent="amber" />
            <KPICard value={stats?.byTier?.tier3_enrich ?? 0} label="Tier 3 — Enrich" icon={<Database className="w-4 h-4" />} accent="blue" />
            <KPICard value={stats?.byOutreach?.sent ?? 0} label="Emails Sent" icon={<Send className="w-4 h-4" />} accent="green" />
            <KPICard value={stats?.byOutreach?.pending_approval ?? 0} label="Pending Approval" icon={<Clock className="w-4 h-4" />} accent="amber" />
          </div>

          {/* Title Relevance Breakdown */}
          {stats && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contact Relevance Breakdown</CardTitle>
                <CardDescription>How contacts are classified by their job title</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  {Object.entries(stats.byTitleRelevance).map(([key, count]) => {
                    const config = RELEVANCE_CONFIG[key] || { label: key, color: "text-slate-500" };
                    return (
                      <div key={key} className="text-center p-3 rounded-lg bg-slate-50">
                        <div className={`text-2xl font-bold ${config.color}`}>{count}</div>
                        <div className="text-xs text-muted-foreground mt-1">{config.label}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Enrichment Stats */}
          {stats && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Enrichment Pipeline Status</CardTitle>
                <CardDescription>Apollo → Hunter.io waterfall enrichment progress</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  <div className="text-center p-3 rounded-lg bg-green-50">
                    <div className="text-2xl font-bold text-green-600">{stats.byEnrichment?.enriched ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Enriched</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-blue-50">
                    <div className="text-2xl font-bold text-blue-600">{stats.byEnrichment?.not_needed ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Has Email (Import)</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-amber-50">
                    <div className="text-2xl font-bold text-amber-600">{stats.byEnrichment?.pending ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Needs Enrichment</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-slate-50">
                    <div className="text-2xl font-bold text-slate-500">{stats.byEnrichment?.not_found ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Not Found</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-red-50">
                    <div className="text-2xl font-bold text-red-500">{stats.byEnrichment?.failed ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Failed</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Admin Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Campaign Actions</CardTitle>
              <CardDescription>Run enrichment, project matching, and bulk operations</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => matchProjectsMut.mutate({ campaignId })}
                disabled={matchProjectsMut.isPending}
              >
                {matchProjectsMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Target className="w-4 h-4 mr-2" />}
                Match to Projects
              </Button>
              <Button
                variant="outline"
                onClick={() => enrichMut.mutate({ campaignId, maxContacts: 25 })}
                disabled={enrichMut.isPending}
              >
                {enrichMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                Enrich 25 (Apollo → Hunter)
              </Button>
              <Button
                variant="outline"
                onClick={() => enrichMut.mutate({ campaignId, maxContacts: 100 })}
                disabled={enrichMut.isPending}
              >
                {enrichMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                Enrich 100 (Apollo → Hunter)
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  statsQuery.refetch();
                  contactsQuery.refetch();
                }}
              >
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh Stats
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Contacts Tab ── */}
        <TabsContent value="contacts" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, company, title, email..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
                className="pl-9"
              />
            </div>
            <select
              value={tierFilter}
              onChange={e => { setTierFilter(e.target.value); setPage(0); }}
              className="px-3 py-2 rounded-md border border-border bg-card text-sm"
            >
              <option value="">All Tiers</option>
              <option value="tier1_hot">Tier 1 — Hot</option>
              <option value="tier2_warm">Tier 2 — Warm</option>
              <option value="tier3_enrich">Tier 3 — Enrich</option>
              <option value="tier4_low">Tier 4 — Low</option>
            </select>
            <select
              value={outreachFilter}
              onChange={e => { setOutreachFilter(e.target.value); setPage(0); }}
              className="px-3 py-2 rounded-md border border-border bg-card text-sm"
            >
              <option value="">All Statuses</option>
              <option value="not_started">Not Started</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="sent">Sent</option>
            </select>
            <select
              value={enrichmentFilter}
              onChange={e => { setEnrichmentFilter(e.target.value); setPage(0); }}
              className="px-3 py-2 rounded-md border border-border bg-card text-sm"
            >
              <option value="">All Enrichment</option>
              <option value="enriched">Enriched</option>
              <option value="not_needed">Has Email (Import)</option>
              <option value="pending">Needs Enrichment</option>
              <option value="not_found">Not Found</option>
            </select>
          </div>

          {/* Contact Table */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Score</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Name</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Title</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Company</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Email</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Tier</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Outreach</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contactsQuery.isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                      Loading contacts...
                    </td>
                  </tr>
                ) : contacts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No contacts found matching filters
                    </td>
                  </tr>
                ) : contacts.map((c, i) => (
                  <tr key={c.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                    <td className="px-3 py-2.5">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                        c.score >= 60 ? "bg-red-100 text-red-700" :
                        c.score >= 40 ? "bg-amber-100 text-amber-700" :
                        c.score >= 20 ? "bg-blue-100 text-blue-700" :
                        "bg-slate-100 text-slate-500"
                      }`}>
                        {c.score}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-navy">{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</div>
                      {c.matchedProjectCount > 0 && (
                        <div className="text-[10px] text-teal font-medium">{c.matchedProjectCount} project match{c.matchedProjectCount > 1 ? "es" : ""}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-muted-foreground text-xs">{c.enrichedTitle || c.title || "—"}</div>
                      {c.titleRelevance !== "unknown" && (
                        <span className={`text-[10px] font-semibold ${RELEVANCE_CONFIG[c.titleRelevance]?.color || ""}`}>
                          {RELEVANCE_CONFIG[c.titleRelevance]?.label || c.titleRelevance}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs max-w-[200px] truncate" title={c.reviewedCompanyName || c.company}>
                      {c.reviewedCompanyName || c.company}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate max-w-[180px]" title={c.enrichedEmail || c.email || ""}>
                          {c.enrichedEmail || c.email || (
                            <span className="text-muted-foreground italic">
                              {c.enrichmentStatus === "pending" ? "Needs enrichment" :
                               c.enrichmentStatus === "not_found" ? "Not found" :
                               "No email"}
                            </span>
                          )}
                        </span>
                        {c.enrichmentSource === "apollo" && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700" title="Verified via Apollo">
                            Apollo
                          </span>
                        )}
                        {c.enrichmentSource === "hunter" && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-100 text-orange-700" title={`Hunter.io (${c.hunterConfidence ?? '?'}% confidence)`}>
                            Hunter {c.hunterConfidence ? `${c.hunterConfidence}%` : ''}
                          </span>
                        )}
                        {c.enrichmentStatus === "not_needed" && !c.enrichmentSource && (c.email || c.enrichedEmail) && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-500" title="Original email from import">
                            Import
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${TIER_CONFIG[c.tier]?.color || "bg-slate-100"}`}>
                        {TIER_CONFIG[c.tier]?.label?.split("—")[1]?.trim() || c.tier}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${OUTREACH_CONFIG[c.outreachStatus]?.color || "bg-slate-100"}`}>
                        {OUTREACH_CONFIG[c.outreachStatus]?.label || c.outreachStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {(c.email || c.enrichedEmail) && c.outreachStatus === "not_started" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setSelectedContact(c);
                              generateEmailMut.mutate({ contactId: c.id, tone: "first_touch" });
                              setShowEmailDialog(true);
                            }}
                            disabled={generateEmailMut.isPending}
                          >
                            {generateEmailMut.isPending && selectedContact?.id === c.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Mail className="w-3 h-3" />}
                          </Button>
                        )}
                        {(c.outreachStatus === "pending_approval" || c.outreachStatus === "email_drafted") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-amber-600"
                            onClick={() => openEmailDialog(c)}
                          >
                            <Eye className="w-3 h-3" />
                          </Button>
                        )}
                        {c.outreachStatus === "approved" && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-blue-600"
                              onClick={() => openInOutlook(c)}
                              title="Open in Outlook"
                            >
                              <Mail className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-green-600"
                              onClick={() => markAsSentMut.mutate({ contactId: c.id })}
                              disabled={markAsSentMut.isPending}
                              title="Mark as Sent"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                        {c.outreachStatus === "rejected" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-blue-600"
                            onClick={() => {
                              generateEmailMut.mutate({ contactId: c.id, tone: "first_touch" });
                              setSelectedContact(c);
                            }}
                            disabled={generateEmailMut.isPending}
                            title="Re-generate email"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalContacts)} of {totalContacts}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span>Page {page + 1} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Approval Queue Tab ── */}
        <TabsContent value="approval" className="space-y-4">
          <ApprovalQueue campaignId={campaignId} />
        </TabsContent>
      </Tabs>

      {/* ── Email Review Dialog ── */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Email to {selectedContact ? [selectedContact.firstName, selectedContact.lastName].filter(Boolean).join(" ") : "Contact"}
            </DialogTitle>
            <DialogDescription>
              {selectedContact?.reviewedCompanyName || selectedContact?.company} — {selectedContact?.enrichedTitle || selectedContact?.title || "No title"}
            </DialogDescription>
          </DialogHeader>

          {generateEmailMut.isPending ? (
            <div className="py-8 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-gold" />
              <p className="text-muted-foreground">Generating personalised email with AI...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Subject</label>
                <Input
                  value={editingSubject}
                  onChange={e => setEditingSubject(e.target.value)}
                  className="font-medium"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Body</label>
                <Textarea
                  value={editingBody}
                  onChange={e => setEditingBody(e.target.value)}
                  rows={12}
                  className="font-mono text-sm"
                />
              </div>
              {selectedContact?.draftKeyPoints && selectedContact.draftKeyPoints.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Key Points</label>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    {selectedContact.draftKeyPoints.map((kp, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Zap className="w-3 h-3 text-gold mt-0.5 shrink-0" />
                        {kp}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (selectedContact) {
                  updateDraftMut.mutate({
                    contactId: selectedContact.id,
                    subject: editingSubject,
                    body: editingBody,
                  });
                }
              }}
              disabled={updateDraftMut.isPending || generateEmailMut.isPending}
            >
              <Edit3 className="w-4 h-4 mr-2" /> Save Draft
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (selectedContact) {
                  generateEmailMut.mutate({ contactId: selectedContact.id, tone: "first_touch" });
                }
              }}
              disabled={generateEmailMut.isPending}
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Regenerate
            </Button>
            <Button
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50"
              onClick={() => {
                if (selectedContact) {
                  rejectEmailMut.mutate({ contactId: selectedContact.id });
                }
              }}
              disabled={rejectEmailMut.isPending || approveEmailMut.isPending}
            >
              <ThumbsDown className="w-4 h-4 mr-2" /> Reject
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => {
                if (selectedContact) {
                  // Save draft first, then approve
                  updateDraftMut.mutate({
                    contactId: selectedContact.id,
                    subject: editingSubject,
                    body: editingBody,
                  }, {
                    onSuccess: () => {
                      approveEmailMut.mutate({ contactId: selectedContact.id });
                    },
                  });
                }
              }}
              disabled={approveEmailMut.isPending || updateDraftMut.isPending || generateEmailMut.isPending}
            >
              <ThumbsUp className="w-4 h-4 mr-2" /> Approve & Queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Approval Queue ──

function ApprovalQueue({ campaignId }: { campaignId: number }) {
  const pendingQuery = trpc.campaign.contacts.useQuery({
    campaignId,
    outreachStatus: "pending_approval",
    limit: 100,
    offset: 0,
    sortBy: "score",
    sortDir: "desc",
  });

  const approvedQuery = trpc.campaign.contacts.useQuery({
    campaignId,
    outreachStatus: "approved",
    limit: 100,
    offset: 0,
    sortBy: "score",
    sortDir: "desc",
  });

  const rejectedQuery = trpc.campaign.contacts.useQuery({
    campaignId,
    outreachStatus: "rejected",
    limit: 100,
    offset: 0,
    sortBy: "score",
    sortDir: "desc",
  });

  const approveEmailMut = trpc.campaign.approveEmail.useMutation({
    onSuccess: () => {
      pendingQuery.refetch();
      approvedQuery.refetch();
      toast.success("Email approved");
    },
  });

  const rejectEmailMut = trpc.campaign.rejectEmail.useMutation({
    onSuccess: () => {
      pendingQuery.refetch();
      rejectedQuery.refetch();
      toast.success("Email rejected — contact pushed back for re-generation");
    },
    onError: (err) => toast.error(`Failed to reject: ${err.message}`),
  });

  const markAsSentMut = trpc.campaign.markAsSent.useMutation({
    onSuccess: (result) => {
      approvedQuery.refetch();
      if (result.success) {
        toast.success("Email marked as sent");
      } else {
        toast.error(result.error || "Failed to mark as sent");
      }
    },
    onError: (err: { message: string }) => toast.error(`Failed to mark as sent: ${err.message}`),
  });

  /** Open the approved email in the user's default mail client (Outlook) */
  const openInOutlook = (c: { enrichedEmail?: string | null; email?: string | null; draftSubject?: string | null; draftBody?: string | null }) => {
    const to = c.enrichedEmail || c.email || "";
    const subject = encodeURIComponent(c.draftSubject || "Atlas Copco \u2014 High-Volume Air Solutions");
    const body = encodeURIComponent(
      (c.draftBody || "") +
      "\n\n---\nReminder: Please attach the XAVS1800 product flyer before sending."
    );
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, "_self");
  };

  const pending = pendingQuery.data?.contacts ?? [];
  const approved = approvedQuery.data?.contacts ?? [];
  const rejected = rejectedQuery.data?.contacts ?? [];

  return (
    <div className="space-y-6">
      {/* Pending Approval */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            Pending Approval ({pending.length})
          </CardTitle>
          <CardDescription>Emails waiting for Ryan's review and approval</CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No emails pending approval</p>
          ) : (
            <div className="space-y-3">
              {pending.map(c => (
                <div key={c.id} className="p-3 rounded-lg border border-border hover:border-gold/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-navy text-sm">
                          {[c.firstName, c.lastName].filter(Boolean).join(" ")}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${TIER_CONFIG[c.tier]?.color || ""}`}>
                          {TIER_CONFIG[c.tier]?.label?.split("—")[1]?.trim() || c.tier}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-1">
                        {c.enrichedTitle || c.title} at {c.reviewedCompanyName || c.company}
                      </div>
                      <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                        <span>{c.enrichedEmail || c.email}</span>
                        {c.enrichmentSource === "apollo" && (
                          <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-purple-100 text-purple-700">Apollo</span>
                        )}
                        {c.enrichmentSource === "hunter" && (
                          <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-orange-100 text-orange-700">Hunter {c.hunterConfidence ? `${c.hunterConfidence}%` : ''}</span>
                        )}
                      </div>
                      {c.draftSubject && (
                        <div className="text-xs">
                          <span className="font-semibold">Subject:</span> {c.draftSubject}
                        </div>
                      )}
                      {c.draftBody && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {c.draftBody.substring(0, 200)}...
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => approveEmailMut.mutate({ contactId: c.id })}
                        disabled={approveEmailMut.isPending || rejectEmailMut.isPending}
                      >
                        <ThumbsUp className="w-3 h-3 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        onClick={() => rejectEmailMut.mutate({ contactId: c.id })}
                        disabled={rejectEmailMut.isPending || approveEmailMut.isPending}
                      >
                        <ThumbsDown className="w-3 h-3 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rejected — Pushed Back */}
      {rejected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              Rejected — Pushed Back ({rejected.length})
            </CardTitle>
            <CardDescription>Emails rejected during review. These contacts can be re-generated or removed.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {rejected.map(c => (
                <div key={c.id} className="p-3 rounded-lg border border-red-200 bg-red-50/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-navy text-sm">
                          {[c.firstName, c.lastName].filter(Boolean).join(" ")}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${TIER_CONFIG[c.tier]?.color || ""}`}>
                          {TIER_CONFIG[c.tier]?.label?.split("\u2014")[1]?.trim() || c.tier}
                        </span>
                        <Badge variant="outline" className="border-red-300 text-red-600 text-[9px]">Rejected</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.enrichedTitle || c.title} at {c.reviewedCompanyName || c.company}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-blue-300 text-blue-600 hover:bg-blue-50 shrink-0"
                      onClick={() => {
                        // Re-generate by calling generateEmail which resets status
                        toast.info("Use the Contacts tab to re-generate this email");
                      }}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" /> Re-generate
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approved — Ready to Send */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Approved — Ready to Send ({approved.length})
          </CardTitle>
          <CardDescription>Emails approved by Ryan, ready to dispatch</CardDescription>
        </CardHeader>
        <CardContent>
          {approved.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No approved emails ready to send</p>
          ) : (
            <div className="space-y-3">
              {approved.map(c => (
                <div key={c.id} className="p-3 rounded-lg border border-green-200 bg-green-50/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-semibold text-navy text-sm">
                        {[c.firstName, c.lastName].filter(Boolean).join(" ")}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <span>{c.enrichedEmail || c.email}</span>
                        {c.enrichmentSource === "apollo" && (
                          <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-purple-100 text-purple-700">Apollo</span>
                        )}
                        {c.enrichmentSource === "hunter" && (
                          <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-orange-100 text-orange-700">Hunter {c.hunterConfidence ? `${c.hunterConfidence}%` : ''}</span>
                        )}
                        <span>— {c.reviewedCompanyName || c.company}</span>
                      </div>
                      {c.draftSubject && (
                        <div className="text-xs mt-1"><span className="font-semibold">Subject:</span> {c.draftSubject}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-blue-600 border-blue-200 hover:bg-blue-50"
                        onClick={() => openInOutlook(c)}
                      >
                        <Mail className="w-3 h-3 mr-1" /> Open in Outlook
                      </Button>
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => markAsSentMut.mutate({ contactId: c.id })}
                        disabled={markAsSentMut.isPending}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Mark Sent
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── KPI Card ──

function KPICard({ value, label, icon, accent }: {
  value: number;
  label: string;
  icon: React.ReactNode;
  accent?: "red" | "amber" | "blue" | "green" | "teal";
}) {
  const accentClass = accent === "red" ? "text-red-500" :
    accent === "amber" ? "text-amber-500" :
    accent === "blue" ? "text-blue-500" :
    accent === "green" ? "text-green-500" :
    accent === "teal" ? "text-teal" : "text-navy";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className={accentClass}>{icon}</span>
        </div>
        <div className={`text-2xl font-bold ${accentClass}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}
