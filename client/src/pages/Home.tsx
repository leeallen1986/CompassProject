/*
 * Home — Atlas Copco Power Technique Market Intelligence Dashboard
 * Design: Nordic Industrial Precision
 * Deep navy header, gold accents, tabbed layout, priority-coded cards
 * Now fetches data from the database via tRPC API
 */
import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import {
  Flame, TrendingUp, Users, Search, Download, ExternalLink,
  BarChart3, Pickaxe, Fuel, Building, Building2, Shield,
  ArrowUpRight, Database, FileText, Loader2, LogIn, LogOut, ChevronDown, Settings, Target, Sparkles, Globe, Filter,
  ShieldCheck, AlertTriangle, CheckCircle2, Linkedin, Bot, CircleHelp, ThumbsUp,
  Archive, Clock, Award, Check, Eye
} from "lucide-react";
import { Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProjectCard, { type ProjectData, type ContactData } from "@/components/ProjectCard";
import { IMAGES } from "@/lib/images";
import { scoreAndRankProjects, locationMatchesTerritory, type UserProfileData, type FeedbackData } from "@/lib/personalization";
import OutreachEmailModal from "@/components/OutreachEmailModal";
import AIProjectSearch from "@/components/AIProjectSearch";
import ApolloContactSearch from "@/components/ApolloContactSearch";
import ContractorPatterns from "@/components/ContractorPatterns";

// ── Sector helpers ──
const sectorIcons: Record<string, React.ReactNode> = {
  mining: <Pickaxe className="w-3.5 h-3.5" />,
  oil_gas: <Fuel className="w-3.5 h-3.5" />,
  infrastructure: <Building className="w-3.5 h-3.5" />,
  energy: <TrendingUp className="w-3.5 h-3.5" />,
  defence: <Shield className="w-3.5 h-3.5" />,
};
const sectorLabels: Record<string, string> = {
  mining: "Mining", oil_gas: "Oil & Gas", infrastructure: "Infrastructure", energy: "Energy", defence: "Defence",
};

// ── KPI Card ──
function KPICard({ value, label, accent }: { value: string | number; label: string; accent?: "hot" | "warm" | "gold" | "teal" }) {
  const accentClass = accent === "hot" ? "text-hot" : accent === "warm" ? "text-warm" : accent === "gold" ? "text-gold" : accent === "teal" ? "text-teal" : "text-navy";
  return (
    <div className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-shadow">
      <div className={`text-3xl font-bold ${accentClass} tracking-tight`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wider">{label}</div>
    </div>
  );
}

// ── Priority Filter ──
function PriorityFilter({ active, onChange, stats }: { active: string; onChange: (v: string) => void; stats: { total: number; hot: number; warm: number; cold: number } }) {
  const filters = [
    { key: "all", label: "All", count: stats.total },
    { key: "hot", label: "Hot", count: stats.hot, color: "bg-hot" },
    { key: "warm", label: "Warm", count: stats.warm, color: "bg-warm" },
    { key: "cold", label: "Cold", count: stats.cold, color: "bg-cold" },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {filters.map(f => (
        <button key={f.key} onClick={() => onChange(f.key)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${active === f.key ? "bg-navy text-white shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-navy/30"}`}>
          {f.color && <span className={`inline-block w-2 h-2 rounded-full ${f.color} mr-1.5`} />}
          {f.label} ({f.count})
        </button>
      ))}
    </div>
  );
}

// ── Sector Filter ──
function SectorFilter({ active, onChange }: { active: string; onChange: (v: string) => void }) {
  const sectors = ["all", "mining", "oil_gas", "infrastructure", "energy", "defence"];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {sectors.map(s => (
        <button key={s} onClick={() => onChange(s)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${active === s ? "bg-navy text-white shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-navy/30"}`}>
          {s !== "all" && sectorIcons[s]}
          {s === "all" ? "All Sectors" : sectorLabels[s]}
        </button>
      ))}
    </div>
  );
}

// ── Contacts Table ──
interface ContactRow {
  id: number;
  name: string;
  title: string;
  company: string;
  project: string;
  priority: "hot" | "warm" | "cold";
  roleBucket: string;
  email: string | null;
  linkedin: string | null;
  enrichmentSource: string | null;
  verificationStatus: string | null;
  confidenceScore: string | null;
  linkedinSearchUrl: string | null;
  emailVerified: boolean | null;
  linkedinProfilePic: string | null;
  verificationScore: number | null;
  linkedinProfileUrl: string | null;
  sourceUrl: string | null;
}

/** Deduplicated contact — one row per unique person, with all their projects */
interface DeduplicatedContact extends ContactRow {
  allProjects: string[];
  projectCount: number;
  /** Keep the "best" row's data (prefer verified > ai_suggested, linkedin > llm) */
  originalIds: number[];
}

// Map onboarding buyer role IDs to contact roleBucket values
const buyerRoleToRoleBucket: Record<string, string[]> = {
  procurement: ["procurement"],
  project_manager: ["project_manager", "project_management"],
  engineering: ["engineering"],
  maintenance_shutdown: ["maintenance"],
  operations_site: ["operations", "site_manager"],
  hse_esg: ["hse", "esg"],
  fleet_manager: ["fleet_manager"],
  commercial: ["commercial"],
};

const roleBucketLabels: Record<string, string> = {
  procurement: "Procurement",
  project_manager: "Project Manager",
  project_management: "Project Manager",
  engineering: "Engineering",
  maintenance: "Maintenance",
  operations: "Operations",
  site_manager: "Site Manager",
  fleet_manager: "Fleet Manager",
  general_manager: "Executive",
  commercial: "Commercial",
  executive: "Executive",
  hse: "HSE",
  esg: "ESG",
  other: "Other",
};

function ContactsTable({ data, weekEnding, projects: allProjects, businessLineNames, preferredBuyerRoles }: { data: ContactRow[]; weekEnding: string; projects: ProjectData[]; businessLineNames: Record<number, string>; preferredBuyerRoles: string[] }) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "verified" | "ai_suggested" | "web_search">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "preferred" | string>("preferred");

  // Build the set of preferred role buckets from onboarding buyer roles
  const preferredRoleBuckets = useMemo(() => {
    const buckets = new Set<string>();
    preferredBuyerRoles.forEach(role => {
      const mapped = buyerRoleToRoleBucket[role];
      if (mapped) mapped.forEach(b => buckets.add(b));
    });
    return buckets;
  }, [preferredBuyerRoles]);
  const [outreachContact, setOutreachContact] = useState<ContactRow | null>(null);
  const [outreachProject, setOutreachProject] = useState<ProjectData | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  // Fetch contacted contacts list for badges
  const { data: contactedList } = trpc.outreach.contactedList.useQuery();
  const utils = trpc.useUtils();

  // Verify contact mutation
  const verifyMutation = trpc.dataPipeline.verifyContact.useMutation({
    onSuccess: (result: { verified?: boolean; quotaExhausted?: boolean; message?: string }) => {
      setVerifyingId(null);
      if (result.verified) {
        alert(`Contact verified! ${result.message}`);
      } else if (result.quotaExhausted) {
        alert("LinkedIn API quota exhausted. Try again later or use the LinkedIn search link to verify manually.");
      } else {
        alert(result.message || "Contact could not be verified via LinkedIn.");
      }
      // Refresh the data
      utils.report.full.invalidate();
    },
    onError: (err: { message: string }) => {
      setVerifyingId(null);
      alert(`Verification failed: ${err.message}`);
    },
  });

  // Find matching project for a contact
  const findProjectForContact = (contact: ContactRow): ProjectData | null => {
    const projectName = contact.project.toLowerCase();
    return allProjects.find(p => 
      p.name.toLowerCase().includes(projectName) || 
      projectName.includes(p.name.toLowerCase())
    ) ?? allProjects.find(p => 
      p.owner.toLowerCase() === contact.company.toLowerCase()
    ) ?? null;
  };

  const handleOutreachClick = (contact: ContactRow) => {
    const matchedProject = findProjectForContact(contact);
    if (matchedProject) {
      setOutreachContact(contact);
      setOutreachProject(matchedProject);
    } else {
      setOutreachContact(contact);
      setOutreachProject({
        id: 0, reportId: 0, projectKey: "", name: contact.project, location: "Australia",
        value: "Unknown", owner: contact.company, priority: contact.priority,
        capexGrade: "Unknown" as const, opportunityRoute: "Direct CAPEX" as const,
        sector: "mining" as const, isNew: false, stage: null, overview: null,
        equipmentSignals: null, contractors: null, opportunityNote: null,
        sources: null, timeline: null, completion: null, matchedBusinessLines: null,
        createdAt: new Date(),
      });
    }
  };

  const handleVerifyClick = (contactId: number) => {
    setVerifyingId(contactId);
    verifyMutation.mutate({ contactId });
  };

  // Deduplicate contacts: group by name (case-insensitive) to merge same person across projects
  const deduplicatedData = useMemo(() => {
    const map = new Map<string, DeduplicatedContact>();
    for (const c of data) {
      const key = c.name.toLowerCase().trim();
      const existing = map.get(key);
      if (existing) {
        // Merge: add project, keep best data
        if (c.project && !existing.allProjects.includes(c.project)) {
          existing.allProjects.push(c.project);
        }
        existing.projectCount = existing.allProjects.length;
        existing.originalIds.push(c.id);
        // Upgrade verification status if this row is better
        const verOrder = { verified: 3, ai_suggested: 2, unverified: 1 };
        const existingVer = verOrder[(existing.verificationStatus as keyof typeof verOrder) || "unverified"] || 0;
        const newVer = verOrder[(c.verificationStatus as keyof typeof verOrder) || "unverified"] || 0;
        if (newVer > existingVer) {
          existing.verificationStatus = c.verificationStatus;
          existing.enrichmentSource = c.enrichmentSource;
          existing.confidenceScore = c.confidenceScore;
          existing.linkedin = c.linkedin || existing.linkedin;
          existing.linkedinProfilePic = c.linkedinProfilePic || existing.linkedinProfilePic;
          existing.linkedinSearchUrl = c.linkedinSearchUrl || existing.linkedinSearchUrl;
          existing.email = c.email || existing.email;
          existing.emailVerified = c.emailVerified || existing.emailVerified;
        }
        // Keep higher priority
        const priOrder = { hot: 3, warm: 2, cold: 1 };
        if ((priOrder[c.priority] || 0) > (priOrder[existing.priority] || 0)) {
          existing.priority = c.priority;
        }
      } else {
        map.set(key, {
          ...c,
          allProjects: c.project ? [c.project] : [],
          projectCount: c.project ? 1 : 0,
          originalIds: [c.id],
        });
      }
    }
    return Array.from(map.values());
  }, [data]);

  const filtered = useMemo(() => {
    let result = deduplicatedData;
    // Source filter
    if (sourceFilter === "verified") {
      result = result.filter(c => c.verificationStatus === "verified");
    } else if (sourceFilter === "ai_suggested") {
      result = result.filter(c => c.verificationStatus === "ai_suggested" || c.enrichmentSource === "llm");
    } else if (sourceFilter === "web_search") {
      result = result.filter(c => c.enrichmentSource === "web_search");
    }
    // Role filter
    if (roleFilter === "preferred" && preferredRoleBuckets.size > 0) {
      result = result.filter(c => preferredRoleBuckets.has(c.roleBucket?.toLowerCase() || ""));
    } else if (roleFilter !== "all" && roleFilter !== "preferred") {
      result = result.filter(c => (c.roleBucket?.toLowerCase() || "") === roleFilter);
    }
    // Search filter
    if (!search) return result;
    const q = search.toLowerCase();
    return result.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.company.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.project.toLowerCase().includes(q) ||
      c.allProjects.some(p => p.toLowerCase().includes(q))
    );
  }, [deduplicatedData, search, sourceFilter, roleFilter, preferredRoleBuckets]);

  // Count contacts by role for filter badges (use deduplicated data)
  const preferredCount = preferredRoleBuckets.size > 0 ? deduplicatedData.filter(c => preferredRoleBuckets.has(c.roleBucket?.toLowerCase() || "")).length : 0;

  const verifiedCount = deduplicatedData.filter(c => c.verificationStatus === "verified").length;
  const aiSuggestedCount = deduplicatedData.filter(c => c.verificationStatus === "ai_suggested" || c.enrichmentSource === "llm").length;
  const totalUniqueContacts = deduplicatedData.length;

  const exportCSV = () => {
    const headers = ["Name", "Title", "Company", "Projects", "# Projects", "Priority", "Role Bucket", "Email", "Email Verified", "LinkedIn Profile", "LinkedIn Search", "Source", "Verification", "Confidence", "Verification Score"];
    const rows = filtered.map(c => [c.name, c.title, c.company, c.allProjects.join(" | "), String(c.projectCount), c.priority, c.roleBucket, c.email || "", c.emailVerified ? "Yes" : "No", c.linkedin || c.linkedinProfileUrl || "", c.linkedinSearchUrl || "", c.enrichmentSource || "", c.verificationStatus || "", c.confidenceScore || "", String(c.verificationScore ?? 0)]);
    const csv = [headers, ...rows].map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-copco-contacts-${weekEnding.replace(/\s/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const priorityBadge = (p: string) => {
    if (p === "hot") return "bg-hot text-white";
    if (p === "warm") return "bg-warm text-navy";
    return "bg-cold text-white";
  };

  const verificationBadge = (c: ContactRow) => {
    if (c.verificationStatus === "verified") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700" title="Verified via LinkedIn API">
          <ShieldCheck className="w-3 h-3" /> Verified
        </span>
      );
    }
    if (c.enrichmentSource === "web_search") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700" title={`Web-discovered contact${c.sourceUrl ? ` — Source: ${c.sourceUrl}` : ''}`}>
          <Eye className="w-3 h-3" /> Web Found
        </span>
      );
    }
    if (c.verificationStatus === "ai_suggested" || c.enrichmentSource === "llm") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700" title="AI-generated contact — verify before outreach">
          <Bot className="w-3 h-3" /> AI Suggested
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500" title="Unverified contact">
        <CircleHelp className="w-3 h-3" /> Unverified
      </span>
    );
  };

  const confidenceBadge = (c: ContactRow) => {
    const score = c.confidenceScore || "medium";
    if (score === "high") return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-600">HIGH</span>;
    if (score === "medium") return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-600">MED</span>;
    return <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-50 text-red-500">LOW</span>;
  };

  return (
    <div>
      {/* Header with search, source filter, and export */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search by name, company, title, or project..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold" />
        </div>
        <button onClick={exportCSV}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gold text-navy text-sm font-semibold hover:bg-gold-light transition-colors">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Source filter tabs */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={() => setSourceFilter("all")}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
            sourceFilter === "all" ? "bg-navy text-white shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-navy/30"
          }`}>
          All ({totalUniqueContacts})
        </button>
        <button onClick={() => setSourceFilter("verified")}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
            sourceFilter === "verified" ? "bg-emerald-600 text-white shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-emerald-300"
          }`}>
          <ShieldCheck className="w-3 h-3" /> Verified ({verifiedCount})
        </button>
        <button onClick={() => setSourceFilter("ai_suggested")}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
            sourceFilter === "ai_suggested" ? "bg-amber-600 text-white shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-amber-300"
          }`}>
          <Bot className="w-3 h-3" /> AI Suggested ({aiSuggestedCount})
        </button>
        <button onClick={() => setSourceFilter("web_search")}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
            sourceFilter === "web_search" ? "bg-indigo-600 text-white shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-indigo-300"
          }`}>
          <Eye className="w-3 h-3" /> Web Found ({deduplicatedData.filter(c => c.enrichmentSource === "web_search").length})
        </button>
      </div>

      {/* Role filter tabs */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-1">Role:</span>
        {preferredBuyerRoles.length > 0 && (
          <button onClick={() => setRoleFilter("preferred")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
              roleFilter === "preferred" ? "bg-gold text-navy shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-gold/30"
            }`}>
            <Target className="w-3 h-3" /> My Roles ({preferredCount})
          </button>
        )}
        <button onClick={() => setRoleFilter("all")}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
            roleFilter === "all" ? "bg-navy text-white shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-navy/30"
          }`}>
          All Roles ({totalUniqueContacts})
        </button>
        {["procurement", "project_manager", "engineering", "operations", "maintenance", "fleet_manager", "commercial", "general_manager"].map(role => {
          const count = deduplicatedData.filter(c => (c.roleBucket?.toLowerCase() || "") === role).length;
          if (count === 0) return null;
          return (
            <button key={role} onClick={() => setRoleFilter(role)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                roleFilter === role ? "bg-navy text-white shadow-sm" : "bg-card text-muted-foreground border border-border hover:border-navy/30"
              }`}>
              {roleBucketLabels[role] || role} ({count})
            </button>
          );
        })}
      </div>

      {/* Warning banner for AI contacts */}
      {sourceFilter !== "verified" && aiSuggestedCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800">
            <strong>AI-Suggested contacts</strong> are role-based inferences generated by AI. Names, emails, and titles are pattern-guessed and <strong>must be verified before outreach</strong>. Use the LinkedIn search link or "Verify" button to confirm each contact.
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy text-white">
              <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wider">Name</th>
              <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wider">Title</th>
              <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wider">Company</th>
              <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wider">Projects</th>
              <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wider">Priority</th>
              <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wider">Score</th>
              <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wider">LinkedIn</th>
              <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => (
              <tr key={c.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    {c.linkedinProfilePic ? (
                      <img src={c.linkedinProfilePic} alt="" className="w-7 h-7 rounded-full object-cover border border-border" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500">
                        {c.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="font-medium text-navy">{c.name}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        {roleBucketLabels[c.roleBucket?.toLowerCase() || ""] || c.roleBucket}
                        {preferredRoleBuckets.has(c.roleBucket?.toLowerCase() || "") && (
                          <span className="px-1 py-0 rounded bg-gold/20 text-gold-dark text-[8px] font-bold" title="Matches your preferred buyer roles">YOUR ROLE</span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-muted-foreground text-xs">{c.title}</td>
                <td className="px-3 py-3 text-xs">{c.company}</td>
                <td className="px-3 py-3 text-xs max-w-[200px]">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground truncate" title={c.allProjects.join(' | ')}>{c.allProjects[0]}</span>
                    {c.projectCount > 1 && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-navy/10 text-navy text-[9px] font-bold" title={c.allProjects.join('\n')}>+{c.projectCount - 1}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${priorityBadge(c.priority)}`}>{c.priority}</span>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    {/* Numeric verification score with color ring */}
                    {(() => {
                      const score = c.verificationScore ?? 0;
                      const color = score >= 80 ? "text-emerald-600 border-emerald-400 bg-emerald-50" :
                                    score >= 60 ? "text-blue-600 border-blue-400 bg-blue-50" :
                                    score >= 40 ? "text-amber-600 border-amber-400 bg-amber-50" :
                                    "text-red-500 border-red-300 bg-red-50";
                      const label = score >= 80 ? "High Confidence" :
                                    score >= 60 ? "Moderate" :
                                    score >= 40 ? "Low — Verify" :
                                    "Needs Verification";
                      return (
                        <div className="relative group">
                          <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center text-xs font-bold ${color}`}
                            title={`${label} (${score}/100)`}>
                            {score}
                          </div>
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 bg-slate-800 text-white text-[9px] px-2 py-1.5 rounded shadow-lg whitespace-nowrap min-w-[140px]">
                            <div className="font-bold mb-0.5">{label} ({score}/100)</div>
                            <div>Source: {c.verificationStatus === 'verified' ? '30' : c.enrichmentSource === 'web_search' ? '20' : c.enrichmentSource === 'llm' ? '10' : '5'}/30</div>
                            <div>Name: 15/15</div>
                            <div>Email: {c.email ? (c.emailVerified ? '15' : c.verificationStatus === 'verified' ? '12' : '8') : '0'}/15</div>
                            <div>Title: {c.title.split(' ').length >= 3 ? '15' : '12'}/15</div>
                            <div>LinkedIn: {c.linkedin || c.linkedinProfileUrl ? '15' : c.linkedinSearchUrl ? '5' : '0'}/15</div>
                            <div>Company: {score >= 80 ? '10' : '5'}/10</div>
                          </div>
                        </div>
                      );
                    })()}
                    {verificationBadge(c)}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {/* Direct LinkedIn profile link */}
                  <div className="flex flex-col gap-1">
                    {(c.linkedin || c.linkedinProfileUrl) ? (
                      <a href={c.linkedin || c.linkedinProfileUrl || ''} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-[#0077B5]/10 text-[#0077B5] hover:bg-[#0077B5]/20 transition-colors"
                        title="View LinkedIn profile">
                        <Linkedin className="w-3 h-3" /> Profile
                      </a>
                    ) : c.linkedinSearchUrl ? (
                      <a href={c.linkedinSearchUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                        title="Search LinkedIn for this person">
                        <Search className="w-3 h-3" /> Search
                      </a>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Email with warning for unverified */}
                    {c.email && (
                      <div className="relative group">
                        <button onClick={() => handleOutreachClick(c)}
                          className={`px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 transition-colors ${
                            c.emailVerified || c.verificationStatus === "verified"
                              ? "bg-gold/15 text-gold-dark hover:bg-gold/25"
                              : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                          }`}>
                          <Sparkles className="w-3 h-3" />
                          {c.emailVerified || c.verificationStatus === "verified" ? "Outreach" : "Outreach*"}
                        </button>
                        {!c.emailVerified && c.verificationStatus !== "verified" && (
                          <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10 bg-slate-800 text-white text-[9px] px-2 py-1 rounded shadow-lg whitespace-nowrap">
                            Email is pattern-guessed — verify before sending
                          </div>
                        )}
                      </div>
                    )}

                    {/* Source URL for web-discovered contacts */}
                    {c.enrichmentSource === "web_search" && c.sourceUrl && (
                      <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer"
                        className="px-2 py-1 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors flex items-center gap-1"
                        title={`Source: ${c.sourceUrl}`}>
                        <ExternalLink className="w-3 h-3" /> Source
                      </a>
                    )}

                    {/* Verify via LinkedIn button (for AI-suggested and web-discovered contacts) */}
                    {(c.verificationStatus === "ai_suggested" || c.enrichmentSource === "llm" || c.enrichmentSource === "web_search") && c.verificationStatus !== "verified" && (
                      <button
                        onClick={() => handleVerifyClick(c.id)}
                        disabled={verifyingId === c.id}
                        className="px-2 py-1 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors flex items-center gap-1 disabled:opacity-50"
                        title="Use LinkedIn API to verify this contact">
                        {verifyingId === c.id ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> Verifying...</>
                        ) : (
                          <><CheckCircle2 className="w-3 h-3" /> Verify</>
                        )}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{filtered.length} unique contacts shown (from {data.length} total entries across projects)</p>

      {/* Outreach Email Modal */}
      {outreachContact && outreachProject && (
        <OutreachEmailModal
          isOpen={!!outreachContact}
          onClose={() => { setOutreachContact(null); setOutreachProject(null); }}
          contact={{
            name: outreachContact.name,
            title: outreachContact.title,
            company: outreachContact.company,
            email: outreachContact.email || "",
            roleBucket: outreachContact.roleBucket,
          }}
          project={{
            name: outreachProject.name,
            location: outreachProject.location,
            value: outreachProject.value,
            sector: outreachProject.sector,
            stage: outreachProject.stage,
            overview: outreachProject.overview,
            equipmentSignals: outreachProject.equipmentSignals,
            opportunityRoute: outreachProject.opportunityRoute,
            matchedBusinessLines: (outreachProject.matchedBusinessLines || []).map(id => businessLineNames[id] || `BL-${id}`),
          }}
        />
      )}
    </div>
  );
}

// ── Login Page ──
function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-6">
        <div className="mb-8">
          <img src={IMAGES.heroBanner} alt="" className="w-full h-32 object-cover rounded-lg mb-6" />
          <h1 className="text-2xl font-bold text-navy tracking-tight mb-2">Atlas Copco Power Technique</h1>
          <p className="text-sm text-muted-foreground">Market Intelligence Dashboard</p>
        </div>
        <a href="/login"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-navy text-white font-semibold hover:bg-navy-light transition-colors shadow-md">
          <LogIn className="w-5 h-5" /> Sign In to Access Dashboard
        </a>
        <p className="text-xs text-muted-foreground mt-4">Login required to view market intelligence data.</p>
      </div>
    </div>
  );
}

// ── Loading Page ──
function LoadingPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-10 h-10 text-gold animate-spin mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">Loading intelligence data...</p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ── Main Dashboard ──
// ══════════════════════════════════════════════════════════════
export default function Home() {
  const { user, loading: authLoading, isAuthenticated, logout } = useAuth();
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [businessLineFilter, setBusinessLineFilter] = useState("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<"all" | "active" | "stale" | "archived" | "awarded" | "completed">("active");
  const [showAllTerritories, setShowAllTerritories] = useState(false);
  const [showScoringGuide, setShowScoringGuide] = useState(() => {
    return !localStorage.getItem("atlas-scoring-guide-dismissed");
  });
  const [activeTab, setActiveTab] = useState("overview");
  const [highlightedProjectId, setHighlightedProjectId] = useState<number | null>(null);

  const [, navigate] = useLocation();

  // Fetch user profile to check onboarding status
  const { data: profile, isLoading: profileLoading } = trpc.profile.get.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 0, // Always refetch to ensure onboarding status is current
  });

  // Fetch the unified dashboard data (all projects across all sources)
  const { data: fullReport, isLoading: reportLoading } = trpc.report.full.useQuery(
    {},
    { enabled: isAuthenticated }
  );

  // Fetch feedback for personalization
  const reportIdForFeedback = fullReport?.report?.id;
  const { data: feedbackList } = trpc.feedback.byReport.useQuery(
    { reportId: reportIdForFeedback! },
    { enabled: isAuthenticated && !!reportIdForFeedback }
  );

  // Fetch pipeline claims for the current user
  const { data: myClaims } = trpc.pipeline.mine.useQuery(undefined, { enabled: isAuthenticated });

  // Fetch active business lines for the filter
  const { data: activeBusinessLines } = trpc.businessLines.active.useQuery(undefined, { enabled: isAuthenticated });

  // Build business line ID → name lookup for badges
  const businessLineNamesMap: Record<number, string> = useMemo(() => {
    if (!activeBusinessLines) return {};
    const map: Record<number, string> = {};
    activeBusinessLines.forEach((bl: any) => { map[bl.id] = bl.name; });
    return map;
  }, [activeBusinessLines]);

  // ── Auth gates ──
  if (authLoading) return <LoadingPage />;
  if (!isAuthenticated) return <LoginPage />;

  // Wait for profile to load before deciding
  if (profileLoading) return <LoadingPage />;

  // Redirect to onboarding if profile not completed
  if (profile === null || (profile && !profile.onboardingCompleted)) {
    navigate("/onboarding");
    return <LoadingPage />;
  }

  if (reportLoading || !fullReport) return <LoadingPage />;

  const { report, projects, contacts, drillingCampaigns, awardedProjects, lifecycleCounts } = fullReport;

  const actionItems: string[] = (report.actionItems as string[]) ?? [];

  // ── Personalization: score and rank projects ──
  const profileData: UserProfileData | null = profile ? {
    territories: profile.territories as string[] | null,
    industries: profile.industries as string[] | null,
    offerCategories: profile.offerCategories as string[] | null,
    customerTypes: profile.customerTypes as string[] | null,
    keyAccounts: profile.keyAccounts as string[] | null,
    excludeAccounts: profile.excludeAccounts as string[] | null,
    dealSizeMin: profile.dealSizeMin,
    dealSizeMax: profile.dealSizeMax,
    stageTiming: profile.stageTiming as string[] | null,
    buyerRoles: profile.buyerRoles as string[] | null,
  } : null;

  const feedbackData: FeedbackData[] = (feedbackList ?? []).map((f: any) => ({
    projectId: f.projectId,
    vote: f.vote as "up" | "down",
    reason: f.reason,
  }));

  const feedbackMap = new Map(feedbackData.map(f => [f.projectId, f]));

  // Build pipeline claims lookup by projectId
  const claimsMap = new Map(
    (myClaims ?? []).map((c: any) => [c.projectId, { id: c.id, status: c.status }])
  );

  const personalizedProjects = scoreAndRankProjects(
    projects as ProjectData[],
    profileData,
    feedbackData
  );

  // ── Lifecycle filter: filter by project lifecycle status ──
  const lifecycleFiltered = lifecycleFilter === "all"
    ? personalizedProjects
    : personalizedProjects.filter((p: ProjectData) => {
        const status = (p as any).lifecycleStatus ?? "active";
        return status === lifecycleFilter;
      });

  // ── Territory hard-filter: hide projects outside user's preferred territories ──
  const userTerritories = profileData?.territories ?? [];
  const territoryFiltered = (showAllTerritories || userTerritories.length === 0)
    ? lifecycleFiltered
    : lifecycleFiltered.filter((p: ProjectData) =>
        locationMatchesTerritory(p.location, userTerritories)
      );

  // Also filter contacts, awarded projects, and drilling campaigns by territory
  const territoryFilteredContacts = (showAllTerritories || userTerritories.length === 0)
    ? contacts
    : (contacts as any[]).filter((c: any) => {
        // Match contact's project name to a territory-filtered project
        const matchedProject = territoryFiltered.find((p: ProjectData) =>
          p.name.toLowerCase().includes(c.project?.toLowerCase?.() || "") ||
          (c.project?.toLowerCase?.() || "").includes(p.name.toLowerCase())
        );
        return !!matchedProject;
      });

  const territoryFilteredAwarded = (showAllTerritories || userTerritories.length === 0)
    ? awardedProjects
    : (awardedProjects as any[]).filter((ap: any) =>
        locationMatchesTerritory(ap.location || "", userTerritories)
      );

  const territoryFilteredDrilling = (showAllTerritories || userTerritories.length === 0)
    ? drillingCampaigns
    : (drillingCampaigns as any[]).filter((dc: any) =>
        locationMatchesTerritory(dc.location || "", userTerritories)
      );

  // Apply business line filter, then priority/sector
  const businessLineFiltered = businessLineFilter === "all"
    ? territoryFiltered
    : territoryFiltered.filter((p: ProjectData) => {
        const blIds = p.matchedBusinessLines;
        if (!blIds || blIds.length === 0) return false;
        return blIds.includes(Number(businessLineFilter));
      });

  const filteredProjects = businessLineFiltered.filter((p: ProjectData) => {
    if (priorityFilter !== "all" && p.priority !== priorityFilter) return false;
    if (sectorFilter !== "all" && p.sector !== sectorFilter) return false;
    return true;
  });

  const hotProjects = businessLineFiltered.filter((p: ProjectData) => p.priority === "hot");
  const warmProjects = businessLineFiltered.filter((p: ProjectData) => p.priority === "warm");
  const coldProjects = businessLineFiltered.filter((p: ProjectData) => p.priority === "cold");

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Header */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={IMAGES.heroBanner} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-navy/95 via-navy/85 to-navy/70" />
        </div>
        <div className="relative container py-8 sm:py-12">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight">
                Atlas Copco Power Technique
              </h1>
              <p className="text-sm sm:text-base text-slate-300 mt-1 font-medium">
                Market Intelligence Dashboard — Personalised for You
              </p>
            </div>
            <div className="text-right flex flex-col items-end gap-2">
              <div className="text-xl sm:text-2xl font-bold text-gold tracking-wider">ATLAS COPCO</div>
              <div className="text-xs text-slate-400">
                Multi-Source Intelligence | Updated: {new Date(report.generatedTime).toLocaleDateString()}
              </div>
              {/* User info & settings & logout */}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-slate-400">{user?.name || user?.email}</span>
                <Link href="/pipeline" className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                  <Target className="w-3 h-3" /> Pipeline
                </Link>
                <span className="text-slate-600">|</span>
                <button onClick={() => navigate("/settings")} className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                  <Settings className="w-3 h-3" /> Settings
                </button>
                <span className="text-slate-600">|</span>
                {user?.role === "admin" && (
                  <>
                    <Link href="/admin" className="text-xs text-gold hover:text-gold-light flex items-center gap-1 transition-colors">
                      <Database className="w-3 h-3" /> Admin
                    </Link>
                    <span className="text-slate-600">|</span>
                  </>
                )}
                <button onClick={() => logout()} className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                  <LogOut className="w-3 h-3" /> Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-6 sm:py-8">
        {/* Territory Filter Bar */}
        {userTerritories.length > 0 && (
          <div className="flex items-center justify-between gap-3 mb-3 bg-card rounded-lg border border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-gold" />
              <span className="text-xs font-semibold text-foreground">
                {showAllTerritories ? "Showing all territories" : `Filtered to: ${userTerritories.join(", ")}`}
              </span>
              {!showAllTerritories && (
                <span className="text-[10px] text-muted-foreground">
                  ({territoryFiltered.length} of {personalizedProjects.length} projects)
                </span>
              )}
            </div>
            <button
              onClick={() => setShowAllTerritories(!showAllTerritories)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                showAllTerritories
                  ? "bg-gold/15 text-gold-dark border border-gold/30 hover:bg-gold/25"
                  : "bg-card text-muted-foreground border border-border hover:border-navy/30"
              }`}
            >
              <Filter className="w-3 h-3" />
              {showAllTerritories ? "Apply Territory Filter" : "Show All Territories"}
            </button>
          </div>
        )}

        {/* Lifecycle Filter Bar */}
        <div className="flex items-center gap-2 mb-3 overflow-x-auto scrollbar-thin pb-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Status:</span>
          {([
            { key: "active", label: "Active", icon: Eye, count: (lifecycleCounts as any)?.active ?? 0 },
            { key: "stale", label: "Stale", icon: Clock, count: (lifecycleCounts as any)?.stale ?? 0 },
            { key: "archived", label: "Archived", icon: Archive, count: (lifecycleCounts as any)?.archived ?? 0 },
            { key: "awarded", label: "Awarded", icon: Award, count: (lifecycleCounts as any)?.awarded ?? 0 },
            { key: "completed", label: "Completed", icon: Check, count: (lifecycleCounts as any)?.completed ?? 0 },
            { key: "all", label: "All", icon: BarChart3, count: Object.values((lifecycleCounts as any) ?? {}).reduce((a: number, b: any) => a + Number(b), 0) as number },
          ] as const).map(f => {
            const Icon = f.icon;
            const isActive = lifecycleFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setLifecycleFilter(f.key as any)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-navy text-white shadow-sm"
                    : "bg-card text-muted-foreground border border-border hover:border-navy/30"
                }`}
              >
                <Icon className="w-3 h-3" />
                {f.label} ({f.count})
              </button>
            );
          })}
        </div>

        {/* Business Line Filter */}
        {activeBusinessLines && activeBusinessLines.length > 0 && (
          <div className="flex items-center gap-2 mb-4 overflow-x-auto scrollbar-thin pb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Business Line:</span>
            <button
              onClick={() => setBusinessLineFilter("all")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${
                businessLineFilter === "all"
                  ? "bg-navy text-white shadow-sm"
                  : "bg-card text-muted-foreground border border-border hover:border-navy/30"
              }`}
            >
              All PT ({territoryFiltered.length})
            </button>
            {activeBusinessLines.map((bl: any) => {
              const count = territoryFiltered.filter((p: ProjectData) => {
                const ids = p.matchedBusinessLines;
                return ids && ids.includes(bl.id);
              }).length;
              return (
                <button
                  key={bl.id}
                  onClick={() => setBusinessLineFilter(String(bl.id))}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${
                    businessLineFilter === String(bl.id)
                      ? "bg-navy text-white shadow-sm"
                      : "bg-card text-muted-foreground border border-border hover:border-navy/30"
                  }`}
                >
                  {bl.name} ({count})
                </button>
              );
            })}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="overflow-x-auto mb-6 -mx-1 px-1 scrollbar-thin">
            <TabsList className="inline-flex w-max min-w-full justify-start bg-card border border-border rounded-lg p-1 gap-0.5">
              <TabsTrigger value="overview" className="flex-none text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">Overview</TabsTrigger>
              <TabsTrigger value="projects" className="flex-none text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">All Projects ({territoryFiltered.length})</TabsTrigger>
              <TabsTrigger value="awarded" className="flex-none text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">Awarded Projects</TabsTrigger>
              <TabsTrigger value="drilling" className="flex-none text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">Drilling & Exploration</TabsTrigger>
              <TabsTrigger value="ai-search" className="flex-none text-xs sm:text-sm font-semibold data-[state=active]:bg-gold data-[state=active]:text-navy px-3 sm:px-4 whitespace-nowrap flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" />AI Search</TabsTrigger>
              <TabsTrigger value="contacts" className="flex-none text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">Contacts ({territoryFilteredContacts.length})</TabsTrigger>
              <TabsTrigger value="contractors" className="flex-none text-xs sm:text-sm font-semibold data-[state=active]:bg-gold data-[state=active]:text-navy px-3 sm:px-4 whitespace-nowrap flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5" />Contractors</TabsTrigger>
              <TabsTrigger value="sources" className="flex-none text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">Sources & Methodology</TabsTrigger>
            </TabsList>
          </div>

          {/* ===== OVERVIEW TAB ===== */}
          <TabsContent value="overview" className="space-y-6">
            {/* Scoring Guide for first-time users */}
            {showScoringGuide && (
              <div className="bg-gradient-to-r from-navy/5 via-gold/5 to-teal/5 rounded-lg border border-gold/30 p-5 sm:p-6 relative">
                <button
                  onClick={() => {
                    setShowScoringGuide(false);
                    localStorage.setItem("atlas-scoring-guide-dismissed", "true");
                  }}
                  className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors text-sm"
                  title="Dismiss"
                >
                  ✕
                </button>
                <h2 className="text-base font-bold text-navy flex items-center gap-2 mb-3">
                  <Sparkles className="w-5 h-5 text-gold" />
                  How Your Dashboard is Personalised
                </h2>
                <p className="text-sm text-foreground/70 mb-4">
                  Projects and contacts are ranked based on the preferences you set during onboarding. Here's how the scoring works:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div className="bg-white/60 rounded-lg p-3 border border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <Globe className="w-4 h-4 text-teal" />
                      <span className="text-xs font-bold text-navy">Territory Match (25%)</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Projects in your selected territories ({userTerritories.length > 0 ? userTerritories.join(", ") : "all"}) are shown. Others are hidden unless you toggle "Show All".</p>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3 border border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <BarChart3 className="w-4 h-4 text-teal" />
                      <span className="text-xs font-bold text-navy">Industry Match (25%)</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Projects in your selected industries (mining, oil & gas, infrastructure, etc.) score higher and appear first.</p>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3 border border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <Target className="w-4 h-4 text-gold" />
                      <span className="text-xs font-bold text-navy">Offer Category (15%)</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Projects matching your offer categories (Direct CAPEX, Fleet CAPEX, OPEX) get a relevance boost.</p>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3 border border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-gold" />
                      <span className="text-xs font-bold text-navy">Customer Type (15%)</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Projects with your preferred customer types (principal contractors, owner-operators) are prioritised.</p>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3 border border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <Building2 className="w-4 h-4 text-navy" />
                      <span className="text-xs font-bold text-navy">Key Accounts (10%)</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Projects involving your nominated key accounts (BHP, Rio Tinto, etc.) get an extra boost.</p>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3 border border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <ThumbsUp className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs font-bold text-navy">Your Feedback (10%)</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Thumbs up/down on project cards teaches the system your preferences over time.</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <p className="text-[11px] text-muted-foreground italic">Hover over the match % badge on any project card to see its score breakdown.</p>
                  <button
                    onClick={() => navigate("/settings")}
                    className="text-[11px] font-semibold text-gold-dark hover:text-gold transition-colors underline"
                  >
                    Update your preferences
                  </button>
                </div>
              </div>
            )}

            {/* Executive Summary */}
            <div className="bg-card rounded-lg border border-border p-5 sm:p-6">
              <h2 className="text-lg font-bold text-navy flex items-center gap-2 mb-3">
                <FileText className="w-5 h-5 text-gold" />
                Market Intelligence Overview
              </h2>
              <p className="text-sm text-foreground/80 leading-relaxed mb-4">
                {report.executiveSummaryMain || `Tracking ${report.totalProjects} projects across mining, infrastructure, energy, and defence sectors. Projects are ranked by your personal preferences — use thumbs up/down on project cards to improve your recommendations.`}
              </p>
              {actionItems.length > 0 && (
                <div className="bg-gold/8 border border-gold/25 rounded-lg p-4 mb-4">
                  <h3 className="text-sm font-bold text-gold-dark mb-2 flex items-center gap-2">
                    <ArrowUpRight className="w-4 h-4" /> Top Action Items for Sales
                  </h3>
                  <ol className="space-y-2">
                    {actionItems.map((item: string, i: number) => (
                      <li key={i} className="text-sm text-foreground/80 flex gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-gold text-navy text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                        {item}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <p className="text-sm text-foreground/70">{report.executiveSummaryChanges}</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <KPICard value={businessLineFiltered.length} label="Total Projects" accent="teal" />
              <KPICard value={hotProjects.length} label="Hot Projects" accent="hot" />
              <KPICard value={warmProjects.length} label="Warm Projects" accent="warm" />
              <KPICard value={coldProjects.length} label="Cold / Monitor" />
              <KPICard value={territoryFilteredAwarded.length} label="Awarded" accent="gold" />
              <KPICard value={territoryFilteredDrilling.length} label="Drilling Campaigns" />
              <KPICard value={territoryFilteredContacts.length} label="Contacts" />
              <KPICard value="4" label="Data Sources" accent="teal" />
            </div>

            {/* Hot Projects */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Flame className="w-5 h-5 text-hot" />
                <h2 className="text-lg font-bold text-navy">Hot Projects</h2>
                <span className="px-2 py-0.5 rounded-full bg-hot/15 text-hot text-xs font-bold">{hotProjects.length}</span>
              </div>
              <div className="space-y-3">
                {hotProjects.map((p: ProjectData) => <ProjectCard key={p.id} project={p} existingFeedback={feedbackMap.get(p.id) ?? null} pipelineClaim={claimsMap.get(p.id) ?? null} businessLineNames={businessLineNamesMap} allContacts={contacts as ContactData[]} buyerRoles={profileData?.buyerRoles} />)}
              </div>
            </div>
          </TabsContent>

          {/* ===== ALL PROJECTS TAB ===== */}
          <TabsContent value="projects" className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <PriorityFilter active={priorityFilter} onChange={setPriorityFilter} stats={{ total: businessLineFiltered.length, hot: hotProjects.length, warm: warmProjects.length, cold: coldProjects.length }} />
              <SectorFilter active={sectorFilter} onChange={setSectorFilter} />
            </div>

            {(["hot", "warm", "cold"] as const).map(priority => {
              const group = filteredProjects.filter((p: ProjectData) => p.priority === priority);
              if (group.length === 0) return null;
              const icon = priority === "hot" ? <Flame className="w-4 h-4 text-hot" /> : priority === "warm" ? <TrendingUp className="w-4 h-4 text-warm" /> : <BarChart3 className="w-4 h-4 text-cold" />;
              const label = priority === "hot" ? "Hot Projects" : priority === "warm" ? "Warm Projects" : "Cold / Monitor Projects";
              const badgeClass = priority === "hot" ? "bg-hot/15 text-hot" : priority === "warm" ? "bg-warm/15 text-warm" : "bg-cold/15 text-cold";
              return (
                <div key={priority}>
                  <div className="flex items-center gap-2 mb-3">
                    {icon}
                    <h2 className="text-base font-bold text-navy">{label}</h2>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${badgeClass}`}>{group.length}</span>
                  </div>
                  <div className="space-y-3">
                    {group.map((p: ProjectData) => <ProjectCard key={p.id} project={p} existingFeedback={feedbackMap.get(p.id) ?? null} pipelineClaim={claimsMap.get(p.id) ?? null} businessLineNames={businessLineNamesMap} allContacts={contacts as ContactData[]} buyerRoles={profileData?.buyerRoles} />)}
                  </div>
                </div>
              );
            })}
          </TabsContent>

          {/* ===== AWARDED PROJECTS TAB ===== */}
          <TabsContent value="awarded" className="space-y-5">
            <div className="bg-card rounded-lg border border-border p-5">
              <h2 className="text-lg font-bold text-navy mb-2">Awarded Projects — Confirmed Contractor Opportunities</h2>
              <p className="text-sm text-foreground/70 mb-4">These projects have confirmed contract awards with named contractors. These are the highest-confidence opportunities — the contractor is known, the work is funded, and mobilisation is underway or imminent.</p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Project</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Value</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Winning Contractor</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Location</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Stage</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Opportunity</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {territoryFilteredAwarded.map((ap: any, i: number) => {
                    const oppClass = ap.opportunity === "Direct" ? "bg-teal/15 text-teal" : ap.opportunity === "Fleet" ? "bg-gold/15 text-gold-dark" : "bg-slate-200 text-slate-600";
                    return (
                      <tr key={ap.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                        <td className="px-4 py-3 font-semibold text-navy">{ap.project}</td>
                        <td className="px-4 py-3 font-medium">{ap.value}</td>
                        <td className="px-4 py-3">{ap.winningContractor}</td>
                        <td className="px-4 py-3 text-muted-foreground">{ap.location}</td>
                        <td className="px-4 py-3 text-muted-foreground">{ap.stage}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${oppClass}`}>{ap.opportunity}</span></td>
                        <td className="px-4 py-3">
                          {ap.sourceUrl && (
                            <a href={ap.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-teal hover:text-teal-light text-xs flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" />{ap.sourceLabel || "Source"}
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ===== DRILLING TAB ===== */}
          <TabsContent value="drilling" className="space-y-5">
            <div className="bg-card rounded-lg border border-border p-5">
              <h2 className="text-lg font-bold text-navy mb-2">Drilling & Exploration Campaigns</h2>
              <p className="text-sm text-foreground/70">Active and upcoming drilling campaigns represent direct demand for portable air compressors. RC drilling rigs require 600-1200 CFM at 350 psi. Diamond drilling requires 200-400 CFM. These are time-sensitive opportunities.</p>
            </div>
            <div className="relative rounded-lg overflow-hidden h-48 sm:h-56">
              <img src={IMAGES.miningOps} alt="Mining operations" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-navy/80 to-transparent" />
              <div className="absolute bottom-4 left-5 text-white">
                <h3 className="text-lg font-bold">Portable Air in Action</h3>
                <p className="text-xs text-slate-300">Compressed air is critical for drilling, blasting, and maintenance operations</p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Campaign</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Operator</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Location</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Drill Type</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Timing</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Air Requirement</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {territoryFilteredDrilling.map((dc: any, i: number) => (
                    <tr key={dc.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                      <td className="px-4 py-3 font-semibold text-navy">{dc.campaign}</td>
                      <td className="px-4 py-3">{dc.operator}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dc.location}</td>
                      <td className="px-4 py-3">{dc.drillType}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dc.timing}</td>
                      <td className="px-4 py-3 font-medium text-teal">{dc.airRequirement}</td>
                      <td className="px-4 py-3">
                        {dc.sourceUrl && (
                          <a href={dc.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-teal hover:text-teal-light text-xs flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" />{dc.sourceLabel || "Source"}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ===== CONTACTS TAB ===== */}
          <TabsContent value="contacts" className="space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-gold" />
              <h2 className="text-lg font-bold text-navy">Contact Database</h2>
              <span className="px-2 py-0.5 rounded-full bg-gold/15 text-gold-dark text-xs font-bold">{territoryFilteredContacts.length} contacts</span>
            </div>

            {/* Apollo Contact Search — search 275M+ contacts, reveal with 1 credit */}
            <ApolloContactSearch />

            <ContactsTable data={territoryFilteredContacts as ContactRow[]} weekEnding={report.weekEnding} projects={territoryFiltered as ProjectData[]} businessLineNames={businessLineNamesMap} preferredBuyerRoles={profileData?.buyerRoles ?? []} />
          </TabsContent>

          {/* ===== AI SEARCH TAB ===== */}
          <TabsContent value="ai-search" className="space-y-5">
            <AIProjectSearch onNavigateToProject={(projectId: number) => {
              setHighlightedProjectId(projectId);
              // Reset filters so the project is visible
              setPriorityFilter("all");
              setSectorFilter("all");
              setLifecycleFilter("all");
              // Switch to All Projects tab
              setActiveTab("projects");
              // Scroll to the project after tab switch renders
              setTimeout(() => {
                const el = document.getElementById(`project-${projectId}`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  el.classList.add("ring-2", "ring-gold", "ring-offset-2");
                  setTimeout(() => {
                    el.classList.remove("ring-2", "ring-gold", "ring-offset-2");
                    setHighlightedProjectId(null);
                  }, 3000);
                }
              }, 150);
            }} />
          </TabsContent>

          {/* ===== CONTRACTORS TAB ===== */}
          <TabsContent value="contractors" className="space-y-5">
            <ContractorPatterns />
          </TabsContent>

          {/* ===== SOURCES TAB ===== */}
          <TabsContent value="sources" className="space-y-5">
            <div className="bg-card rounded-lg border border-border p-5">
              <h2 className="text-lg font-bold text-navy mb-2 flex items-center gap-2">
                <Database className="w-5 h-5 text-gold" /> Data Sources & Pipeline
              </h2>
              <p className="text-sm text-foreground/70">Projects are aggregated from multiple automated data sources, each running on a scheduled pipeline. New projects are automatically extracted, deduplicated, and ranked by your personal preferences.</p>
            </div>

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
                    {[
                      { source: "RSS Feed Pipeline", type: "32 Industry Feeds", schedule: "Daily (06:00 UTC) + Sunday Mega-Scrape (9pm AWST)", coverage: "Mining, Energy, Oil & Gas, Infrastructure, Defence, Construction, Renewables, ASX", credits: "~100/day cap" },
                      { source: "Projectory Australia", type: "Web Scraper", schedule: "Weekly (Mondays) + Sunday Mega-Scrape", coverage: "Resources, Infrastructure, Construction, Energy, Industrial, Defence", credits: "None" },
                      { source: "DMIRS MINEDEX", type: "Government API", schedule: "Weekly (Wednesdays) + Sunday Mega-Scrape", coverage: "WA Mining Proposals & Approvals", credits: "None" },
                      { source: "AEMO Generation Info", type: "Government Data", schedule: "Weekly (Fridays) + Sunday Mega-Scrape", coverage: "BESS, Pumped Hydro, Gas Peaker & Power Generation (NEM)", credits: "None" },
                      { source: "Gov Major Projects", type: "Government Data", schedule: "Weekly (Tuesdays) + Sunday Mega-Scrape", coverage: "Infrastructure Australia + NREPL: Transport, Water, Energy, Defence", credits: "None" },
                      { source: "AusTender OCDS", type: "Government API", schedule: "Weekly (Thursdays) + Sunday Mega-Scrape", coverage: "Federal Contracts >$1M: Construction, Mining, Energy, Water, Defence", credits: "None" },
                      { source: "ICN Gateway", type: "Industry Portal", schedule: "Weekly (Saturdays) + Sunday Mega-Scrape", coverage: "Major Projects with Open Work Packages: Defence, Mining, Transport, Energy", credits: "None" },
                      { source: "Apollo.io People Search", type: "Contact Enrichment", schedule: "On-demand (per project)", coverage: "275M+ contacts — verified emails, titles, LinkedIn (no phone numbers)", credits: "1 credit/reveal" },
                    ].map((row, i) => (
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

            <div>
              <h3 className="text-base font-bold text-navy mb-3">How Personalisation Works</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-2xl font-bold text-gold mb-1">1</div>
                  <h4 className="text-sm font-bold text-navy mb-1">Profile Matching</h4>
                  <p className="text-xs text-muted-foreground">Your onboarding preferences (territories, industries, deal size) are matched against each project to calculate a relevance score.</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-2xl font-bold text-gold mb-1">2</div>
                  <h4 className="text-sm font-bold text-navy mb-1">Feedback Learning</h4>
                  <p className="text-xs text-muted-foreground">Every thumbs up/down adjusts your personal weights via Bayesian learning. The more feedback you give, the better your rankings become.</p>
                </div>
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="text-2xl font-bold text-gold mb-1">3</div>
                  <h4 className="text-sm font-bold text-navy mb-1">Smart Ranking</h4>
                  <p className="text-xs text-muted-foreground">Projects are scored combining profile match, feedback boost, and priority signals. Hot projects with high relevance appear first.</p>
                </div>
              </div>
            </div>

            <div className="bg-gold/8 border border-gold/25 rounded-lg p-4">
              <p className="text-sm text-foreground/80">
                <strong className="text-navy">Methodology Note:</strong> All CAPEX grades are evidence-based. Contractor predictions include confidence scores and are clearly labelled. Contact information is enriched via Apollo.io (275M+ database) with verified business emails. AI-generated contacts are clearly marked and require verification before outreach. Every Sunday at 9pm AWST, a full mega-scrape runs all 8 pipeline stages across all sources.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="bg-navy text-slate-400 py-6 mt-8">
        <div className="container text-center">
          <p className="text-xs font-medium text-gold mb-1">Powered by Multi-Source Intelligence Pipeline</p>
          <p className="text-xs">Atlas Copco Power Technique — Market Intelligence Dashboard</p>
          <p className="text-xs mt-1">Data sourced from 32 RSS feeds, Projectory, DMIRS MINEDEX, AEMO, AusTender, ICN Gateway, Gov Major Projects, and Apollo.io. Ranked by your preferences.</p>
        </div>
      </footer>
    </div>
  );
}
