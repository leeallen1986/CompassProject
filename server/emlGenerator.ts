/**
 * emlGenerator.ts — Generate downloadable .eml files with:
 * - Outlook-compatible HTML email body (table-based layout)
 * - Automatic collateral PDF attachment from S3
 * - X-Unsent: 1 header so Outlook opens in compose mode (auto-inserts user's signature)
 * - Professional Atlas Copco / Chicago Pneumatic branding with product imagery
 */

// ── Brand colour palette ──
const BRAND = {
  atlasCopco: {
    primary: "#0A2240",     // Deep navy
    accent: "#D4A843",      // Gold
    text: "#333333",
    lightBg: "#F7F5F0",
    border: "#E0DCD4",
    headerBg: "#0A2240",
    headerText: "#FFFFFF",
    ctaBg: "#D4A843",
    ctaText: "#0A2240",
    logoUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310519663178278143/3SMu786VMCWdCnmNSx6pxw/ac-logo-pt_3537326f.png",
    heroUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310519663178278143/3SMu786VMCWdCnmNSx6pxw/ac-xavs1800_40420fc1.jpg",
    heroAlt: "Atlas Copco X-Air+ Portable Compressor",
  },
  chicagoPneumatic: {
    primary: "#C41230",     // CP Red
    accent: "#1A1A1A",
    text: "#333333",
    lightBg: "#FDF5F5",
    border: "#E8D8D8",
    headerBg: "#C41230",
    headerText: "#FFFFFF",
    ctaBg: "#C41230",
    ctaText: "#FFFFFF",
    logoUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310519663178278143/3SMu786VMCWdCnmNSx6pxw/cp-logo-full_abc82cf4.png",
    heroUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310519663178278143/3SMu786VMCWdCnmNSx6pxw/cp-t110-compressor_501583a7.jpeg",
    heroAlt: "Chicago Pneumatic T110 Truck Air Compressor",
  },
};

interface EmlOptions {
  /** Sender's display name */
  fromName: string;
  /** Sender's email address */
  fromEmail: string;
  /** Recipient's display name */
  toName: string;
  /** Recipient's email address */
  toEmail: string;
  /** Email subject line */
  subject: string;
  /** Plain text body (paragraph-separated by \n\n) */
  bodyText: string;
  /** Brand to use for styling */
  brand?: "atlasCopco" | "chicagoPneumatic";
  /** Optional collateral PDF to attach */
  attachment?: {
    filename: string;
    /** Base64-encoded file content */
    contentBase64: string;
    mimeType: string;
  };
  /** Optional CTA text shown at the bottom of the email */
  ctaText?: string;
  /** Whether to include product hero image in the email (default: true) */
  includeHeroImage?: boolean;
}

/**
 * Convert plain text body paragraphs into Outlook-compatible HTML.
 * Each paragraph (separated by \n\n) becomes a styled <p> in a table cell.
 * Single \n within a paragraph becomes <br/>.
 */
function bodyToHtml(text: string, colors: typeof BRAND.atlasCopco): string {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  return paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:14px;line-height:1.6;color:${colors.text};">${p.replace(/\n/g, "<br/>")}</p>`
    )
    .join("\n");
}

/**
 * Build the full Outlook-compatible HTML email.
 * Uses table-based layout for maximum compatibility with Outlook's Word rendering engine.
 * Includes brand logo in header and optional product hero image.
 */
function buildHtmlEmail(opts: EmlOptions): string {
  const colors = opts.brand === "chicagoPneumatic" ? BRAND.chicagoPneumatic : BRAND.atlasCopco;
  const brandName = opts.brand === "chicagoPneumatic" ? "Chicago Pneumatic" : "Atlas Copco";
  const bodyHtml = bodyToHtml(opts.bodyText, colors);
  const showHero = opts.includeHeroImage !== false;

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(opts.subject)}</title>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#FFFFFF;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<!-- Outer wrapper table for email client compatibility -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#FFFFFF;">
<tr><td align="center" style="padding:24px 16px;">

<!-- Main content card -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:8px;overflow:hidden;border:1px solid ${colors.border};">

  <!-- Header bar with logo -->
  <tr>
    <td style="background-color:${colors.headerBg};padding:16px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="vertical-align:middle;width:44px;padding-right:12px;">
            <img src="${colors.logoUrl}" alt="${escapeHtml(brandName)}" width="40" height="40" style="display:block;border:0;outline:none;width:40px;height:40px;border-radius:4px;" />
          </td>
          <td style="font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:2px;color:${colors.headerText};text-transform:uppercase;vertical-align:middle;">
            ${escapeHtml(brandName)}
          </td>
          <td align="right" style="font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:11px;color:${colors.headerText};opacity:0.7;vertical-align:middle;">
            ${opts.brand === "chicagoPneumatic" ? "Part of Atlas Copco Group" : "Power Technique"}
          </td>
        </tr>
      </table>
    </td>
  </tr>

  ${showHero ? `
  <!-- Product hero image -->
  <tr>
    <td style="padding:0;line-height:0;">
      <img src="${colors.heroUrl}" alt="${escapeHtml(colors.heroAlt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;" />
    </td>
  </tr>
  ` : ""}

  <!-- Body content -->
  <tr>
    <td style="padding:28px 28px 12px 28px;">
      ${bodyHtml}
    </td>
  </tr>

  <!-- CTA section (optional) -->
  ${opts.ctaText ? `
  <tr>
    <td style="padding:0 28px 24px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="background-color:${colors.lightBg};border-radius:6px;padding:16px 20px;border-left:4px solid ${colors.accent};">
            <p style="margin:0;font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:13px;line-height:1.5;color:${colors.text};font-style:italic;">
              ${escapeHtml(opts.ctaText)}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  ` : ""}

  <!-- Footer divider -->
  <tr>
    <td style="padding:0 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="border-top:1px solid ${colors.border};padding-top:16px;padding-bottom:20px;">
            <p style="margin:0;font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:10px;color:#999999;text-align:center;">
              ${escapeHtml(brandName)} &mdash; Part of the Atlas Copco Group
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
<!-- End main content card -->

