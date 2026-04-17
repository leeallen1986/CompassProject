/**
 * TemplateEditorModal.tsx — Campaign email template editor
 *
 * Features:
 * - Plain text mode: subject, greeting, body, sign-off, signature with merge fields
 * - HTML mode: paste/upload branded HTML templates with merge field injection
 * - Live preview for both modes (HTML rendered in sandboxed iframe)
 * - Merge field insertion buttons for both modes
 * - Save / Load default / Delete template
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  FileText, Eye, Save, Loader2, Trash2, RefreshCw,
  Type, AtSign, User, Building2, Briefcase, MapPin, Mail, Package,
  Code, FileUp, Copy, AlertTriangle,
} from "lucide-react";

// ── Types ──

interface MergeField {
  token: string;
  label: string;
  description: string;
  example: string;
}

interface TemplateEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: number;
  campaignName: string;
  onTemplateSaved?: () => void;
}

// ── Merge Field Icon Map ──

const MERGE_FIELD_ICONS: Record<string, React.ReactNode> = {
  "{{firstName}}": <User className="w-3 h-3" />,
  "{{lastName}}": <User className="w-3 h-3" />,
  "{{fullName}}": <User className="w-3 h-3" />,
  "{{company}}": <Building2 className="w-3 h-3" />,
  "{{title}}": <Briefcase className="w-3 h-3" />,
  "{{email}}": <AtSign className="w-3 h-3" />,
  "{{projectName}}": <FileText className="w-3 h-3" />,
  "{{projectLocation}}": <MapPin className="w-3 h-3" />,
  "{{sector}}": <Package className="w-3 h-3" />,
  "{{collateralName}}": <Package className="w-3 h-3" />,
  "{{senderName}}": <Mail className="w-3 h-3" />,
  "{{senderTitle}}": <Briefcase className="w-3 h-3" />,
  "{{senderEmail}}": <AtSign className="w-3 h-3" />,
};

// ── Greeting & Sign-off Options ──

const GREETING_OPTIONS = [
  "Hi {{firstName}},",
  "Dear {{firstName}},",
  "Hello {{firstName}},",
  "G'day {{firstName}},",
  "Hi {{fullName}},",
  "Dear {{fullName}},",
];

const SIGNOFF_OPTIONS = [
  "Kind regards,",
  "Best regards,",
  "Warm regards,",
  "Regards,",
  "Cheers,",
  "Thanks,",
  "Many thanks,",
];

// ── Component ──

export default function TemplateEditorModal({
  open,
  onOpenChange,
  campaignId,
  campaignName,
  onTemplateSaved,
}: TemplateEditorModalProps) {
  // ── State ──
  const [templateMode, setTemplateMode] = useState<"plaintext" | "html">("plaintext");
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [greetingStyle, setGreetingStyle] = useState("Hi {{firstName}},");
  const [signOffStyle, setSignOffStyle] = useState("Kind regards,");
  const [senderSignature, setSenderSignature] = useState("");
  const [htmlTemplate, setHtmlTemplate] = useState("");
  const [activeTab, setActiveTab] = useState("edit");
  const [hasChanges, setHasChanges] = useState(false);

  // Refs for cursor position insertion
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const signatureRef = useRef<HTMLTextAreaElement>(null);
  const htmlEditorRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeField, setActiveField] = useState<"subject" | "body" | "signature" | "html">("body");

  // ── Queries ──
  const templateQuery = trpc.campaign.getTemplate.useQuery(
    { campaignId },
    { enabled: open },
  );
  const defaultTemplateQuery = trpc.campaign.getDefaultTemplate.useQuery(
    { campaignId },
    { enabled: open },
  );

  const mergeFields: readonly MergeField[] = templateQuery.data?.mergeFields || [];

  // ── Mutations ──
  const saveMut = trpc.campaign.saveTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template saved successfully");
      setHasChanges(false);
      templateQuery.refetch();
      onTemplateSaved?.();
    },
    onError: (err: any) => toast.error(`Failed to save template: ${err.message}`),
  });

  const deleteMut = trpc.campaign.deleteTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template deleted");
      setSubjectTemplate("");
      setBodyTemplate("");
      setGreetingStyle("Hi {{firstName}},");
      setSignOffStyle("Kind regards,");
      setSenderSignature("");
      setHtmlTemplate("");
      setTemplateMode("plaintext");
      setHasChanges(false);
      templateQuery.refetch();
      onTemplateSaved?.();
    },
    onError: (err: any) => toast.error(`Failed to delete template: ${err.message}`),
  });

  // ── Load template data ──
  useEffect(() => {
    if (templateQuery.data?.template) {
      const t = templateQuery.data.template;
      setSubjectTemplate(t.subjectTemplate);
      setBodyTemplate(t.bodyTemplate);
      setGreetingStyle(t.greetingStyle);
      setSignOffStyle(t.signOffStyle);
      setSenderSignature(t.senderSignature || "");
      setTemplateMode((t.templateMode as "plaintext" | "html") || "plaintext");
      setHtmlTemplate(t.htmlTemplate || "");
      setHasChanges(false);
    } else if (defaultTemplateQuery.data && !templateQuery.data?.template) {
      const d = defaultTemplateQuery.data;
      setSubjectTemplate(d.subjectTemplate);
      setBodyTemplate(d.bodyTemplate);
      setGreetingStyle(d.greetingStyle);
      setSignOffStyle(d.signOffStyle);
      setSenderSignature(d.senderSignature);
      setTemplateMode("plaintext");
      setHtmlTemplate("");
      setHasChanges(false);
    }
  }, [templateQuery.data, defaultTemplateQuery.data]);

  // ── Insert merge field at cursor ──
  const insertMergeField = useCallback((token: string) => {
    if (activeField === "html" && htmlEditorRef.current) {
      const el = htmlEditorRef.current;
      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;
      const newVal = htmlTemplate.slice(0, start) + token + htmlTemplate.slice(end);
      setHtmlTemplate(newVal);
      setHasChanges(true);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }, 0);
    } else if (activeField === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;
      const newVal = subjectTemplate.slice(0, start) + token + subjectTemplate.slice(end);
      setSubjectTemplate(newVal);
      setHasChanges(true);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }, 0);
    } else if (activeField === "signature" && signatureRef.current) {
      const el = signatureRef.current;
      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;
      const newVal = senderSignature.slice(0, start) + token + senderSignature.slice(end);
      setSenderSignature(newVal);
      setHasChanges(true);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }, 0);
    } else {
      // Default to body
      const el = bodyRef.current;
      if (el) {
        const start = el.selectionStart || 0;
        const end = el.selectionEnd || 0;
        const newVal = bodyTemplate.slice(0, start) + token + bodyTemplate.slice(end);
        setBodyTemplate(newVal);
        setHasChanges(true);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start + token.length, start + token.length);
        }, 0);
      } else {
        setBodyTemplate(prev => prev + token);
        setHasChanges(true);
      }
    }
  }, [activeField, subjectTemplate, bodyTemplate, senderSignature, htmlTemplate]);

  // ── Preview rendering (client-side with sample data) ──
  const sampleContext = useMemo(() => {
    const fields = defaultTemplateQuery.data?.mergeFields || mergeFields;
    const ctx: Record<string, string> = {};
    for (const f of fields) {
      const key = f.token.replace(/\{\{|\}\}/g, "");
      ctx[key] = f.example;
    }
    return ctx;
  }, [mergeFields, defaultTemplateQuery.data]);

  const renderPreview = useCallback((template: string) => {
    let result = template;
    for (const [key, value] of Object.entries(sampleContext)) {
      result = result.split(`{{${key}}}`).join(value);
    }
    return result;
  }, [sampleContext]);

  const previewSubject = renderPreview(subjectTemplate);
  const previewGreeting = renderPreview(greetingStyle);
  const previewBody = renderPreview(bodyTemplate);
  const previewSignOff = renderPreview(signOffStyle);
  const previewSignature = renderPreview(senderSignature || "{{senderName}}\n{{senderTitle}}\nAtlas Copco Australia - Power Technique\n{{senderEmail}}");
  const previewHtml = renderPreview(htmlTemplate);

  // ── Count merge fields in HTML ──
  const htmlMergeFieldCount = useMemo(() => {
    if (!htmlTemplate) return 0;
    const matches = htmlTemplate.match(/\{\{[a-zA-Z]+\}\}/g);
    return matches ? new Set(matches).size : 0;
  }, [htmlTemplate]);

  // ── File Upload Handler ──
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".html") && !file.name.endsWith(".htm") && file.type !== "text/html") {
      toast.error("Please upload an HTML file (.html or .htm)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setHtmlTemplate(content);
        setTemplateMode("html");
        setHasChanges(true);
        toast.success(`HTML template loaded (${(content.length / 1024).toFixed(1)} KB). Add merge fields like {{firstName}} to personalise.`);
      }
    };
    reader.onerror = () => toast.error("Failed to read file");
    reader.readAsText(file);

    // Reset input so same file can be re-uploaded
    e.target.value = "";
  }, []);

  // ── Handlers ──
  const handleSave = () => {
    if (templateMode === "html" && !htmlTemplate) {
      toast.error("Please paste or upload an HTML template before saving in HTML mode.");
      return;
    }
    saveMut.mutate({
      campaignId,
      subjectTemplate,
      bodyTemplate: templateMode === "html" ? (bodyTemplate || "Email body (HTML mode)") : bodyTemplate,
      greetingStyle,
      signOffStyle,
      senderSignature: senderSignature || undefined,
      templateMode,
      htmlTemplate: templateMode === "html" ? htmlTemplate : null,
    });
  };

  const handleLoadDefault = () => {
    if (defaultTemplateQuery.data) {
      const d = defaultTemplateQuery.data;
      setSubjectTemplate(d.subjectTemplate);
      setBodyTemplate(d.bodyTemplate);
      setGreetingStyle(d.greetingStyle);
      setSignOffStyle(d.signOffStyle);
      setSenderSignature(d.senderSignature);
      setTemplateMode("plaintext");
      setHtmlTemplate("");
      setHasChanges(true);
      toast.info("Default template loaded — click Save to apply");
    }
  };

  const handleDelete = () => {
    if (templateQuery.data?.template) {
      deleteMut.mutate({ templateId: templateQuery.data.template.id });
    }
  };

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    toast.success(`Copied ${token} to clipboard`);
  };

  const isLoading = templateQuery.isLoading || defaultTemplateQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!fixed !inset-0 !w-screen !h-screen !max-w-none !max-h-none !rounded-none !border-0 !translate-x-0 !translate-y-0 !top-0 !left-0 overflow-hidden flex flex-col p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-gold" />
            Email Template — {campaignName}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 flex-wrap">
            Create a reusable email template with merge fields.
            {templateQuery.data?.template && (
              <Badge variant="outline" className="border-green-500 text-green-600">
                Template Active
              </Badge>
            )}
            {templateMode === "html" && (
              <Badge variant="outline" className="border-blue-500 text-blue-600">
                HTML Mode
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-gold" />
            <p className="text-muted-foreground">Loading template...</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {/* ── Mode Toggle ── */}
            <div className="flex items-center gap-3 mb-3 pb-3 border-b border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Template Mode:</span>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => { setTemplateMode("plaintext"); setHasChanges(true); setActiveField("body"); }}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    templateMode === "plaintext"
                      ? "bg-navy text-white"
                      : "bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Type className="w-3.5 h-3.5" /> Plain Text
                </button>
                <button
                  onClick={() => { setTemplateMode("html"); setHasChanges(true); setActiveField("html"); }}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    templateMode === "html"
                      ? "bg-navy text-white"
                      : "bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Code className="w-3.5 h-3.5" /> HTML Template
                </button>
              </div>
              {templateMode === "html" && htmlMergeFieldCount > 0 && (
                <span className="text-[10px] text-green-600 font-medium">
                  {htmlMergeFieldCount} merge field{htmlMergeFieldCount !== 1 ? "s" : ""} detected
                </span>
              )}
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
              <TabsList className="mb-3">
                <TabsTrigger value="edit" className="flex items-center gap-1.5">
                  <Type className="w-3.5 h-3.5" /> Editor
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" /> Preview
                </TabsTrigger>
                {templateMode === "html" && (
                  <TabsTrigger value="mergefields" className="flex items-center gap-1.5">
                    <AtSign className="w-3.5 h-3.5" /> Merge Fields
                  </TabsTrigger>
                )}
              </TabsList>

              {/* ── Editor Tab ── */}
              <TabsContent value="edit" className="flex-1 overflow-y-auto space-y-4 pr-1">
                {/* Merge Field Buttons */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">
                    Insert Merge Field
                    <span className="text-[10px] font-normal ml-2 normal-case">
                      (click to insert at cursor in {
                        activeField === "subject" ? "subject" :
                        activeField === "signature" ? "signature" :
                        activeField === "html" ? "HTML editor" : "body"
                      })
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {mergeFields.map((field) => {
                      const isProjectField = ["{{projectName}}", "{{projectLocation}}", "{{sector}}"].includes(field.token);
                      return (
                        <button
                          key={field.token}
                          onClick={() => insertMergeField(field.token)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
                            isProjectField
                              ? "bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-300"
                              : "bg-navy/10 text-navy hover:bg-navy/20 border-navy/20"
                          }`}
                          title={`${field.description} — e.g. "${field.example}"`}
                        >
                          {MERGE_FIELD_ICONS[field.token] || <Type className="w-3 h-3" />}
                          {field.label}
                          {isProjectField && <span className="text-[9px] text-amber-500">*</span>}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-amber-600 mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span><strong>*Project fields</strong> (Project Name, Location, Sector) use smart fallbacks when a contact has no matched project — e.g. "BHP Group's operations" instead of a project name.</span>
                  </p>
                </div>

                {/* Subject Line (both modes) */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">
                    Subject Line
                  </label>
                  <Input
                    ref={subjectRef}
                    value={subjectTemplate}
                    onChange={e => { setSubjectTemplate(e.target.value); setHasChanges(true); }}
                    onFocus={() => setActiveField("subject")}
                    placeholder="e.g. {{company}} — High-Pressure Air Solutions for {{projectName}}"
                    className="font-medium"
                  />
                </div>

                {templateMode === "plaintext" ? (
                  <>
                    {/* Greeting Style */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">
                          Greeting Style
                        </label>
                        <Select value={greetingStyle} onValueChange={(v) => { setGreetingStyle(v); setHasChanges(true); }}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {GREETING_OPTIONS.map(g => (
                              <SelectItem key={g} value={g}>{g}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">
                          Sign-Off Style
                        </label>
                        <Select value={signOffStyle} onValueChange={(v) => { setSignOffStyle(v); setHasChanges(true); }}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SIGNOFF_OPTIONS.map(s => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Body Template */}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">
                        Email Body
                      </label>
                      <Textarea
                        ref={bodyRef}
                        value={bodyTemplate}
                        onChange={e => { setBodyTemplate(e.target.value); setHasChanges(true); }}
                        onFocus={() => setActiveField("body")}
                        rows={10}
                        placeholder="Write your email body here. Use merge fields like {{firstName}}, {{company}}, {{projectName}} for personalisation..."
                        className="font-mono text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Tip: The greeting and sign-off are added automatically. Just write the main body content here.
                      </p>
                    </div>

                    {/* Sender Signature */}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">
                        Sender Signature
                      </label>
                      <Textarea
                        ref={signatureRef}
                        value={senderSignature}
                        onChange={e => { setSenderSignature(e.target.value); setHasChanges(true); }}
                        onFocus={() => setActiveField("signature")}
                        rows={4}
                        placeholder={"{{senderName}}\n{{senderTitle}}\nAtlas Copco Australia - Power Technique\n{{senderEmail}}"}
                        className="font-mono text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Leave blank to use the default signature (sender name, title, company, email).
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    {/* ── HTML Template Editor ── */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-semibold text-muted-foreground uppercase">
                          HTML Email Template
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".html,.htm,text/html"
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                            className="h-7 text-xs"
                          >
                            <FileUp className="w-3 h-3 mr-1" /> Upload HTML
                          </Button>
                          {htmlTemplate && (
                            <span className="text-[10px] text-muted-foreground">
                              {(htmlTemplate.length / 1024).toFixed(1)} KB
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Info banner */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                        <div className="flex gap-2">
                          <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                          <div className="text-xs text-blue-700 space-y-1">
                            <p className="font-semibold">How to use HTML templates:</p>
                            <ol className="list-decimal list-inside space-y-0.5">
                              <li>Upload or paste your branded HTML email template below</li>
                              <li>Replace static text with merge fields (e.g. change "Hi Lee" to "Hi {'{{firstName}}'}")</li>
                              <li>Use the merge field buttons above or the Merge Fields tab for reference</li>
                              <li>Switch to Preview to see how it renders with sample data</li>
                            </ol>
                          </div>
                        </div>
                      </div>

                      <Textarea
                        ref={htmlEditorRef}
                        value={htmlTemplate}
                        onChange={e => { setHtmlTemplate(e.target.value); setHasChanges(true); }}
                        onFocus={() => setActiveField("html")}
                        rows={16}
                        placeholder="Paste your HTML email template here, or click 'Upload HTML' to load from a file...

Example: Replace personalised text with merge fields:
  'Hi Lee' → 'Hi {{firstName}}'
  'Boart Longyear' → '{{company}}'
  'DrillAir X1350' → '{{collateralName}}'"
                        className="font-mono text-xs leading-relaxed"
                        style={{ tabSize: 2 }}
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        The HTML is sent as-is in the email. All images should use absolute URLs (https://...). Merge fields like {"{{firstName}}"} will be replaced per-contact.
                      </p>
                    </div>

                    {/* Plain text fallback (collapsed) */}
                    <details className="border border-border rounded-lg">
                      <summary className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:bg-muted/50">
                        Plain Text Fallback (for email clients that don't render HTML)
                      </summary>
                      <div className="p-3 space-y-3 border-t border-border">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Greeting</label>
                            <Select value={greetingStyle} onValueChange={(v) => { setGreetingStyle(v); setHasChanges(true); }}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {GREETING_OPTIONS.map(g => (
                                  <SelectItem key={g} value={g}>{g}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Sign-Off</label>
                            <Select value={signOffStyle} onValueChange={(v) => { setSignOffStyle(v); setHasChanges(true); }}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SIGNOFF_OPTIONS.map(s => (
                                  <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Textarea
                          ref={bodyRef}
                          value={bodyTemplate}
                          onChange={e => { setBodyTemplate(e.target.value); setHasChanges(true); }}
                          onFocus={() => setActiveField("body")}
                          rows={4}
                          placeholder="Plain text version of your email (used as fallback)..."
                          className="font-mono text-xs"
                        />
                      </div>
                    </details>
                  </>
                )}
              </TabsContent>

              {/* ── Preview Tab ── */}
              <TabsContent value="preview" className="flex-1 overflow-y-auto">
                {/* Email header (both modes) */}
                <div className="bg-white rounded-t-lg border border-border p-4 space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-gray-500 w-16">From:</span>
                    <span className="text-gray-900">{sampleContext.senderName} &lt;{sampleContext.senderEmail}&gt;</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-gray-500 w-16">To:</span>
                    <span className="text-gray-900">{sampleContext.fullName} &lt;{sampleContext.email}&gt;</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-gray-500 w-16">Subject:</span>
                    <span className="text-gray-900 font-medium">{previewSubject || "(no subject)"}</span>
                  </div>
                </div>

                {templateMode === "html" && htmlTemplate ? (
                  <>
                    {/* HTML Preview in sandboxed iframe */}
                    <div className="border border-t-0 border-border rounded-b-lg overflow-hidden bg-white">
                      <iframe
                        srcDoc={previewHtml}
                        title="HTML Email Preview"
                        className="w-full border-0"
                        style={{ minHeight: "500px", height: "60vh" }}
                        sandbox="allow-same-origin"
                      />
                    </div>
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs text-amber-700">
                        <strong>Preview note:</strong> This shows your HTML template with sample data substituted for merge fields. Each contact's email will use their actual details.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Plain text preview */}
                    <div className="bg-white rounded-b-lg border border-t-0 border-border p-6">
                      <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-[Calibri,_'Segoe_UI',_Arial,_sans-serif]">
                        <p>{previewGreeting}</p>
                        <br />
                        {previewBody.split("\n\n").map((para, i) => (
                          <div key={i}>
                            <p>{para}</p>
                            {i < previewBody.split("\n\n").length - 1 && <br />}
                          </div>
                        ))}
                        <br />
                        <p>{previewSignOff}</p>
                        <p className="whitespace-pre-wrap">{previewSignature}</p>
                      </div>
                    </div>
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs text-amber-700">
                        <strong>Preview note:</strong> This shows sample data. Each contact's email will be personalised with their actual name, company, project, and other details.
                      </p>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* ── Merge Fields Reference Tab (HTML mode) ── */}
              {templateMode === "html" && (
                <TabsContent value="mergefields" className="flex-1 overflow-y-auto">
                  <div className="bg-card rounded-lg border border-border p-4">
                    <h3 className="text-sm font-bold text-navy mb-3">Available Merge Fields</h3>
                    <p className="text-xs text-muted-foreground mb-4">
                      Copy these tokens and paste them into your HTML template to personalise each email. They will be replaced with real contact data when emails are generated.
                    </p>
                    <div className="space-y-2">
                      {mergeFields.map((field) => (
                        <div key={field.token} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 group">
                          <div className="flex items-center gap-1.5 min-w-[140px]">
                            {MERGE_FIELD_ICONS[field.token] || <Type className="w-3.5 h-3.5 text-muted-foreground" />}
                            <code className="text-xs font-bold text-navy bg-navy/10 px-1.5 py-0.5 rounded">
                              {field.token}
                            </code>
                          </div>
                          <div className="flex-1">
                            <span className="text-xs text-foreground">{field.description}</span>
                            <span className="text-[10px] text-muted-foreground ml-2">e.g. "{field.example}"</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleCopyToken(field.token)}
                          >
                            <Copy className="w-3 h-3 mr-1" /> Copy
                          </Button>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs text-blue-700">
                        <strong>Tip:</strong> In your HTML, find static text like "Hi Lee" and replace it with {"Hi {{firstName}}"}. 
                        Find "Boart Longyear" and replace with {"{{company}}"}. The system handles the rest.
                      </p>
                    </div>
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2 border-t pt-4 mt-2">
          <div className="flex items-center gap-2 mr-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadDefault}
              disabled={isLoading}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Load Default
            </Button>
            {templateQuery.data?.template && (
              <Button
                variant="outline"
                size="sm"
                className="border-red-300 text-red-600 hover:bg-red-50"
                onClick={handleDelete}
                disabled={deleteMut.isPending}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete Template
              </Button>
            )}
          </div>

          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMut.isPending || !subjectTemplate || (templateMode === "plaintext" && !bodyTemplate) || (templateMode === "html" && !htmlTemplate)}
            className="bg-gold text-navy hover:bg-gold/90"
          >
            {saveMut.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
