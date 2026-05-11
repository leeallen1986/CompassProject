#!/usr/bin/env python3
"""
Patch emailDigest.ts:
1. Replace buildEmailSignals function with fixed version (product labels, CTA language,
   word-boundary truncation, contact title sanitisation, contact name in CTA)
2. Fix sendWeeklyDigestToUser to pass htmlContent + textContent
"""
import re

TARGET = "server/emailDigest.ts"

with open(TARGET, "r") as f:
    content = f.read()

# ── Patch 1: Replace buildEmailSignals ──────────────────────────────────────
OLD_FUNC_START = '/**\n * Convert annotated projects into EmailSignal[] for the new HTML template.\n * Caps at 5 signals total: up to 3 action_ready + 2 discovery_needed.\n * Monitor-only projects are excluded from the email (they can see them on dashboard).\n */\nexport function buildEmailSignals('
OLD_FUNC_END = 'return signals;\n}\n\n/**\n * Generate a personalized Thursday mid-week reminder for a single user.'

start_idx = content.find(OLD_FUNC_START)
end_idx = content.find(OLD_FUNC_END)

if start_idx == -1:
    print("ERROR: buildEmailSignals start not found")
    exit(1)
if end_idx == -1:
    print("ERROR: buildEmailSignals end not found")
    exit(1)

