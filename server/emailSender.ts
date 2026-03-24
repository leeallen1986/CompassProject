/**
 * Email Sender Service
 * Uses Resend API to send personalized emails directly to individual users.
 * Falls back to notifyOwner() if Resend is not configured.
 */
import { Resend } from "resend";
import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!ENV.resendApiKey) {
    console.warn("[EmailSender] RESEND_API_KEY not configured, will fall back to notifyOwner");
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(ENV.resendApiKey);
  }
  return resendClient;
}

/**
 * The "from" address for all digest emails.
 * Using verified custom domain: ptatlascopcointel.com
 * Falls back to onboarding@resend.dev if custom domain is not yet verified.
 */
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS ?? "Atlas Copco PT Intelligence <digest@ptaltascopcointel.com>";

export interface SendEmailOptions {
  to: string;
  subject: string;
  /** Markdown-formatted content — will be converted to simple HTML */
  markdownContent: string;
  /** Plain text fallback */
  textContent?: string;
}

/**
 * Convert markdown-ish content to simple HTML for email rendering.
 * Handles: bold, links, line breaks, horizontal rules, headers, bullet points.
 */
function markdownToHtml(md: string): string {
  let html = md
    // Escape HTML entities first
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.+)$/gm, '<h3 style="color:#0d2137;margin:16px 0 8px;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#0d2137;margin:20px 0 10px;">$1</h2>')
    .replace(/^\*\*(.+?)\*\*$/gm, '<h3 style="color:#0d2137;margin:16px 0 8px;">$1</h3>')
    // Bold inline
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#c8a951;">$1</a>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">')
    // Bullet points
    .replace(/^• (.+)$/gm, '<li style="margin:4px 0;">$1</li>')
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0;">$1</li>')
    // Emojis are fine as-is
    // Line breaks
    .replace(/\n\n/g, '</p><p style="margin:8px 0;line-height:1.6;">')
    .replace(/\n/g, '<br>');

  // Wrap in email template
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:20px;">
    <!-- Header -->
    <div style="background:#0d2137;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h1 style="color:#c8a951;margin:0;font-size:18px;letter-spacing:1px;">ATLAS COPCO</h1>
      <p style="color:#94a3b8;margin:4px 0 0;font-size:12px;">Power Technique — Market Intelligence</p>
    </div>
    <!-- Content -->
    <div style="background:#ffffff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
      <p style="margin:8px 0;line-height:1.6;color:#1e293b;font-size:14px;">
        ${html}
      </p>
    </div>
    <!-- Footer -->
    <div style="text-align:center;padding:16px;color:#94a3b8;font-size:11px;">
      <p>Atlas Copco Power Technique — Weekly Market Intelligence</p>
      <p>This is an automated digest from your PT Intelligence platform.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send an email to a specific user via Resend.
 * Falls back to notifyOwner() if Resend is not configured.
 * Returns true on success, false on failure.
 */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const client = getResendClient();

  if (!client) {
    // Fallback: send via notifyOwner (goes to project owner only)
    console.warn(`[EmailSender] Falling back to notifyOwner for ${options.to}`);
    return notifyOwner({
      title: options.subject,
      content: options.textContent || options.markdownContent,
    });
  }

  try {
    const htmlContent = markdownToHtml(options.markdownContent);

    const { data, error } = await client.emails.send({
      from: FROM_ADDRESS,
      to: [options.to],
      subject: options.subject,
      html: htmlContent,
      text: options.textContent || options.markdownContent,
    });

    if (error) {
      console.error(`[EmailSender] Resend error for ${options.to}:`, error);
      return false;
    }

    console.log(`[EmailSender] ✓ Email sent to ${options.to} (id: ${data?.id})`);
    return true;
  } catch (err) {
    console.error(`[EmailSender] Failed to send to ${options.to}:`, err);
    return false;
  }
}

/**
 * Send emails to multiple recipients in sequence with a small delay.
 * Returns counts of sent/failed.
 */
export async function sendBulkEmails(
  emails: SendEmailOptions[]
): Promise<{ sent: number; failed: number }> {
  const results = { sent: 0, failed: 0 };

  for (const email of emails) {
    const success = await sendEmail(email);
    if (success) {
      results.sent++;
    } else {
      results.failed++;
    }
    // Small delay between sends to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  return results;
}

/**
 * Validate that the Resend API key is working.
 * Returns true if the API key is valid.
 */
export async function validateResendKey(): Promise<boolean> {
  const client = getResendClient();
  if (!client) return false;

  try {
    // Try listing domains first; if key is send-only restricted, that's still valid
    const { data, error } = await client.domains.list();
    if (error) {
      // "restricted_api_key" means the key is valid but limited to sending only — that's fine
      if ((error as any).name === "restricted_api_key" || (error as any).statusCode === 401) {
        console.log("[EmailSender] Resend API key valid (send-only restricted)");
        return true;
      }
      // A 403 with "invalid API key" means the key itself is wrong
      if ((error as any).statusCode === 403) {
        console.error("[EmailSender] Resend API key is invalid:", error);
        return false;
      }
      console.error("[EmailSender] Resend API key validation failed:", error);
      return false;
    }
    console.log(`[EmailSender] Resend API key valid, ${data?.data?.length || 0} domains configured`);
    return true;
  } catch (err) {
    console.error("[EmailSender] Resend API key validation error:", err);
    return false;
  }
}
