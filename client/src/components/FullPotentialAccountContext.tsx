import { AlertTriangle, ArrowUpRight, Building2, CheckCircle2, Route, UserRound } from "lucide-react";
import { Link } from "wouter";
import {
  accountContextNextGap,
  candidateRoleLabel,
  certaintyLabel,
  priorityTierLabel,
  routeToMarketLabel,
  type ProjectFullPotentialContext,
} from "@/lib/fullPotentialProjectContext";

function certaintyClasses(certainty: string): string {
  if (certainty === "confirmed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (certainty === "likely_high") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function accountName(context: ProjectFullPotentialContext): string {
  const match = context.primaryMatch;
  if (!match) return "";
  return match.account.displayName?.trim() || match.displayName?.trim() || match.canonicalName;
}

export default function FullPotentialAccountContext({
  context,
  compact = false,
  showEmpty = false,
}: {
  context?: ProjectFullPotentialContext | null;
  compact?: boolean;
  showEmpty?: boolean;
}) {
  const match = context?.primaryMatch ?? null;

  if (!match) {
    const unresolved = (context?.candidateCount ?? 0) > 0;
    if (!unresolved && !showEmpty) return null;

    const ambiguous = context?.unresolvedCandidates.find(candidate => candidate.reason === "ambiguous_match");
    const title = unresolved ? "Buying account unresolved" : "No Full Potential account match";
    const detail = ambiguous
      ? `${ambiguous.candidateName} matches more than one canonical account.`
      : unresolved
        ? "Confirm which contractor or buying entity should own the commercial action."
        : "No canonical account has been identified from the current project evidence.";

    if (compact) {
      return (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10px] text-amber-700">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate font-semibold">{title}</span>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <div className="font-bold">{title}</div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-amber-800">{detail}</div>
          </div>
        </div>
      </div>
    );
  }

  const account = match.account;
  const name = accountName(context!);
  const nextGap = accountContextNextGap(context);
  const owner = account.ownerName?.trim() || account.channelOwner?.trim() || "Owner not assigned";
  const link = `/full-potential/commercial-model?accountId=${match.accountId}`;

  if (compact) {
    return (
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px]" onClick={event => event.stopPropagation()}>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-bold ${certaintyClasses(match.certainty)}`}>
          {match.certainty === "confirmed" ? <CheckCircle2 className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
          {certaintyLabel(match.certainty)}
        </span>
        <Link href={link} className="max-w-52 truncate font-bold text-navy hover:text-teal" title={name}>
          {name}
        </Link>
        <span className="hidden text-muted-foreground md:inline">· {owner}</span>
        <span className="hidden text-muted-foreground lg:inline">· {routeToMarketLabel(account.routeToMarket)}</span>
        <span className="min-w-0 truncate font-medium text-amber-700">· {nextGap}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/45 p-3" onClick={event => event.stopPropagation()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold ${certaintyClasses(match.certainty)}`}>
              {match.certainty === "confirmed" ? <CheckCircle2 className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
              {certaintyLabel(match.certainty)}
            </span>
            <span className="rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {candidateRoleLabel(match.candidateRole)}
            </span>
            <span className="rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {priorityTierLabel(account.priorityTier)}
            </span>
          </div>
          <Link href={link} className="mt-1.5 inline-flex items-center gap-1 text-sm font-bold text-navy hover:text-teal">
            {name} <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{owner}</span>
            <span className="inline-flex items-center gap-1"><Route className="h-3 w-3" />{routeToMarketLabel(account.routeToMarket)}</span>
            {(account.activePursuitCount ?? 0) > 0 && <span>{account.activePursuitCount} attributed pursuit{account.activePursuitCount === 1 ? "" : "s"}</span>}
            {(account.openActionCount ?? 0) > 0 && <span>{account.openActionCount} open FP action{account.openActionCount === 1 ? "" : "s"}</span>}
          </div>
        </div>
        <div className="max-w-sm rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
          <span className="font-bold">Next account step:</span> {nextGap}
        </div>
      </div>
    </div>
  );
}
