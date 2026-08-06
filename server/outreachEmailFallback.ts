import type { OutreachInput, OutreachResult } from "./outreachEmail";
import type { LLMFailureKind } from "./_core/llmErrors";

function compact(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function firstName(fullName: string): string {
  return compact(fullName).split(" ")[0] || "there";
}

function knownFocus(input: OutreachInput): string | null {
  // A user-selected collateral item is an explicit input. A derived business
  // line match is a ranking signal, not claim-level evidence, and must not be
  // stated as fact in a provider-free fallback.
  const collateral = compact(input.collateralName);
  if (collateral) return collateral;
  return null;
}

/**
 * Provider-free outreach fallback. It uses canonical persisted context already
 * approved by the project outreach guard and deliberately makes no performance,
 * product-fit, savings, competitor or project-stage claims.
 */
export function buildDeterministicOutreachEmail(
  input: OutreachInput,
  reason: LLMFailureKind,
): OutreachResult {
  const recipientFirstName = firstName(input.contactName);
  const company = compact(input.contactCompany);
  const project = compact(input.projectName);
  const location = compact(input.projectLocation);
  const title = compact(input.contactTitle);
  const selectedCollateral = knownFocus(input);

  const projectReference = location
    ? `${project} in ${location}`
    : project;
  const contextReference = title && company
    ? `Our records list ${title} and ${company}, but I would first like to confirm whether this project is relevant to your current responsibilities. `
    : `I would first like to confirm whether this project is relevant to your current responsibilities. `;
  const focusParagraph = selectedCollateral
    ? `I have ${selectedCollateral} information available if it proves relevant. I would like to understand the requirements before suggesting a specific solution.`
    : `I would like to understand the project's equipment requirements before suggesting a specific solution.`;

  return {
    subject: `${project} — project contact check`,
    body: [
      `Hi ${recipientFirstName},`,
      `I'm getting in touch regarding ${projectReference}. ${contextReference}I thought it would be useful to understand the project's requirements and whether Atlas Copco Power Technique could support them.`,
      focusParagraph,
      "Would a brief discussion be useful? If this is outside your remit, please let me know or point me to the appropriate project contact.",
    ].join("\n\n"),
    keyPoints: [
      `Project: ${project}`,
      `Recorded contact context to confirm: ${title || "role not recorded"}${company ? ` — ${company}` : ""}`,
      selectedCollateral
        ? `Selected collateral available if relevant: ${selectedCollateral}`
        : "Next step: confirm requirements before recommending a solution",
    ],
    toneUsed: input.tone,
    generationMode: "deterministic_template",
    aiUnavailableReason: reason,
  };
}
