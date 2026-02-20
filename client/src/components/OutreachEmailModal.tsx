/**
 * OutreachEmailModal — AI-powered personalised outreach email composer
 * 
 * Flow:
 * 1. User clicks "Email" on a contact → modal opens
 * 2. AI generates a personalised draft based on project + contact + PT products
 * 3. User can edit subject/body, change tone, regenerate
 * 4. "Open in Email" opens their email client via mailto: with the draft pre-filled
 * 5. "Save as Template" saves the current email as a reusable template
 * 6. "Use Template" lets user pick a saved template and auto-personalise it
 */
import { useState, useEffect } from "react";
import {
  X, Send, RefreshCw, Sparkles, Mail, Copy, Check, Pencil,
  BookTemplate, ChevronDown, ChevronUp, Save
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface ContactInfo {
  name: string;
  title: string;
  company: string;
  email: string;
  roleBucket: string;
}

interface ProjectInfo {
  name: string;
  location: string;
  value: string;
  sector: string;
  stage: string | null;
  overview: string | null;
  equipmentSignals: string[] | null;
  opportunityRoute: string;
  matchedBusinessLines: string[];
}

interface OutreachEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: ContactInfo & { id?: number };
  project: ProjectInfo & { id?: number };
}

type Tone = "professional" | "consultative" | "direct";

const toneConfig: Record<Tone, { label: string; description: string; icon: string }> = {
  professional: { label: "Professional", description: "Formal, credibility-focused", icon: "🏢" },
  consultative: { label: "Consultative", description: "Warm, advisor-style", icon: "🤝" },
  direct: { label: "Direct", description: "Concise, action-focused", icon: "🎯" },
};

