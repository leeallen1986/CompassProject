/*
 * Home — Atlas Copco Market Intelligence Dashboard
 * Design: Nordic Industrial Precision
 * Deep navy header, gold accents, tabbed layout, priority-coded cards
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flame, TrendingUp, Users, Search, Download, ExternalLink,
  BarChart3, Pickaxe, Fuel, Building, Shield, ChevronRight,
  MapPin, Calendar, ArrowUpRight, Sparkles, Database, FileText
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProjectCard from "@/components/ProjectCard";
import { IMAGES } from "@/lib/images";
import {
  projects, contacts, drillingCampaigns, awardedProjects,
  researchPasses, sourceCategories, stats, executiveSummary, metadata,
  type Project, type Contact
} from "@/lib/data";

const sectorIcons: Record<string, React.ReactNode> = {
  mining: <Pickaxe className="w-3.5 h-3.5" />,
  oil_gas: <Fuel className="w-3.5 h-3.5" />,
  infrastructure: <Building className="w-3.5 h-3.5" />,
  energy: <TrendingUp className="w-3.5 h-3.5" />,
  defence: <Shield className="w-3.5 h-3.5" />,
};

const sectorLabels: Record<string, string> = {
  mining: "Mining",
  oil_gas: "Oil & Gas",
  infrastructure: "Infrastructure",
  energy: "Energy",
  defence: "Defence",
};

function KPICard({ value, label, accent }: { value: string | number; label: string; accent?: "hot" | "warm" | "gold" | "teal" }) {
  const accentClass = accent === "hot" ? "text-hot" : accent === "warm" ? "text-warm" : accent === "gold" ? "text-gold" : accent === "teal" ? "text-teal" : "text-navy";
  return (
    <div className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-shadow">
      <div className={`text-3xl font-bold ${accentClass} tracking-tight`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wider">{label}</div>
    </div>
  );
}

function PriorityFilter({ active, onChange }: { active: string; onChange: (v: string) => void }) {
  const filters = [
    { key: "all", label: "All", count: stats.totalProjects },
    { key: "hot", label: "Hot", count: stats.hotProjects, color: "bg-hot" },
    { key: "warm", label: "Warm", count: stats.warmProjects, color: "bg-warm" },
    { key: "cold", label: "Cold", count: stats.coldProjects, color: "bg-cold" },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {filters.map(f => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
            active === f.key
              ? "bg-navy text-white shadow-sm"
              : "bg-card text-muted-foreground border border-border hover:border-navy/30"
          }`}
        >
          {f.color && <span className={`inline-block w-2 h-2 rounded-full ${f.color} mr-1.5`} />}
          {f.label} ({f.count})
        </button>
      ))}
    </div>
  );
}

function SectorFilter({ active, onChange }: { active: string; onChange: (v: string) => void }) {
  const sectors = ["all", "mining", "oil_gas", "infrastructure", "energy", "defence"];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {sectors.map(s => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
            active === s
              ? "bg-navy text-white shadow-sm"
              : "bg-card text-muted-foreground border border-border hover:border-navy/30"
          }`}
        >
          {s !== "all" && sectorIcons[s]}
          {s === "all" ? "All Sectors" : sectorLabels[s]}
        </button>
      ))}
    </div>
  );
}

function ContactsTable({ data }: { data: Contact[] }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.company.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.project.toLowerCase().includes(q)
    );
  }, [data, search]);

  const exportCSV = () => {
    const headers = ["Name", "Title", "Company", "Project", "Priority", "Role Bucket", "Email", "LinkedIn"];
    const rows = filtered.map(c => [c.name, c.title, c.company, c.project, c.priority, c.roleBucket, c.email || "", c.linkedin || ""]);
    const csv = [headers, ...rows].map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-copco-contacts-${metadata.weekEnding.replace(/\s/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const priorityBadge = (p: string) => {
    if (p === "hot") return "bg-hot text-white";
    if (p === "warm") return "bg-warm text-navy";
    return "bg-cold text-white";
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, company, title, or project..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold"
          />
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gold text-navy text-sm font-semibold hover:bg-gold-light transition-colors"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground italic mb-3">Contact details require verification via People Data Labs or Coresignal before outreach. Emails shown are corporate domain patterns.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy text-white">
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Title</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Company</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Project</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Priority</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => (
              <tr key={i} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                <td className="px-4 py-3 font-medium text-navy">{c.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.title}</td>
                <td className="px-4 py-3">{c.company}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.project}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${priorityBadge(c.priority)}`}>{c.priority}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{c.roleBucket}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="px-2 py-1 rounded text-[10px] font-semibold bg-teal/15 text-teal hover:bg-teal/25 transition-colors">
                        Email
                      </a>
                    )}
                    {c.linkedin && (
                      <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded text-[10px] font-semibold bg-navy/10 text-navy hover:bg-navy/20 transition-colors">
                        LI
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {data.length} contacts shown</p>
    </div>
  );
}

export default function Home() {
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sectorFilter, setSectorFilter] = useState("all");

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (priorityFilter !== "all" && p.priority !== priorityFilter) return false;
      if (sectorFilter !== "all" && p.sector !== sectorFilter) return false;
      return true;
    });
  }, [priorityFilter, sectorFilter]);

  const hotProjects = projects.filter(p => p.priority === "hot");

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
                Atlas Copco Portable Air
              </h1>
              <p className="text-sm sm:text-base text-slate-300 mt-1 font-medium">
                Weekly Market Intelligence Dashboard — Enhanced Edition
              </p>
            </div>
            <div className="text-right">
              <div className="text-xl sm:text-2xl font-bold text-gold tracking-wider">ATLAS COPCO</div>
              <div className="text-xs text-slate-400 mt-1">
                Week ending {metadata.weekEnding} | Generated: {metadata.generatedTime}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-6 sm:py-8">
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="w-full justify-start bg-card border border-border rounded-lg p-1 overflow-x-auto flex-nowrap mb-6">
            <TabsTrigger value="overview" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              Overview
            </TabsTrigger>
            <TabsTrigger value="projects" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              All Projects ({stats.totalProjects})
            </TabsTrigger>
            <TabsTrigger value="awarded" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              Awarded Projects
            </TabsTrigger>
            <TabsTrigger value="drilling" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              Drilling & Exploration
            </TabsTrigger>
            <TabsTrigger value="contacts" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              Contacts ({stats.totalContacts})
            </TabsTrigger>
            <TabsTrigger value="sources" className="text-xs sm:text-sm font-semibold data-[state=active]:bg-navy data-[state=active]:text-white px-3 sm:px-4 whitespace-nowrap">
              Sources & Methodology
            </TabsTrigger>
          </TabsList>

          {/* ===== OVERVIEW TAB ===== */}
          <TabsContent value="overview" className="space-y-6">
            {/* Executive Summary */}
            <div className="bg-card rounded-lg border border-border p-5 sm:p-6">
              <h2 className="text-lg font-bold text-navy flex items-center gap-2 mb-3">
                <FileText className="w-5 h-5 text-gold" />
                Executive Summary — Week of {metadata.weekEnding}
              </h2>
              <p className="text-sm text-foreground/80 leading-relaxed mb-4">{executiveSummary.mainText}</p>
              <div className="bg-gold/8 border border-gold/25 rounded-lg p-4 mb-4">
                <h3 className="text-sm font-bold text-gold-dark mb-2 flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4" /> Top Action Items for Sales
                </h3>
                <ol className="space-y-2">
                  {executiveSummary.actionItems.map((item, i) => (
                    <li key={i} className="text-sm text-foreground/80 flex gap-2">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-gold text-navy text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                      {item}
                    </li>
                  ))}
                </ol>
              </div>
              <p className="text-sm text-foreground/70">{executiveSummary.changes}</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <KPICard value={stats.totalProjects} label="Total Projects" accent="teal" />
              <KPICard value={stats.hotProjects} label="Hot Projects" accent="hot" />
              <KPICard value={stats.warmProjects} label="Warm Projects" accent="warm" />
              <KPICard value={stats.confirmedContractors} label="Confirmed Contractors" />
              <KPICard value={stats.predictedContractors} label="Predicted Contractors" />
              <KPICard value={stats.capexOpportunities} label="CAPEX Opportunities" accent="gold" />
              <KPICard value={stats.totalContacts} label="Contacts" />
              <KPICard value={stats.sourcesSearched} label="Sources Searched" accent="teal" />
            </div>

            {/* Hot Projects */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Flame className="w-5 h-5 text-hot" />
                <h2 className="text-lg font-bold text-navy">Hot Projects</h2>
                <span className="px-2 py-0.5 rounded-full bg-hot/15 text-hot text-xs font-bold">{hotProjects.length}</span>
              </div>
              <div className="space-y-3">
                {hotProjects.map(p => <ProjectCard key={p.id} project={p} />)}
              </div>
            </div>
          </TabsContent>

          {/* ===== ALL PROJECTS TAB ===== */}
          <TabsContent value="projects" className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <PriorityFilter active={priorityFilter} onChange={setPriorityFilter} />
              <SectorFilter active={sectorFilter} onChange={setSectorFilter} />
            </div>

            {(["hot", "warm", "cold"] as const).map(priority => {
              const group = filteredProjects.filter(p => p.priority === priority);
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
                    {group.map(p => <ProjectCard key={p.id} project={p} />)}
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
                  {awardedProjects.map((ap, i) => {
                    const oppClass = ap.opportunity === "Direct" ? "bg-teal/15 text-teal" : ap.opportunity === "Fleet" ? "bg-gold/15 text-gold-dark" : "bg-slate-200 text-slate-600";
                    return (
                      <tr key={i} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                        <td className="px-4 py-3 font-semibold text-navy">{ap.project}</td>
                        <td className="px-4 py-3 font-medium">{ap.value}</td>
                        <td className="px-4 py-3">{ap.winningContractor}</td>
                        <td className="px-4 py-3 text-muted-foreground">{ap.location}</td>
                        <td className="px-4 py-3 text-muted-foreground">{ap.stage}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${oppClass}`}>{ap.opportunity}</span></td>
                        <td className="px-4 py-3">
                          <a href={ap.source.url} target="_blank" rel="noopener noreferrer" className="text-teal hover:text-teal-light text-xs flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" />{ap.source.label}
                          </a>
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
            {/* Feature image */}
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
                  {drillingCampaigns.map((dc, i) => (
                    <tr key={i} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"} hover:bg-gold/5 transition-colors`}>
                      <td className="px-4 py-3 font-semibold text-navy">{dc.campaign}</td>
                      <td className="px-4 py-3">{dc.operator}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dc.location}</td>
                      <td className="px-4 py-3">{dc.drillType}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dc.timing}</td>
                      <td className="px-4 py-3 font-medium text-teal">{dc.airRequirement}</td>
                      <td className="px-4 py-3">
                        <a href={dc.source.url} target="_blank" rel="noopener noreferrer" className="text-teal hover:text-teal-light text-xs flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />{dc.source.label}
                        </a>
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
              <span className="px-2 py-0.5 rounded-full bg-gold/15 text-gold-dark text-xs font-bold">{stats.totalContacts} contacts</span>
            </div>
            <ContactsTable data={contacts} />
          </TabsContent>

          {/* ===== SOURCES TAB ===== */}
          <TabsContent value="sources" className="space-y-5">
            <div className="bg-card rounded-lg border border-border p-5">
              <h2 className="text-lg font-bold text-navy mb-2 flex items-center gap-2">
                <Database className="w-5 h-5 text-gold" /> Sources & Methodology
              </h2>
              <p className="text-sm text-foreground/70">This report was generated using an <strong className="text-navy">8-pass multi-source research methodology</strong>, searching across 20+ Australian industry sources. This is a significant improvement over single-source approaches, ensuring broader coverage and cross-validation.</p>
            </div>

            <div>
              <h3 className="text-base font-bold text-navy mb-3">Research Passes</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-navy text-white">
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Pass</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Focus</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Raw Projects</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Key Sources</th>
                    </tr>
                  </thead>
                  <tbody>
                    {researchPasses.map((rp, i) => (
                      <tr key={i} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-slate-50"}`}>
                        <td className="px-4 py-3 font-bold text-gold">{rp.pass}</td>
                        <td className="px-4 py-3 font-medium text-navy">{rp.focus}</td>
                        <td className="px-4 py-3">{rp.rawProjects}</td>
                        <td className="px-4 py-3 text-muted-foreground">{rp.keySources}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-base font-bold text-navy mb-3">Source Categories</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {sourceCategories.map((sc, i) => {
                  const dotColor = sc.type === "asx" ? "bg-gold" : sc.type === "industry" ? "bg-teal" : sc.type === "news" ? "bg-hot" : "bg-cold";
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm text-foreground/80 py-1.5 px-3 bg-card rounded border border-border">
                      <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
                      {sc.name}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-gold/8 border border-gold/25 rounded-lg p-4">
              <p className="text-sm text-foreground/80">
                <strong className="text-navy">Methodology Note:</strong> All CAPEX grades are evidence-based. If no source URL + date can be cited for a CAPEX claim, the grade is set to "Unknown" rather than estimated. Contractor predictions include confidence scores (0.0–1.0) and are clearly labelled. Contact information requires verification before outreach.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="bg-navy text-slate-400 py-6 mt-8">
        <div className="container text-center">
          <p className="text-xs font-medium text-gold mb-1">Generated by Manus AI — Enhanced Multi-Source Edition</p>
          <p className="text-xs">Atlas Copco Portable Air — Weekly Market Intelligence Dashboard</p>
          <p className="text-xs mt-1">Data sourced from 20+ public sources including ASX releases, industry publications, and government announcements. Week ending {metadata.weekEnding}.</p>
        </div>
      </footer>
    </div>
  );
}
