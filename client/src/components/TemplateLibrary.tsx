/**
 * TemplateLibrary — Browse, filter, and manage outreach email templates
 * 
 * Features:
 * - Browse all shared templates sorted by popularity
 * - Filter by role, sector, tone, or search text
 * - Preview template content
 * - "Use Template" to apply it to a contact (opens OutreachEmailModal with template)
 * - Edit/delete own templates
 */
import { useState, useMemo } from "react";
import {
  Search, BookTemplate, Star, Users, Briefcase, Mail,
  Trash2, Pencil, Copy, ChevronDown, ChevronUp, X,
  FileText, TrendingUp, Filter, Plus
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

interface TemplateLibraryProps {
  onUseTemplate?: (template: {
    id: number;
    name: string;
    subject: string;
    body: string;
    tone: "professional" | "consultative" | "direct";
    roleBucket: string | null;
  }) => void;
  compact?: boolean;
}

const ROLE_OPTIONS = [
  { value: "", label: "All Roles" },
  { value: "procurement", label: "Procurement" },
  { value: "engineering", label: "Engineering" },
  { value: "operations", label: "Operations" },
  { value: "project_management", label: "Project Management" },
  { value: "maintenance", label: "Maintenance" },
  { value: "fleet", label: "Fleet" },
  { value: "executive", label: "Executive" },
  { value: "construction", label: "Construction" },
];

const SECTOR_OPTIONS = [
  { value: "", label: "All Sectors" },
  { value: "mining", label: "Mining" },
  { value: "oil_gas", label: "Oil & Gas" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "energy", label: "Energy" },
  { value: "defence", label: "Defence" },
];

const TONE_OPTIONS = [
  { value: "", label: "All Tones" },
  { value: "professional", label: "Professional" },
  { value: "consultative", label: "Consultative" },
  { value: "direct", label: "Direct" },
];

const toneEmoji: Record<string, string> = {
  professional: "🏢",
  consultative: "🤝",
  direct: "🎯",
};

const roleColors: Record<string, string> = {
  procurement: "bg-blue-100 text-blue-700",
  engineering: "bg-purple-100 text-purple-700",
  operations: "bg-orange-100 text-orange-700",
  project_management: "bg-teal-100 text-teal-700",
  maintenance: "bg-amber-100 text-amber-700",
  fleet: "bg-indigo-100 text-indigo-700",
  executive: "bg-rose-100 text-rose-700",
  construction: "bg-green-100 text-green-700",
};

export default function TemplateLibrary({ onUseTemplate, compact = false }: TemplateLibraryProps) {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [toneFilter, setToneFilter] = useState("");
  const [showMyOnly, setShowMyOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { data: templates, isLoading, refetch } = trpc.templates.list.useQuery({
    roleBucket: roleFilter || undefined,
    sector: sectorFilter || undefined,
    tone: toneFilter || undefined,
    search: searchQuery || undefined,
    myOnly: showMyOnly || undefined,
  });

  const { data: stats } = trpc.templates.stats.useQuery();

  const deleteMutation = trpc.templates.delete.useMutation({
    onSuccess: () => {
      toast.success("Template deleted");
      refetch();
    },
    onError: (err: { message: string }) => {
      toast.error("Failed to delete: " + err.message);
    },
  });

  const handleDelete = (id: number) => {
    if (confirm("Delete this template? This cannot be undone.")) {
      deleteMutation.mutate({ id });
    }
  };

  const handleUseTemplate = (template: NonNullable<typeof templates>[number]) => {
    if (onUseTemplate) {
      onUseTemplate({
        id: template.id,
        name: template.name,
        subject: template.subject,
        body: template.body,
        tone: template.tone as "professional" | "consultative" | "direct",
        roleBucket: template.roleBucket,
      });
    }
  };

  const activeFilterCount = [roleFilter, sectorFilter, toneFilter, showMyOnly].filter(Boolean).length;

  if (compact) {
    return (
      <CompactTemplateList
        templates={templates || []}
        isLoading={isLoading}
        onUseTemplate={onUseTemplate}
        userId={user?.id}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with stats */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <BookTemplate className="w-5 h-5 text-gold" />
          <div>
            <h3 className="text-base font-bold text-navy">Template Library</h3>
            <p className="text-xs text-muted-foreground">
              {stats ? `${stats.totalTemplates} templates · ${stats.totalUsage} total uses` : "Loading..."}
            </p>
          </div>
        </div>
      </div>

      {/* Search + Filter Bar */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search templates by name, subject, or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all ${
              activeFilterCount > 0
                ? "border-gold bg-gold/10 text-gold-dark"
                : "border-border text-muted-foreground hover:border-navy/30"
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
          </button>
        </div>

        {/* Filter dropdowns */}
        {showFilters && (
          <div className="flex items-center gap-2 flex-wrap bg-card border border-border rounded-lg p-3">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-border text-xs bg-background focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-border text-xs bg-background focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              {SECTOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={toneFilter}
              onChange={(e) => setToneFilter(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-border text-xs bg-background focus:outline-none focus:ring-2 focus:ring-gold/40"
            >
              {TONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showMyOnly}
                onChange={(e) => setShowMyOnly(e.target.checked)}
                className="rounded border-border"
              />
              My templates only
            </label>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setRoleFilter(""); setSectorFilter(""); setToneFilter(""); setShowMyOnly(false); }}
                className="text-xs text-muted-foreground hover:text-navy transition-colors underline"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Template List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-muted-foreground">Loading templates...</div>
        </div>
      ) : !templates || templates.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-lg border border-border">
          <BookTemplate className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-sm font-semibold text-muted-foreground">No templates yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Generate an outreach email and click "Save as Template" to start building your library.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              isExpanded={expandedId === template.id}
              onToggle={() => setExpandedId(expandedId === template.id ? null : template.id)}
              onUse={() => handleUseTemplate(template)}
              onDelete={() => handleDelete(template.id)}
              isOwner={user?.id === template.createdBy}
              showUseButton={!!onUseTemplate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  isExpanded,
  onToggle,
  onUse,
  onDelete,
  isOwner,
  showUseButton,
}: {
  template: {
    id: number;
    name: string;
    description: string | null;
    subject: string;
    body: string;
    tone: string;
    roleBucket: string | null;
    sector: string | null;
    tags: string[] | null;
    usageCount: number;
    createdByName: string | null;
    createdAt: Date;
  };
  isExpanded: boolean;
  onToggle: () => void;
  onUse: () => void;
  onDelete: () => void;
  isOwner: boolean;
  showUseButton: boolean;
}) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${template.subject}\n\n${template.body}`);
      toast.success("Template copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <div className={`bg-card rounded-lg border transition-all ${
      isExpanded ? "border-gold/40 shadow-md" : "border-border hover:border-navy/20"
    }`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-navy truncate">{template.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-navy/8 text-navy font-medium">
              {toneEmoji[template.tone]} {template.tone}
            </span>
            {template.roleBucket && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${roleColors[template.roleBucket] || "bg-gray-100 text-gray-700"}`}>
                {template.roleBucket.replace(/_/g, " ")}
              </span>
            )}
            {template.sector && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                {template.sector.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {template.subject}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="w-3 h-3" />
              <span>{template.usageCount} uses</span>
            </div>
            {template.createdByName && (
              <div className="text-[10px] text-muted-foreground">by {template.createdByName}</div>
            )}
          </div>
          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
          {template.description && (
            <p className="text-xs text-muted-foreground italic">{template.description}</p>
          )}

          {/* Tags */}
          {template.tags && template.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {template.tags.map((tag: string, i: number) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-gold/10 text-gold-dark font-medium">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Subject Preview */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Subject</label>
            <div className="mt-1 px-3 py-2 rounded-lg bg-gold/5 border border-gold/20 text-sm font-medium text-navy">
              {template.subject}
            </div>
          </div>

          {/* Body Preview */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Email Body</label>
            <div className="mt-1 px-3 py-2 rounded-lg bg-card border border-border text-xs leading-relaxed text-foreground/80 whitespace-pre-line max-h-48 overflow-y-auto">
              {template.body}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-muted-foreground border border-border hover:border-navy/30 hover:text-navy transition-colors"
              >
                <Copy className="w-3 h-3" /> Copy
              </button>
              {isOwner && (
                <button
                  onClick={onDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              )}
            </div>
            {showUseButton && (
              <button
                onClick={onUse}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gold text-navy text-xs font-bold hover:bg-gold-light transition-colors shadow-sm"
              >
                <Mail className="w-3.5 h-3.5" /> Use This Template
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact template list for embedding inside the OutreachEmailModal
 */
function CompactTemplateList({
  templates,
  isLoading,
  onUseTemplate,
  userId,
}: {
  templates: {
    id: number;
    name: string;
    subject: string;
    body: string;
    tone: string;
    roleBucket: string | null;
    usageCount: number;
    createdByName: string | null;
  }[];
  isLoading: boolean;
  onUseTemplate?: (template: {
    id: number;
    name: string;
    subject: string;
    body: string;
    tone: "professional" | "consultative" | "direct";
    roleBucket: string | null;
  }) => void;
  userId?: number;
}) {
  if (isLoading) {
    return <div className="text-xs text-muted-foreground text-center py-4">Loading templates...</div>;
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground">No saved templates yet.</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Generate an email and save it as a template to reuse later.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 max-h-48 overflow-y-auto">
      {templates.slice(0, 8).map((t) => (
        <button
          key={t.id}
          onClick={() => onUseTemplate?.({
            id: t.id,
            name: t.name,
            subject: t.subject,
            body: t.body,
            tone: t.tone as "professional" | "consultative" | "direct",
            roleBucket: t.roleBucket,
          })}
          className="w-full text-left px-3 py-2 rounded-lg border border-border hover:border-gold/40 hover:bg-gold/5 transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-navy truncate">{t.name}</span>
            <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{t.usageCount} uses</span>
          </div>
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{t.subject}</p>
        </button>
      ))}
    </div>
  );
}
