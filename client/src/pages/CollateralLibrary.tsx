/**
 * Collateral Library — Upload, tag, and manage product flyers, case studies, and solution briefs.
 * Sales reps upload PDFs, tag them with applications/sectors, and the platform
 * automatically matches them to relevant projects for outreach.
 */
import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation, Link } from "wouter";
import { getLoginUrl } from "@/const";
import { IMAGES } from "@/lib/images";
import {
  Upload, FileText, Tag, Search, Trash2, Edit3, Eye, Download,
  Plus, X, Check, Loader2, Filter, BarChart3, Target,
  Settings, Database, LogOut, LogIn, Sparkles, Layers,
  FileUp, Briefcase, ChevronDown, ExternalLink, Pickaxe,
  Fuel, Building, TrendingUp, Shield, Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

// ── Tag display helpers ──
const applicationLabels: Record<string, string> = {
  rc_drilling: "RC Drilling", waterwell_drilling: "Waterwell Drilling",
  diamond_drilling: "Diamond Drilling", exploration_drilling: "Exploration Drilling",
  blast_hole_drilling: "Blast Hole Drilling", tunnelling: "Tunnelling",
  shotcrete: "Shotcrete", sandblasting: "Sandblasting",
  pipeline_testing: "Pipeline Testing", pneumatic_tools: "Pneumatic Tools",
  dewatering: "Dewatering", earthworks: "Earthworks",
  construction_general: "General Construction", solar_farm: "Solar Farm",
  wind_farm: "Wind Farm", oil_gas_production: "Oil & Gas Production",
  mining_production: "Mining Production", nitrogen_generation: "Nitrogen Generation",
  power_generation: "Power Generation", lighting: "Lighting",
};

const sectorLabels: Record<string, string> = {
  mining: "Mining", oil_gas: "Oil & Gas", infrastructure: "Infrastructure",
  energy: "Energy", defence: "Defence", water: "Water", construction: "Construction",
};

const productLineLabels: Record<string, string> = {
  portable_air: "Portable Air", dewatering: "Dewatering", generators: "Generators",
  bess: "BESS", nitrogen: "Nitrogen", lighting: "Lighting", other: "Other",
};

const productLineColors: Record<string, string> = {
  portable_air: "bg-teal/15 text-teal border-teal/20",
  dewatering: "bg-blue-100 text-blue-700 border-blue-200",
  generators: "bg-amber-100 text-amber-700 border-amber-200",
  bess: "bg-emerald-100 text-emerald-700 border-emerald-200",
  nitrogen: "bg-purple-100 text-purple-700 border-purple-200",
  lighting: "bg-yellow-100 text-yellow-700 border-yellow-200",
  other: "bg-slate-100 text-slate-600 border-slate-200",
};

// ── Upload Modal ──
function UploadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [productLine, setProductLine] = useState("portable_air");
  const [applicationTags, setApplicationTags] = useState<string[]>([]);
  const [sectorTags, setSectorTags] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tagOptions = trpc.collateral.tagOptions.useQuery();
  const createMutation = trpc.collateral.create.useMutation();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (f.size > 10 * 1024 * 1024) {
        toast.error("File too large. Maximum size is 10MB.");
        return;
      }
      setFile(f);
      if (!name) setName(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    }
  };

  const toggleTag = (arr: string[], setArr: (v: string[]) => void, tag: string) => {
    setArr(arr.includes(tag) ? arr.filter(t => t !== tag) : [...arr, tag]);
  };

  const addKeyword = () => {
    const kw = keywordInput.trim().toLowerCase();
    if (kw && !keywordTags.includes(kw)) {
      setKeywordTags([...keywordTags, kw]);
      setKeywordInput("");
    }
  };

  const handleUpload = async () => {
    if (!file || !name.trim()) {
      toast.error("Please provide a name and select a file.");
      return;
    }
    if (applicationTags.length === 0) {
      toast.error("Please select at least one application tag.");
      return;
    }

    setUploading(true);
    try {
      // Read file as base64
      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        productLine,
        fileBase64: base64,
        fileName: file.name,
        fileMimeType: file.type || "application/pdf",
        fileSizeBytes: file.size,
        applicationTags,
        sectorTags,
        keywordTags,
      });

      toast.success("Collateral uploaded successfully!");
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-navy flex items-center gap-2">
            <Upload className="w-5 h-5 text-gold" /> Upload Collateral
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* File Upload */}
          <div>
            <label className="text-sm font-semibold text-navy block mb-2">File (PDF, max 10MB)</label>
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.pptx,.png,.jpg" onChange={handleFileSelect} className="hidden" />
            {file ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-slate-50">
                <FileText className="w-8 h-8 text-teal shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-navy truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  className="p-1 rounded hover:bg-slate-200 transition-colors">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()}
                className="w-full p-6 rounded-lg border-2 border-dashed border-border hover:border-gold/50 hover:bg-gold/5 transition-all text-center">
                <FileUp className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Click to select a file</p>
              </button>
            )}
          </div>

          {/* Name & Description */}
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-sm font-semibold text-navy block mb-1">Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., X1300 Portable Compressor — RC Drilling"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold" />
            </div>
            <div>
              <label className="text-sm font-semibold text-navy block mb-1">Description (optional)</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of what this collateral covers..."
                rows={2} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold resize-none" />
            </div>
          </div>

          {/* Product Line */}
          <div>
            <label className="text-sm font-semibold text-navy block mb-2">Product Line</label>
            <div className="flex flex-wrap gap-2">
              {(tagOptions.data?.productLines || []).map(pl => (
                <button key={pl.value} onClick={() => setProductLine(pl.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all border ${
                    productLine === pl.value ? "bg-navy text-white border-navy" : "bg-card text-muted-foreground border-border hover:border-navy/30"
                  }`}>
                  {pl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Application Tags */}
          <div>
            <label className="text-sm font-semibold text-navy block mb-2">
              Applications <span className="text-hot">*</span>
              <span className="text-xs font-normal text-muted-foreground ml-2">What is this product used for?</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {(tagOptions.data?.applicationTags || []).map(tag => (
                <button key={tag.value} onClick={() => toggleTag(applicationTags, setApplicationTags, tag.value)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all border ${
                    applicationTags.includes(tag.value) ? "bg-teal text-white border-teal" : "bg-card text-muted-foreground border-border hover:border-teal/30"
                  }`}>
                  {applicationTags.includes(tag.value) && <Check className="w-3 h-3 inline mr-1" />}
                  {tag.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sector Tags */}
          <div>
            <label className="text-sm font-semibold text-navy block mb-2">
              Sectors
              <span className="text-xs font-normal text-muted-foreground ml-2">Which industries is this relevant to?</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {(tagOptions.data?.sectorTags || []).map(tag => (
                <button key={tag.value} onClick={() => toggleTag(sectorTags, setSectorTags, tag.value)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all border ${
                    sectorTags.includes(tag.value) ? "bg-navy text-white border-navy" : "bg-card text-muted-foreground border-border hover:border-navy/30"
                  }`}>
                  {sectorTags.includes(tag.value) && <Check className="w-3 h-3 inline mr-1" />}
                  {tag.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Keywords */}
          <div>
            <label className="text-sm font-semibold text-navy block mb-2">
              Custom Keywords
              <span className="text-xs font-normal text-muted-foreground ml-2">Extra matching terms (e.g., "25 bar", "truck deck")</span>
            </label>
            <div className="flex gap-2 mb-2">
              <input type="text" value={keywordInput} onChange={e => setKeywordInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                placeholder="Type a keyword and press Enter..."
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold" />
              <Button onClick={addKeyword} variant="outline" size="sm" className="shrink-0">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {keywordTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {keywordTags.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/10 text-gold-dark text-[11px] font-medium border border-gold/20">
                    {kw}
                    <button onClick={() => setKeywordTags(keywordTags.filter(k => k !== kw))} className="hover:text-hot transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-border">
          <Button onClick={onClose} variant="outline" disabled={uploading}>Cancel</Button>
          <Button onClick={handleUpload} disabled={uploading || !file || !name.trim() || applicationTags.length === 0}
            className="bg-gold text-navy hover:bg-gold-light font-semibold">
            {uploading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Uploading...</> : <><Upload className="w-4 h-4 mr-2" /> Upload Collateral</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Modal ──
function EditModal({ item, onClose, onSuccess }: { item: any; onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description || "");
  const [productLine, setProductLine] = useState(item.productLine);
  const [applicationTags, setApplicationTags] = useState<string[]>(item.applicationTags || []);
  const [sectorTags, setSectorTags] = useState<string[]>(item.sectorTags || []);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>(item.keywordTags || []);
  const [saving, setSaving] = useState(false);

  const tagOptions = trpc.collateral.tagOptions.useQuery();
  const updateMutation = trpc.collateral.update.useMutation();

  const toggleTag = (arr: string[], setArr: (v: string[]) => void, tag: string) => {
    setArr(arr.includes(tag) ? arr.filter(t => t !== tag) : [...arr, tag]);
  };

  const addKeyword = () => {
    const kw = keywordInput.trim().toLowerCase();
    if (kw && !keywordTags.includes(kw)) {
      setKeywordTags([...keywordTags, kw]);
      setKeywordInput("");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateMutation.mutateAsync({
        id: item.id,
        name: name.trim(),
        description: description.trim() || undefined,
        productLine,
        applicationTags,
        sectorTags,
        keywordTags,
      });
      toast.success("Collateral updated successfully!");
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-navy flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-gold" /> Edit Collateral
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Name & Description */}
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-sm font-semibold text-navy block mb-1">Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold" />
            </div>
            <div>
              <label className="text-sm font-semibold text-navy block mb-1">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold resize-none" />
            </div>
          </div>

          {/* Product Line */}
          <div>
            <label className="text-sm font-semibold text-navy block mb-2">Product Line</label>
            <div className="flex flex-wrap gap-2">
              {(tagOptions.data?.productLines || []).map(pl => (
                <button key={pl.value} onClick={() => setProductLine(pl.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all border ${
                    productLine === pl.value ? "bg-navy text-white border-navy" : "bg-card text-muted-foreground border-border hover:border-navy/30"
                  }`}>
                  {pl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Application Tags */}
          <div>
            <label className="text-sm font-semibold text-navy block mb-2">Applications</label>
            <div className="flex flex-wrap gap-2">
              {(tagOptions.data?.applicationTags || []).map(tag => (
                <button key={tag.value} onClick={() => toggleTag(applicationTags, setApplicationTags, tag.value)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all border ${
                    applicationTags.includes(tag.value) ? "bg-teal text-white border-teal" : "bg-card text-muted-foreground border-border hover:border-teal/30"
                  }`}>
                  {applicationTags.includes(tag.value) && <Check className="w-3 h-3 inline mr-1" />}
                  {tag.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sector Tags */}
          <div>
            <label className="text-sm font-semibold text-navy block mb-2">Sectors</label>
            <div className="flex flex-wrap gap-2">
              {(tagOptions.data?.sectorTags || []).map(tag => (
                <button key={tag.value} onClick={() => toggleTag(sectorTags, setSectorTags, tag.value)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all border ${
                    sectorTags.includes(tag.value) ? "bg-navy text-white border-navy" : "bg-card text-muted-foreground border-border hover:border-navy/30"
                  }`}>
                  {sectorTags.includes(tag.value) && <Check className="w-3 h-3 inline mr-1" />}
                  {tag.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Keywords */}
          <div>
            <label className="text-sm font-semibold text-navy block mb-2">Custom Keywords</label>
            <div className="flex gap-2 mb-2">
              <input type="text" value={keywordInput} onChange={e => setKeywordInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                placeholder="Type a keyword and press Enter..."
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold" />
              <Button onClick={addKeyword} variant="outline" size="sm" className="shrink-0">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {keywordTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {keywordTags.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/10 text-gold-dark text-[11px] font-medium border border-gold/20">
                    {kw}
                    <button onClick={() => setKeywordTags(keywordTags.filter(k => k !== kw))} className="hover:text-hot transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-border">
          <Button onClick={onClose} variant="outline" disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}
            className="bg-gold text-navy hover:bg-gold-light font-semibold">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving...</> : <><Check className="w-4 h-4 mr-2" /> Save Changes</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Collateral Card ──
function CollateralCard({ item, onEdit, onDelete }: { item: any; onEdit: () => void; onDelete: () => void }) {
  const [, navigate] = useLocation();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to remove this collateral?")) return;
    setDeleting(true);
    onDelete();
  };

  return (
    <Card className="hover:shadow-md transition-shadow group">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* File icon / thumbnail */}
          <div className="w-12 h-14 rounded-lg bg-navy/5 border border-border flex items-center justify-center shrink-0">
            <FileText className="w-6 h-6 text-navy/40" />
          </div>

          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-navy truncate">{item.name}</h3>
                {item.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={onEdit} className="p-1.5 rounded hover:bg-slate-100 transition-colors" title="Edit">
                  <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-slate-100 transition-colors" title="View PDF">
                  <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                </a>
                <button onClick={handleDelete} disabled={deleting} className="p-1.5 rounded hover:bg-red-50 transition-colors" title="Remove">
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-hot" />
                </button>
              </div>
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-1 mt-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${productLineColors[item.productLine] || productLineColors.other}`}>
                {productLineLabels[item.productLine] || item.productLine}
              </span>
              {(item.applicationTags || []).slice(0, 3).map((tag: string) => (
                <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal/8 text-teal border border-teal/15">
                  {applicationLabels[tag] || tag}
                </span>
              ))}
              {(item.applicationTags || []).length > 3 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">
                  +{item.applicationTags.length - 3} more
                </span>
              )}
            </div>

            {/* Sector tags */}
            {(item.sectorTags || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {(item.sectorTags || []).map((tag: string) => (
                  <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-navy/5 text-navy/60 border border-navy/10">
                    {sectorLabels[tag] || tag}
                  </span>
                ))}
              </div>
            )}

            {/* Custom keywords */}
            {(item.keywordTags || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {(item.keywordTags || []).map((kw: string) => (
                  <span key={kw} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gold/8 text-gold-dark border border-gold/15">
                    {kw}
                  </span>
                ))}
              </div>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              <span>{item.fileName} ({item.fileSizeBytes ? (item.fileSizeBytes / 1024).toFixed(0) + " KB" : "—"})</span>
              <span>Uploaded by {item.uploadedByName || "Unknown"}</span>
              <span>{new Date(item.createdAt).toLocaleDateString()}</span>
              {item.matchCount > 0 && (
                <button
                  onClick={() => navigate(`/dashboard?collateralId=${item.id}`)}
                  className="text-teal font-medium hover:text-teal/80 hover:underline cursor-pointer transition-colors"
                  title="View matched projects"
                >
                  {item.matchCount} project matches
                </button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──
export default function CollateralLibrary() {
  const { user, loading: authLoading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const [showUpload, setShowUpload] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [filterProductLine, setFilterProductLine] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const collateralList = trpc.collateral.list.useQuery(
    filterProductLine !== "all" ? { productLine: filterProductLine } : undefined
  );
  const stats = trpc.collateral.stats.useQuery();
  const deleteMutation = trpc.collateral.delete.useMutation();
  const utils = trpc.useUtils();

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success("Collateral removed.");
      utils.collateral.list.invalidate();
      utils.collateral.stats.invalidate();
    } catch (err: any) {
      toast.error(err.message || "Delete failed.");
    }
  };

  const filteredItems = (collateralList.data || []).filter(item => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      (item.description || "").toLowerCase().includes(q) ||
      (item.applicationTags || []).some(t => (applicationLabels[t] || t).toLowerCase().includes(q)) ||
      (item.keywordTags || []).some(k => k.toLowerCase().includes(q))
    );
  });

  // Auth guard
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gold" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <Layers className="w-12 h-12 text-gold mx-auto mb-4" />
            <h2 className="text-xl font-bold text-navy mb-2">Sign In Required</h2>
            <p className="text-sm text-muted-foreground mb-4">Please sign in to access the Collateral Library.</p>
            <a href="/login" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gold text-navy font-semibold hover:bg-gold-light transition-colors">
              <LogIn className="w-4 h-4" /> Sign In
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={IMAGES.heroBanner} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-navy/95 via-navy/85 to-navy/70" />
        </div>
        <div className="relative container py-6 sm:py-8">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white tracking-tight flex items-center gap-3">
                <Layers className="w-7 h-7 text-gold" /> Collateral Library
              </h1>
              <p className="text-sm text-slate-300 mt-1">
                Upload product flyers, case studies, and solution briefs. The platform automatically matches them to relevant projects for outreach.
              </p>
            </div>
            <div className="text-right flex flex-col items-end gap-2">
              <div className="text-xl sm:text-2xl font-bold text-gold tracking-wider">ATLAS COPCO</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-slate-400">{user?.name || user?.email}</span>
                <Link href="/" className="text-xs text-gold hover:text-gold-light flex items-center gap-1 transition-colors">
                  <Zap className="w-3 h-3" /> This Week
                </Link>
                <span className="text-slate-600">|</span>
                <Link href="/dashboard" className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                  <BarChart3 className="w-3 h-3" /> Dashboard
                </Link>
                <span className="text-slate-600">|</span>
                <Link href="/pipeline" className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                  <Target className="w-3 h-3" /> Pipeline
                </Link>
                <span className="text-slate-600">|</span>
                <button onClick={() => navigate("/settings")} className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                  <Settings className="w-3 h-3" /> Settings
                </button>
                <span className="text-slate-600">|</span>
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
        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-2xl font-bold text-navy">{stats.data?.activeItems || 0}</div>
            <div className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wider">Active Items</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-2xl font-bold text-teal">{stats.data?.totalMatches || 0}</div>
            <div className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wider">Project Matches</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-2xl font-bold text-gold">{stats.data?.byProductLine?.portable_air || 0}</div>
            <div className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wider">Portable Air</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="text-2xl font-bold text-navy">
              {Object.entries(stats.data?.byProductLine || {}).filter(([k]) => k !== "portable_air").reduce((sum, [, v]) => sum + (v as number), 0)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wider">Other Products</div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search collateral..."
                className="pl-9 pr-4 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold w-64" />
            </div>
            {/* Product Line Filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-4 h-4 text-muted-foreground" />
              {[{ value: "all", label: "All" }, ...Object.entries(productLineLabels).map(([v, l]) => ({ value: v, label: l }))].map(pl => (
                <button key={pl.value} onClick={() => setFilterProductLine(pl.value)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    filterProductLine === pl.value ? "bg-navy text-white" : "bg-card text-muted-foreground border border-border hover:border-navy/30"
                  }`}>
                  {pl.label}
                </button>
              ))}
            </div>
          </div>

          <Button onClick={() => setShowUpload(true)} className="bg-gold text-navy hover:bg-gold-light font-semibold">
            <Plus className="w-4 h-4 mr-2" /> Upload Collateral
          </Button>
        </div>

        {/* Collateral Grid */}
        {collateralList.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-gold" />
          </div>
        ) : filteredItems.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Layers className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-navy mb-2">
                {searchQuery || filterProductLine !== "all" ? "No matching collateral found" : "No collateral uploaded yet"}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {searchQuery || filterProductLine !== "all"
                  ? "Try adjusting your search or filter."
                  : "Upload your first product flyer, case study, or solution brief to get started."}
              </p>
              {!searchQuery && filterProductLine === "all" && (
                <Button onClick={() => setShowUpload(true)} className="bg-gold text-navy hover:bg-gold-light font-semibold">
                  <Plus className="w-4 h-4 mr-2" /> Upload Your First Collateral
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filteredItems.map(item => (
              <CollateralCard
                key={item.id}
                item={item}
                onEdit={() => setEditItem(item)}
                onDelete={() => handleDelete(item.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Modals */}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={() => { utils.collateral.list.invalidate(); utils.collateral.stats.invalidate(); }}
        />
      )}
      {editItem && (
        <EditModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSuccess={() => { utils.collateral.list.invalidate(); utils.collateral.stats.invalidate(); }}
        />
      )}
    </div>
  );
}
