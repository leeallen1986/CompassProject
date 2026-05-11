/**
 * emailTemplate.ts — Clean HTML email template for weekly digest
 *
 * Benchmark design:
 * - Card-based signals with status badges (Action ready / Discovery needed)
 * - Each card: project title + product relevance, company subtitle, pitch, italic CTA, product tag pill
 * - Single "Open your dashboard →" CTA button at bottom
 * - Clean, minimal, enticing layout that drives dashboard visits
 */

import { ENV } from "./_core/env";

// ── Types ──

export interface EmailSignal {
  /** Project ID for linking */
  projectId: number;
  /** Status badge: "Action ready" or "Discovery needed" */
  badge: "action_ready" | "discovery_needed";
  /** Project name + product relevance (e.g., "Yara Pilbara — Advanced Compressor Hire") */
  title: string;
  /** Company/owner name */
  company: string;
  /** Short pitch paragraph explaining the opportunity and Atlas Copco's fit */
  pitch: string;
  /** Italic CTA action (e.g., "Contact the Maintenance Operations Manager to discuss equipment scope and timing") */
  ctaAction: string;
  /** Product tag pill (e.g., "Portable Air for Mining") */
  productTag: string;
}

export interface DigestEmailData {
  /** Recipient's first name */
  userName: string;
  /** Territory label (e.g., "WA", "QLD/NSW") */
  territory: string;
  /** Week label (e.g., "2026-05-04") */
  weekLabel: string;
  /** Summary line above signals (e.g., "2 action-ready opportunities this week.") */
  summaryLine: string;
  /** The signal cards */
  signals: EmailSignal[];
  /** Dashboard URL */
  dashboardUrl: string;
}

// ── Badge Styles ──

function getBadgeHtml(badge: EmailSignal["badge"]): string {
  if (badge === "action_ready") {
    return `<span style="display:inline-block;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;text-transform:uppercase;letter-spacing:0.5px;">Action ready</span>`;
  }
  return `<span style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;text-transform:uppercase;letter-spacing:0.5px;">Discovery needed</span>`;
}

// ── Signal Card ──

function renderSignalCard(signal: EmailSignal, dashboardUrl: string, index: number): string {
  const badge = getBadgeHtml(signal.badge);
  const projectUrl = `${dashboardUrl}/project/${signal.projectId}`;
  // First card has no top border; subsequent cards have a separator
  const topBorder = index === 0 ? "" : "border-top:1px solid #e2e8f0;padding-top:20px;";

  return `
    <div style="padding:16px 0;margin-bottom:4px;${topBorder}">
      <!-- Badge -->
      <div style="margin-bottom:10px;">
        ${badge}
      </div>
      <!-- Title -->
      <h3 style="margin:0 0 6px;font-size:16px;font-weight:700;color:#1e293b;line-height:1.35;">
        <a href="${projectUrl}" style="color:#1e293b;text-decoration:none;">${escapeHtml(signal.title)}</a>
      </h3>
      <!-- Company -->
      ${signal.company ? `<p style="margin:0 0 10px;font-size:13px;color:#64748b;font-weight:500;">${escapeHtml(signal.company)}</p>` : ""}
      <!-- Pitch -->
      <p style="margin:0 0 14px;font-size:14px;color:#334155;line-height:1.55;">${escapeHtml(signal.pitch)}</p>
      <!-- CTA Action -->
      <p style="margin:0 0 12px;font-size:13px;color:#0d9488;font-weight:500;">
        → <a href="${projectUrl}" style="color:#0d9488;text-decoration:none;">${escapeHtml(signal.ctaAction)}</a>
      </p>
      <!-- Product Tag Pill -->
      <span style="display:inline-block;background:#f1f5f9;color:#475569;font-size:11px;font-weight:500;padding:4px 10px;border-radius:12px;border:1px solid #e2e8f0;">${escapeHtml(signal.productTag)}</span>
    </div>`;
}

// ── Full Email HTML ──

export function buildDigestEmailHtml(data: DigestEmailData): string {
  const signalCards = data.signals.map((s, i) => renderSignalCard(s, data.dashboardUrl, i)).join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PT Capital Sales — Weekly Brief</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:20px;">
    <!-- Header -->
    <div style="background:#0d2137;padding:24px 28px;border-radius:8px 8px 0 0;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;">
            <h1 style="color:#c8a951;margin:0;font-size:18px;font-weight:700;letter-spacing:1px;">ATLAS COPCO</h1>
            <p style="color:#94a3b8;margin:4px 0 0;font-size:12px;">Power Technique — Capital Sales Intelligence</p>
          </td>
          <td style="text-align:right;vertical-align:middle;">
            <span style="color:#94a3b8;font-size:11px;">${escapeHtml(data.territory)} · ${escapeHtml(data.weekLabel)}</span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Content -->
    <div style="background:#ffffff;padding:28px;border:1px solid #e2e8f0;border-top:none;">
      <!-- Greeting + Summary -->
      <p style="margin:0 0 4px;font-size:14px;color:#1e293b;line-height:1.5;">
        Hi ${escapeHtml(data.userName)},
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.5;">
        ${escapeHtml(data.summaryLine)}
      </p>

      <!-- Section Header -->
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;">
        This week's signals
      </p>

      <!-- Signal Cards -->
      ${signalCards}

      <!-- Dashboard CTA -->
      <div style="text-align:center;padding:32px 0 8px;">
        <p style="margin:0 0 16px;font-size:14px;color:#475569;">
          See full details, reveal contacts, and act on these opportunities.
        </p>
        <a href="${data.dashboardUrl}/" style="display:inline-block;background:#0d2137;color:#ffffff;font-size:14px;font-weight:600;padding:14px 32px;border-radius:6px;text-decoration:none;letter-spacing:0.3px;">
          Open your dashboard →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="border-radius:0 0 8px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-top:none;padding:16px 28px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">
        Atlas Copco Power Technique — Weekly Market Intelligence
      </p>
      <p style="margin:4px 0 0;font-size:11px;color:#94a3b8;">
        Automated digest from your PT Intelligence platform.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Plain Text Version ──

export function buildDigestEmailText(data: DigestEmailData): string {
  let text = `PT Capital Sales — ${data.territory} Brief — ${data.weekLabel}\n\n`;
  text += `Hi ${data.userName},\n\n`;
  text += `${data.summaryLine}\n\n`;
  text += `THIS WEEK'S SIGNALS\n${"─".repeat(40)}\n\n`;

  for (const signal of data.signals) {
    const badgeLabel = signal.badge === "action_ready" ? "[Action ready]" : "[Discovery needed]";
    text += `${badgeLabel}\n`;
    text += `${signal.title}\n`;
    text += `${signal.company}\n\n`;
    text += `${signal.pitch}\n\n`;
    text += `→ ${signal.ctaAction}\n`;
    text += `[${signal.productTag}]\n\n`;
    text += `─────\n\n`;
  }

  text += `See full details, reveal contacts, and act on these opportunities.\n`;
  text += `Open your dashboard: ${data.dashboardUrl}/\n`;
  return text;
}

// ── Utility ──

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
