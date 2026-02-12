/**
 * Settings — Edit profile preferences and notification settings
 */
import { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  Loader2, ArrowLeft, Settings as SettingsIcon, Save, Mail, Bell, BellOff,
  Clock, Filter, Users, BarChart3, CheckCircle2, AlertCircle, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Frequency = "weekly" | "fortnightly" | "daily" | "none";

const frequencyOptions: { value: Frequency; label: string; description: string; icon: React.ReactNode }[] = [
  { value: "daily", label: "Daily", description: "Every weekday at 4pm AEST", icon: <Clock className="w-4 h-4" /> },
  { value: "weekly", label: "Weekly", description: "Every Monday at 4pm AEST", icon: <Clock className="w-4 h-4" /> },
  { value: "fortnightly", label: "Fortnightly", description: "Every other Monday at 4pm AEST", icon: <Clock className="w-4 h-4" /> },
  { value: "none", label: "Off", description: "No digest notifications", icon: <BellOff className="w-4 h-4" /> },
];

function NotificationPreferencesSection() {
  const { data: prefs, isLoading } = trpc.emailDigest.get.useQuery();
  const utils = trpc.useUtils();
  const updatePrefs = trpc.emailDigest.update.useMutation({
    onSuccess: () => {
      utils.emailDigest.get.invalidate();
      toast.success("Notification preferences saved");
    },
    onError: () => toast.error("Failed to update preferences"),
  });

  const [enabled, setEnabled] = useState(true);
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [includeHotOnly, setIncludeHotOnly] = useState(false);
  const [includeContacts, setIncludeContacts] = useState(true);
  const [includePipelineUpdates, setIncludePipelineUpdates] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (prefs) {
      setEnabled(prefs.enabled);
      setFrequency(prefs.frequency as Frequency);
      setIncludeHotOnly(prefs.includeHotOnly);
      setIncludeContacts(prefs.includeContacts);
      setIncludePipelineUpdates(prefs.includePipelineUpdates);
      setHasChanges(false);
    }
  }, [prefs]);

  const handleChange = <T,>(setter: (v: T) => void, value: T) => {
    setter(value);
    setHasChanges(true);
  };

  const handleSave = () => {
    updatePrefs.mutate({ enabled, frequency, includeHotOnly, includeContacts, includePipelineUpdates });
    setHasChanges(false);
  };

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-gold mx-auto my-4" />;

  const lastSentDate = prefs?.lastSentAt ? new Date(prefs.lastSentAt) : null;
  const effectiveEnabled = enabled && frequency !== "none";

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Section Header */}
      <div className="bg-navy/5 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${effectiveEnabled ? "bg-teal/15" : "bg-slate-200"}`}>
              {effectiveEnabled ? <Bell className="w-5 h-5 text-teal" /> : <BellOff className="w-5 h-5 text-muted-foreground" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-navy">Notification Preferences</h2>
              <p className="text-xs text-muted-foreground">
                Control how and when you receive intelligence digest notifications
              </p>
            </div>
          </div>
          {effectiveEnabled && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal/10 text-teal text-[11px] font-semibold">
              <CheckCircle2 className="w-3 h-3" /> Active
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Master Toggle */}
        <div className="flex items-center justify-between py-3 px-4 rounded-lg bg-background border border-border">
          <div>
            <p className="text-sm font-semibold text-navy">Intelligence Digest</p>
            <p className="text-xs text-muted-foreground">
              Personalized project matches delivered to your Manus notifications
            </p>
          </div>
          <button
            onClick={() => handleChange(setEnabled, !enabled)}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-gold/40 ${enabled ? "bg-teal" : "bg-slate-300"}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {enabled && (
          <>
            {/* Frequency Selection */}
            <div>
              <p className="text-sm font-semibold text-navy mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-gold" /> Delivery Frequency
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {frequencyOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleChange(setFrequency, opt.value)}
                    className={`relative flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center ${
                      frequency === opt.value
                        ? "border-navy bg-navy/5 shadow-sm"
                        : "border-border bg-background hover:border-navy/30"
                    }`}
                  >
                    <div className={`${frequency === opt.value ? "text-navy" : "text-muted-foreground"}`}>
                      {opt.icon}
                    </div>
                    <span className={`text-xs font-bold ${frequency === opt.value ? "text-navy" : "text-foreground/70"}`}>
                      {opt.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {opt.description}
                    </span>
                    {frequency === opt.value && (
                      <div className="absolute top-1.5 right-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-navy" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {frequency !== "none" && (
              <>
                {/* Content Filters */}
                <div>
                  <p className="text-sm font-semibold text-navy mb-3 flex items-center gap-2">
                    <Filter className="w-4 h-4 text-gold" /> Digest Content
                  </p>
                  <div className="space-y-1">
                    <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-background transition-colors cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={includeHotOnly}
                        onChange={e => handleChange(setIncludeHotOnly, e.target.checked)}
                        className="rounded border-border text-navy focus:ring-gold h-4 w-4"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-foreground/90 group-hover:text-navy transition-colors">
                          Hot projects only
                        </span>
                        <p className="text-[11px] text-muted-foreground">
                          Only include high-priority projects (excludes warm and cold)
                        </p>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-hot text-white">Hot</span>
                    </label>

                    <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-background transition-colors cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={includeContacts}
                        onChange={e => handleChange(setIncludeContacts, e.target.checked)}
                        className="rounded border-border text-navy focus:ring-gold h-4 w-4"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-foreground/90 group-hover:text-navy transition-colors">
                          Include key contacts
                        </span>
                        <p className="text-[11px] text-muted-foreground">
                          Show top 5 relevant contacts with emails and roles
                        </p>
                      </div>
                      <Users className="w-4 h-4 text-muted-foreground" />
                    </label>

                    <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-background transition-colors cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={includePipelineUpdates}
                        onChange={e => handleChange(setIncludePipelineUpdates, e.target.checked)}
                        className="rounded border-border text-navy focus:ring-gold h-4 w-4"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-foreground/90 group-hover:text-navy transition-colors">
                          Include pipeline updates
                        </span>
                        <p className="text-[11px] text-muted-foreground">
                          Show your active pipeline claim count and status changes
                        </p>
                      </div>
                      <BarChart3 className="w-4 h-4 text-muted-foreground" />
                    </label>
                  </div>
                </div>

                {/* Info Box */}
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-gold/8 border border-gold/20">
                  <Info className="w-4 h-4 text-gold shrink-0 mt-0.5" />
                  <div className="text-xs text-foreground/70 leading-relaxed">
                    <p>
                      Digests are personalized based on your profile preferences (territory, industries, offer categories).
                      Projects are scored and ranked by relevance — only matches above 40% are included.
                    </p>
                    {lastSentDate && (
                      <p className="mt-1.5 font-medium text-navy">
                        Last digest sent: {lastSentDate.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Save Button */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={handleSave}
            disabled={updatePrefs.isPending || !hasChanges}
            className="bg-gold hover:bg-gold-light text-navy font-semibold gap-1.5"
          >
            {updatePrefs.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Preferences
          </Button>
          {hasChanges && (
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Unsaved changes
            </span>
          )}
        </div>
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
    window.location.href = "/login";
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
                <SettingsIcon className="w-5 h-5 text-gold" /> Settings
              </h1>
              <p className="text-xs text-slate-400">Manage your profile and notification preferences</p>
            </div>
          </div>
          <span className="text-gold font-bold text-sm tracking-wider">ATLAS COPCO</span>
        </div>
      </header>

      <main className="container py-8 max-w-2xl mx-auto space-y-6">
        {profile ? (
          <>
            {/* Profile Summary */}
            <div className="bg-card rounded-lg border border-border p-5">
              <h2 className="text-base font-bold text-navy mb-3 flex items-center gap-2">
                <Users className="w-5 h-5 text-gold" /> Your Profile
              </h2>
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
              <div className="mt-4 flex gap-3">
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
            </div>

            {/* Notification Preferences */}
            <NotificationPreferencesSection />
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
