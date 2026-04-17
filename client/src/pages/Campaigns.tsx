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
  Megaphone, Users, Mail, CheckCircle2, Send, Search, Download, Archive,
  Flame, TrendingUp, Sparkles, Database, ChevronLeft, ChevronRight,
  Eye, Edit3, ThumbsUp, Loader2, Filter, BarChart3,
  Target, Zap, Clock, AlertCircle, RefreshCw, ThumbsDown, XCircle, Plus, Trash2, FileText, Code,
} from "lucide-react";
import { Link } from "wouter";
import CampaignBuilder from "./CampaignBuilder";
import TemplateEditorModal from "@/components/TemplateEditorModal";

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
  draftTone: string | null;
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
  // Seniority buckets (from classifyTitle in campaignService.ts)
  c_suite: { label: "C-Suite / MD", color: "text-purple-700" },
  director: { label: "Director / GM", color: "text-indigo-600" },
  senior_manager: { label: "Senior Manager", color: "text-amber-700" },
  manager: { label: "Manager", color: "text-amber-600" },
  // Function buckets
  blasting_specialist: { label: "Blasting & Coating", color: "text-red-600" },
  construction: { label: "Construction", color: "text-red-500" },
  procurement: { label: "Procurement", color: "text-emerald-600" },
  engineering: { label: "Engineering", color: "text-cyan-600" },
  project_management: { label: "Project Management", color: "text-blue-600" },
  project_manager: { label: "Project Management", color: "text-blue-600" },
  operations: { label: "Operations", color: "text-blue-500" },
  fleet_equipment: { label: "Fleet & Equipment", color: "text-orange-600" },
  fleet_manager: { label: "Fleet & Equipment", color: "text-orange-600" },
  fleet: { label: "Fleet & Equipment", color: "text-orange-600" },
  maintenance: { label: "Maintenance", color: "text-yellow-700" },
  site_workshop: { label: "Site & Workshop", color: "text-stone-600" },
  site_manager: { label: "Site Management", color: "text-stone-600" },
  // Legacy/fallback buckets
  decision_maker: { label: "Decision Maker", color: "text-amber-600" },
  executive: { label: "Executive", color: "text-purple-700" },
  general_manager: { label: "General Manager", color: "text-indigo-600" },
  other: { label: "Other", color: "text-slate-500" },
  unknown: { label: "Unknown", color: "text-slate-400" },
};

// ── Main Component ──

export default function Campaigns() {
  const { user, loading } = useAuth();
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);

  // Access control: admin role OR campaignAccess flag in DB
  const hasAccess = user?.role === 'admin' || !!(user as any)?.campaignAccess;

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

  if (showBuilder) {
    return <CampaignBuilder
      onComplete={(id) => {
        setShowBuilder(false);
        setSelectedCampaignId(id);
        campaignsQuery.refetch();
      }}
      onCancel={() => setShowBuilder(false)}
    />;
  }

  if (!selectedCampaignId && campaignsQuery.data?.length) {
    return <CampaignList
      campaigns={campaignsQuery.data}
      onSelect={setSelectedCampaignId}
      onCreate={() => setShowBuilder(true)}
      isLoading={campaignsQuery.isLoading}
      onRefresh={() => campaignsQuery.refetch()}
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
    onCreate={() => setShowBuilder(true)}
    isLoading={campaignsQuery.isLoading}
    onRefresh={() => campaignsQuery.refetch()}
  />;
}

// ── Campaign List ──

