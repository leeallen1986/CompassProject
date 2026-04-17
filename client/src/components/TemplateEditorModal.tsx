/**
 * TemplateEditorModal.tsx — Campaign email template editor
 *
 * Features:
 * - Subject line editor with merge field insertion
 * - Rich body editor with merge field insertion
 * - Greeting style selector
 * - Sign-off style selector
 * - Sender signature editor
 * - Live preview panel with sample data
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
  FileText, Eye, Save, Loader2, Plus, Trash2, RefreshCw,
  Type, AtSign, User, Building2, Briefcase, MapPin, Mail, Package,
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
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [greetingStyle, setGreetingStyle] = useState("Hi {{firstName}},");
  const [signOffStyle, setSignOffStyle] = useState("Kind regards,");
  const [senderSignature, setSenderSignature] = useState("");
  const [activeTab, setActiveTab] = useState("edit");
  const [hasChanges, setHasChanges] = useState(false);

  // Refs for cursor position insertion
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const signatureRef = useRef<HTMLTextAreaElement>(null);
  const [activeField, setActiveField] = useState<"subject" | "body" | "signature">("body");

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
    onError: (err) => toast.error(`Failed to save template: ${err.message}`),
  });

  const deleteMut = trpc.campaign.deleteTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template deleted");
      setSubjectTemplate("");
      setBodyTemplate("");
      setGreetingStyle("Hi {{firstName}},");
      setSignOffStyle("Kind regards,");
      setSenderSignature("");
      setHasChanges(false);
      templateQuery.refetch();
      onTemplateSaved?.();
    },
    onError: (err) => toast.error(`Failed to delete template: ${err.message}`),
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
      setHasChanges(false);
    } else if (defaultTemplateQuery.data && !templateQuery.data?.template) {
      const d = defaultTemplateQuery.data;
      setSubjectTemplate(d.subjectTemplate);
      setBodyTemplate(d.bodyTemplate);
      setGreetingStyle(d.greetingStyle);
      setSignOffStyle(d.signOffStyle);
      setSenderSignature(d.senderSignature);
      setHasChanges(false);
    }
  }, [templateQuery.data, defaultTemplateQuery.data]);

  // ── Insert merge field at cursor ──
  const insertMergeField = useCallback((token: string) => {
    if (activeField === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;
      const newVal = subjectTemplate.slice(0, start) + token + subjectTemplate.slice(end);
      setSubjectTemplate(newVal);
      setHasChanges(true);
      // Restore cursor position after React re-render
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
        // Fallback: append to body
        setBodyTemplate(prev => prev + token);
        setHasChanges(true);
      }
    }
  }, [activeField, subjectTemplate, bodyTemplate, senderSignature]);

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

  // ── Handlers ──
  const handleSave = () => {
    saveMut.mutate({
      campaignId,
      subjectTemplate,
      bodyTemplate,
      greetingStyle,
      signOffStyle,
      senderSignature: senderSignature || undefined,
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
      setHasChanges(true);
      toast.info("Default template loaded — click Save to apply");
    }
  };

  const handleDelete = () => {
    if (templateQuery.data?.template) {
      deleteMut.mutate({ templateId: templateQuery.data.template.id });
    }
  };

  const isLoading = templateQuery.isLoading || defaultTemplateQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-gold" />
            Email Template — {campaignName}
          </DialogTitle>
          <DialogDescription>
            Create a reusable email template with merge fields. Click merge field buttons to insert personalisation tokens.
            {templateQuery.data?.template && (
              <Badge variant="outline" className="ml-2 border-green-500 text-green-600">
                Template Active
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
          <div className="flex-1 overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
              <TabsList className="mb-3">
                <TabsTrigger value="edit" className="flex items-center gap-1.5">
                  <Type className="w-3.5 h-3.5" /> Editor
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" /> Preview
                </TabsTrigger>
              </TabsList>

              {/* ── Editor Tab ── */}
              <TabsContent value="edit" className="flex-1 overflow-y-auto space-y-4 pr-1">
                {/* Merge Field Buttons */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">
                    Insert Merge Field
                    <span className="text-[10px] font-normal ml-2 normal-case">
                      (click to insert at cursor in {activeField === "subject" ? "subject" : activeField === "signature" ? "signature" : "body"})
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {mergeFields.map((field) => (
                      <button
                        key={field.token}
                        onClick={() => insertMergeField(field.token)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-navy/10 text-navy hover:bg-navy/20 border border-navy/20 transition-colors"
                        title={`${field.description} — e.g. "${field.example}"`}
                      >
                        {MERGE_FIELD_ICONS[field.token] || <Type className="w-3 h-3" />}
                        {field.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subject Line */}
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
                    placeholder="{{senderName}}&#10;{{senderTitle}}&#10;Atlas Copco Australia - Power Technique&#10;{{senderEmail}}"
                    className="font-mono text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Leave blank to use the default signature (sender name, title, company, email).
                  </p>
                </div>
              </TabsContent>

              {/* ── Preview Tab ── */}
              <TabsContent value="preview" className="flex-1 overflow-y-auto">
                <div className="bg-white rounded-lg border border-border p-6 space-y-4">
                  {/* Email header */}
                  <div className="border-b border-gray-200 pb-3 space-y-1">
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

                  {/* Email body */}
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
              </TabsContent>
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
            disabled={saveMut.isPending || !subjectTemplate || !bodyTemplate}
            className="bg-gold text-navy hover:bg-gold/90"
          >
            {saveMut.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {hasChanges ? "Save Template" : "Save Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
