import { useEffect, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import type {
  DailyActivationDecision,
  DailyRecommendation,
} from "@/lib/fullPotentialDailyActivation";

export interface RecommendationResponseInput {
  decision: DailyActivationDecision;
  actionText: string;
  dueDate: string;
  reason: string;
}

export default function ResponseEditor({
  recommendation,
  initialDecision,
  busy,
  onCancel,
  onSubmit,
}: {
  recommendation: DailyRecommendation;
  initialDecision: DailyActivationDecision;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: RecommendationResponseInput) => void;
}) {
  const [decision, setDecision] = useState<DailyActivationDecision>(initialDecision);
  const [actionText, setActionText] = useState(recommendation.recommendedAction);
  const [dueDate, setDueDate] = useState(recommendation.defaultDueDate);
  const [reason, setReason] = useState("");

  useEffect(() => {
    setDecision(initialDecision);
    setActionText(recommendation.recommendedAction);
    setDueDate(recommendation.defaultDueDate);
    setReason("");
  }, [initialDecision, recommendation.defaultDueDate, recommendation.recommendedAction]);

  const isClosed = decision === "rejected" || decision === "not_relevant";
  const canSubmit = isClosed
    ? reason.trim().length >= 3
    : actionText.trim().length >= 3 && dueDate.length === 10;

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-gold/30 bg-gold/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-xs text-navy">Respond to recommendation</strong>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/70 hover:text-navy"
          aria-label="Close recommendation response"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Decision
        </span>
        <select
          value={decision}
          onChange={event => setDecision(event.target.value as DailyActivationDecision)}
          className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs"
        >
          <option value="accepted">Accept as recommended</option>
          <option value="edited">Edit and accept</option>
          <option value="deferred">Defer to a date</option>
          <option value="rejected">Reject this recommendation</option>
          <option value="not_relevant">Not relevant to this account</option>
        </select>
      </label>

      {!isClosed ? (
        <>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Evidence-generating action
            </span>
            <textarea
              rows={3}
              value={actionText}
              onChange={event => setActionText(event.target.value)}
              className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-xs"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Due date
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={event => setDueDate(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Optional rep note
            </span>
            <input
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="What did you change or what needs to happen first?"
              className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs"
            />
          </label>
        </>
      ) : (
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Reason
          </span>
          <textarea
            rows={3}
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="Explain why it is wrong, too early, assigned elsewhere or not commercially relevant."
            className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-xs"
          />
        </label>
      )}

      <button
        type="button"
        disabled={busy || !canSubmit}
        onClick={() => onSubmit({ decision, actionText, dueDate, reason })}
        className="inline-flex items-center gap-1.5 rounded-md bg-navy px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Record decision
      </button>
    </div>
  );
}
