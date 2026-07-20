import { Loader2, Shield } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import PlatformPageShell from "@/components/PlatformPageShell";
import { hasPumpTargetAccess } from "@/lib/platformNavigation";
import { trpc } from "@/lib/trpc";
import AccountAttack from "./AccountAttack";
import AccountPriors from "./AccountPriors";
import ExploreProjects from "./ExploreProjects";
import FullPotential from "./FullPotential";
import FullPotentialCommercialModel from "./FullPotentialCommercialModel";
import FullPotentialDataQuality from "./FullPotentialDataQuality";
import FullPotentialPilot from "./FullPotentialPilot";
import FullPotentialRentalHire from "./FullPotentialRentalHire";
import Home from "./Home";
import Pipeline from "./Pipeline";
import ThisWeekWithFullPotential from "./ThisWeekWithFullPotential";

export function ThisWeekRoute() {
  return (
    <PlatformPageShell legacyHeader="hide">
      <ThisWeekWithFullPotential />
    </PlatformPageShell>
  );
}

export function ExploreProjectsRoute() {
  return (
    <PlatformPageShell>
      <ExploreProjects />
    </PlatformPageShell>
  );
}

export function AllIntelligenceRoute() {
  return (
    <PlatformPageShell
      title="All Intelligence"
      description="Broad project, contact, drilling, contractor and source research. Return to Explore Projects for the lane-gated sales board."
      legacyHeader="hide"
    >
      <Home />
    </PlatformPageShell>
  );
}

export function AccountIntelligenceRoute() {
  return (
    <PlatformPageShell
      title="Account Intelligence"
      description="Connect owners, contractors, projects, stakeholders and buying routes around one commercial account."
      legacyHeader="hide"
    >
      <AccountAttack />
    </PlatformPageShell>
  );
}

export function PursuitsRoute() {
  return (
    <PlatformPageShell
      title="Pursuits"
      description="Compass records why a pursuit started and its next evidence-generating action. C4C remains authoritative once qualified."
      legacyHeader="pursuits-toolbar"
    >
      <Pipeline />
    </PlatformPageShell>
  );
}

export function FullPotentialRoute() {
  return (
    <PlatformPageShell>
      <FullPotential />
    </PlatformPageShell>
  );
}

export function FullPotentialPilotRoute() {
  return (
    <PlatformPageShell>
      <FullPotentialPilot />
    </PlatformPageShell>
  );
}

export function FullPotentialCommercialModelRoute() {
  return (
    <PlatformPageShell>
      <FullPotentialCommercialModel />
    </PlatformPageShell>
  );
}

export function FullPotentialDataQualityRoute() {
  return (
    <PlatformPageShell>
      <FullPotentialDataQuality />
    </PlatformPageShell>
  );
}

export function FullPotentialRentalHireRoute() {
  return (
    <PlatformPageShell>
      <FullPotentialRentalHire />
    </PlatformPageShell>
  );
}

export function PumpTargetsRoute() {
  const { user } = useAuth();
  const { data: profile, isLoading } = trpc.profile.get.useQuery(undefined, {
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  if (!user) return <AccountPriors />;

  if (isLoading) {
    return (
      <PlatformPageShell>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-gold" />
        </div>
      </PlatformPageShell>
    );
  }

  const assignedBusinessLines = (profile?.assignedBusinessLines as string[] | null | undefined) ?? [];
  const allowed = hasPumpTargetAccess(user.role, assignedBusinessLines);

  if (!allowed) {
    return (
      <PlatformPageShell title="Pump Targets" description="WA Pump/Flow account-prior library">
        <main className="container py-12">
          <div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
            <Shield className="mx-auto h-10 w-10 text-amber-600" />
            <h2 className="mt-3 text-lg font-bold text-navy">Pump and Dewatering team view</h2>
            <p className="mt-2 text-sm text-amber-900/80">
              Portable Air strategic accounts are managed in Full Potential. This legacy target list remains available only to Pump and Dewatering users and admins.
            </p>
          </div>
        </main>
      </PlatformPageShell>
    );
  }

  return (
    <PlatformPageShell
      title="Pump Targets"
      description="WA Pump/Flow Top 100 account-prior library"
      legacyHeader="hide"
    >
      <AccountPriors />
    </PlatformPageShell>
  );
}
