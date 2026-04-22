/**
 * Shared utility functions — used by both server and client code.
 */

/**
 * Sanitize a contractor name for display.
 * Rejects names that contain HTML tags, href patterns, URL fragments, or hex colors.
 * Returns null if the name is invalid or too short/long.
 */
export function sanitizeContractorName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = String(name).trim();
  // Reject if it contains HTML tags, href patterns, URL fragments, or hex colors
  if (
    s.includes("<") ||
    s.includes(">") ||
    s.includes("href") ||
    s.includes("//www.") ||
    s.includes("http") ||
    /^#[0-9a-fA-F]{3,6}$/.test(s) ||
    s.startsWith("\"") ||
    s.length < 3 ||
    s.length > 200
  ) {
    return null;
  }
  return s;
}

/**
 * Derive a plain-English "why now" sentence for a project.
 * Used in the collapsed project card view.
 */
export function deriveWhyNow(project: {
  actionTier?: string | null;
  isNew?: boolean;
  stageCode?: string | null;
  overview?: string | null;
}): string {
  if (project.actionTier === "tier1_actionable") {
    return "Action required now — Tier 1 opportunity.";
  }
  if (project.isNew) {
    return "New project identified this week.";
  }
  if (project.stageCode) {
    return `Stage: ${project.stageCode}.`;
  }
  if (project.overview) {
    const trimmed = project.overview.trim();
    return trimmed.length > 120 ? trimmed.slice(0, 117) + "…" : trimmed;
  }
  return "Monitor for upcoming opportunities.";
}
