/**
 * CampaignBuilder.tsx — Self-service campaign creation wizard
 *
 * Multi-step flow:
 * 1. Campaign Details — name, description, product, sender info, target segment
 * 2. Add Contacts — upload CSV/Excel OR search by company domains via Hunter.io
 *    - Smart detection: if uploaded file has companies/domains but no individual contacts,
 *      automatically switches to "Find Contacts at These Companies" flow
 * 3. Review & Launch — see imported contacts, tier breakdown, trigger enrichment
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Check, Upload, Search, Globe,
  Users, Loader2, FileSpreadsheet, Zap, Megaphone,
  Flame, TrendingUp, Database, Clock, AlertCircle, X,
  Plus, Trash2, CheckCircle2, ArrowRight, Building2, Sparkles,
} from "lucide-react";

// ── Types ──

interface CampaignForm {
  name: string;
  description: string;
  collateralId: number | null;
  collateralName: string;
  senderName: string;
  senderEmail: string;
  senderTitle: string;
  targetSegment: string;
}

interface ColumnMapping {
  firstName?: number;
  lastName?: number;
  fullName?: number;
  title?: number;
  company?: number;
  email?: number;
  phone?: number;
  mobile?: number;
  linkedin?: number;
  website?: number;
}

interface FilePreview {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  detectedMapping: ColumnMapping;
  sheetNames?: string[];
}

interface SearchResult {
  contacts: any[];
  domainsSearched: number;
  domainsWithResults: number;
  totalFound: number;
  totalFiltered: number;
  domainBreakdown: { domain: string; organization: string; found: number; filtered: number }[];
}

interface CompanySearchResult extends SearchResult {
  companies: any[];
  companiesWithoutDomain: string[];
}

// ── Constants ──

const STEPS_DEFAULT = [
  { id: 1, label: "Campaign Details", icon: Megaphone },
  { id: 2, label: "Add Contacts", icon: Users },
  { id: 3, label: "Review & Launch", icon: Zap },
];

const STEPS_COMPANY_FLOW = [
  { id: 1, label: "Campaign Details", icon: Megaphone },
  { id: 2, label: "Discover Contacts", icon: Search },
  { id: 3, label: "Import & Enrich", icon: Zap },
];

const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "fullName", label: "Full Name" },
  { key: "title", label: "Job Title" },
  { key: "company", label: "Company", required: true },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "mobile", label: "Mobile" },
];

// ── Main Component ──

export default function CampaignBuilder({ onComplete, onCancel }: {
  onComplete: (campaignId: number) => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [createdCampaignId, setCreatedCampaignId] = useState<number | null>(null);

  // Step 1: Campaign details
  const [form, setForm] = useState<CampaignForm>({
    name: "",
    description: "",
    collateralId: null,
    collateralName: "",
    senderName: user?.name || "",
    senderEmail: user?.email || "",
    senderTitle: "",
    targetSegment: "",
  });

  // Step 2: Contact source
  const [contactMethod, setContactMethod] = useState<"upload" | "search" | null>(null);

  // Upload state
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [isUploading, setIsUploading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Company-list detection state
  const [fileType, setFileType] = useState<"contacts" | "companies" | null>(null);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [companySearchResult, setCompanySearchResult] = useState<CompanySearchResult | null>(null);

  // Background company search job state
  const [searchJobId, setSearchJobId] = useState<string | null>(null);
  const [searchJobTotalCompanies, setSearchJobTotalCompanies] = useState(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Search state
  const [searchDomains, setSearchDomains] = useState<string[]>([""]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [customRolePattern, setCustomRolePattern] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Progress polling state
  const [searchProgress, setSearchProgress] = useState<{
    companiesSearched: number;
    totalCompanies: number;
    totalFound: number;
    totalFiltered: number;
    companiesWithResults: number;
    currentCompany: string | null;
    elapsedSeconds: number;
    status: string;
    phase: string;
    error: string | null;
    domainInference: {
      total: number;
      completed: number;
      resolved: number;
      highConfidence: number;
      mediumConfidence: number;
    };
  } | null>(null);

  // Step 3: Import state
  const [importResult, setImportResult] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichmentResult, setEnrichmentResult] = useState<any>(null);
  const [showEnrichConfirm, setShowEnrichConfirm] = useState(false);
  const [autoEnrichTriggered, setAutoEnrichTriggered] = useState(false);
  const [enrichBatchSize, setEnrichBatchSize] = useState(100);
  const [remainingPending, setRemainingPending] = useState<number | null>(null);

  // Queries
  const collateralQuery = trpc.collateral.list.useQuery({});
  const rolesQuery = trpc.campaign.availableRoles.useQuery();
  const trpcUtils = trpc.useUtils();

  // Mutations
  const createCampaign = trpc.campaign.create.useMutation();
  const previewFile = trpc.campaign.previewFile.useMutation();
  const importWithMapping = trpc.campaign.importWithMapping.useMutation();
  const searchContacts = trpc.campaign.searchContacts.useMutation();
  const importSearchResults = trpc.campaign.importSearchResults.useMutation();
  const enrichContacts = trpc.campaign.enrichContacts.useMutation();
  const analyseFile = trpc.campaign.analyseFile.useMutation();
  const searchCompanyContacts = trpc.campaign.searchCompanyContacts.useMutation();

  // ── Step 1: Campaign Details ──

  const handleCreateCampaign = async () => {
    if (!form.name || !form.senderName || !form.senderEmail) {
      toast.error("Please fill in campaign name, sender name, and sender email");
      return;
    }
    try {
      const result = await createCampaign.mutateAsync({
        name: form.name,
        description: form.description || undefined,
        collateralId: form.collateralId || undefined,
        collateralName: form.collateralName || undefined,
        senderName: form.senderName,
        senderEmail: form.senderEmail,
        senderTitle: form.senderTitle || undefined,
        targetSegment: form.targetSegment || undefined,
      });
      setCreatedCampaignId(result.id);
      toast.success(`Campaign "${form.name}" created`);
      setStep(2);
    } catch (err) {
      toast.error("Failed to create campaign: " + (err as Error).message);
    }
  };

  // ── Step 2: File Upload ──

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setIsPreviewing(true);
    setFileType(null);
    setCompanySearchResult(null);
    try {
      // Upload file to S3 via server endpoint
      const uploadRes = await fetch("/api/upload-campaign-file", {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": file.name,
        },
        credentials: "include",
      });
      if (!uploadRes.ok) throw new Error("File upload failed");
      const { url: fileUrl } = await uploadRes.json();

      setUploadedFileUrl(fileUrl);
      setUploadedFileName(file.name);

      // Preview the file to detect columns
      const preview = await previewFile.mutateAsync({ fileUrl });
      setFilePreview(preview);
      setColumnMapping(preview.detectedMapping);

      // Analyse the file to detect if it's contacts or companies
      setIsAnalysing(true);
      try {
        const analysis = await analyseFile.mutateAsync({
          fileUrl,
          mapping: preview.detectedMapping,
        });
        setFileType(analysis.type);
        if (analysis.type === "companies") {
          toast.info(
            `Detected ${analysis.rowsCompanyOnly} companies (no individual contacts). We'll help you find contacts at these companies.`,
            { duration: 5000 }
          );
        } else {
          toast.success(`File uploaded: ${preview.totalRows} rows with contact data detected`);
        }
      } catch {
        // If analysis fails, default to contacts
        setFileType("contacts");
        toast.success(`File uploaded: ${preview.totalRows} rows detected`);
      }
      setIsAnalysing(false);
    } catch (err) {
      toast.error("Failed to upload file: " + (err as Error).message);
    } finally {
      setIsUploading(false);
      setIsPreviewing(false);
    }
  };

  const handleImportFromFile = async () => {
    if (!createdCampaignId || !uploadedFileUrl) return;
    setIsImporting(true);
    try {
      const result = await importWithMapping.mutateAsync({
        campaignId: createdCampaignId,
        fileUrl: uploadedFileUrl,
        mapping: columnMapping,
      });
      setImportResult(result);
      toast.success(`Imported ${result.imported} contacts`);
      setStep(3);
    } catch (err) {
      toast.error("Import failed: " + (err as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  // ── Step 2: Company Contact Discovery ──

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleSearchCompanyContacts = async () => {
    if (!uploadedFileUrl) return;
    if (selectedRoles.length === 0 && !customRolePattern) {
      toast.error("Please select at least one target role to search for");
      return;
    }

    setIsSearching(true);
    setSearchProgress(null);
    try {
      // Save search roles to campaign for future reference
      if (createdCampaignId) {
        saveSearchRoles.mutate({
          campaignId: createdCampaignId,
          targetRoles: selectedRoles,
          customRoleKeywords: customRolePattern ? customRolePattern.split("|").map(k => k.trim()).filter(Boolean) : [],
        });
      }

      // Start background job — returns immediately with jobId
      const result = await searchCompanyContacts.mutateAsync({
        fileUrl: uploadedFileUrl,
        mapping: columnMapping,
        targetRoles: selectedRoles,
        customRolePatterns: customRolePattern ? [customRolePattern] : undefined,
        maxPerDomain: 25,
        maxTotal: 2000,
      });

      if (!result.jobId) {
        toast.error("No companies found in file");
        setIsSearching(false);
        return;
      }

      setSearchJobId(result.jobId);
      setSearchJobTotalCompanies(result.totalCompanies);
      toast.info(`Searching ${result.totalCompanies} companies in the background...`);

      // Start polling for progress
      startPolling(result.jobId);
    } catch (err) {
      toast.error("Contact search failed: " + (err as Error).message);
      setIsSearching(false);
    }
  };

  const startPolling = useCallback((jobId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    const poll = async () => {
      try {
        const progress = await trpcUtils.campaign.companySearchProgress.fetch({ jobId });

        setSearchProgress({
          companiesSearched: progress.companiesSearched,
          totalCompanies: progress.totalCompanies,
          totalFound: progress.totalFound,
          totalFiltered: progress.totalFiltered,
          companiesWithResults: progress.companiesWithResults,
          currentCompany: progress.currentCompany,
          elapsedSeconds: progress.elapsedSeconds,
          status: progress.status,
          phase: progress.phase,
          error: progress.error,
          domainInference: progress.domainInference,
        });

        if (progress.status === "completed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setIsSearching(false);
          setSearchJobId(null);

          // Build the CompanySearchResult from the completed job
          setCompanySearchResult({
            companies: [],
            contacts: progress.contacts,
            domainsSearched: progress.totalCompanies,
            domainsWithResults: progress.companiesWithResults,
            totalFound: progress.totalFound,
            totalFiltered: progress.totalFiltered,
            domainBreakdown: progress.domainBreakdown,
            companiesWithoutDomain: [],
          });
          toast.success(
            `Found ${progress.totalFiltered} contacts at ${progress.companiesWithResults} companies (${progress.elapsedSeconds}s)`
          );
        } else if (progress.status === "failed" || progress.status === "not_found") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setIsSearching(false);
          setSearchJobId(null);
          toast.error("Search failed: " + (progress.error || "Unknown error"));
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    };

    // Poll immediately, then every 2 seconds
    poll();
    pollingRef.current = setInterval(poll, 2000);
  }, []);

  const handleImportCompanySearchResults = async () => {
    if (!createdCampaignId || !companySearchResult) return;
    setIsImporting(true);
    try {
      const result = await importSearchResults.mutateAsync({
        campaignId: createdCampaignId,
        contacts: companySearchResult.contacts,
      });
      setImportResult(result);
      toast.success(`Imported ${result.imported} contacts`);
      setStep(3);
      // Auto-trigger enrichment confirmation dialog after company discovery import
      if (result.imported > 0) {
        setAutoEnrichTriggered(true);
        setShowEnrichConfirm(true);
      }
    } catch (err) {
      toast.error("Import failed: " + (err as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  // ── Step 2: Domain Search ──

  const addDomain = () => setSearchDomains(prev => [...prev, ""]);
  const removeDomain = (idx: number) => setSearchDomains(prev => prev.filter((_, i) => i !== idx));
  const updateDomain = (idx: number, val: string) => {
    setSearchDomains(prev => prev.map((d, i) => i === idx ? val : d));
  };

  const toggleRole = (roleKey: string) => {
    setSelectedRoles(prev =>
      prev.includes(roleKey) ? prev.filter(r => r !== roleKey) : [...prev, roleKey]
    );
  };

  const handleSearch = async () => {
    const validDomains = searchDomains.filter(d => d.trim()).map(d => d.trim().toLowerCase());
    if (validDomains.length === 0) {
      toast.error("Please enter at least one company domain");
      return;
    }
    if (selectedRoles.length === 0 && !customRolePattern) {
      toast.error("Please select at least one target role");
      return;
    }

    setIsSearching(true);
    try {
      // Save search roles to campaign for future reference
      if (createdCampaignId) {
        saveSearchRoles.mutate({
          campaignId: createdCampaignId,
          targetRoles: selectedRoles,
          customRoleKeywords: customRolePattern ? customRolePattern.split("|").map(k => k.trim()).filter(Boolean) : [],
        });
      }

      const result = await searchContacts.mutateAsync({
        domains: validDomains,
        targetRoles: selectedRoles,
        customRolePatterns: customRolePattern ? [customRolePattern] : undefined,
        maxPerDomain: 50,
      });
      setSearchResult(result);
      toast.success(`Found ${result.totalFiltered} matching contacts across ${result.domainsWithResults} domains`);
    } catch (err) {
      toast.error("Search failed: " + (err as Error).message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleImportSearchResults = async () => {
    if (!createdCampaignId || !searchResult) return;
    setIsImporting(true);
    try {
      const result = await importSearchResults.mutateAsync({
        campaignId: createdCampaignId,
        contacts: searchResult.contacts,
      });
      setImportResult(result);
      toast.success(`Imported ${result.imported} contacts`);
      setStep(3);
      // Auto-trigger enrichment confirmation dialog after search import
      if (result.imported > 0) {
        setAutoEnrichTriggered(true);
        setShowEnrichConfirm(true);
      }
    } catch (err) {
      toast.error("Import failed: " + (err as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  // ── Step 3: Enrichment ──

  const handleEnrich = async (batchSize: number = 100) => {
    if (!createdCampaignId) return;
    setIsEnriching(true);
    setShowEnrichConfirm(false);
    try {
      // Start enrichment as a background job
      const { jobId } = await enrichContacts.mutateAsync({
        campaignId: createdCampaignId,
        maxContacts: batchSize,
      });
      // Poll for completion
      const pollInterval = 3000; // 3 seconds
      const maxPollTime = 10 * 60 * 1000; // 10 minutes
      const startTime = Date.now();
      const poll = async (): Promise<void> => {
        if (Date.now() - startTime > maxPollTime) {
          toast.error("Enrichment is taking too long. Check the campaign dashboard for results.");
          setIsEnriching(false);
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
            setIsEnriching(false);
            return;
          }
          if (progress.status === "not_found") {
            toast.error("Enrichment job not found. Please try again.");
            setIsEnriching(false);
            return;
          }
          // Completed
          const result = progress.result;
          if (result) {
            setEnrichmentResult(result);
            const totalPending = remainingPending ?? (importResult?.imported || 0);
            const processedThisRun = (result.enriched || 0) + (result.notFound || 0) + (result.failed || 0);
            setRemainingPending(Math.max(0, totalPending - processedThisRun));
            const parts = [];
            if (result.apolloFound) parts.push(`Apollo: ${result.apolloFound}`);
            if (result.hunterFound) parts.push(`Hunter: ${result.hunterFound}`);
            if (result.emailsVerified) parts.push(`Verified: ${result.emailsVerified}`);
            if (result.linkedInAdded) parts.push(`LinkedIn: ${result.linkedInAdded}`);
            toast.success(`Enriched ${result.enriched} contacts in ${progress.elapsedSeconds}s${parts.length ? ` (${parts.join(", ")})` : ""}`);
          } else {
            toast.success("Enrichment completed");
          }
          setIsEnriching(false);
        } catch (pollErr) {
          // Network error during polling — retry
          console.warn("[Enrichment] Poll error, retrying...", pollErr);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          return poll();
        }
      };
      await poll();
    } catch (err) {
      toast.error("Failed to start enrichment: " + (err as Error).message);
      setIsEnriching(false);
    }
  };

  // ── Shared: Role Selector (rendered inline to avoid re-mount / focus loss) ──

  const saveSearchRoles = trpc.campaign.saveSearchRoles.useMutation();

  const roleSelectorJsx = (
    <div className="space-y-3">
      <Label className="text-sm font-semibold">Target Roles</Label>
      <p className="text-xs text-muted-foreground">
        Select the types of contacts you're looking for. We'll search for people matching these roles.
      </p>
      <div className="flex flex-wrap gap-2">
        {rolesQuery.data?.map((role: any) => (
          <button
            key={role.key}
            onClick={() => toggleRole(role.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              selectedRoles.includes(role.key)
                ? "bg-navy text-white shadow-sm"
                : "bg-card text-muted-foreground border border-border hover:border-navy/30"
            }`}
          >
            {role.name}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Custom role keyword (optional)</Label>
        <Input
          placeholder="e.g., compressor|pneumatic|rental"
          value={customRolePattern}
          onChange={e => setCustomRolePattern(e.target.value)}
          className="border-border text-sm"
        />
        <p className="text-[10px] text-muted-foreground">Separate multiple keywords with | (pipe). These will be saved to the campaign for future searches.</p>
      </div>
    </div>
  );

  // ── Render ──

  return (
    <div className="container py-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-muted-foreground">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to Campaigns
        </Button>
      </div>

      <h1 className="text-2xl font-bold text-navy mb-2">Create New Campaign</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Set up a targeted outreach campaign with contacts, enrichment, and email generation.
      </p>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-8">
        {(fileType === "companies" ? STEPS_COMPANY_FLOW : STEPS_DEFAULT).map((s: typeof STEPS_DEFAULT[number], idx: number) => {
          const Icon = s.icon;
          const isActive = step === s.id;
          const isCompleted = step > s.id;
          return (
            <div key={s.id} className="flex items-center gap-2">
              {idx > 0 && (
                <div className={`h-px w-8 sm:w-16 ${isCompleted ? "bg-gold" : "bg-border"}`} />
              )}
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? "bg-navy text-white" :
                isCompleted ? "bg-gold/15 text-gold-dark" :
                "bg-card text-muted-foreground border border-border"
              }`}>
                {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step 1: Campaign Details */}
      {step === 1 && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-navy">Campaign Details</CardTitle>
            <CardDescription>Define the campaign name, product, and sender information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Campaign Name */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-semibold">Campaign Name *</Label>
              <Input
                id="name"
                placeholder="e.g., DrillAir X1350 — RC Drilling Campaign"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="border-border"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="desc" className="text-sm font-semibold">Description</Label>
              <Textarea
                id="desc"
                placeholder="Brief description of the campaign objectives and target audience..."
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="border-border"
              />
            </div>

            {/* Product / Collateral */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Product / Collateral</Label>
              <Select
                value={form.collateralId?.toString() || "none"}
                onValueChange={val => {
                  if (val === "none") {
                    setForm(prev => ({ ...prev, collateralId: null, collateralName: "" }));
                  } else {
                    const item = (collateralQuery.data as any[])?.find((c: any) => c.id === Number(val));
                    setForm(prev => ({
                      ...prev,
                      collateralId: Number(val),
                      collateralName: item?.name || "",
                    }));
                  }
                }}
              >
                <SelectTrigger className="border-border">
                  <SelectValue placeholder="Select a product or collateral..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No collateral linked</SelectItem>
                  {(collateralQuery.data as any[])?.map((item: any) => (
                    <SelectItem key={item.id} value={item.id.toString()}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!form.collateralId && (
                <div className="space-y-2">
                  <Label htmlFor="collateralName" className="text-xs text-muted-foreground">Or enter a product name manually</Label>
                  <Input
                    id="collateralName"
                    placeholder="e.g., DrillAir X1350"
                    value={form.collateralName}
                    onChange={e => setForm(prev => ({ ...prev, collateralName: e.target.value }))}
                    className="border-border"
                  />
                </div>
              )}
            </div>

            {/* Target Segment */}
            <div className="space-y-2">
              <Label htmlFor="segment" className="text-sm font-semibold">Target Segment</Label>
              <Input
                id="segment"
                placeholder="e.g., RC Drillers, Water Well Drillers, Exploration Companies"
                value={form.targetSegment}
                onChange={e => setForm(prev => ({ ...prev, targetSegment: e.target.value }))}
                className="border-border"
              />
            </div>

            {/* Sender Info */}
            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-navy mb-3">Sender Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="senderName" className="text-xs">Sender Name *</Label>
                  <Input
                    id="senderName"
                    placeholder="Ryan Pemberton"
                    value={form.senderName}
                    onChange={e => setForm(prev => ({ ...prev, senderName: e.target.value }))}
                    className="border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="senderEmail" className="text-xs">Sender Email *</Label>
                  <Input
                    id="senderEmail"
                    type="email"
                    placeholder="ryan.pemberton@atlascopco.com"
                    value={form.senderEmail}
                    onChange={e => setForm(prev => ({ ...prev, senderEmail: e.target.value }))}
                    className="border-border"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="senderTitle" className="text-xs">Sender Title</Label>
                  <Input
                    id="senderTitle"
                    placeholder="Business Line Manager — Portable Air Division"
                    value={form.senderTitle}
                    onChange={e => setForm(prev => ({ ...prev, senderTitle: e.target.value }))}
                    className="border-border"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end pt-4">
              <Button
                onClick={handleCreateCampaign}
                disabled={!form.name || !form.senderName || !form.senderEmail || createCampaign.isPending}
                className="bg-navy hover:bg-navy/90 text-white"
              >
                {createCampaign.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
                ) : (
                  <>Next: Add Contacts <ChevronRight className="w-4 h-4 ml-2" /></>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Add Contacts */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Contact Method Selection */}
          {!contactMethod && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card
                className="cursor-pointer hover:shadow-md transition-shadow border-border hover:border-gold/50"
                onClick={() => setContactMethod("upload")}
              >
                <CardContent className="p-6 text-center">
                  <div className="w-14 h-14 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-4">
                    <Upload className="w-7 h-7 text-gold" />
                  </div>
                  <h3 className="text-lg font-bold text-navy mb-2">Upload a List</h3>
                  <p className="text-sm text-muted-foreground">
                    Upload a CSV or Excel file with contacts <strong>or companies</strong>. We'll auto-detect the format and find contacts if needed.
                  </p>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer hover:shadow-md transition-shadow border-border hover:border-teal/50"
                onClick={() => setContactMethod("search")}
              >
                <CardContent className="p-6 text-center">
                  <div className="w-14 h-14 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-4">
                    <Search className="w-7 h-7 text-teal" />
                  </div>
                  <h3 className="text-lg font-bold text-navy mb-2">Search for Contacts</h3>
                  <p className="text-sm text-muted-foreground">
                    Enter company domains and target roles. We'll use Hunter.io to find the right contacts for you.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Upload Flow */}
          {contactMethod === "upload" && (
            <Card className="border-border">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-navy flex items-center gap-2">
                      <FileSpreadsheet className="w-5 h-5 text-gold" />
                      Upload a List
                    </CardTitle>
                    <CardDescription>
                      Upload a CSV or Excel file with contacts or companies. We'll auto-detect the format.
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => {
                    setContactMethod(null);
                    setFilePreview(null);
                    setFileType(null);
                    setCompanySearchResult(null);
                    setSelectedRoles([]);
                    setCustomRolePattern("");
                  }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* File Input */}
                {!filePreview && (
                  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                    <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-2">
                      Drag & drop or click to select a CSV or Excel file
                    </p>
                    <p className="text-xs text-muted-foreground mb-4">
                      Works with contact lists (name + email) <strong>and</strong> company lists (company name + domain)
                    </p>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="file-upload"
                    />
                    <label htmlFor="file-upload">
                      <Button variant="outline" className="cursor-pointer" asChild>
                        <span>
                          {isUploading || isPreviewing ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</>
                          ) : (
                            <>Choose File</>
                          )}
                        </span>
                      </Button>
                    </label>
                  </div>
                )}

                {/* Preview & Column Mapping */}
                {filePreview && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-navy">{uploadedFileName}</p>
                        <p className="text-xs text-muted-foreground">{filePreview.totalRows} rows detected</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => {
                        setFilePreview(null);
                        setUploadedFileUrl(null);
                        setFileType(null);
                        setCompanySearchResult(null);
                      }}>
                        Change File
                      </Button>
                    </div>

                    {/* File Type Detection Banner */}
                    {isAnalysing && (
                      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        <span className="text-sm text-blue-700">Analysing file format...</span>
                      </div>
                    )}

                    {fileType === "companies" && !companySearchResult && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <Building2 className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                          <div className="w-full">
                            <h4 className="text-sm font-bold text-amber-800 mb-1">
                              Company List Detected
                            </h4>
                            <p className="text-xs text-amber-700 mb-3">
                              This file contains company names and domains but no individual contacts.
                              Select the roles you're targeting below and we'll search for contacts at these companies.
                            </p>

                            {/* Role selector — hidden while searching */}
                            {!isSearching && roleSelectorJsx}

                            {/* Progress indicator — shown while searching */}
                            {isSearching && searchProgress && (
                              <div className="space-y-3 my-3">
                                {/* Phase indicator */}
                                <div className="flex items-center gap-3 text-xs">
                                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold ${
                                    searchProgress.phase === "inferring_domains"
                                      ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300"
                                      : searchProgress.domainInference.total > 0
                                        ? "bg-blue-50 text-blue-400"
                                        : "bg-slate-50 text-slate-400"
                                  }`}>
                                    {searchProgress.phase === "inferring_domains" && <Loader2 className="w-3 h-3 animate-spin" />}
                                    {searchProgress.phase !== "inferring_domains" && searchProgress.domainInference.total > 0 && <Check className="w-3 h-3" />}
                                    <span>1. AI Domain Lookup</span>
                                  </div>
                                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold ${
                                    searchProgress.phase === "searching_hunter"
                                      ? "bg-green-100 text-green-700 ring-1 ring-green-300"
                                      : searchProgress.phase === "searching_apollo" || searchProgress.phase === "done"
                                        ? "bg-green-50 text-green-400"
                                        : "bg-slate-50 text-slate-400"
                                  }`}>
                                    {searchProgress.phase === "searching_hunter" && <Loader2 className="w-3 h-3 animate-spin" />}
                                    {(searchProgress.phase === "searching_apollo" || searchProgress.phase === "done") && <Check className="w-3 h-3" />}
                                    <span>2. Hunter.io Search</span>
                                  </div>
                                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold ${
                                    searchProgress.phase === "searching_apollo"
                                      ? "bg-purple-100 text-purple-700 ring-1 ring-purple-300"
                                      : searchProgress.phase === "done"
                                        ? "bg-purple-50 text-purple-400"
                                        : "bg-slate-50 text-slate-400"
                                  }`}>
                                    {searchProgress.phase === "searching_apollo" && <Loader2 className="w-3 h-3 animate-spin" />}
                                    {searchProgress.phase === "done" && <Check className="w-3 h-3" />}
                                    <span>3. Apollo Fallback</span>
                                  </div>
                                </div>

                                {/* Domain Inference Phase */}
                                {searchProgress.phase === "inferring_domains" && searchProgress.domainInference.total > 0 && (
                                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                                    <div className="flex items-center gap-2">
                                      <Sparkles className="w-4 h-4 text-blue-600" />
                                      <span className="text-sm font-semibold text-blue-800">AI is inferring company domains...</span>
                                    </div>
                                    <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
                                      <div
                                        className="bg-blue-500 h-2 rounded-full transition-all duration-500 ease-out"
                                        style={{ width: `${searchProgress.domainInference.total > 0 ? Math.round((searchProgress.domainInference.completed / searchProgress.domainInference.total) * 100) : 0}%` }}
                                      />
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-blue-700">
                                      <span>{searchProgress.domainInference.completed}/{searchProgress.domainInference.total} companies processed</span>
                                      <span>{searchProgress.domainInference.resolved} domains resolved</span>
                                    </div>
                                  </div>
                                )}

                                {/* Domain Inference Summary (after completion) */}
                                {searchProgress.phase !== "inferring_domains" && searchProgress.domainInference.total > 0 && searchProgress.domainInference.resolved > 0 && (
                                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                                      <span className="text-xs text-blue-700">
                                        AI resolved <strong>{searchProgress.domainInference.resolved}</strong> of {searchProgress.domainInference.total} company domains
                                        ({searchProgress.domainInference.highConfidence} high, {searchProgress.domainInference.mediumConfidence} medium confidence)
                                      </span>
                                    </div>
                                    <Check className="w-3.5 h-3.5 text-blue-500" />
                                  </div>
                                )}

                                {/* Contact Search Progress (Hunter + Apollo phases) */}
                                {(searchProgress.phase === "searching_hunter" || searchProgress.phase === "searching_apollo") && (
                                  <>
                                    {/* Progress bar */}
                                    <div className="w-full bg-amber-100 rounded-full h-3 overflow-hidden">
                                      <div
                                        className="bg-gold h-3 rounded-full transition-all duration-500 ease-out"
                                        style={{ width: `${searchProgress.totalCompanies > 0 ? Math.round((searchProgress.companiesSearched / searchProgress.totalCompanies) * 100) : 0}%` }}
                                      />
                                    </div>

                                    {/* Stats row */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                      <div className="bg-white rounded-lg px-3 py-2 border border-amber-100">
                                        <div className="text-lg font-bold text-navy">{searchProgress.companiesSearched}/{searchProgress.totalCompanies}</div>
                                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Companies Searched</div>
                                      </div>
                                      <div className="bg-white rounded-lg px-3 py-2 border border-amber-100">
                                        <div className="text-lg font-bold text-teal">{searchProgress.totalFiltered}</div>
                                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Contacts Found</div>
                                      </div>
                                      <div className="bg-white rounded-lg px-3 py-2 border border-amber-100">
                                        <div className="text-lg font-bold text-gold-dark">{searchProgress.companiesWithResults}</div>
                                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Companies with Hits</div>
                                      </div>
                                      <div className="bg-white rounded-lg px-3 py-2 border border-amber-100">
                                        <div className="text-lg font-bold text-muted-foreground">{searchProgress.elapsedSeconds}s</div>
                                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Elapsed</div>
                                      </div>
                                    </div>

                                    {/* Current company */}
                                    {searchProgress.currentCompany && (
                                      <div className="flex items-center gap-2">
                                        <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
                                        <span className="text-xs text-amber-700 truncate">
                                          {searchProgress.phase === "searching_hunter" ? "Hunter.io" : "Apollo"}: <strong>{searchProgress.currentCompany}</strong>
                                        </span>
                                      </div>
                                    )}

                                    {/* Estimated time remaining */}
                                    {searchProgress.companiesSearched > 5 && (
                                      <p className="text-[10px] text-amber-600">
                                        Est. {Math.ceil(((searchProgress.elapsedSeconds / searchProgress.companiesSearched) * (searchProgress.totalCompanies - searchProgress.companiesSearched)) / 60)} min remaining
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            )}

                            {/* Search button */}
                            <div className="flex items-center justify-between mt-4">
                              {!isSearching && filePreview && filePreview.totalRows > 50 && (
                                <p className="text-xs text-amber-600">
                                  {filePreview.totalRows} companies — est. {Math.ceil(filePreview.totalRows * 0.5 / 60)} min
                                </p>
                              )}
                              <div className="ml-auto">
                                <Button
                                  onClick={handleSearchCompanyContacts}
                                  disabled={isSearching || (selectedRoles.length === 0 && !customRolePattern)}
                                  className="bg-gold hover:bg-gold/90 text-navy font-semibold"
                                >
                                  {isSearching ? (
                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Searching {searchProgress?.companiesSearched ?? 0}/{searchProgress?.totalCompanies ?? filePreview?.totalRows ?? '...'} companies...</>
                                  ) : (
                                    <><Search className="w-4 h-4 mr-2" /> Find Contacts at These Companies</>
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Company Search Results */}
                    {companySearchResult && (
                      <div className="space-y-4">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                            <h4 className="text-sm font-bold text-green-800">
                              Found {companySearchResult.totalFiltered} contacts at {companySearchResult.domainsWithResults} companies
                            </h4>
                          </div>

                          {/* Company/Domain Breakdown */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                            {companySearchResult.domainBreakdown.filter((d: any) => d.filtered > 0).map((d: any) => (
                              <div key={d.domain || d.organization} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-green-100">
                                <div>
                                  <p className="text-xs font-semibold text-navy">{d.organization || d.domain}</p>
                                  {d.domain && d.domain !== d.organization && (
                                    <p className="text-[10px] text-muted-foreground">{d.domain}</p>
                                  )}
                                </div>
                                <Badge className="bg-teal/15 text-teal text-[10px]">{d.filtered} contacts</Badge>
                              </div>
                            ))}
                          </div>

                          {/* Companies with no results */}
                          {companySearchResult.domainBreakdown.filter((d: any) => d.filtered === 0).length > 0 && (
                            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-3">
                              <p className="text-xs text-amber-700 font-medium mb-1">
                                <AlertCircle className="w-3 h-3 inline mr-1" />
                                {companySearchResult.domainBreakdown.filter((d: any) => d.filtered === 0).length} companies had no matching contacts:
                              </p>
                              <p className="text-xs text-amber-600">
                                {companySearchResult.domainBreakdown.filter((d: any) => d.filtered === 0).map((d: any) => d.organization || d.domain).join(", ")}
                              </p>
                              <p className="text-[10px] text-amber-500 mt-1">
                                Try broadening the target roles or adding domains to your spreadsheet.
                              </p>
                            </div>
                          )}


                        </div>

                        {/* Sample Contacts Table */}
                        {companySearchResult.contacts.length > 0 && (
                          <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-navy text-white">
                                  <th className="px-3 py-2 text-left font-semibold">Name</th>
                                  <th className="px-3 py-2 text-left font-semibold">Title</th>
                                  <th className="px-3 py-2 text-left font-semibold">Company</th>
                                  <th className="px-3 py-2 text-left font-semibold">Email</th>
                                </tr>
                              </thead>
                              <tbody>
                                {companySearchResult.contacts.slice(0, 15).map((c: any, i: number) => (
                                  <tr key={i} className={i % 2 === 0 ? "bg-card" : "bg-slate-50"}>
                                    <td className="px-3 py-2 font-medium text-navy">
                                      {c.firstName} {c.lastName}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">{c.title || "—"}</td>
                                    <td className="px-3 py-2">{c.company}</td>
                                    <td className="px-3 py-2">
                                      {c.email ? (
                                        <span className="text-teal">{c.email}</span>
                                      ) : (
                                        <span className="text-amber-500 text-[10px]">Needs enrichment</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {companySearchResult.contacts.length > 15 && (
                              <div className="px-3 py-2 text-xs text-muted-foreground bg-slate-50 border-t border-border">
                                Showing 15 of {companySearchResult.contacts.length} contacts
                              </div>
                            )}
                          </div>
                        )}

                        {/* Import / Retry */}
                        <div className="flex justify-between pt-2">
                          <Button variant="ghost" onClick={() => {
                            setCompanySearchResult(null);
                            setSelectedRoles([]);
                            setCustomRolePattern("");
                          }}>
                            <ChevronLeft className="w-4 h-4 mr-1" /> Modify Search
                          </Button>
                          <Button
                            onClick={handleImportCompanySearchResults}
                            disabled={isImporting || companySearchResult.contacts.length === 0}
                            className="bg-gold hover:bg-gold/90 text-navy font-semibold"
                          >
                            {isImporting ? (
                              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</>
                            ) : (
                              <>Import {companySearchResult.contacts.length} Contacts <ArrowRight className="w-4 h-4 ml-2" /></>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Standard Contact Import (when file has actual contacts) */}
                    {fileType === "contacts" && (
                      <>
                        {/* Hint: Switch to company mode if no columns mapped */}
                        {!columnMapping.company && !columnMapping.firstName && !columnMapping.lastName && !columnMapping.fullName && !columnMapping.email && (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                              <div>
                                <h4 className="text-sm font-bold text-amber-800 mb-1">No columns auto-detected</h4>
                                <p className="text-xs text-amber-700 mb-3">
                                  We couldn't automatically match the columns in your file. You can either map them manually below,
                                  or if this is a list of companies (not individual contacts), switch to company discovery mode.
                                </p>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-400 text-amber-800 hover:bg-amber-100"
                                  onClick={() => setFileType("companies")}
                                >
                                  <Building2 className="w-4 h-4 mr-1.5" /> Switch to Company Discovery
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Column Mapping */}
                        <div className="bg-slate-50 rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-navy mb-3">Column Mapping</h4>
                          <p className="text-xs text-muted-foreground mb-3">
                            We auto-detected the columns below. Adjust if needed.
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {MAPPING_FIELDS.map(field => (
                              <div key={field.key} className="space-y-1">
                                <Label className="text-xs">
                                  {field.label} {field.required && <span className="text-red-500">*</span>}
                                </Label>
                                <Select
                                  value={columnMapping[field.key]?.toString() ?? "unmapped"}
                                  onValueChange={val => {
                                    setColumnMapping(prev => ({
                                      ...prev,
                                      [field.key]: val === "unmapped" ? undefined : Number(val),
                                    }));
                                  }}
                                >
                                  <SelectTrigger className="h-8 text-xs border-border">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unmapped">— Not mapped —</SelectItem>
                                    {filePreview.headers.map((h, i) => (
                                      <SelectItem key={i} value={i.toString()}>{h}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Import Button */}
                        <div className="flex justify-between pt-2">
                          <Button variant="ghost" onClick={() => { setContactMethod(null); setFilePreview(null); setFileType(null); }}>
                            <ChevronLeft className="w-4 h-4 mr-1" /> Back
                          </Button>
                          <Button
                            onClick={handleImportFromFile}
                            disabled={isImporting || !columnMapping.company}
                            className="bg-gold hover:bg-gold/90 text-navy font-semibold"
                          >
                            {isImporting ? (
                              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</>
                            ) : (
                              <>Import {filePreview.totalRows} Contacts <ArrowRight className="w-4 h-4 ml-2" /></>
                            )}
                          </Button>
                        </div>
                      </>
                    )}

                    {/* Sample Data Preview (always shown) */}
                    {!companySearchResult && (
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-navy text-white">
                              {filePreview.headers.map((h, i) => (
                                <th key={i} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filePreview.sampleRows.map((row, ri) => (
                              <tr key={ri} className={ri % 2 === 0 ? "bg-card" : "bg-slate-50"}>
                                {row.map((cell, ci) => (
                                  <td key={ci} className="px-3 py-2 whitespace-nowrap max-w-[200px] truncate">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Search Flow */}
          {contactMethod === "search" && (
            <Card className="border-border">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-navy flex items-center gap-2">
                      <Globe className="w-5 h-5 text-teal" />
                      Search for Contacts
                    </CardTitle>
                    <CardDescription>Enter company domains and select target roles. Uses Hunter.io Domain Search.</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setContactMethod(null); setSearchResult(null); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Company Domains */}
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Company Domains</Label>
                  <p className="text-xs text-muted-foreground">
                    Enter the website domains of companies you want to find contacts at. One domain per line.
                  </p>
                  {searchDomains.map((domain, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        placeholder="e.g., monadelphous.com.au"
                        value={domain}
                        onChange={e => updateDomain(idx, e.target.value)}
                        className="border-border"
                      />
                      {searchDomains.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => removeDomain(idx)} className="shrink-0">
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addDomain} className="text-xs">
                    <Plus className="w-3 h-3 mr-1" /> Add Domain
                  </Button>
                </div>

                {/* Target Roles */}
                {roleSelectorJsx}

                {/* Search Button */}
                {!searchResult && (
                  <div className="flex justify-between pt-2">
                    <Button variant="ghost" onClick={() => setContactMethod(null)}>
                      <ChevronLeft className="w-4 h-4 mr-1" /> Back
                    </Button>
                    <Button
                      onClick={handleSearch}
                      disabled={isSearching || searchDomains.every(d => !d.trim()) || (selectedRoles.length === 0 && !customRolePattern)}
                      className="bg-teal hover:bg-teal/90 text-white font-semibold"
                    >
                      {isSearching ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Searching...</>
                      ) : (
                        <><Search className="w-4 h-4 mr-2" /> Search Contacts</>
                      )}
                    </Button>
                  </div>
                )}

                {/* Search Results */}
                {searchResult && (
                  <div className="space-y-4 border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-navy">
                        Search Results: {searchResult.totalFiltered} contacts found
                      </h4>
                      <Badge variant="outline" className="text-xs">
                        {searchResult.domainsSearched} domains searched
                      </Badge>
                    </div>

                    {/* Domain Breakdown */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {searchResult.domainBreakdown.filter(d => d.filtered > 0).map(d => (
                        <div key={d.domain} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                          <div>
                            <p className="text-xs font-semibold text-navy">{d.organization}</p>
                            <p className="text-[10px] text-muted-foreground">{d.domain}</p>
                          </div>
                          <Badge className="bg-teal/15 text-teal text-[10px]">{d.filtered} contacts</Badge>
                        </div>
                      ))}
                    </div>

                    {/* Sample Contacts */}
                    {searchResult.contacts.length > 0 && (
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-navy text-white">
                              <th className="px-3 py-2 text-left font-semibold">Name</th>
                              <th className="px-3 py-2 text-left font-semibold">Title</th>
                              <th className="px-3 py-2 text-left font-semibold">Company</th>
                              <th className="px-3 py-2 text-left font-semibold">Email</th>
                            </tr>
                          </thead>
                          <tbody>
                            {searchResult.contacts.slice(0, 10).map((c: any, i: number) => (
                              <tr key={i} className={i % 2 === 0 ? "bg-card" : "bg-slate-50"}>
                                <td className="px-3 py-2 font-medium text-navy">
                                  {c.firstName} {c.lastName}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">{c.title || "—"}</td>
                                <td className="px-3 py-2">{c.company}</td>
                                <td className="px-3 py-2 text-teal">{c.email || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {searchResult.contacts.length > 10 && (
                          <div className="px-3 py-2 text-xs text-muted-foreground bg-slate-50 border-t border-border">
                            Showing 10 of {searchResult.contacts.length} contacts
                          </div>
                        )}
                      </div>
                    )}

                    {/* Import Button */}
                    <div className="flex justify-between pt-2">
                      <Button variant="ghost" onClick={() => setSearchResult(null)}>
                        <ChevronLeft className="w-4 h-4 mr-1" /> Modify Search
                      </Button>
                      <Button
                        onClick={handleImportSearchResults}
                        disabled={isImporting || searchResult.contacts.length === 0}
                        className="bg-gold hover:bg-gold/90 text-navy font-semibold"
                      >
                        {isImporting ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</>
                        ) : (
                          <>Import {searchResult.contacts.length} Contacts <ArrowRight className="w-4 h-4 ml-2" /></>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Step 3: Review & Launch */}
      {step === 3 && (
        <div className="space-y-6">
          {/* Import Summary */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-navy flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Contacts Imported Successfully
              </CardTitle>
            </CardHeader>
            <CardContent>
              {importResult && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-card rounded-lg border border-border p-3">
                      <div className="text-2xl font-bold text-navy">{importResult.imported}</div>
                      <div className="text-xs text-muted-foreground">Contacts Imported</div>
                    </div>
                    <div className="bg-card rounded-lg border border-border p-3">
                      <div className="text-2xl font-bold text-muted-foreground">{importResult.excluded || 0}</div>
                      <div className="text-xs text-muted-foreground">Excluded / Skipped</div>
                    </div>
                    {importResult.tierBreakdown && Object.entries(importResult.tierBreakdown).map(([tier, count]) => {
                      const config: Record<string, { label: string; color: string; Icon: any }> = {
                        tier1_hot: { label: "Hot", color: "text-red-500", Icon: Flame },
                        tier2_warm: { label: "Warm", color: "text-amber-500", Icon: TrendingUp },
                        tier3_enrich: { label: "Enrich", color: "text-blue-500", Icon: Database },
                        tier4_low: { label: "Low", color: "text-slate-400", Icon: Clock },
                      };
                      const c = config[tier] || { label: tier, color: "text-slate-500", Icon: Users };
                      return (
                        <div key={tier} className="bg-card rounded-lg border border-border p-3">
                          <div className={`text-2xl font-bold ${c.color}`}>{count as number}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <c.Icon className="w-3 h-3" /> {c.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pipeline Progress Indicator (for company discovery flow) */}
          {(fileType === "companies" || contactMethod === "search") && (
            <div className="flex items-center gap-0 mb-2">
              {[
                { label: "Discovered", icon: Search, done: true, count: companySearchResult?.totalFiltered || searchResult?.totalFiltered || 0 },
                { label: "Imported", icon: Users, done: !!importResult, count: importResult?.imported || 0 },
                { label: "Enriched", icon: Zap, done: !!enrichmentResult, count: enrichmentResult?.enriched || 0 },
              ].map((phase, idx) => (
                <div key={phase.label} className="flex items-center">
                  {idx > 0 && (
                    <div className={`h-px w-6 sm:w-10 ${phase.done ? "bg-gold" : "bg-border"}`} />
                  )}
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    phase.done
                      ? "bg-gold/15 text-gold-dark"
                      : isEnriching && phase.label === "Enriched"
                        ? "bg-navy text-white animate-pulse"
                        : "bg-card text-muted-foreground border border-border"
                  }`}>
                    {phase.done ? <Check className="w-3 h-3" /> : <phase.icon className="w-3 h-3" />}
                    {phase.label}
                    {phase.count > 0 && <span className="text-[10px] opacity-70">({phase.count})</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Enrichment */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-navy flex items-center gap-2">
                <Zap className="w-5 h-5 text-gold" />
                Waterfall Enrichment
              </CardTitle>
              <CardDescription>
                {enrichmentResult
                  ? "Enrichment complete. You can run again to process remaining contacts."
                  : isEnriching
                    ? "Running Apollo → Hunter.io waterfall to verify emails, find LinkedIn URLs, and update titles..."
                    : "Run Apollo → Hunter.io waterfall to find verified email addresses, LinkedIn URLs, and updated titles."
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Enrichment in progress */}
              {isEnriching && (
                <div className="bg-gold/5 border border-gold/20 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-gold animate-spin" />
                    <div>
                      <p className="text-sm font-semibold text-navy">Enriching contacts in the background...</p>
                      <p className="text-xs text-muted-foreground">Processing via Apollo → Hunter.io waterfall. This typically takes 1-3 minutes. You can stay on this page or navigate away — the job will continue running.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Enrichment results */}
              {enrichmentResult && !isEnriching && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <p className="text-sm font-semibold text-green-800">Enrichment Complete</p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-white rounded-lg border border-green-100 p-2.5">
                      <div className="text-lg font-bold text-navy">{enrichmentResult.enriched}</div>
                      <div className="text-[10px] text-muted-foreground">Contacts Enriched</div>
                    </div>
                    {enrichmentResult.apolloFound > 0 && (
                      <div className="bg-white rounded-lg border border-green-100 p-2.5">
                        <div className="text-lg font-bold text-blue-600">{enrichmentResult.apolloFound}</div>
                        <div className="text-[10px] text-muted-foreground">Via Apollo</div>
                      </div>
                    )}
                    {enrichmentResult.hunterFound > 0 && (
                      <div className="bg-white rounded-lg border border-green-100 p-2.5">
                        <div className="text-lg font-bold text-teal">{enrichmentResult.hunterFound}</div>
                        <div className="text-[10px] text-muted-foreground">Via Hunter</div>
                      </div>
                    )}
                    {enrichmentResult.linkedInAdded > 0 && (
                      <div className="bg-white rounded-lg border border-green-100 p-2.5">
                        <div className="text-lg font-bold text-indigo-600">{enrichmentResult.linkedInAdded}</div>
                        <div className="text-[10px] text-muted-foreground">LinkedIn Added</div>
                      </div>
                    )}
                    {enrichmentResult.emailsVerified > 0 && (
                      <div className="bg-white rounded-lg border border-green-100 p-2.5">
                        <div className="text-lg font-bold text-green-600">{enrichmentResult.emailsVerified}</div>
                        <div className="text-[10px] text-muted-foreground">Emails Verified</div>
                      </div>
                    )}
                    {enrichmentResult.emailsCorrected > 0 && (
                      <div className="bg-white rounded-lg border border-green-100 p-2.5">
                        <div className="text-lg font-bold text-amber-600">{enrichmentResult.emailsCorrected}</div>
                        <div className="text-[10px] text-muted-foreground">Emails Corrected</div>
                      </div>
                    )}
                    {enrichmentResult.titlesUpdated > 0 && (
                      <div className="bg-white rounded-lg border border-green-100 p-2.5">
                        <div className="text-lg font-bold text-purple-600">{enrichmentResult.titlesUpdated}</div>
                        <div className="text-[10px] text-muted-foreground">Titles Updated</div>
                      </div>
                    )}
                    {enrichmentResult.notFound > 0 && (
                      <div className="bg-white rounded-lg border border-amber-100 p-2.5">
                        <div className="text-lg font-bold text-amber-500">{enrichmentResult.notFound}</div>
                        <div className="text-[10px] text-muted-foreground">Not Found</div>
                      </div>
                    )}
                  </div>
                  {enrichmentResult.creditsUsed > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Credits used: ~{enrichmentResult.creditsUsed} Apollo credits
                    </p>
                  )}
                </div>
              )}

              {/* Run / Re-run button */}
              {!isEnriching && (
                <div className="flex items-center gap-4">
                  <Button
                    onClick={() => setShowEnrichConfirm(true)}
                    className="bg-gold hover:bg-gold/90 text-navy font-semibold"
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    {enrichmentResult
                      ? `Run Again${remainingPending ? ` (${remainingPending} Remaining)` : " (More Contacts)"}`
                      : "Run Enrichment (Apollo → Hunter)"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {enrichmentResult
                      ? remainingPending && remainingPending > 0
                        ? `${remainingPending} contacts still pending enrichment. Click to process them.`
                        : "All contacts have been processed."
                      : "You can run enrichment multiple times to process more contacts."
                    }
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Launch */}
          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Add More Contacts
            </Button>
            <Button
              onClick={() => createdCampaignId && onComplete(createdCampaignId)}
              className="bg-navy hover:bg-navy/90 text-white font-semibold"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" /> Go to Campaign Dashboard
            </Button>
          </div>

          {/* Enrichment Confirmation Dialog */}
          {showEnrichConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-gold/15 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-gold" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-navy">
                      {autoEnrichTriggered && !enrichmentResult ? "Enrich Contacts Now?" : "Run Enrichment"}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Apollo → Hunter.io waterfall
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-lg p-4 mb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Contacts to enrich</span>
                    <span className="text-sm font-semibold text-navy">{remainingPending ?? (importResult?.imported || 0)} pending</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Estimated Apollo credits</span>
                    <span className="text-sm font-semibold text-navy">~{Math.min(enrichBatchSize, remainingPending ?? (importResult?.imported || 0))} credits</span>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Batch size</label>
                    <div className="flex gap-2">
                      {[50, 100, 200, 500].map(size => (
                        <button
                          key={size}
                          onClick={() => setEnrichBatchSize(size)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                            enrichBatchSize === size
                              ? "bg-navy text-white"
                              : "bg-white border border-border text-muted-foreground hover:border-navy/30"
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {autoEnrichTriggered && !enrichmentResult && (
                  <p className="text-xs text-muted-foreground mb-4">
                    Your contacts have been imported and are ready for enrichment. This will verify emails, add LinkedIn URLs, and update job titles.
                  </p>
                )}

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setShowEnrichConfirm(false); setAutoEnrichTriggered(false); }}
                  >
                    {autoEnrichTriggered && !enrichmentResult ? "Skip for Now" : "Cancel"}
                  </Button>
                  <Button
                    className="flex-1 bg-gold hover:bg-gold/90 text-navy font-semibold"
                    onClick={() => handleEnrich(enrichBatchSize)}
                  >
                    <Zap className="w-4 h-4 mr-2" /> Enrich {Math.min(enrichBatchSize, remainingPending ?? (importResult?.imported || 0))} Contacts
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