# The replacement includes the helper functions + the rebuilt buildEmailSignals
REPLACEMENT = '''// ── Product lane slug → human label map ──
const PRODUCT_LANE_LABELS: Record<string, string> = {
  portable_air: "Portable Air",
  multi_lane_pt: "Multi-Line PT",
  bess: "BESS",
  pal: "PAL",
  generators: "Generators",
  lighting: "Lighting",
  pump: "Pump",
  pumps: "Pumps",
  dewatering: "Dewatering",
  nitrogen: "Nitrogen",
  opexmonitor: "OPEX / Monitor",
  opex_monitor: "OPEX / Monitor",
  fleet_capex: "Fleet CAPEX",
  direct_capex: "Direct CAPEX",
  rental: "Rental",
};

function humaniseProductLabel(raw: string | null | undefined): string | null {
  if (!raw || raw === "Unknown") return null;
  const key = raw.toLowerCase().replace(/[\\s/]+/g, "_");
  return PRODUCT_LANE_LABELS[key] ?? raw.replace(/_/g, " ").replace(/\\b\\w/g, c => c.toUpperCase());
}

// ── Sector slug → human label map ──
const SECTOR_LABELS: Record<string, string> = {
  oil_gas: "Oil & Gas",
  oil: "Oil & Gas",
  gas: "Gas",
  mining: "Mining",
  energy: "Energy",
  infrastructure: "Infrastructure",
  defence: "Defence",
  water: "Water",
  construction: "Construction",
  renewables: "Renewables",
  transport: "Transport",
};

function humaniseSectorLabel(raw: string | null | undefined): string {
  if (!raw || raw === "Unknown") return "project";
  const key = raw.toLowerCase().replace(/[\\s/]+/g, "_");
  return SECTOR_LABELS[key] ?? raw.replace(/_/g, " ").replace(/\\b\\w/g, c => c.toUpperCase());
}

// ── Truncate pitch at word boundary ──
function truncatePitch(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  const cut = text.lastIndexOf(" ", maxLen - 3);
  return (cut > 80 ? text.slice(0, cut) : text.slice(0, maxLen - 3)) + "...";
}

// ── Sanitise contact title (strip LinkedIn pipe-fragments, enforce max length) ──
function sanitiseContactTitle(raw: string | null | undefined): string | null {
  if (!raw || raw === "Unknown") return null;
  const first = raw.split("|")[0].trim();
  const clean = first.replace(/\\s+at\\s+[A-Z].*/i, "").replace(/[,;]+$/, "").trim();
  if (clean.length > 80) return clean.slice(0, 77) + "...";
  return clean || null;
}

// ── Lane-appropriate CTA language (direct-sale, no rental) ──
function buildCtaAction(
  contactName: string | null,
  contactTitle: string | null,
  productLane: string | null,
  badge: "action_ready" | "discovery_needed",
): string {
  if (badge === "discovery_needed") {
    if (contactName && contactTitle) {
      return `Engage ${contactName}, ${contactTitle} — confirm equipment scope, timing, and route to purchase.`;
    }
    return "Open project card → Contacts tab → run enrichment to identify the right buyer.";
  }
  // action_ready — lane-specific direct-sale language
  const lane = (productLane ?? "").toLowerCase();
  let action: string;
  if (lane.includes("pump") || lane.includes("dewater")) {
    action = "discuss dewatering scope, pump package, and site requirements";
  } else if (lane.includes("bess") || lane.includes("pal") || lane.includes("generator") || lane.includes("lighting")) {
    action = "discuss project package, deployment timing, and site delivery path";
  } else {
    // Portable Air default (also covers multi_lane_pt, direct_capex, fleet_capex)
    action = "discuss application, timing, equipment package, and contractor route-to-buy";
  }
  if (contactName && contactTitle) {
    return `Contact ${contactName}, ${contactTitle} to ${action}.`;
  } else if (contactName) {
    return `Contact ${contactName} to ${action}.`;
  } else if (contactTitle) {
    return `Contact the ${contactTitle} to ${action}.`;
  }
  return `Open project card to ${action}.`;
}

/**
 * Convert annotated projects into EmailSignal[] for the new HTML template.
 * Caps at 5 signals total: up to 3 action_ready + 2 discovery_needed.
 * Monitor-only projects are excluded from the email (they can see them on dashboard).
 */
export function buildEmailSignals(
  annotatedProjects: Array<DigestProject & { relevanceScore: number; briefReadiness?: BriefReadiness; bestContact?: DigestProject["bestContact"] }>,
  territories: string[],
): EmailSignal[] {
  const signals: EmailSignal[] = [];
  const actionReady = annotatedProjects.filter(p => p.briefReadiness === "action_ready").slice(0, 3);
  const discoveryNeeded = annotatedProjects.filter(p => p.briefReadiness === "discovery_needed").slice(0, 2);
  for (const p of actionReady) {
    const rawProductSuffix = p.productLane && p.productLane !== "Unknown"
      ? p.productLane
      : p.opportunityRoute && p.opportunityRoute !== "Unknown"
        ? p.opportunityRoute
        : null;
    const productSuffix = humaniseProductLabel(rawProductSuffix);
    const title = productSuffix ? `${p.name} \u2014 ${productSuffix}` : p.name;
    const company = p.owner && p.owner !== "Unknown" && p.owner !== "unknown" ? p.owner : "";
    // Build pitch from overview — word-boundary truncation
    let pitch = "";
    if (p.overview && p.overview.length > 20) {
      pitch = truncatePitch(p.overview.replace(/\\s+/g, " ").trim(), 200);
    } else {
      pitch = `${p.name} presents an opportunity for Atlas Copco Power Technique solutions.`;
    }
    // Build CTA — direct-sale language, contact name + sanitised title
    const contactName = p.bestContact?.name && p.bestContact.name !== "Unknown" ? p.bestContact.name : null;
    const rawTitle = p.bestContact?.title && p.bestContact.title !== "Unknown" ? p.bestContact.title : null;
    const contactTitle = sanitiseContactTitle(rawTitle);
    const ctaAction = buildCtaAction(contactName, contactTitle, rawProductSuffix, "action_ready");
    // Product tag — human labels
    const sectorLabel = humaniseSectorLabel(p.sector);
    const productTag = productSuffix
      ? `${productSuffix} for ${sectorLabel}`
      : `Equipment solutions for ${sectorLabel}`;
    signals.push({
      projectId: p.id,
      badge: "action_ready",
      title,
      company,
      pitch,
      ctaAction,
      productTag,
    });
  }
  for (const p of discoveryNeeded) {
    const rawProductSuffix = p.productLane && p.productLane !== "Unknown"
      ? p.productLane
      : p.opportunityRoute && p.opportunityRoute !== "Unknown"
        ? p.opportunityRoute
        : null;
    const productSuffix = humaniseProductLabel(rawProductSuffix);
    const title = productSuffix ? `${p.name} \u2014 ${productSuffix}` : p.name;
    const company = p.owner && p.owner !== "Unknown" && p.owner !== "unknown" ? p.owner : "";
    let pitch = "";
    if (p.overview && p.overview.length > 20) {
      pitch = truncatePitch(p.overview.replace(/\\s+/g, " ").trim(), 200);
    } else {
      pitch = `${p.name} may require Power Technique solutions — contact discovery needed.`;
    }
    const contactName = p.bestContact?.name && p.bestContact.name !== "Unknown" ? p.bestContact.name : null;
    const rawTitle = p.bestContact?.title && p.bestContact.title !== "Unknown" ? p.bestContact.title : null;
    const contactTitle = sanitiseContactTitle(rawTitle);
    const ctaAction = buildCtaAction(contactName, contactTitle, rawProductSuffix, "discovery_needed");
    const sectorLabel = humaniseSectorLabel(p.sector);
    const productTag = productSuffix
      ? `${productSuffix} for ${sectorLabel}`
      : `Equipment opportunity — ${sectorLabel}`;
    signals.push({
      projectId: p.id,
      badge: "discovery_needed",
      title,
      company,
      pitch,
      ctaAction,
      productTag,
    });
  }
  return signals;
}
/**
 * Generate a personalized Thursday mid-week reminder for a single user.
 * Lighter than the Monday digest — focuses on urgent actions, pipeline nudges,
 * and any new hot projects discovered since Monday.
 */
function generateThursdayReminder('''