</td></tr>
</table>
<!-- End outer wrapper -->

</body>
</html>`;
}

/** Escape HTML entities */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate a MIME boundary string.
 */
function generateBoundary(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "----=_Part_";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Fold long header lines at 76 characters (RFC 2822 compliance).
 */
function foldHeader(value: string, maxLen = 76): string {
  if (value.length <= maxLen) return value;
  const lines: string[] = [];
  let remaining = value;
  while (remaining.length > maxLen) {
    let breakAt = remaining.lastIndexOf(" ", maxLen);
    if (breakAt <= 0) breakAt = maxLen;
    lines.push(remaining.substring(0, breakAt));
    remaining = " " + remaining.substring(breakAt).trimStart();
  }
  lines.push(remaining);
  return lines.join("\r\n");
}

/**
 * Encode a string for use in email headers using RFC 2047 encoded-word syntax.
 * Only encodes if the string contains non-ASCII characters.
 */
function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

/**
 * Build a complete .eml file as a string.
 * Supports multipart/mixed (HTML body + optional attachment).
 * Uses X-Unsent: 1 header so Outlook opens the .eml in compose/new-message mode,
 * which triggers automatic insertion of the user's Outlook signature.
 */
export function buildEmlFile(opts: EmlOptions): string {
  const html = buildHtmlEmail(opts);
  const plainText = opts.bodyText;
  const date = new Date().toUTCString();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@atlascopco.com>`;

  const fromHeader = `${encodeHeaderValue(opts.fromName)} <${opts.fromEmail}>`;
  const toHeader = `${encodeHeaderValue(opts.toName)} <${opts.toEmail}>`;
  const subjectHeader = encodeHeaderValue(opts.subject);

  if (!opts.attachment) {
    // Simple multipart/alternative (plain text + HTML)
    const altBoundary = generateBoundary();
    return [
      `From: ${fromHeader}`,
      `To: ${toHeader}`,
      `Subject: ${subjectHeader}`,
      `Date: ${date}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `X-Unsent: 1`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      `X-Mailer: Atlas Copco Intelligence Platform`,
      ``,
      `--${altBoundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: quoted-printable`,
      ``,
      plainText,
      ``,
      `--${altBoundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: quoted-printable`,
      ``,
      html,
      ``,
      `--${altBoundary}--`,
    ].join("\r\n");
  }

  // Multipart/mixed with attachment
  const mixedBoundary = generateBoundary();
  const altBoundary = generateBoundary();

  return [
    `From: ${fromHeader}`,
    `To: ${toHeader}`,
    `Subject: ${subjectHeader}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
    `X-Unsent: 1`,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    `X-Mailer: Atlas Copco Intelligence Platform`,
    ``,
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ``,
    `--${altBoundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    plainText,
    ``,
    `--${altBoundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    html,
    ``,
    `--${altBoundary}--`,
    ``,
    `--${mixedBoundary}`,
    `Content-Type: ${opts.attachment.mimeType}; name="${opts.attachment.filename}"`,
    `Content-Disposition: attachment; filename="${opts.attachment.filename}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    // Split base64 into 76-char lines (RFC 2045)
    opts.attachment.contentBase64.replace(/(.{76})/g, "$1\r\n"),
    ``,
    `--${mixedBoundary}--`,
  ].join("\r\n");
}

/**
 * Fetch a file from a URL and return its base64-encoded content.
 */
export async function fetchFileAsBase64(url: string): Promise<{
  base64: string;
  mimeType: string;
  filename: string;
}> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  // Extract filename from URL
  const urlPath = new URL(url).pathname;
  const filename = decodeURIComponent(urlPath.split("/").pop() || "attachment.pdf");

  const mimeType = response.headers.get("content-type") || "application/pdf";

  return { base64, mimeType: mimeType.split(";")[0], filename };
}

/**
 * Determine which brand to use based on collateral name.
 */
export function detectBrand(collateralName?: string): "atlasCopco" | "chicagoPneumatic" {
  if (!collateralName) return "atlasCopco";
  const lower = collateralName.toLowerCase();
  if (lower.includes("cp ") || lower.includes("chicago") || lower.includes("pneumatic")) {
    return "chicagoPneumatic";
  }
  return "atlasCopco";
}
