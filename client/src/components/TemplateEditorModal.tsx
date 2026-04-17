/**
 * TemplateEditorModal.tsx — WYSIWYG Campaign Email Template Editor
 *
 * Features:
 * - Rich text editor (TipTap) with formatting toolbar
 * - Colourful merge field pill buttons
 * - Inline image support (drag-drop, paste, upload)
 * - Show Preview toggle
 * - HTML file upload for branded templates (advanced)
 * - Word count
 * - Full-screen modal
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  FileText, Eye, EyeOff, Save, Loader2, Trash2, RefreshCw,
  Bold, Italic, Underline as UnderlineIcon, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Link as LinkIcon, Image as ImageIcon, Undo, Redo,
  Upload, Code, AlertTriangle,
} from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TiptapImage from "@tiptap/extension-image";
import TiptapLink from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TiptapUnderline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";

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

// ── Merge field pill colours ──

const MERGE_PILL_COLORS: Record<string, string> = {
  "{{firstName}}": "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200",
  "{{lastName}}": "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200",
  "{{fullName}}": "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200",
  "{{company}}": "bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200",
  "{{title}}": "bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-200",
  "{{email}}": "bg-cyan-100 text-cyan-800 border-cyan-300 hover:bg-cyan-200",
  "{{projectName}}": "bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200",
  "{{projectLocation}}": "bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200",
  "{{sector}}": "bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200",
  "{{collateralName}}": "bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-200",
  "{{senderName}}": "bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200",
  "{{senderTitle}}": "bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200",
  "{{senderEmail}}": "bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200",
};

const DEFAULT_PILL = "bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200";

// ── Image upload helper ──

async function uploadImage(file: File): Promise<string> {
  const resp = await fetch("/api/upload-template-image", {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-Filename": file.name,
    },
    body: file,
  });
  if (!resp.ok) throw new Error("Image upload failed");
  const data = await resp.json();
  return data.url;
}

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
  const [showPreview, setShowPreview] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [templateMode, setTemplateMode] = useState<"plaintext" | "html">("html"); // default to WYSIWYG (html)
  const [rawHtmlMode, setRawHtmlMode] = useState(false); // for advanced HTML upload
  const [rawHtml, setRawHtml] = useState("");
  const [previewMode, setPreviewMode] = useState<"with-project" | "no-project">("with-project");
  const subjectRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // ── TipTap Editor ──
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, // email doesn't need headings
      }),
      TiptapUnderline,
      TextAlign.configure({
        types: ["paragraph"],
      }),
      TiptapImage.configure({
        inline: true,
        allowBase64: true,
        HTMLAttributes: {
          style: "max-width: 100%; height: auto;",
        },
      }),
      TiptapLink.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      Placeholder.configure({
        placeholder: "Start writing your email here...\n\nTip: Use the merge field buttons above to personalise for each recipient.",
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[300px] px-5 py-4",
        style: "font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 14px; line-height: 1.6;",
      },
      handleDrop: (view, event, _slice, moved) => {
        if (!moved && event.dataTransfer?.files?.length) {
          const file = event.dataTransfer.files[0];
          if (file.type.startsWith("image/")) {
            event.preventDefault();
            handleImageDrop(file);
            return true;
          }
        }
        return false;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of Array.from(items)) {
            if (item.type.startsWith("image/")) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) handleImageDrop(file);
              return true;
            }
          }
        }
        return false;
      },
    },
    onUpdate: () => {
      setHasChanges(true);
    },
  });

  // ── Image drop/paste handler ──
  const handleImageDrop = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image too large. Max 10MB per image.");
      return;
    }
    const toastId = toast.loading("Uploading image...");
    try {
      const url = await uploadImage(file);
      editor?.chain().focus().setImage({ src: url }).run();
      toast.success("Image added", { id: toastId });
    } catch {
      toast.error("Failed to upload image", { id: toastId });
    }
  }, [editor]);

  // ── Mutations ──
  const saveMut = trpc.campaign.saveTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template saved");
      setHasChanges(false);
      templateQuery.refetch();
      onTemplateSaved?.();
    },
    onError: (err: any) => toast.error(`Failed to save: ${err.message}`),
  });

  const deleteMut = trpc.campaign.deleteTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template deleted");
      setSubjectTemplate("");
      editor?.commands.clearContent();
      setRawHtml("");
      setRawHtmlMode(false);
      setHasChanges(false);
      templateQuery.refetch();
      onTemplateSaved?.();
    },
    onError: (err: any) => toast.error(`Failed to delete: ${err.message}`),
  });

  // ── Load template data ──
  useEffect(() => {
    if (!editor) return;
    if (templateQuery.data?.template) {
      const t = templateQuery.data.template;
      setSubjectTemplate(t.subjectTemplate);
      const mode = (t.templateMode as "plaintext" | "html") || "html";
      setTemplateMode(mode);
      if (mode === "html" && t.htmlTemplate) {
        editor.commands.setContent(t.htmlTemplate);
        setRawHtml(t.htmlTemplate);
      } else if (t.bodyTemplate) {
        // Convert plain text to HTML paragraphs for the editor
        const htmlContent = t.bodyTemplate
          .split("\n\n")
          .map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`)
          .join("");
        const fullHtml = `<p>${t.greetingStyle}</p>${htmlContent}<p>${t.signOffStyle}</p><p>${t.senderSignature || ""}</p>`;
        editor.commands.setContent(fullHtml);
      }
      setHasChanges(false);
    } else if (defaultTemplateQuery.data && !templateQuery.data?.template) {
      const d = defaultTemplateQuery.data;
      setSubjectTemplate(d.subjectTemplate);
      // Build default WYSIWYG content
      const htmlContent = d.bodyTemplate
        .split("\n\n")
        .map((p: string) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
        .join("");
      const fullHtml = `<p>${d.greetingStyle}</p>${htmlContent}<p>${d.signOffStyle}</p><p>${d.senderSignature || ""}</p>`;
      editor.commands.setContent(fullHtml);
      setTemplateMode("html");
      setHasChanges(false);
    }
  }, [templateQuery.data, defaultTemplateQuery.data, editor]);

  // ── Insert merge field into editor ──
  const insertMergeField = useCallback((token: string) => {
    if (editor) {
      editor.chain().focus().insertContent(token).run();
      setHasChanges(true);
    }
  }, [editor]);

  // ── Insert merge field into subject ──
  const insertMergeFieldToSubject = useCallback((token: string) => {
    if (subjectRef.current) {
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
    } else {
      setSubjectTemplate(prev => prev + token);
      setHasChanges(true);
    }
  }, [subjectTemplate]);

  // ── Image upload via button ──
  const handleImageUpload = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) await handleImageDrop(file);
    };
    input.click();
  }, [handleImageDrop]);

  // ── Link insertion ──
  const handleInsertLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("Enter URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  // ── HTML file upload ──
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
      if (content && editor) {
        editor.commands.setContent(content);
        setRawHtml(content);
        setTemplateMode("html");
        setHasChanges(true);
        toast.success(`HTML template loaded (${(content.length / 1024).toFixed(1)} KB)`);
      }
    };
    reader.onerror = () => toast.error("Failed to read file");
    reader.readAsText(file);
    e.target.value = "";
  }, [editor]);

  // ── Preview rendering ──
  const sampleContext = useMemo(() => {
    const fields = defaultTemplateQuery.data?.mergeFields || mergeFields;
    const ctx: Record<string, string> = {};
    for (const f of fields) {
      const key = f.token.replace(/\{\{|\}\}/g, "");
      ctx[key] = f.example;
    }
    return ctx;
  }, [mergeFields, defaultTemplateQuery.data]);

  const noProjectContext = useMemo(() => {
    const base = { ...sampleContext };
    const company = base.company || "Acme Corp";
    base.projectName = `${company}'s operations`;
    base.projectLocation = "your region";
    base.sector = "your industry";
    return base;
  }, [sampleContext]);

  const activePreviewContext = previewMode === "no-project" ? noProjectContext : sampleContext;

  const renderPreview = useCallback((template: string) => {
    let result = template;
    for (const [key, value] of Object.entries(activePreviewContext)) {
      result = result.split(`{{${key}}}`).join(value);
    }
    return result;
  }, [activePreviewContext]);

  // ── Word count ──
  const wordCount = useMemo(() => {
    if (!editor) return 0;
    const text = editor.getText();
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }, [editor?.getText()]);

  // ── Save handler ──
  const handleSave = () => {
    const htmlContent = editor?.getHTML() || "";
    if (!htmlContent || htmlContent === "<p></p>") {
      toast.error("Please write some email content before saving.");
      return;
    }
    saveMut.mutate({
      campaignId,
      subjectTemplate,
      bodyTemplate: editor?.getText() || "Email body",
      greetingStyle: "Hi {{firstName}},",
      signOffStyle: "Kind regards,",
      senderSignature: undefined,
      templateMode: "html",
      htmlTemplate: htmlContent,
    });
  };

  const handleLoadDefault = () => {
    if (defaultTemplateQuery.data && editor) {
      const d = defaultTemplateQuery.data;
      setSubjectTemplate(d.subjectTemplate);
      const htmlContent = d.bodyTemplate
        .split("\n\n")
        .map((p: string) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
        .join("");
      const fullHtml = `<p>${d.greetingStyle}</p>${htmlContent}<p>${d.signOffStyle}</p><p>${d.senderSignature || ""}</p>`;
      editor.commands.setContent(fullHtml);
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

  // ── Toolbar Button Component ──
  const ToolbarBtn = ({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title: string }) => (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-navy text-white"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!fixed !inset-0 !w-screen !h-screen !max-w-none !max-h-none !rounded-none !border-0 !translate-x-0 !translate-y-0 !top-0 !left-0 overflow-hidden flex flex-col p-0">
        {/* ── Header ── */}
        <div className="px-6 pt-5 pb-4 border-b border-border bg-white">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-navy/10 flex items-center justify-center">
                <FileText className="w-5 h-5 text-navy" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Email Template Editor</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Master template for this campaign — images and layout stay fixed, text is personalised per recipient.
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {templateQuery.data?.template && (
                <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50">
                  Template saved
                </Badge>
              )}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-gold" />
              <p className="text-muted-foreground">Loading template...</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            {/* ── Subject Line ── */}
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Subject Line</label>
              <Input
                ref={subjectRef}
                value={subjectTemplate}
                onChange={e => { setSubjectTemplate(e.target.value); setHasChanges(true); }}
                placeholder="e.g. Enhance {{company}}'s Operations with..."
                className="text-base"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use placeholders like {"{{firstName}}"}, {"{{company}}"} — they'll be replaced per recipient.
              </p>
            </div>

            {/* ── Merge Field Pills ── */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-500 mb-2 block">Insert Placeholder</label>
              <div className="flex flex-wrap gap-1.5">
                {(mergeFields.length > 0 ? [...mergeFields] : [
                  { token: "{{firstName}}", label: "First Name", description: "", example: "" },
                  { token: "{{lastName}}", label: "Last Name", description: "", example: "" },
                  { token: "{{fullName}}", label: "Full Name", description: "", example: "" },
                  { token: "{{company}}", label: "Company", description: "", example: "" },
                  { token: "{{title}}", label: "Job Title", description: "", example: "" },
                  { token: "{{projectName}}", label: "Project Name", description: "", example: "" },
                ]).map((field) => {
                  const colorClass = MERGE_PILL_COLORS[field.token] || DEFAULT_PILL;
                  return (
                    <button
                      key={field.token}
                      onClick={() => insertMergeField(field.token)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${colorClass}`}
                      title={field.description || `Insert ${field.label}`}
                    >
                      {field.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Formatting Toolbar ── */}
            <div className="flex items-center gap-0.5 px-2 py-1.5 bg-gray-50 border border-border rounded-t-lg flex-wrap">
              <ToolbarBtn
                active={editor?.isActive("bold")}
                onClick={() => editor?.chain().focus().toggleBold().run()}
                title="Bold"
              >
                <Bold className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn
                active={editor?.isActive("italic")}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
                title="Italic"
              >
                <Italic className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn
                active={editor?.isActive("underline")}
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
                title="Underline"
              >
                <UnderlineIcon className="w-4 h-4" />
              </ToolbarBtn>

              <div className="w-px h-5 bg-gray-300 mx-1" />

              <ToolbarBtn
                active={editor?.isActive({ textAlign: "left" })}
                onClick={() => editor?.chain().focus().setTextAlign("left").run()}
                title="Align Left"
              >
                <AlignLeft className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn
                active={editor?.isActive({ textAlign: "center" })}
                onClick={() => editor?.chain().focus().setTextAlign("center").run()}
                title="Align Center"
              >
                <AlignCenter className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn
                active={editor?.isActive({ textAlign: "right" })}
                onClick={() => editor?.chain().focus().setTextAlign("right").run()}
                title="Align Right"
              >
                <AlignRight className="w-4 h-4" />
              </ToolbarBtn>

              <div className="w-px h-5 bg-gray-300 mx-1" />

              <ToolbarBtn
                active={editor?.isActive("bulletList")}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                title="Bullet List"
              >
                <List className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn
                active={editor?.isActive("orderedList")}
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                title="Numbered List"
              >
                <ListOrdered className="w-4 h-4" />
              </ToolbarBtn>

              <div className="w-px h-5 bg-gray-300 mx-1" />

              <ToolbarBtn
                active={editor?.isActive("link")}
                onClick={handleInsertLink}
                title="Insert Link"
              >
                <LinkIcon className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn
                active={false}
                onClick={handleImageUpload}
                title="Insert Image"
              >
                <ImageIcon className="w-4 h-4" />
              </ToolbarBtn>

              <div className="w-px h-5 bg-gray-300 mx-1" />

              <ToolbarBtn
                active={false}
                onClick={() => editor?.chain().focus().undo().run()}
                title="Undo"
              >
                <Undo className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn
                active={false}
                onClick={() => editor?.chain().focus().redo().run()}
                title="Redo"
              >
                <Redo className="w-4 h-4" />
              </ToolbarBtn>

              {/* Right side: Show Preview toggle + Upload HTML */}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                  title="Upload a branded HTML template file"
                >
                  <Upload className="w-3.5 h-3.5" /> Upload HTML
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".html,.htm"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    showPreview
                      ? "bg-navy text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showPreview ? "Hide Preview" : "Show Preview"}
                </button>
              </div>
            </div>

            {/* ── Editor / Preview Area ── */}
            {showPreview ? (
              <div className="border border-t-0 border-border rounded-b-lg bg-white">
                {/* Preview mode toggle */}
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-border">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase">Preview as:</span>
                  <button
                    onClick={() => setPreviewMode("with-project")}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                      previewMode === "with-project" ? "bg-teal text-white" : "bg-white text-muted-foreground border border-border"
                    }`}
                  >
                    With Project
                  </button>
                  <button
                    onClick={() => setPreviewMode("no-project")}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                      previewMode === "no-project" ? "bg-amber-500 text-white" : "bg-white text-muted-foreground border border-border"
                    }`}
                  >
                    No Project
                  </button>
                </div>
                {/* Email header */}
                <div className="px-5 py-3 border-b border-border space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-gray-500 w-16">From:</span>
                    <span className="text-gray-900">{activePreviewContext.senderName} &lt;{activePreviewContext.senderEmail}&gt;</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-gray-500 w-16">To:</span>
                    <span className="text-gray-900">{activePreviewContext.fullName} &lt;{activePreviewContext.email}&gt;</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-gray-500 w-16">Subject:</span>
                    <span className="text-gray-900 font-medium">{renderPreview(subjectTemplate) || "(no subject)"}</span>
                  </div>
                </div>
                {/* Rendered preview */}
                <div className="p-5">
                  <div
                    className="prose prose-sm max-w-none"
                    style={{ fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif", fontSize: "14px", lineHeight: "1.6" }}
                    dangerouslySetInnerHTML={{ __html: renderPreview(editor?.getHTML() || "") }}
                  />
                </div>
              </div>
            ) : (
              <div className="border border-t-0 border-border rounded-b-lg bg-white">
                <EditorContent editor={editor} />
                <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground flex items-center justify-between">
                  <span>
                    Drag and drop images into the editor, paste from clipboard, or click the image icon. Max 10MB per image.
                  </span>
                  <span>{wordCount} words</span>
                </div>
              </div>
            )}

            {/* ── Project fields note ── */}
            <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-600">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>Project fields</strong> (Project Name, Location, Sector) use smart fallbacks when a contact has no matched project.
                {showPreview && " Toggle 'No Project' above to see how it looks."}
              </span>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="px-6 py-3 border-t border-border bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleLoadDefault}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Load Default
            </Button>
            {templateQuery.data?.template && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={deleteMut.isPending}
                className="text-red-600 border-red-300 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete Template
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMut.isPending || !hasChanges}
              className="bg-teal hover:bg-teal/90 text-white"
            >
              {saveMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
              ) : (
                <Save className="w-4 h-4 mr-1.5" />
              )}
              Save Template
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