export default function OutreachEmailModal({ isOpen, onClose, contact, project }: OutreachEmailModalProps) {
  const [tone, setTone] = useState<Tone>("consultative");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateTags, setTemplateTags] = useState("");
  const [isShared, setIsShared] = useState(true);

  const generateMutation = trpc.outreach.generate.useMutation({
    onSuccess: (data) => {
      setSubject(data.subject);
      setBody(data.body);
      setKeyPoints(data.keyPoints);
      setIsEditing(false);
      setShowTemplates(false);
    },
    onError: (err) => {
      toast.error("Failed to generate email: " + err.message);
    },
  });

  // Generate on first open and when tone changes
  useEffect(() => {
    if (isOpen && contact.email) {
      generateMutation.mutate({
        contactName: contact.name,
        contactTitle: contact.title,
        contactCompany: contact.company,
        contactEmail: contact.email,
        contactRoleBucket: contact.roleBucket,
        projectName: project.name,
        projectLocation: project.location,
        projectValue: project.value,
        projectSector: project.sector,
        projectStage: project.stage,
        projectOverview: project.overview,
        equipmentSignals: project.equipmentSignals,
        opportunityRoute: project.opportunityRoute,
        matchedBusinessLines: project.matchedBusinessLines,
        tone,
      });
    }
  }, [isOpen, tone]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMutation = trpc.outreach.save.useMutation({
    onError: (err) => {
      console.error("Failed to save outreach email:", err.message);
    },
  });

  // Template mutations
  const { data: templates, refetch: refetchTemplates } = trpc.templates.list.useQuery(
    { roleBucket: contact.roleBucket || undefined },
    { enabled: isOpen }
  );

  const saveTemplateMutation = trpc.templates.create.useMutation({
    onSuccess: () => {
      toast.success("Template saved to library!");
      setShowSaveForm(false);
      setTemplateName("");
      setTemplateDescription("");
      setTemplateTags("");
      refetchTemplates();
    },
    onError: (err) => {
      toast.error("Failed to save template: " + err.message);
    },
  });

  const personaliseMutation = trpc.templates.personalise.useMutation({
    onSuccess: (data) => {
      setSubject(data.subject);
      setBody(data.body);
      setKeyPoints([]);
      setIsEditing(false);
      setShowTemplates(false);
      toast.success("Template personalised for " + contact.name);
    },
    onError: (err) => {
      toast.error("Failed to personalise template: " + err.message);
    },
  });

  const handleOpenInEmail = () => {
    saveMutation.mutate({
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: contact.email || undefined,
      projectId: project.id,
      projectName: project.name,
      subject,
      body,
      tone,
      status: "opened_in_email",
    });

    const mailtoSubject = encodeURIComponent(subject);
    const mailtoBody = encodeURIComponent(body);
    window.open(`mailto:${contact.email}?subject=${mailtoSubject}&body=${mailtoBody}`, "_self");
    toast.success("Opening in your email client — outreach saved to history");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      toast.success("Email copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleRegenerate = () => {
    generateMutation.mutate({
      contactName: contact.name,
      contactTitle: contact.title,
      contactCompany: contact.company,
      contactEmail: contact.email,
      contactRoleBucket: contact.roleBucket,
      projectName: project.name,
      projectLocation: project.location,
      projectValue: project.value,
      projectSector: project.sector,
      projectStage: project.stage,
      projectOverview: project.overview,
      equipmentSignals: project.equipmentSignals,
      opportunityRoute: project.opportunityRoute,
      matchedBusinessLines: project.matchedBusinessLines,
      tone,
    });
  };

  const handleSaveAsTemplate = () => {
    if (!templateName.trim()) {
      toast.error("Please enter a template name");
      return;
    }
    const tags = templateTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    saveTemplateMutation.mutate({
      name: templateName.trim(),
      description: templateDescription.trim() || undefined,
      subject,
      body,
      tone,
      roleBucket: contact.roleBucket || undefined,
      sector: project.sector || undefined,
      tags: tags.length > 0 ? tags : undefined,
      isShared,
    });
  };

  const handleUseTemplate = (templateId: number) => {
    personaliseMutation.mutate({
      templateId,
      contactName: contact.name,
      contactTitle: contact.title,
      contactCompany: contact.company,
      contactEmail: contact.email,
      contactRoleBucket: contact.roleBucket,
      projectName: project.name,
      projectLocation: project.location,
      projectValue: project.value,
      projectSector: project.sector,
      projectStage: project.stage,
      projectOverview: project.overview,
      equipmentSignals: project.equipmentSignals,
      matchedBusinessLines: project.matchedBusinessLines,
    });
  };

  if (!isOpen) return null;

  const isGenerating = generateMutation.isPending || personaliseMutation.isPending;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-card rounded-xl shadow-2xl border border-border w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-border bg-navy text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-gold" />
              <div>
                <h2 className="text-base font-bold">AI Outreach Email</h2>
                <p className="text-xs text-slate-300">
                  To: {contact.name} ({contact.title}) — {project.name}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tone Selector + Template Toggle */}
          <div className="px-6 py-3 border-b border-border bg-card">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tone:</span>
                <div className="flex gap-2">
                  {(Object.keys(toneConfig) as Tone[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTone(t)}
                      disabled={isGenerating}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        tone === t
                          ? "bg-navy text-white shadow-sm"
                          : "bg-card text-muted-foreground border border-border hover:border-navy/30"
                      } ${isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      {toneConfig[t].icon} {toneConfig[t].label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => { setShowTemplates(!showTemplates); setShowSaveForm(false); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  showTemplates
                    ? "bg-gold/15 text-gold-dark border border-gold/30"
                    : "text-muted-foreground border border-border hover:border-gold/30 hover:text-gold-dark"
                }`}
              >
                <BookTemplate className="w-3.5 h-3.5" />
                Templates
                {showTemplates ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* Template Picker (collapsible) */}
          {showTemplates && (
            <div className="px-6 py-3 border-b border-border bg-gold/3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-navy">
                  {personaliseMutation.isPending ? "Personalising template..." : "Pick a template to personalise for this contact:"}
                </p>
              </div>
              {personaliseMutation.isPending ? (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Sparkles className="w-4 h-4 text-gold animate-pulse" />
                  <span className="text-xs text-muted-foreground">
                    Adapting template for {contact.name}...
                  </span>
                </div>
              ) : !templates || templates.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-xs text-muted-foreground">No templates saved yet.</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Generate an email below and click "Save as Template" to start your library.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleUseTemplate(t.id)}
                      className="w-full text-left px-3 py-2 rounded-lg border border-border hover:border-gold/40 hover:bg-gold/5 transition-all group bg-card"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-semibold text-navy truncate">{t.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-navy/8 text-navy font-medium shrink-0">
                            {toneConfig[t.tone as Tone]?.icon} {t.tone}
                          </span>
                          {t.roleBucket && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal/10 text-teal font-medium shrink-0">
                              {t.roleBucket.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{t.usageCount} uses</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{t.subject}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="relative">
                  <Sparkles className="w-8 h-8 text-gold animate-pulse" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-navy">
                    {personaliseMutation.isPending ? "Personalising template..." : "Generating personalised email..."}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Analysing {project.name} and crafting a tailored message for {contact.name}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Subject */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                    Subject
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gold/40"
                    />
                  ) : (
                    <div className="px-3 py-2 rounded-lg bg-gold/5 border border-gold/20 text-sm font-medium text-navy">
                      {subject}
                    </div>
                  )}
                </div>

                {/* Body */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Email Body
                    </label>
                    <button
                      onClick={() => setIsEditing(!isEditing)}
                      className="flex items-center gap-1 text-xs text-teal hover:text-teal-light transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      {isEditing ? "Done editing" : "Edit"}
                    </button>
                  </div>
                  {isEditing ? (
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={12}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-gold/40 resize-y"
                    />
                  ) : (
                    <div className="px-4 py-3 rounded-lg bg-card border border-border text-sm leading-relaxed whitespace-pre-line text-foreground/85">
                      {body}
                    </div>
                  )}
                </div>

                {/* Key Points */}
                {keyPoints.length > 0 && (
                  <div className="bg-teal/5 border border-teal/20 rounded-lg p-3">
                    <p className="text-xs font-semibold text-teal uppercase tracking-wider mb-2">Key Selling Points Used</p>
                    <ul className="space-y-1">
                      {keyPoints.map((kp, i) => (
                        <li key={i} className="text-xs text-foreground/70 flex gap-2">
                          <span className="shrink-0 w-4 h-4 rounded-full bg-teal/15 text-teal text-[10px] font-bold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          {kp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Save as Template Form (collapsible) */}
                {showSaveForm && (
                  <div className="bg-gold/5 border border-gold/20 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-navy flex items-center gap-1.5">
                        <BookTemplate className="w-3.5 h-3.5 text-gold" />
                        Save as Template
                      </h4>
                      <button
                        onClick={() => setShowSaveForm(false)}
                        className="text-muted-foreground hover:text-navy transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Template Name *
                      </label>
                      <input
                        type="text"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        placeholder="e.g., Mining Procurement — TCO Pitch"
                        className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Description (optional)
                      </label>
                      <input
                        type="text"
                        value={templateDescription}
                        onChange={(e) => setTemplateDescription(e.target.value)}
                        placeholder="When to use this template..."
                        className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Tags (comma-separated, optional)
                      </label>
                      <input
                        type="text"
                        value={templateTags}
                        onChange={(e) => setTemplateTags(e.target.value)}
                        placeholder="e.g., mining, compressors, TCO"
                        className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isShared}
                          onChange={(e) => setIsShared(e.target.checked)}
                          className="rounded border-border"
                        />
                        Share with team
                      </label>
                      <button
                        onClick={handleSaveAsTemplate}
                        disabled={saveTemplateMutation.isPending || !templateName.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gold text-navy text-xs font-bold hover:bg-gold-light transition-colors disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {saveTemplateMutation.isPending ? "Saving..." : "Save Template"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 border-t border-border bg-card flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={handleRegenerate}
                disabled={isGenerating}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-muted-foreground border border-border hover:border-navy/30 hover:text-navy transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isGenerating ? "animate-spin" : ""}`} />
                Regenerate
              </button>
              {!isGenerating && body && !showSaveForm && (
                <button
                  onClick={() => setShowSaveForm(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-gold-dark border border-gold/30 hover:bg-gold/10 transition-colors"
                >
                  <BookTemplate className="w-4 h-4" />
                  Save as Template
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                disabled={isGenerating || !body}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-navy border border-border hover:bg-navy/5 transition-colors disabled:opacity-50"
              >
                {copied ? <Check className="w-4 h-4 text-teal" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied" : "Copy"}
              </button>

              <button
                onClick={handleOpenInEmail}
                disabled={isGenerating || !body}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gold text-navy text-sm font-bold hover:bg-gold-light transition-colors shadow-sm disabled:opacity-50"
              >
                <Mail className="w-4 h-4" />
                Open in Email
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
