import { AlertTriangle, CheckCircle2, CircleDashed, FileCheck2, Rocket, Users } from "lucide-react";
import type { DailyActivationResponse } from "@/lib/fullPotentialDailyActivation";

const metricIcons = {
  Pending: CircleDashed,
  Responded: CheckCircle2,
  Stalled: AlertTriangle,
  Evidence: FileCheck2,
  Approved: CheckCircle2,
  Pursuits: Rocket,
};

export default function ManagerRollup({ data }: { data: DailyActivationResponse }) {
  const rollup = data.managerRollup;
  if (!rollup) return null;

  const responded =
    rollup.accepted +
    rollup.edited +
    rollup.deferred +
    rollup.rejected +
    rollup.notRelevant;

  const metrics: Array<[keyof typeof metricIcons, number]> = [
    ["Pending", rollup.pending],
    ["Responded", responded],
    ["Stalled", rollup.stalledAccounts],
    ["Evidence", rollup.evidenceAddedThisWeek],
    ["Approved", rollup.modelsApprovedThisWeek],
    ["Pursuits", rollup.pursuitsStartedThisWeek],
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {metrics.map(([label, value]) => {
          const Icon = metricIcons[label];
          return (
            <div key={label} className="rounded-lg border border-border bg-card p-2 text-center">
              <Icon className="mx-auto h-3.5 w-3.5 text-gold-dark" />
              <div className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="mt-0.5 text-lg font-bold text-navy">{value}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="font-bold uppercase tracking-wider text-muted-foreground">Model movement</div>
          <div className="mt-2 flex justify-between"><span>Submitted</span><strong>{rollup.modelsSubmittedThisWeek}</strong></div>
          <div className="mt-1 flex justify-between"><span>Approved</span><strong>{rollup.modelsApprovedThisWeek}</strong></div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="font-bold uppercase tracking-wider text-muted-foreground">Recommendation response</div>
          <div className="mt-2 flex justify-between"><span>Accepted / edited</span><strong>{rollup.accepted + rollup.edited}</strong></div>
          <div className="mt-1 flex justify-between"><span>Deferred / rejected</span><strong>{rollup.deferred + rollup.rejected + rollup.notRelevant}</strong></div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> Owner exceptions
        </div>
        {rollup.byOwner.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">No owned Full Potential accounts are in the current roll-up.</div>
        ) : (
          <div className="divide-y divide-border">
            {rollup.byOwner.slice(0, 8).map(owner => (
              <div
                key={owner.ownerName}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 px-3 py-2 text-[10px]"
              >
                <span className="truncate font-semibold text-navy">{owner.ownerName}</span>
                <span title="Pending recommendations">{owner.pending} pending</span>
                <span title="Responded recommendations">{owner.responded} responded</span>
                <span className={owner.stalled > 0 ? "font-bold text-red-700" : "text-muted-foreground"}>
                  {owner.stalled} stalled
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-[10px] leading-relaxed text-blue-900">
        Manager focus is conversion and exceptions: evidence added, models approved, recommendations dispositioned and genuine pursuits started. This is not a forecast review, and C4C remains authoritative after qualification.
      </div>
    </div>
  );
}
