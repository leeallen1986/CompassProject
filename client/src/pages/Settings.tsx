/**
 * Settings — Edit profile preferences after onboarding
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Settings as SettingsIcon, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

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

      <main className="container py-8 max-w-2xl mx-auto">
        {profile ? (
          <div className="space-y-6">
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
          </div>
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
