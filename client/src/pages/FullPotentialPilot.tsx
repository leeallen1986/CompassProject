import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  DollarSign,
  Loader2,
  LogIn,
  Rocket,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import FullPotentialPilotAccountCard from "@/components/FullPotentialPilotAccountCard";
import { Button } from "@/components/ui/button";
import {
  TOP_FIVE_PILOT_ACCOUNTS,
  calculatePilotSummary,
  type PilotAccountSnapshot,
} from "@/lib/fullPotentialPilot";
import { formatAud } from "@/lib/fullPotentialCommercialModel";

function SummaryCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-bold text-navy">{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
        </div>
        <span className="rounded-lg bg-gold/15 p-2 text-gold-dark">{icon}</span>
      </div>
    </div>
  );
}

export default function FullPotentialPilot() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [snapshots, setSnapshots] = useState<Record<number, PilotAccountSnapshot>>({});

  const recordSnapshot = useCallback((snapshot: PilotAccountSnapshot) => {
    setSnapshots(current => {
      const previous = current[snapshot.accountId];
      if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) return current;
      return { ...current, [snapshot.accountId]: snapshot };
    });
  }, []);

  const summary = useMemo(
    () => calculatePilotSummary(Object.values(snapshots)),
    [snapshots],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <h1 className="text-xl font-bold text-navy">Authentication Required</h1>
        <a href={getLoginUrl()} className="inline-flex items-center gap-2 rounded-lg bg-navy px-6 py-3 font-semibold text-white hover:bg-navy-light">
          <LogIn className="h-4 w-4" /> Sign In
        </a>
      </div>
    );
  }

  if (user.role === "distributor") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <ShieldAlert className="h-12 w-12 text-red-500" />
        <h1 className="text-xl font-bold text-navy">Internal Sales Access Required</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          The Full Potential activation pilot contains internal evidence, commercial assumptions and attributed-pursuit information.
        </p>
        <Button variant="outline" onClick={() => navigate("/full-potential")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Full Potential
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-white">
        <div className="container flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => navigate("/full-potential")} className="rounded p-1.5 transition-colors hover:bg-white/10" aria-label="Back to Full Potential">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold">
                <Rocket className="h-5 w-5 text-gold" /> Top-five Account Activation
              </h1>
              <p className="mt-1 text-xs text-slate-300">
                Evidence → approved model → attributed pursuit → qualified C4C handoff
              </p>
            </div>
          </div>
          <span className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-slate-200">
            Controlled V1 pilot · internal sales
          </span>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard
            label="Accounts loaded"
            value={`${summary.loadedAccounts}/5`}
            detail="Approved pilot cohort"
            icon={<Users className="h-4 w-4" />}
          />
          <SummaryCard
            label="Evidence ready"
            value={`${summary.evidenceReadyAccounts}/5`}
            detail="Verified evidence and positive line"
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
          <SummaryCard
            label="Approved models"
            value={`${summary.approvedModels}/5`}
            detail="Manager-approved potential"
            icon={<BrainCircuit className="h-4 w-4" />}
          />
          <SummaryCard
            label="Attributed pursuits"
            value={String(summary.attributedPursuits)}
            detail={`${summary.progressedPursuits} beyond identified`}
            icon={<Rocket className="h-4 w-4" />}
          />
          <SummaryCard
            label="Attributed value"
            value={formatAud(summary.attributedValueAud)}
            detail="Working pursuit estimates, not forecast"
            icon={<DollarSign className="h-4 w-4" />}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-start gap-3">
              <Rocket className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
              <div>
                <h2 className="font-bold text-navy">Pilot purpose</h2>
                <p className="mt-1 text-sm text-slate-700">
                  Prove that approved account intelligence creates genuine customer action and attributable opportunity—not another list of unsupported pipeline claims.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-gold/40 bg-gold/10 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-gold-dark" />
              <div>
                <h2 className="font-bold text-navy">Not a second CRM</h2>
                <p className="mt-1 text-sm text-slate-700">
                  This workspace starts and attributes pursuits only. It does not manage forecasts, quotes, opportunity administration, contact records or formal sales activity.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-dashed border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <BrainCircuit className="mt-0.5 h-5 w-5 shrink-0 text-navy" />
            <div>
              <h2 className="font-bold text-navy">AI intelligence boundary</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This release consumes only approved evidence and commercial models. Signal matching, source-cited “why now” briefs, missing-evidence recommendations and Next Best 5 delivery belong to the next focused intelligence release.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-5">
          {TOP_FIVE_PILOT_ACCOUNTS.map(pilot => (
            <FullPotentialPilotAccountCard
              key={pilot.id}
              pilot={pilot}
              onSnapshot={recordSnapshot}
            />
          ))}
        </section>
      </main>
    </div>
  );
}
