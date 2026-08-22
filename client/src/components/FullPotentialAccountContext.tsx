import { AlertTriangle, ArrowUpRight, Building2, Route, UserRound } from "lucide-react";
import { Link } from "wouter";
import {
  accountContextNextGap,
  routeToMarketLabel,
  type ProjectFullPotentialContext,
} from "@/lib/fullPotentialProjectContext";

function accountName(context: ProjectFullPotentialContext): string {
  const match = context.primaryMatch;
  if (!match) return "";
  return match.account.displayName?.trim() || match.displayName?.trim() || match.canonicalName;
}

function salesNextStep(context: ProjectFullPotentialContext | null | undefined): string {
  const step = accountContextNextGap(context);
  const salesLanguage: Record<string, string> = {
    "Attributed pursuit active": "Pursuit already active",
    "Build and approve the evidence-backed model": "Confirm the likely equipment need and timing",
    "Set the next evidence-generating action": "Set the next customer action",
    "Account route is ready for commercial validation": "Confirm the need, timing and decision maker",
    "No Full Potential buying account identified": "Buyer route has not been identified",
  };
  return salesLanguage[step] ?? step;
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
    const detail = ambiguous
      ? `${ambiguous.candidateName} could match more than one buying account.`
      : unresolved
        ? "Confirm which contractor or buying entity should own the commercial action."
        : "No buying account is supported by the current project evidence.";

    if (compact) {
      return (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10px] text-amber-700">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate font-semibold">Buyer route to confirm</span>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <div className="font-bold">Buyer route to confirm</div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-amber-800">{detail}</div>
          </div>
        </div>
      </div>
    );
  }

  const account = match.account;
  const name = accountName(context!);
  const nextStep = salesNextStep(context);
  const owner = account.ownerName?.trim() || account.channelOwner?.trim() || null;
  const accountLabel = match.certainty === "confirmed" ? "Buying account" : "Likely buying account";
  const link = `/full-potential/commercial-model?accountId=${match.accountId}`;

  if (compact) {
    return (
      <div
        className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px]"
        onClick={event => event.stopPropagation()}
      >
        <Building2 className="h-3 w-3 shrink-0 text-slate-500" />
        <span className="shrink-0 font-semibold text-slate-500">{accountLabel}</span>
        <Link href={link} className="max-w-52 truncate font-bold text-navy hover:text-teal" title={name}>
          {name}
        </Link>
        {owner && <span className="hidden text-muted-foreground md:inline">· {owner}</span>}
        <span className="min-w-0 truncate font-medium text-amber-700">· {nextStep}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/45 p-3" onClick={event => event.stopPropagation()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-bold text-blue-700">
            <Building2 className="h-3 w-3" />
            {accountLabel}
          </span>
          <Link href={link} className="mt-1.5 flex w-fit items-center gap-1 text-sm font-bold text-navy hover:text-teal">
            {name} <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {owner && <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{owner}</span>}
            {account.routeToMarket && (
              <span className="inline-flex items-center gap-1"><Route className="h-3 w-3" />{routeToMarketLabel(account.routeToMarket)}</span>
            )}
            {(account.activePursuitCount ?? 0) > 0 && <span className="font-semibold text-emerald-700">Pursuit active</span>}
          </div>
        </div>
        <div className="max-w-sm rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
          <span className="font-bold">Next sales step:</span> {nextStep}
        </div>
      </div>
    </div>
  );
}
