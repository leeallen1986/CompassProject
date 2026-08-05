import { trackActivity } from "./userActivityService";

export interface OutreachDraftTelemetry {
  userId: number;
  projectId: number;
  contactId: number;
  claimId?: number;
  sourceAccountId?: number;
  tone: string;
  generationMode: string;
  aiUnavailableReason: string | null;
}

type ActivityWriter = typeof trackActivity;

/**
 * Record categorical draft diagnostics without allowing an analytics failure
 * to discard a usable draft. The input type intentionally has no recipient,
 * email, subject, body or project-name fields.
 */
export async function recordOutreachDraftTelemetry(
  input: OutreachDraftTelemetry,
  writer: ActivityWriter = trackActivity,
): Promise<boolean> {
  try {
    await writer(input.userId, "outreach_drafted", {
      projectId: input.projectId,
      contactId: input.contactId,
      claimId: input.claimId,
      metadata: {
        tone: input.tone,
        generationMode: input.generationMode,
        aiUnavailableReason: input.aiUnavailableReason,
        sourceAccountId: input.sourceAccountId ?? null,
      },
    });
    return true;
  } catch {
    console.warn("[Outreach] draft telemetry unavailable", {
      generationMode: input.generationMode,
      aiUnavailableReason: input.aiUnavailableReason,
    });
    return false;
  }
}
