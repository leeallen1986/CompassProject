import { BrainCircuit, ExternalLink, ShieldAlert } from "lucide-react";
import type { GroundedAiBrief } from "@/lib/fullPotentialDailyActivation";

function sourceLabel(value: string): string {
  return value === "fp_signal"
    ? "FP signal"
    : value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

export default function GroundedBrief({ brief }: { brief: GroundedAiBrief }) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <strong className="flex items-center gap-1.5 text-blue-900">
          <BrainCircuit className="h-3.5 w-3.5" />
          Grounded account brief
        </strong>
        <span className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
          {brief.generatedBy === "ai" ? "AI" : "Safe fallback"}
        </span>
      </div>

      <p className="leading-relaxed text-slate-700">{brief.accountBrief}</p>

      <div>
        <strong className="text-navy">Why now</strong>
        <p className="mt-1 leading-relaxed text-slate-600">{brief.whyNow}</p>
      </div>

      <div>
        <strong className="text-navy">Questions to ask</strong>
        <ul className="mt-1 space-y-1 text-slate-600">
          {brief.questionsToAsk.map(question => <li key={question}>• {question}</li>)}
        </ul>
      </div>

      {brief.evidenceGaps.length > 0 && (
        <div>
          <strong className="text-navy">Evidence gaps</strong>
          <ul className="mt-1 space-y-1 text-slate-600">
            {brief.evidenceGaps.map(gap => <li key={gap}>• {gap}</li>)}
          </ul>
        </div>
      )}

      <div className="rounded-md border border-blue-100 bg-white/70 p-2">
        <strong className="text-navy">Expected outcome</strong>
        <p className="mt-1 text-slate-600">{brief.expectedOutcome}</p>
      </div>

      {brief.sources.length > 0 && (
        <div>
          <strong className="text-navy">Sources used</strong>
          <div className="mt-1 space-y-1">
            {brief.sources.map(source => (
              <div
                key={`${source.sourceType}-${source.sourceId ?? source.title}`}
                className="flex items-start gap-1.5 text-[10px] text-slate-600"
              >
                <span className="shrink-0 font-semibold">{sourceLabel(source.sourceType)}</span>
                <span className="min-w-0 flex-1 truncate">{source.title}</span>
                {source.sourceUrl && (
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-blue-600 hover:underline"
                    aria-label={`Open source for ${source.title}`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{brief.warnings.join(" ")}</span>
      </div>
    </div>
  );
}
