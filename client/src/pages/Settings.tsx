/**
 * Settings — Edit profile preferences and email digest settings
 */
import { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Settings as SettingsIcon, Save, Mail, Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";

function EmailDigestSection() {
  const { data: prefs, isLoading } = trpc.emailDigest.get.useQuery();
  const utils = trpc.useUtils();
  const updatePrefs = trpc.emailDigest.update.useMutation({
    onSuccess: () => {
      utils.emailDigest.get.invalidate();
      toast.success("Email preferences updated");
    },
    onError: () => toast.error("Failed to update preferences"),
  });

  const [enabled, setEnabled] = useState(true);
  const [frequency, setFrequency] = useState<"weekly" | "daily" | "none">("weekly");
  const [includeHotOnly, setIncludeHotOnly] = useState(false);
  const [includeContacts, setIncludeContacts] = useState(true);
  const [includePipelineUpdates, setIncludePipelineUpdates] = useState(true);

  useEffect(() => {
    if (prefs) {
      setEnabled(prefs.enabled);
      setFrequency(prefs.frequency as "weekly" | "daily" | "none");
      setIncludeHotOnly(prefs.includeHotOnly);
      setIncludeContacts(prefs.includeContacts);
      setIncludePipelineUpdates(prefs.includePipelineUpdates);
    }
  }, [prefs]);

  const handleSave = () => {
    updatePrefs.mutate({ enabled, frequency, includeHotOnly, includeContacts, includePipelineUpdates });
  };

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-gold mx-auto my-4" />;

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <h2 className="text-base font-bold text-navy mb-1 flex items-center gap-2">
        <Mail className="w-5 h-5 text-gold" /> Email Digest Preferences
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Receive personalized intelligence summaries filtered to your profile preferences.
      </p>

      <div className="space-y-4">
        {/* Enable / Disable */}
        <div className="flex items-center justify-between py-2 border-b border-border">
          <div>
            <p className="text-sm font-medium text-navy">Email Notifications</p>
            <p className="text-xs text-muted-foreground">Receive intelligence digest emails</p>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? "bg-teal" : "bg-slate-300"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {enabled && (
          <>
            {/* Frequency */}
            <div className="py-2 border-b border-border">
              <p className="text-sm font-medium text-navy mb-2">Frequency</p>
              <div className="flex gap-2">
                {(["weekly", "daily"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFrequency(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${frequency === f ? "bg-navy text-white" : "bg-slate-100 text-muted-foreground border border-border hover:border-navy/30"}`}
                  >
                    {f === "weekly" ? "Weekly (Monday)" : "Daily"}
                  </button>
                ))}
              </div>
            </div>

            {/* Content Options */}
            <div className="py-2 border-b border-border">
              <p className="text-sm font-medium text-navy mb-2">Content</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={includeHotOnly} onChange={e => setIncludeHotOnly(e.target.checked)}
                    className="rounded border-border text-navy focus:ring-gold" />
                  <span className="text-sm text-foreground/80">Hot projects only (exclude warm/cold)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={includeContacts} onChange={e => setIncludeContacts(e.target.checked)}
                    className="rounded border-border text-navy focus:ring-gold" />
                  <span className="text-sm text-foreground/80">Include key contacts</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={includePipelineUpdates} onChange={e => setIncludePipelineUpdates(e.target.checked)}
                    className="rounded border-border text-navy focus:ring-gold" />
                  <span className="text-sm text-foreground/80">Include my pipeline updates</span>
                </label>
              </div>
            </div>
          </>
        )}

        <Button onClick={handleSave} disabled={updatePrefs.isPending} className="bg-gold hover:bg-gold-light text-navy font-semibold gap-1.5">
          {updatePrefs.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Email Preferences
        </Button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { data: profile, isLoading: profileLoading } = trpc.profile.get.useQuery();

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-gold" />
      </div>
    );
  }

  if (!user) {
    window.location.href = getLoginUrl("/settings");
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-white py-4">
        <div className="container flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate("/")} className="text-white hover:bg-navy-light p-2">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <SettingsIcon className="w-5 h-5 text-gold" /> Profile Settings
              </h1>
              <p className="text-xs text-slate-400">Update your intelligence preferences</p>
            </div>
          </div>
          <span className="text-gold font-bold text-sm tracking-wider">ATLAS COPCO</span>
        </div>
      </header>

      <main className="container py-8 max-w-2xl mx-auto space-y-6">
        {profile ? (
          <>
            <div className="bg-card rounded-lg border border-border p-5">
              <h2 className="text-base font-bold text-navy mb-3">Current Profile</h2>
              <div className="divide-y divide-border">
                {profile.companyName && (
                  <div className="py-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Company</p>
                    <p className="text-sm font-medium text-navy">{profile.companyName}</p>
                  </div>
                )}
                {profile.territories && (
                  <div className="py-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Territories</p>
                    <p className="text-sm font-medium text-navy">{(profile.territories as string[]).join(", ")}</p>
                  </div>
                )}
                {profile.industries && (
                  <div className="py-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Industries</p>
                    <p className="text-sm font-medium text-navy">{(profile.industries as string[]).join(", ")}</p>
                  </div>
                )}
                {profile.offerCategories && (
                  <div className="py-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Offer Categories</p>
                    <p className="text-sm font-medium text-navy">{(profile.offerCategories as string[]).join(", ")}</p>
                  </div>
                )}
                {profile.customerTypes && (
                  <div className="py-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Customer Types</p>
                    <p className="text-sm font-medium text-navy">{(profile.customerTypes as string[]).join(", ")}</p>
                  </div>
                )}
                {profile.buyerRoles && (
                  <div className="py-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Buyer Roles</p>
                    <p className="text-sm font-medium text-navy">{(profile.buyerRoles as string[]).join(", ")}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={() => navigate("/onboarding")}
                className="bg-navy hover:bg-navy-light text-white gap-1.5"
              >
                <Save className="w-4 h-4" /> Re-run Setup Wizard
              </Button>
              <Button variant="outline" onClick={() => navigate("/")}>
                Back to Dashboard
              </Button>
            </div>

            {/* Email Digest Section */}
            <EmailDigestSection />
          </>
        ) : (
          <div className="bg-card rounded-lg border border-border p-8 text-center">
            <p className="text-muted-foreground mb-4">You haven't set up your profile yet.</p>
            <Button onClick={() => navigate("/onboarding")} className="bg-gold hover:bg-gold-light text-navy font-bold">
              Start Setup Wizard
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