function CampaignList({ campaigns, onSelect, onCreate, isLoading, onRefresh }: {
  campaigns: any[];
  onSelect: (id: number) => void;
  onCreate: () => void;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", senderName: "", senderEmail: "", senderTitle: "", targetSegment: "" });

  const deleteMut = trpc.campaign.delete.useMutation({
    onSuccess: () => {
      toast.success("Campaign deleted");
      setDeleteTarget(null);
      onRefresh();
    },
    onError: (err) => toast.error("Failed to delete: " + err.message),
  });

  const updateMut = trpc.campaign.update.useMutation({
    onSuccess: () => {
      toast.success("Campaign updated");
      setEditTarget(null);
      onRefresh();
    },
    onError: (err) => toast.error("Failed to update: " + err.message),
  });

  const openEdit = (c: any) => {
    setEditTarget(c);
    setEditForm({
      name: c.name || "",
      description: c.description || "",
      senderName: c.senderName || "",
      senderEmail: c.senderEmail || "",
      senderTitle: c.senderTitle || "",
      targetSegment: c.targetSegment || "",
    });
  };

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
        <Link href="/">
          <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-navy transition-colors mb-4">
            <ChevronLeft className="w-4 h-4" /> Back to Dashboard
          </button>
        </Link>
        <div className="text-center py-16">
          <Megaphone className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-bold text-navy mb-2">No Campaigns Yet</h2>
          <p className="text-muted-foreground mb-6">
            Create your first campaign to start building targeted outreach.
          </p>
          <Button onClick={onCreate} className="bg-navy hover:bg-navy/90 text-white">
            <Plus className="w-4 h-4 mr-2" /> Create Campaign
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/">
            <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-navy transition-colors mb-2">
              <ChevronLeft className="w-4 h-4" /> Back to Dashboard
            </button>
          </Link>
          <h1 className="text-2xl font-bold text-navy">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">Targeted outreach campaigns with collateral intelligence</p>
        </div>
        <Button onClick={onCreate} className="bg-navy hover:bg-navy/90 text-white">
          <Plus className="w-4 h-4 mr-2" /> New Campaign
        </Button>
      </div>

      <div className="grid gap-4">
        {campaigns.map((c: any) => (
          <Card
            key={c.id}
            className="cursor-pointer hover:shadow-md transition-shadow border-border group"
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
                <div className="flex items-start gap-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                      className="p-1.5 rounded-md hover:bg-slate-100 text-muted-foreground hover:text-navy transition-colors"
                      title="Edit campaign"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: c.id, name: c.name }); }}
                      className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                      title="Delete campaign"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">From</div>
                    <div className="text-sm font-semibold text-navy">{c.senderName}</div>
                    <div className="text-xs text-muted-foreground">{c.senderEmail}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Campaign</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This will permanently remove the campaign and all its contacts. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMut.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMut.mutate({ id: deleteTarget.id })}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Deleting...</> : "Delete Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Campaign Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Campaign</DialogTitle>
            <DialogDescription>Update the campaign details below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground">Campaign Name</label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Campaign name"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Description</label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Campaign description"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground">Sender Name</label>
                <Input
                  value={editForm.senderName}
                  onChange={(e) => setEditForm(f => ({ ...f, senderName: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Sender Email</label>
                <Input
                  value={editForm.senderEmail}
                  onChange={(e) => setEditForm(f => ({ ...f, senderEmail: e.target.value }))}
                  type="email"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground">Sender Title</label>
                <Input
                  value={editForm.senderTitle}
                  onChange={(e) => setEditForm(f => ({ ...f, senderTitle: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Target Segment</label>
                <Input
                  value={editForm.targetSegment}
                  onChange={(e) => setEditForm(f => ({ ...f, targetSegment: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={updateMut.isPending}>
              Cancel
            </Button>
            <Button
              className="bg-navy hover:bg-navy/90 text-white"
              onClick={() => editTarget && updateMut.mutate({ id: editTarget.id, ...editForm })}
              disabled={updateMut.isPending || !editForm.name.trim()}
            >
              {updateMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving...</> : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Campaign Detail ──

function CampaignDetail({ campaignId, onBack }: { campaignId: number; onBack: () => void }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [tierFilter, setTierFilter] = useState<string>("");
  const [outreachFilter, setOutreachFilter] = useState<string>("");
  const [enrichmentFilter, setEnrichmentFilter] = useState<string>("");
  const [roleBucketFilter, setRoleBucketFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedContact, setSelectedContact] = useState<CampaignContact | null>(null);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [editingSubject, setEditingSubject] = useState("");
  const [editingBody, setEditingBody] = useState("");
  const [showEnrichConfirm, setShowEnrichConfirm] = useState(false);
  const [enrichBatchSize, setEnrichBatchSize] = useState(100);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkOverwrite, setBulkOverwrite] = useState(false);
  const PAGE_SIZE = 50;

  const campaignQuery = trpc.campaign.get.useQuery({ id: campaignId });
  const statsQuery = trpc.campaign.stats.useQuery({ campaignId });
  const contactsQuery = trpc.campaign.contacts.useQuery({
    campaignId,
    tier: tierFilter || undefined,
    outreachStatus: outreachFilter || undefined,
    enrichmentStatus: enrichmentFilter || undefined,
    roleBucket: roleBucketFilter || undefined,
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

  /** Download .eml file for a campaign contact */
  const downloadEmlMut = trpc.campaign.downloadEml.useMutation({
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.emlBase64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "message/rfc822" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Email downloaded for ${data.recipientName} — open in Outlook and hit Send`);
      contactsQuery.refetch();
    },
    onError: (err: { message: string }) => toast.error(`Failed to download email: ${err.message}`),
  });

  const downloadEml = (c: CampaignContact) => {
    downloadEmlMut.mutate({ contactId: c.id });
  };

  /** Download ALL approved .eml files as a ZIP */
  const downloadAllEmlsMut = trpc.campaign.downloadAllEmls.useMutation({
    onSuccess: (data) => {
      // Download from S3 URL instead of decoding base64 in-browser
      const a = document.createElement("a");
      a.href = data.zipUrl;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(`Downloaded ${data.count} emails as ZIP — drag into Outlook Drafts and send`);
    },
    onError: (err: { message: string }) => toast.error(`Failed to download emails: ${err.message}`),
  });

  /** Fallback: Open in email client via mailto: */
  const openInOutlook = (c: CampaignContact) => {
    const to = c.enrichedEmail || c.email || "";
    const subject = encodeURIComponent(c.draftSubject || "Atlas Copco — High-Volume Air Solutions");
    const body = encodeURIComponent(c.draftBody || "");
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

  const templateQuery = trpc.campaign.getTemplate.useQuery({ campaignId });
  const hasTemplate = !!templateQuery.data?.template;

  const bulkGenerateMut = trpc.campaign.bulkGenerateFromTemplate.useMutation({
    onSuccess: (result) => {
      contactsQuery.refetch();
      statsQuery.refetch();
      setShowBulkConfirm(false);
      toast.success(`Generated ${result.generated} emails from template (${result.skipped} skipped)`);
    },
    onError: (err) => toast.error(`Bulk generate failed: ${err.message}`),
  });

  const generateFromTemplateMut = trpc.campaign.generateFromTemplate.useMutation({
    onSuccess: (result) => {
      setEditingSubject(result.subject);
      setEditingBody(result.body);
      contactsQuery.refetch();
      toast.success("Email generated from template");
    },
    onError: (err) => toast.error(`Failed to generate from template: ${err.message}`),
  });

  const enrichMut = trpc.campaign.enrichContacts.useMutation();
  const trpcUtils = trpc.useUtils();
  const [isEnrichingBg, setIsEnrichingBg] = useState(false);
  const handleEnrichCampaign = async (batchSize: number) => {
    setIsEnrichingBg(true);
    setShowEnrichConfirm(false);
    try {
      const { jobId } = await enrichMut.mutateAsync({ campaignId, maxContacts: batchSize });
      // Poll for completion
      const pollInterval = 3000;
      const maxPollTime = 10 * 60 * 1000;
      const startTime = Date.now();
      const poll = async (): Promise<void> => {
        if (Date.now() - startTime > maxPollTime) {
          toast.error("Enrichment is taking too long. Refresh the page to check results.");
          setIsEnrichingBg(false);
          return;
        }
        try {
          const progress = await trpcUtils.campaign.enrichmentProgress.fetch({ jobId });
          if (progress.status === "running") {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            return poll();
          }
          if (progress.status === "failed") {
            toast.error("Enrichment failed: " + (progress.error || "Unknown error"));
            setIsEnrichingBg(false);
            return;
          }
          if (progress.status === "not_found") {
            toast.error("Enrichment job not found. Please try again.");
            setIsEnrichingBg(false);
            return;
          }
          // Completed
          const result = progress.result;
          if (result) {
            contactsQuery.refetch();
            statsQuery.refetch();
            const parts = [`Enriched: ${result.enriched}`];
            if (result.apolloFound) parts.push(`Apollo: ${result.apolloFound}`);
            if (result.hunterFound) parts.push(`Hunter: ${result.hunterFound}`);
            parts.push(`Not found: ${result.notFound}`);
            if (result.creditsUsed) parts.push(`Credits: ${result.creditsUsed}`);
            const quality: string[] = [];
            if (result.emailsVerified) quality.push(`${result.emailsVerified} emails verified`);
            if (result.emailsCorrected) quality.push(`${result.emailsCorrected} emails corrected`);
            if (result.linkedInAdded) quality.push(`${result.linkedInAdded} LinkedIn added`);
            if (result.titlesUpdated) quality.push(`${result.titlesUpdated} titles updated`);
            if (quality.length > 0) parts.push(quality.join(", "));
            toast.success(parts.join(" | "));
          } else {
            toast.success("Enrichment completed");
            contactsQuery.refetch();
            statsQuery.refetch();
          }
          setIsEnrichingBg(false);
        } catch (pollErr) {
          console.warn("[Enrichment] Poll error, retrying...", pollErr);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          return poll();
        }
      };
      await poll();
    } catch (err) {
      toast.error("Failed to start enrichment: " + (err as Error).message);
      setIsEnrichingBg(false);
    }
  };

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

          {/* Role Bucket Breakdown */}
          {stats && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contact Role Breakdown</CardTitle>
                <CardDescription>How contacts are classified by seniority and function</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {Object.entries(stats.byRoleBucket || stats.byTitleRelevance)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .map(([key, count]) => {
                    const config = RELEVANCE_CONFIG[key] || { label: key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), color: "text-slate-500" };
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
                <CardDescription>Always Enrich — Apollo → Hunter.io waterfall verifies emails, adds LinkedIn, updates titles</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="text-center p-3 rounded-lg bg-green-50">
                    <div className="text-2xl font-bold text-green-600">{stats.byEnrichment?.enriched ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Enriched</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-amber-50">
                    <div className="text-2xl font-bold text-amber-600">{stats.byEnrichment?.pending ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Pending Enrichment</div>
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
                className={hasTemplate ? "bg-gold text-navy hover:bg-gold/90" : ""}
                variant={hasTemplate ? "default" : "outline"}
                onClick={() => setShowTemplateEditor(true)}
              >
                <FileText className="w-4 h-4 mr-2" />
                {hasTemplate ? "Edit Email Template" : "Create Email Template"}
              </Button>
              {hasTemplate && (
                <Button
                  variant="outline"
                  className="border-green-300 text-green-700 hover:bg-green-50"
                  onClick={() => setShowBulkConfirm(true)}
                  disabled={bulkGenerateMut.isPending}
                >
                  {bulkGenerateMut.isPending
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                    : <><Mail className="w-4 h-4 mr-2" /> Generate All Emails from Template</>}
                </Button>
              )}
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
                onClick={() => setShowEnrichConfirm(true)}
                disabled={isEnrichingBg}
              >
                {isEnrichingBg ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                {isEnrichingBg ? "Enriching..." : `Enrich Contacts (${stats?.byEnrichment?.pending ?? 0} pending)`}
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
              {(stats?.byOutreach?.approved ?? 0) > 0 && (
                <Button
                  className="bg-navy hover:bg-navy/90 text-white"
                  onClick={() => downloadAllEmlsMut.mutate({ campaignId })}
                  disabled={downloadAllEmlsMut.isPending}
                >
                  {downloadAllEmlsMut.isPending
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Preparing ZIP...</>
                    : <><Archive className="w-4 h-4 mr-2" /> Download All Emails ({stats?.byOutreach?.approved ?? 0})</>}
                </Button>
              )}
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
              <option value="has_email">Has Email</option>
              <option value="enriched">Enriched</option>
              <option value="pending">Pending Enrichment</option>
              <option value="not_found">Not Found</option>
              <option value="failed">Failed</option>
            </select>
            <select
              value={roleBucketFilter}
              onChange={e => { setRoleBucketFilter(e.target.value); setPage(0); }}
              className="px-3 py-2 rounded-md border border-border bg-card text-sm"
            >
              <option value="">All Roles</option>
              <option value="c_suite">C-Suite / MD</option>
              <option value="director">Director / GM</option>
              <option value="senior_manager">Senior Manager</option>
              <option value="manager">Manager</option>
              <option value="blasting_specialist">Blasting & Coating</option>
              <option value="procurement">Procurement</option>
              <option value="engineering">Engineering</option>
              <option value="project_management">Project Management</option>
              <option value="operations">Operations</option>
              <option value="fleet_equipment">Fleet & Equipment</option>
              <option value="maintenance">Maintenance</option>
              <option value="site_workshop">Site & Workshop</option>
              <option value="other">Other</option>
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
                  <tr key={c.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors${!c.enrichedEmail && !c.email && c.enrichmentStatus !== "pending" ? " opacity-50" : ""}`}>
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
                      {(c.roleBucket || c.titleRelevance) && (c.roleBucket || c.titleRelevance) !== "unknown" && (
                        <span className={`text-[10px] font-semibold ${RELEVANCE_CONFIG[c.roleBucket || c.titleRelevance]?.color || "text-slate-500"}`}>
                          {RELEVANCE_CONFIG[c.roleBucket || c.titleRelevance]?.label || (c.roleBucket || c.titleRelevance || "").replace(/_/g, " ").replace(/\b\w/g, (ch: string) => ch.toUpperCase())}
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
                        {c.enrichmentSource === "import" && (c.email || c.enrichedEmail) && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-500" title="Email kept from import (not verified by Apollo/Hunter)">
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
                          <>
                            {hasTemplate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-gold"
                                title="Generate from template"
                                onClick={() => {
                                  setSelectedContact(c);
                                  generateFromTemplateMut.mutate({ contactId: c.id });
                                  setShowEmailDialog(true);
                                }}
                                disabled={generateFromTemplateMut.isPending}
                              >
                                {generateFromTemplateMut.isPending && selectedContact?.id === c.id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <FileText className="w-3 h-3" />}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              title="Generate with AI"
                              onClick={() => {
                                setSelectedContact(c);
                                generateEmailMut.mutate({ contactId: c.id, tone: "first_touch" });
                                setShowEmailDialog(true);
                              }}
                              disabled={generateEmailMut.isPending}
                            >
                              {generateEmailMut.isPending && selectedContact?.id === c.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Sparkles className="w-3 h-3" />}
                            </Button>
                          </>
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
                              onClick={() => downloadEml(c)}
                              disabled={downloadEmlMut.isPending}
                              title="Download Email (.eml)"
                            >
                              <Download className="w-3 h-3" />
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
              {selectedContact?.draftTone === "html-template" ? (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase">HTML Email Preview</label>
                    <Badge variant="outline" className="border-blue-400 text-blue-600 text-[10px]">HTML Template</Badge>
                  </div>
                  <div className="border border-border rounded-lg overflow-hidden bg-white">
                    <iframe
                      srcDoc={editingBody}
                      title="HTML Email Preview"
                      className="w-full border-0"
                      style={{ minHeight: "350px" }}
                      sandbox="allow-same-origin"
                    />
                  </div>
                  <details className="mt-2">
                    <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">Edit raw HTML source</summary>
                    <Textarea
                      value={editingBody}
                      onChange={e => setEditingBody(e.target.value)}
                      rows={10}
                      className="font-mono text-xs mt-1"
                    />
                  </details>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Body</label>
                  <Textarea
                    value={editingBody}
                    onChange={e => setEditingBody(e.target.value)}
                    rows={12}
                    className="font-mono text-sm"
                  />
                </div>
              )}
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

      {/* Enrichment Confirmation Dialog */}
      <Dialog open={showEnrichConfirm} onOpenChange={setShowEnrichConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              Enrich Contacts
            </DialogTitle>
            <DialogDescription>
              The enrichment pipeline will verify emails, add LinkedIn URLs, and update job titles via Apollo → Hunter.io waterfall.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="text-sm font-semibold text-amber-800 mb-1">Credit Estimate</div>
              <div className="text-xs text-amber-700">
                <strong>{stats?.byEnrichment?.pending ?? 0}</strong> contacts pending enrichment.
                Estimated Apollo credits: <strong>~{Math.min(enrichBatchSize, stats?.byEnrichment?.pending ?? 0)}</strong> (1 credit per contact searched).
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Batch size</label>
              <div className="flex items-center gap-2 mt-1">
                {[50, 100, 200, 500].map(size => (
                  <button
                    key={size}
                    onClick={() => setEnrichBatchSize(size)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                      enrichBatchSize === size
                        ? "bg-navy text-white shadow-sm"
                        : "bg-card text-muted-foreground border border-border hover:border-navy/30"
                    }`}
                  >
                    {size} contacts
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Will process up to {Math.min(enrichBatchSize, stats?.byEnrichment?.pending ?? 0)} of {stats?.byEnrichment?.pending ?? 0} pending contacts, prioritised by score.
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-xs text-blue-700">
                <strong>What happens:</strong> Contacts imported with emails will have those emails verified (or corrected if a better one is found). All contacts get LinkedIn URLs and updated titles where available.
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowEnrichConfirm(false)} disabled={isEnrichingBg}>
              Cancel
            </Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700 text-white"
              onClick={() => handleEnrichCampaign(enrichBatchSize)}
              disabled={isEnrichingBg || (stats?.byEnrichment?.pending ?? 0) === 0}
            >
              {isEnrichingBg ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enriching...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Enrich {Math.min(enrichBatchSize, stats?.byEnrichment?.pending ?? 0)} Contacts</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template Editor Modal */}
      <TemplateEditorModal
        open={showTemplateEditor}
        onOpenChange={setShowTemplateEditor}
        campaignId={campaignId}
        campaignName={campaign.name}
        onTemplateSaved={() => templateQuery.refetch()}
      />

      {/* Bulk Generate from Template Confirmation */}
      <Dialog open={showBulkConfirm} onOpenChange={setShowBulkConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-green-600" />
              Generate Emails from Template
            </DialogTitle>
            <DialogDescription>
              This will generate personalised email drafts for all eligible contacts using your saved template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="bulkOverwrite"
                checked={bulkOverwrite}
                onChange={e => setBulkOverwrite(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="bulkOverwrite" className="text-sm text-foreground">
                Overwrite existing drafts (contacts with existing emails will be regenerated)
              </label>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-700">
                <strong>Note:</strong> Contacts without email addresses and excluded contacts will be skipped.
                Generated emails will be set to "Pending Approval" status.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowBulkConfirm(false)} disabled={bulkGenerateMut.isPending}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => bulkGenerateMut.mutate({
                campaignId,
                overwriteExisting: bulkOverwrite,
                onlyWithEmail: true,
              })}
              disabled={bulkGenerateMut.isPending}
            >
              {bulkGenerateMut.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                : <><Mail className="w-4 h-4 mr-2" /> Generate All Emails</>}
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

  /** Download ALL approved .eml files as a ZIP */
  const downloadAllEmlsMut = trpc.campaign.downloadAllEmls.useMutation({
    onSuccess: (data) => {
      // Download from S3 URL instead of decoding base64 in-browser
      const a = document.createElement("a");
      a.href = data.zipUrl;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(`Downloaded ${data.count} emails as ZIP — drag into Outlook Drafts and send`);
    },
    onError: (err: { message: string }) => toast.error(`Failed to download emails: ${err.message}`),
  });

  /** Download .eml file for a campaign contact in the approval queue */
  const downloadEmlMut2 = trpc.campaign.downloadEml.useMutation({
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.emlBase64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "message/rfc822" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Email downloaded for ${data.recipientName} — open in Outlook and hit Send`);
      approvedQuery.refetch();
    },
    onError: (err: { message: string }) => toast.error(`Failed to download email: ${err.message}`),
  });

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
                        c.draftTone === "html-template" ? (
                          <div className="mt-2 border border-border rounded overflow-hidden">
                            <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 border-b border-border">
                              <Code className="w-3 h-3 text-blue-600" />
                              <span className="text-[10px] font-semibold text-blue-600">HTML Template Email</span>
                            </div>
                            <iframe
                              srcDoc={c.draftBody}
                              title={`Preview for ${c.firstName}`}
                              className="w-full border-0"
                              style={{ height: "200px" }}
                              sandbox="allow-same-origin"
                            />
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {c.draftBody.substring(0, 200)}...
                          </div>
                        )
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Approved — Ready to Send ({approved.length})
              </CardTitle>
              <CardDescription>Emails approved and ready to dispatch</CardDescription>
            </div>
            {approved.length > 0 && (
              <Button
                size="sm"
                className="bg-navy hover:bg-navy/90 text-white"
                onClick={() => downloadAllEmlsMut.mutate({ campaignId })}
                disabled={downloadAllEmlsMut.isPending}
              >
                {downloadAllEmlsMut.isPending
                  ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Preparing...</>
                  : <><Archive className="w-3 h-3 mr-1" /> Download All ({approved.length})</>}
              </Button>
            )}
          </div>
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
                        onClick={() => downloadEmlMut2.mutate({ contactId: c.id })}
                        disabled={downloadEmlMut2.isPending}
                      >
                        <Download className="w-3 h-3 mr-1" /> {downloadEmlMut2.isPending ? "Preparing..." : "Download Email"}
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