# Replace from start of function comment to end of function (exclusive of the Thursday comment)
old_block = content[start_idx:end_idx]
# end_idx points to 'return signals;\n}\n\n/**...' — we keep everything from 'return signals;' onward
# but the REPLACEMENT already ends with the Thursday comment + function signature,
# so we need to skip past the old 'return signals;\n}\n\n' and the Thursday comment header
END_MARKER_LEN = len('return signals;\n}\n\n/**\n * Generate a personalized Thursday mid-week reminder for a single user.\n * Lighter than the Monday digest \u2014 focuses on urgent actions, pipeline nudges,\n * and any new hot projects discovered since Monday.\n */\nfunction generateThursdayReminder(')
new_content = content[:start_idx] + REPLACEMENT + content[end_idx + END_MARKER_LEN:]

# Verify the replacement happened
if REPLACEMENT[:50] in new_content:
    print("✓ Patch 1 (buildEmailSignals): applied")
else:
    print("ERROR: Patch 1 failed")
    exit(1)

content = new_content

# ── Patch 2: Fix sendWeeklyDigestToUser manual send path ────────────────────
# Replace the broken send call that omits htmlContent
OLD_SEND = '''    const sent = await sendEmail({
      to: userEmail,
      subject: forceOverride ? `[FORCE OVERRIDE] ${preview.subject}` : preview.subject,
      markdownContent: preview.content,
      textContent: preview.content,
    });'''

