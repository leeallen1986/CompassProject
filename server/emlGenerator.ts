/**
 * emlGenerator.ts — Generate downloadable .eml files that look like
 * a normal hand-written Outlook email (plain text style).
 *
 * - No branded HTML template, no hero images, no marketing cards
 * - Just clean text paragraphs with Outlook-default font styling
 * - Automatic collateral PDF attachment from S3
 * - X-Unsent: 1 header so Outlook opens in compose mode (auto-inserts user's signature)
 */

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
  /** Brand to use (kept for API compatibility but no longer affects email styling) */
  brand?: "atlasCopco" | "chicagoPneumatic";
  /** Optional collateral PDF to attach */
  attachment?: {
    filename: string;
    /** Base64-encoded file content */
    contentBase64: string;
    mimeType: string;
  };
  /** Optional CTA text (appended as a plain paragraph if provided) */
  ctaText?: string;
  /** Kept for API compatibility — ignored in plain-text style */
  includeHeroImage?: boolean;
  /** Optional pre-built HTML body (from HTML template mode) — used instead of bodyText conversion */
  htmlBody?: string;
}

/**
 * Convert plain text body into simple HTML that mimics Outlook's default
 * compose style — Calibri 11pt, normal paragraph spacing, no decoration.
 * Each paragraph (separated by \n\n) becomes a <p>.
 * Single \n within a paragraph becomes <br>.
 */
function bodyToSimpleHtml(text: string): string {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  return paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 12px 0;font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.5;color:#000000;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`
    )
    .join("\n");
}

/**
 * Build a minimal HTML email that looks like a normal Outlook compose window.
 * No branding, no images, no cards — just clean paragraphs on a white background.
 */
function buildPlainStyleHtml(opts: EmlOptions): string {
  let bodyContent = bodyToSimpleHtml(opts.bodyText);

  // If there's a CTA text, append it as a regular paragraph (not a styled card)
  if (opts.ctaText) {
    bodyContent += `\n<p style="margin:0 0 12px 0;font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.5;color:#000000;">${escapeHtml(opts.ctaText)}</p>`;
  }

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
<body style="margin:0;padding:0;background-color:#FFFFFF;">
<div style="max-width:800px;padding:0;font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;color:#000000;">
${bodyContent}
</div>
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
 * Produces a plain-text-style email (looks like a normal written email in Outlook).
 * Supports optional PDF attachment via multipart/mixed.
 * Uses X-Unsent: 1 header so Outlook opens the .eml in compose/new-message mode,
 * which triggers automatic insertion of the user's Outlook signature.
 */
export function buildEmlFile(opts: EmlOptions): string {
  // If a pre-built HTML body is provided (HTML template mode), use it directly;
  // otherwise generate the simple Outlook-style HTML from plain text
  const html = opts.htmlBody || buildPlainStyleHtml(opts);
  const plainText = opts.bodyText + (opts.ctaText ? "\n\n" + opts.ctaText : "");
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
 * Kept for API compatibility — brand no longer affects email styling
 * but may be used for other purposes (e.g. collateral selection).
 */
export function detectBrand(collateralName?: string): "atlasCopco" | "chicagoPneumatic" {
  if (!collateralName) return "atlasCopco";
  const lower = collateralName.toLowerCase();
  if (lower.includes("cp ") || lower.includes("chicago") || lower.includes("pneumatic")) {
    return "chicagoPneumatic";
  }
  return "atlasCopco";
}
