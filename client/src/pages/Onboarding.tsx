/**
 * Onboarding Wizard — 6-screen "Lead Fit" setup
 * Collects user preferences to personalize the intelligence dashboard.
 * Design: Nordic Industrial Precision, mostly click-based, under 90 seconds.
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  MapPin, Package, Users, DollarSign, UserCheck, Building,
  ChevronRight, ChevronLeft, Check, Sparkles, Globe, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IMAGES } from "@/lib/images";

// ── Option data ──

const TERRITORIES = [
  { id: "WA", label: "Western Australia", short: "WA" },
  { id: "NT", label: "Northern Territory", short: "NT" },
  { id: "QLD", label: "Queensland", short: "QLD" },
  { id: "NSW", label: "New South Wales", short: "NSW" },
  { id: "VIC", label: "Victoria", short: "VIC" },
  { id: "SA", label: "South Australia", short: "SA" },
  { id: "TAS", label: "Tasmania", short: "TAS" },
  { id: "ACT", label: "ACT", short: "ACT" },
  { id: "NATIONAL", label: "National / All States", short: "ALL" },
];

const INDUSTRIES = [
  { id: "mining_exploration", label: "Mining — Exploration", group: "Mining" },
  { id: "mining_development", label: "Mining — Development", group: "Mining" },
  { id: "mining_production", label: "Mining — Production", group: "Mining" },
  { id: "mining_shutdown", label: "Mining — Shutdown/MRO", group: "Mining" },
  { id: "mining_contractors", label: "Mining — Contractors", group: "Mining" },
  { id: "construction_civil", label: "Construction — Civil", group: "Construction" },
  { id: "construction_commercial", label: "Construction — Commercial", group: "Construction" },
  { id: "construction_residential", label: "Construction — Residential", group: "Construction" },
  { id: "construction_utilities", label: "Construction — Utilities", group: "Construction" },
  { id: "energy_oil_gas", label: "Energy — Oil & Gas", group: "Energy" },
  { id: "energy_renewables", label: "Energy — Renewables", group: "Energy" },
  { id: "energy_powergen", label: "Energy — Power Generation", group: "Energy" },
  { id: "energy_transmission", label: "Energy — Transmission", group: "Energy" },
  { id: "infrastructure_roads", label: "Infrastructure — Roads", group: "Infrastructure" },
  { id: "infrastructure_rail", label: "Infrastructure — Rail", group: "Infrastructure" },
  { id: "infrastructure_ports", label: "Infrastructure — Ports", group: "Infrastructure" },
  { id: "infrastructure_water", label: "Infrastructure — Water", group: "Infrastructure" },
  { id: "defence", label: "Defence", group: "Other" },
];

const OFFER_CATEGORIES = [
  { id: "equipment", label: "Equipment (purchase)", icon: "🏗️" },
  { id: "rentals", label: "Rentals / Hire", icon: "🔄" },
  { id: "consumables", label: "Consumables & Parts", icon: "🔧" },
  { id: "services", label: "Services & Maintenance", icon: "⚙️" },
  { id: "engineering", label: "Engineering & Design", icon: "📐" },
  { id: "software", label: "Software / Digital", icon: "💻" },
];

const CUSTOMER_TYPES = [
  { id: "owner_operator", label: "Owner / Operator" },
  { id: "epcm", label: "EPCM" },
  { id: "principal_contractor", label: "Principal Contractor" },
  { id: "specialist_contractor", label: "Specialist Contractor" },
  { id: "government", label: "Government" },
  { id: "rental_company", label: "Rental Company" },
  { id: "oem", label: "OEM" },
];

const DEAL_SIZES = [
  { id: "under_25k", label: "< $25k" },
  { id: "25k_100k", label: "$25k – $100k" },
  { id: "100k_500k", label: "$100k – $500k" },
  { id: "500k_plus", label: "$500k+" },
];

const STAGE_TIMINGS = [
  { id: "early_signal", label: "Early Signal / Pre-tender", desc: "Get ahead of the market" },
  { id: "tender_live", label: "Tender Live / Procurement Active", desc: "Active buying window" },
  { id: "awarded_mobilizing", label: "Awarded / Mobilizing", desc: "Confirmed work, ready to supply" },
];

const BUYER_ROLES = [
  { id: "procurement", label: "Procurement / Category" },
  { id: "project_manager", label: "Project Manager / Director" },
  { id: "engineering", label: "Engineering" },
  { id: "maintenance_shutdown", label: "Maintenance / Shutdown" },
  { id: "operations_site", label: "Operations / Site" },
  { id: "hse_esg", label: "HSE / ESG" },
  { id: "fleet_manager", label: "Fleet Manager" },
  { id: "commercial", label: "Commercial / Contracts" },
];

// ── Chip component ──

function Chip({
  selected, label, onClick, icon,
}: {
  selected: boolean; label: string; onClick: () => void; icon?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${
        selected
          ? "bg-navy text-white border-navy shadow-sm"
          : "bg-card text-foreground/80 border-border hover:border-navy/30 hover:bg-slate-50"
      }`}
    >
      {icon && <span className="mr-1.5">{icon}</span>}
      {label}
      {selected && <Check className="inline-block w-3.5 h-3.5 ml-1.5 -mt-0.5" />}
    </button>
  );
}

// ── Progress bar ──

function ProgressBar({ step, total }: { step: number; total: number }) {
  const pct = ((step + 1) / total) * 100;
  return (
    <div className="w-full bg-slate-200 rounded-full h-1.5 mb-6">
      <div
        className="bg-gold h-1.5 rounded-full transition-all duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Main component ──

export default function Onboarding() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);

  // Form state
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [territories, setTerritories] = useState<string[]>([]);
  const [remoteMetro, setRemoteMetro] = useState("both");
  const [industries, setIndustries] = useState<string[]>([]);
  const [offerCategories, setOfferCategories] = useState<string[]>([]);
  const [customerTypes, setCustomerTypes] = useState<string[]>([]);
  const [dealSizes, setDealSizes] = useState<string[]>([]);
  const [stageTiming, setStageTiming] = useState<string[]>([]);
  const [buyerRoles, setBuyerRoles] = useState<string[]>([]);
  const [keyAccountsText, setKeyAccountsText] = useState("");
  const [excludeAccountsText, setExcludeAccountsText] = useState("");

  const updateProfile = trpc.profile.update.useMutation();
  const completeOnboarding = trpc.profile.completeOnboarding.useMutation();

  const TOTAL_STEPS = 6;

  const toggleItem = (arr: string[], setArr: (v: string[]) => void, id: string) => {
    setArr(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  };

  const canProceed = useMemo(() => {
    switch (step) {
      case 0: return territories.length > 0 && industries.length > 0;
      case 1: return offerCategories.length > 0 && customerTypes.length > 0;
      case 2: return dealSizes.length > 0 && stageTiming.length > 0;
      case 3: return buyerRoles.length >= 1;
      case 4: return true; // optional
      case 5: return true; // confirmation
      default: return false;
    }
  }, [step, territories, industries, offerCategories, customerTypes, dealSizes, stageTiming, buyerRoles]);

  const saveCurrentStep = async () => {
    try {
      switch (step) {
        case 0:
          await updateProfile.mutateAsync({
            companyName: companyName || undefined,
            companyWebsite: companyWebsite || undefined,
            territories,
            remoteMetroOnly: remoteMetro,
            industries,
          });
          break;
        case 1:
          await updateProfile.mutateAsync({ offerCategories, customerTypes });
          break;
        case 2:
          await updateProfile.mutateAsync({
            dealSizeMin: dealSizes[0],
            dealSizeMax: dealSizes[dealSizes.length - 1],
            stageTiming,
          });
          break;
        case 3:
          await updateProfile.mutateAsync({ buyerRoles });
          break;
        case 4:
          await updateProfile.mutateAsync({
            keyAccounts: keyAccountsText ? keyAccountsText.split("\n").map(s => s.trim()).filter(Boolean) : [],
            excludeAccounts: excludeAccountsText ? excludeAccountsText.split("\n").map(s => s.trim()).filter(Boolean) : [],
          });
          break;
      }
    } catch {
      toast.error("Failed to save preferences. Please try again.");
    }
  };

  const handleNext = async () => {
    await saveCurrentStep();
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleFinish = async () => {
    try {
      await saveCurrentStep();
      await completeOnboarding.mutateAsync();
      toast.success("Profile setup complete! Loading your personalized dashboard...");
      setTimeout(() => navigate("/"), 1000);
    } catch {
      toast.error("Failed to complete setup. Please try again.");
    }
  };

  // Auth guard
  if (authLoading) {
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

  // ── Industry groups for rendering ──
  const industryGroups = INDUSTRIES.reduce<Record<string, typeof INDUSTRIES>>((acc, ind) => {
    if (!acc[ind.group]) acc[ind.group] = [];
    acc[ind.group].push(ind);
    return acc;
  }, {});

  // ── Summary for Screen 6 ──
  const summaryTerritories = territories.map(t => TERRITORIES.find(x => x.id === t)?.short || t).join(", ");
  const summaryIndustries = industries.map(i => INDUSTRIES.find(x => x.id === i)?.label || i).join(", ");
  const summaryOffers = offerCategories.map(o => OFFER_CATEGORIES.find(x => x.id === o)?.label || o).join(", ");
  const summaryCustomers = customerTypes.map(c => CUSTOMER_TYPES.find(x => x.id === c)?.label || c).join(", ");
  const summaryDealSize = dealSizes.map(d => DEAL_SIZES.find(x => x.id === d)?.label || d).join(", ");
  const summaryStage = stageTiming.map(s => STAGE_TIMINGS.find(x => x.id === s)?.label || s).join(", ");
  const summaryRoles = buyerRoles.map(r => BUYER_ROLES.find(x => x.id === r)?.label || r).join(", ");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-navy text-white py-4">
        <div className="container flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Atlas Copco Intelligence</h1>
            <p className="text-xs text-slate-400">Personalization Setup</p>
          </div>
          <div className="text-right">
            <span className="text-gold font-bold text-sm tracking-wider">ATLAS COPCO</span>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-2xl mx-auto">
        <ProgressBar step={step} total={TOTAL_STEPS} />

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.25 }}
          >
            {/* ===== SCREEN 1: Territory + Industries ===== */}
            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin className="w-5 h-5 text-gold" />
                    <h2 className="text-xl font-bold text-navy">Where do you operate?</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">Select the states/territories you can service. This filters out irrelevant projects.</p>
                </div>

                {/* Company info (optional, quick) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-1 block">Company Name (optional)</label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      placeholder="e.g. Atlas Copco Power Technique"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-1 block">Company Website (optional)</label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="url"
                        value={companyWebsite}
                        onChange={e => setCompanyWebsite(e.target.value)}
                        placeholder="https://www.atlascopco.com"
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                      />
                    </div>
                  </div>
                </div>

                {/* Territories */}
                <div>
                  <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-2 block">Service Territories</label>
                  <div className="flex flex-wrap gap-2">
                    {TERRITORIES.map(t => (
                      <Chip
                        key={t.id}
                        label={t.short === "ALL" ? t.label : `${t.short} — ${t.label}`}
                        selected={territories.includes(t.id)}
                        onClick={() => {
                          if (t.id === "NATIONAL") {
                            setTerritories(territories.includes("NATIONAL") ? [] : ["NATIONAL"]);
                          } else {
                            const newTerr = territories.filter(x => x !== "NATIONAL");
                            toggleItem(newTerr.includes(t.id) ? newTerr : [...newTerr], setTerritories, t.id);
                            setTerritories(
                              newTerr.includes(t.id)
                                ? newTerr.filter(x => x !== t.id)
                                : [...newTerr, t.id]
                            );
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Remote/Metro */}
                <div>
                  <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-2 block">Location Preference</label>
                  <div className="flex gap-2">
                    {[
                      { id: "remote", label: "Remote / Regional Only" },
                      { id: "metro", label: "Metro Only" },
                      { id: "both", label: "Both" },
                    ].map(opt => (
                      <Chip key={opt.id} label={opt.label} selected={remoteMetro === opt.id} onClick={() => setRemoteMetro(opt.id)} />
                    ))}
                  </div>
                </div>

                {/* Industries */}
                <div>
                  <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-2 block">Target Industries (pick your top 2-3)</label>
                  {Object.entries(industryGroups).map(([group, items]) => (
                    <div key={group} className="mb-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">{group}</p>
                      <div className="flex flex-wrap gap-2">
                        {items.map(ind => (
                          <Chip key={ind.id} label={ind.label.replace(`${group} — `, "")} selected={industries.includes(ind.id)} onClick={() => toggleItem(industries, setIndustries, ind.id)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== SCREEN 2: Offer Category + Customer Type ===== */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-5 h-5 text-gold" />
                    <h2 className="text-xl font-bold text-navy">What do you sell?</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">Select your offer categories and target customer types.</p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-2 block">Offer Categories (pick up to 3)</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {OFFER_CATEGORIES.map(cat => (
                      <Chip key={cat.id} label={cat.label} icon={cat.icon} selected={offerCategories.includes(cat.id)} onClick={() => toggleItem(offerCategories, setOfferCategories, cat.id)} />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-2 block">Who do you sell to?</label>
                  <div className="flex flex-wrap gap-2">
                    {CUSTOMER_TYPES.map(ct => (
                      <Chip key={ct.id} label={ct.label} selected={customerTypes.includes(ct.id)} onClick={() => toggleItem(customerTypes, setCustomerTypes, ct.id)} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ===== SCREEN 3: Deal Size + Stage Timing ===== */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-5 h-5 text-gold" />
                    <h2 className="text-xl font-bold text-navy">Opportunity Preferences</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">What size deals matter to you, and when do you want to engage?</p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-2 block">Typical Contract Band</label>
                  <div className="flex flex-wrap gap-2">
                    {DEAL_SIZES.map(ds => (
                      <Chip key={ds.id} label={ds.label} selected={dealSizes.includes(ds.id)} onClick={() => toggleItem(dealSizes, setDealSizes, ds.id)} />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-2 block">When do you want to engage?</label>
                  <div className="space-y-2">
                    {STAGE_TIMINGS.map(st => (
                      <button
                        key={st.id}
                        onClick={() => toggleItem(stageTiming, setStageTiming, st.id)}
                        className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                          stageTiming.includes(st.id)
                            ? "bg-navy text-white border-navy"
                            : "bg-card text-foreground/80 border-border hover:border-navy/30"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold">{st.label}</p>
                            <p className={`text-xs mt-0.5 ${stageTiming.includes(st.id) ? "text-slate-300" : "text-muted-foreground"}`}>{st.desc}</p>
                          </div>
                          {stageTiming.includes(st.id) && <Check className="w-4 h-4 text-gold" />}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ===== SCREEN 4: Contact Roles ===== */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <UserCheck className="w-5 h-5 text-gold" />
                    <h2 className="text-xl font-bold text-navy">Buyer Roles to Map</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">Which roles do you want us to find contacts for? Pick 3-5 that matter most.</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {BUYER_ROLES.map(role => (
                    <Chip key={role.id} label={role.label} selected={buyerRoles.includes(role.id)} onClick={() => toggleItem(buyerRoles, setBuyerRoles, role.id)} />
                  ))}
                </div>
              </div>
            )}

            {/* ===== SCREEN 5: Key Accounts (Optional) ===== */}
            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Building className="w-5 h-5 text-gold" />
                    <h2 className="text-xl font-bold text-navy">Key Accounts (Optional)</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">Paste company names you want to prioritize or exclude. One per line. You can skip this step.</p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-1 block">Priority Accounts (boost these)</label>
                  <textarea
                    value={keyAccountsText}
                    onChange={e => setKeyAccountsText(e.target.value)}
                    placeholder={"BHP\nRio Tinto\nFortescue Metals\nDowner EDI"}
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-navy uppercase tracking-wider mb-1 block">Exclude Accounts (hide these)</label>
                  <textarea
                    value={excludeAccountsText}
                    onChange={e => setExcludeAccountsText(e.target.value)}
                    placeholder="Companies you don't want to see..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 resize-none"
                  />
                </div>
              </div>
            )}

            {/* ===== SCREEN 6: Summary + Confirm ===== */}
            {step === 5 && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-5 h-5 text-gold" />
                    <h2 className="text-xl font-bold text-navy">Your Intelligence Profile</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">Review your preferences below. Your dashboard will be tailored to show the most relevant projects and contacts.</p>
                </div>

                <div className="bg-card rounded-lg border border-border divide-y divide-border">
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Territories</p>
                    <p className="text-sm font-medium text-navy mt-0.5">{summaryTerritories || "Not set"}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Industries</p>
                    <p className="text-sm font-medium text-navy mt-0.5">{summaryIndustries || "Not set"}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Offer Categories</p>
                    <p className="text-sm font-medium text-navy mt-0.5">{summaryOffers || "Not set"}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customer Types</p>
                    <p className="text-sm font-medium text-navy mt-0.5">{summaryCustomers || "Not set"}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Deal Size</p>
                    <p className="text-sm font-medium text-navy mt-0.5">{summaryDealSize || "Not set"}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stage Timing</p>
                    <p className="text-sm font-medium text-navy mt-0.5">{summaryStage || "Not set"}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Buyer Roles</p>
                    <p className="text-sm font-medium text-navy mt-0.5">{summaryRoles || "Not set"}</p>
                  </div>
                </div>

                <div className="bg-gold/10 border border-gold/25 rounded-lg p-4">
                  <p className="text-sm text-foreground/80">
                    <strong className="text-navy">What happens next:</strong> Your dashboard will prioritize projects matching your territory, industries, and deal size. Projects outside your filters will be deprioritized (not hidden), so you never miss an unexpected opportunity. You can update these preferences anytime from Settings.
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-8 pt-4 border-t border-border">
          <div>
            {step > 0 && (
              <Button variant="outline" onClick={handleBack} className="gap-1.5">
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Step {step + 1} of {TOTAL_STEPS}
            </span>
            {step < TOTAL_STEPS - 1 ? (
              <Button
                onClick={handleNext}
                disabled={!canProceed || updateProfile.isPending}
                className="bg-navy hover:bg-navy-light text-white gap-1.5"
              >
                {updateProfile.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>Next <ChevronRight className="w-4 h-4" /></>
                )}
              </Button>
            ) : (
              <Button
                onClick={handleFinish}
                disabled={completeOnboarding.isPending}
                className="bg-gold hover:bg-gold-light text-navy font-bold gap-1.5"
              >
                {completeOnboarding.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>Launch Dashboard <Sparkles className="w-4 h-4" /></>
                )}
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
