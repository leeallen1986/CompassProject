import {
  ArrowRight,
  Building2,
  CalendarClock,
  ChevronRight,
  Compass,
  MapPin,
  Route,
  Sparkles,
  Target,
} from "lucide-react";
import { Link } from "wouter";
import FullPotentialAccountContext from "@/components/FullPotentialAccountContext";
import type { ExploreProjectLike } from "@/lib/exploreProjects";

export interface ExploreOpportunityProject extends ExploreProjectLike {
  owner?: string | null;
  value?: string | null;
  opportunityRoute?: string | null;
  tierLabel?: string | null;
  contactCTA?: {
    action?: string;
    label?: string;
    contactName?: string;
  } | null;
}

function laneFitClass(value: string | null | undefined): string {
  if (value === "High") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "Medium") return "border-blue-200 bg-blue-50 text-blue-700";
  if (value === "Low") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function channelLabel(value: string | null | undefined): string {
  if (value === "direct") return "Direct sale";
  if (value === "crosssell") return "Cross-sell";
  if (value === "rental") return "Rental signal";
  return "Route to validate";
}

function priorityClass(value: string | null | undefined): string {
  if (value === "hot") return "bg-red-500 text-white";
  if (value === "warm") return "bg-amber-400 text-slate-900";
  return "bg-slate-500 text-white";
}

export default function ExploreOpportunityCard({
  project,
  tenderTiming,
}: {
  project: ExploreOpportunityProject;
  tenderTiming?: string | null;
}) {
  const whyNow = project.whyNow?.trim() || "Review the project evidence and confirm whether a Portable Air buying route exists.";
  const nextMove = project.bestNextMove?.trim() || "Validate the contractor, buying account and next evidence-generating action.";
  const route = project.routeToBuy?.trim() || project.opportunityRoute?.trim() || "Buying route not yet confirmed";

  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priorityClass(project.priority)}`}>
              {project.priority || "monitor"}
            </span>
            {project.laneFitLabel && (
              <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${laneFitClass(project.laneFitLabel)}`}>
                {project.laneFitLabel} lane fit
              </span>
            )}
            {project.channel && project.channel !== "monitor" && (
              <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[10px] font-semibold text-navy">
                {channelLabel(project.channel)}
              </span>
            )}
            {project.bestProductAngle && project.bestProductAngle !== "Monitor" && (
              <span className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                <Target className="h-3 w-3" /> {project.bestProductAngle}
              </span>
            )}
            {tenderTiming && (
              <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                <CalendarClock className="h-3 w-3" /> {tenderTiming}
              </span>
            )}
          </div>

          <Link href={`/project/${project.id}`} className="mt-2 block text-base font-bold leading-snug text-navy hover:text-teal">
            {project.name}
          </Link>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {project.location && (
              <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{project.location}</span>
            )}
            {project.owner && (
              <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{project.owner}</span>
            )}
            {project.relevanceScore !== undefined && project.relevanceScore !== null && (
              <span className="inline-flex items-center gap-1"><Compass className="h-3 w-3" />Lane score {Math.round(project.relevanceScore)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <Sparkles className="h-3 w-3 text-gold" /> Why now
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">{whyNow}</p>
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-600">
            <Route className="mt-0.5 h-3 w-3 shrink-0" />
            <span><strong className="text-navy">Route:</strong> {route}</span>
          </div>
        </div>

        <div className="rounded-lg border border-gold/25 bg-gold/5 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gold-dark">
            <ArrowRight className="h-3 w-3" /> Next commercial step
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">{nextMove}</p>
        </div>
      </div>

      <div className="mt-3">
        <FullPotentialAccountContext context={project.fullPotentialContext} showEmpty={false} />
      </div>

      <div className="mt-3 flex justify-end border-t border-border/60 pt-3">
        <Link href={`/project/${project.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-teal hover:text-teal-light">
          Review intelligence <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}