NEW_SEND = '''    // Build the same HTML + text content as the scheduled batch send
    const { buildDigestEmailHtml: _buildHtml, buildDigestEmailText: _buildText } = await import("./emailTemplate");
    const { buildEmailSignals: _buildSignals } = await import("./emailDigest");
    // Re-use sendWeeklyDigestsForUser data — but we need emailSignals, so call buildEmailSignals
    // directly from the preview data. Since sendWeeklyDigestsForUser only returns markdown,
    // we call the helper functions inline here to produce the styled HTML.
    // Note: preview.content is the markdown version (used as fallback only).
    // For the styled HTML we need to rebuild emailData — use the same pipeline as the batch.
    let htmlContent: string | undefined;
    let textContent: string | undefined;
    try {
      const { sendWeeklyDigestsForUser: _previewFn } = await import("./emailDigest");
      // Build email signals by re-running the annotation pipeline for this user
      const { getActiveProjects: _getProjects, getAllContacts: _getContacts, getLatestReport: _getReport, getPipelineClaimsByUser: _getPipeline, getDb: _getDb, getLatestPipelineRun: _getRun } = await import("./db");
      const { scoreAndFilterProjects: _score } = await import("./laneScoring");
      const { resolveTerritories: _resolveTerr } = await import("./canonicalMappings");
      const { classifyBriefReadiness: _classify } = await import("./emailDigest");
      const { users: _usersT, userProfiles: _profilesT } = await import("../drizzle/schema");
      const { eq: _eq } = await import("drizzle-orm");
      const _db2 = await _getDb();
      const _report2 = await _getReport();
      if (_db2 && _report2) {
        const [_user2] = await _db2.select().from(_usersT).where(_eq(_usersT.id, userId));
        const [_profile2] = await _db2.select().from(_profilesT).where(_eq(_profilesT.userId, userId));
        if (_user2 && _profile2) {
          const _allProjects2 = await _getProjects();
          const _allContacts2 = await _getContacts();
          const _latestRun2 = await _getRun();
          const _matched2 = await _score(_allProjects2, {
            territories: _profile2.territories as string[] | null,
            industries: _profile2.industries as string[] | null,
            offerCategories: _profile2.offerCategories as string[] | null,
            customerTypes: _profile2.customerTypes as string[] | null,
            dealSizeMin: _profile2.dealSizeMin,
            dealSizeMax: _profile2.dealSizeMax,
            assignedBusinessLines: _profile2.assignedBusinessLines as string[] | null,
            salesMotion: (_profile2 as any).salesMotion as "direct_only" | "mixed" | null,
          });
          const _contactProjectNames2 = new Set(_allContacts2.map((c: any) => c.project).filter(Boolean));
          const _matchedContacts2 = _allContacts2.filter((c: any) => new Set(_matched2.map((p: any) => p.name)).has(c.project));
          const _annotated2 = _matched2.map((p: any) => {
            const hasNoContacts = !_contactProjectNames2.has(p.name);
            const projectContacts = _matchedContacts2
              .filter((c: any) =>
                c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
                p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
              )
              .map((c: any) => ({
                name: c.name, title: c.title, company: c.company, project: c.project,
                priority: c.priority, email: c.email, roleRelevance: (c as any).roleRelevance ?? null,
                linkedin: (c as any).linkedinProfileUrl ?? (c as any).linkedin ?? null,
                contactTrustTier: (c as any).contactTrustTier ?? null,
                source: (c as any).source ?? null,
                verificationScore: (c as any).verificationScore ?? null,
              }));
            const { readiness, bestContact } = _classify({ ...p, hasNoContacts }, projectContacts);
            return { ...p, hasNoContacts, briefReadiness: readiness, bestContact };
          });
          const _territories2 = _resolveTerr(_profile2.territories as string[] | null, _profile2.sectorFocus as string[] | null);
          const _emailSignals2 = _buildSignals(_annotated2, _territories2);
          const _freshnessLine2 = _latestRun2?.completedAt
            ? `Data last refreshed: ${new Date(_latestRun2.completedAt).toUTCString().slice(0, 16)} UTC`
            : `Data as of: ${_report2.weekEnding}`;
          const _actionCount2 = _emailSignals2.filter((s: any) => s.badge === "action_ready").length;
          const _discoveryCount2 = _emailSignals2.filter((s: any) => s.badge === "discovery_needed").length;
          const _summaryParts2: string[] = [];
          if (_actionCount2 > 0) _summaryParts2.push(`${_actionCount2} action-ready opportunit${_actionCount2 === 1 ? "y" : "ies"}`);
          if (_discoveryCount2 > 0) _summaryParts2.push(`${_discoveryCount2} need${_discoveryCount2 === 1 ? "s" : ""} contact discovery`);
          const _summaryLine2 = _summaryParts2.length > 0 ? `${_summaryParts2.join(" and ")} this week.` : "Here's your weekly intelligence update.";
          const _territoryLabel2 = _territories2.length > 0 ? _territories2.join("/") : "National";
          const _emailData2 = {
            userName: (_user2.name || "Team Member").split(" ")[0],
            territory: _territoryLabel2,
            weekLabel: _report2.weekEnding,
            summaryLine: _summaryLine2,
            signals: _emailSignals2,
            dashboardUrl: ENV.appSiteUrl || "",
          };
          htmlContent = _buildHtml(_emailData2);
          textContent = _buildText(_emailData2);
        }
      }
    } catch (htmlErr) {
      console.warn("[EmailDigest] sendWeeklyDigestToUser: failed to build htmlContent, falling back to markdown:", htmlErr);
    }
    const sent = await sendEmail({
      to: userEmail,
      subject: forceOverride ? `[FORCE OVERRIDE] ${preview.subject}` : preview.subject,
      markdownContent: preview.content,
      htmlContent,
      textContent: textContent ?? preview.content,
    });'''

if OLD_SEND in content:
    content = content.replace(OLD_SEND, NEW_SEND, 1)
    print("✓ Patch 2 (manual send path htmlContent): applied")
else:
    print("ERROR: Patch 2 target not found")
    # Show what's around line 2856
    lines = content.split('\n')
    for i, line in enumerate(lines[2840:2870], start=2841):
        print(f"{i}: {line}")
    exit(1)

with open(TARGET, "w") as f:
    f.write(content)

print("✓ All patches written to", TARGET)
