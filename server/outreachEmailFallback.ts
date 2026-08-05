import type { OutreachInput, OutreachResult } from "./outreachEmail";
import type { LLMFailureKind } from "./_core/llmErrors";

function compact(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function firstName(fullName: string): string {
  return compact(fullName).split(" ")[0] || "there";
}

function knownFocus(input: OutreachInput): string | null {
  const collateral = compact(input.collateralName);
  if (collateral) return collateral;
  const businessLines = input.matchedBusinessLines.map(compact).filter(Boolean);
  return businessLines.length > 0 ? businessLines.join(", ") : null;
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
  const focus = knownFocus(input);

  const projectReference = location
    ? `${project} in ${location}`
    : project;
  const roleReference = title
    ? `Given your role as ${title} at ${company}, `
    : `Given your role at ${company}, `;
  const focusParagraph = focus
    ? `The information available identifies ${focus} as a relevant area. I would like to understand the requirements before suggesting a specific solution.`
    : `I would like to understand the project's equipment requirements before suggesting a specific solution.`;

  return {
    subject: `${company} — ${project}`,
    body: [
      `Hi ${recipientFirstName},`,
      `I'm getting in touch regarding ${projectReference}. ${roleReference}I thought it would be useful to understand the project's requirements and whether Atlas Copco Power Technique could support them.`,
      focusParagraph,
      "Would a brief discussion be useful, or is there someone else on the project I should speak with?",
    ].join("\n\n"),
    keyPoints: [
      `Project: ${project}`,
      `Contact context: ${title || "project stakeholder"} at ${company}`,
      focus ? `Known focus: ${focus}` : "Next step: confirm requirements before recommending a solution",
    ],
    toneUsed: input.tone,
    generationMode: "deterministic_template",
    aiUnavailableReason: reason,
  };
}
