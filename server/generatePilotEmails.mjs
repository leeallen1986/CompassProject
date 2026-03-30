/**
 * generatePilotEmails.mjs — Generate pilot outreach emails for top 5 XAVS1800 campaign contacts
 * Uses the LLM-powered email composer with XAVS1800 collateral context
 */

import "dotenv/config";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;
if (!FORGE_API_URL || !FORGE_API_KEY) { console.error("FORGE API env not set"); process.exit(1); }

const url = new URL(DATABASE_URL);
const pool = mysql.createPool({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit: 5,
});

const CONTACT_IDS = [7943, 4833, 4648, 4700, 4646];

const XAVS1800_CONTEXT = `
The XAVS1800 is Atlas Copco's high-volume portable air compressor designed for demanding abrasive blasting operations:
- 1,800 cfm at 7 bar (or 1,500 cfm at 14 bar dual pressure)
- Built for continuous blasting operations requiring high air volumes
- Dual pressure capability for versatile applications
- Fuel-efficient design with low operating costs
- DrillAirXpert controller for precise pressure management
- Dynamic Flow Boost technology
- Ideal for: abrasive blasting, sandblasting, surface preparation, pipeline coating, shipyard maintenance
- Key differentiators: highest cfm-per-footprint ratio, dual pressure flexibility, proven reliability in harsh Australian conditions
`;

async function invokeLLM(messages) {
  const res = await fetch(`${FORGE_API_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${FORGE_API_KEY}`,
    },
    body: JSON.stringify({
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "outreach_email",
          strict: true,
          schema: {
            type: "object",
            properties: {
              subject: { type: "string", description: "Email subject line" },
              body: { type: "string", description: "Email body in plain text with line breaks" },
              keyPoints: {
                type: "array",
                items: { type: "string" },
                description: "3-5 key talking points used in the email"
              },
            },
            required: ["subject", "body", "keyPoints"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown");
    throw new Error(`LLM API error ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function main() {
  console.log("=== Generating Pilot Emails for XAVS1800 Campaign ===\n");

  for (const contactId of CONTACT_IDS) {
    const [rows] = await pool.query(
      `SELECT id, firstName, lastName, title, enrichedTitle, company, reviewedCompanyName, 
              email, enrichedEmail, score, tier, titleRelevance, matchedProjectIds, matchedProjectCount
       FROM campaignContacts WHERE id = ?`,
      [contactId]
    );
    const contact = rows[0];
    if (!contact) { console.log(`Contact ${contactId} not found — skipping`); continue; }

    const fullName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim();
    const contactTitle = contact.enrichedTitle || contact.title || "Operations";
    const company = contact.reviewedCompanyName || contact.company || "";
    const contactEmail = contact.enrichedEmail || contact.email || "";

    console.log(`━━━ ${fullName} ━━━`);
    console.log(`  Title: ${contactTitle}`);
    console.log(`  Company: ${company}`);
    console.log(`  Email: ${contactEmail}`);
    console.log(`  Score: ${contact.score} | Tier: ${contact.tier}`);

    // Get matched project context if available
    let projectContext = "";
    if (contact.matchedProjectCount > 0 && contact.matchedProjectIds) {
      try {
        const projectIds = JSON.parse(contact.matchedProjectIds);
        if (projectIds.length > 0) {
          const [projects] = await pool.query(
            `SELECT name, location, owner, overview FROM projects WHERE id IN (${projectIds.map(() => '?').join(',')})`,
            projectIds
          );
          if (projects.length > 0) {
            projectContext = projects.map(p => `Project: ${p.name} (${p.location}) — ${p.owner}. ${(p.overview || "").substring(0, 200)}`).join("\n");
          }
        }
      } catch (e) {
        // ignore JSON parse errors
      }
    }

    const systemPrompt = `You are writing a professional outreach email on behalf of Ryan Pemberton, Business Line Manager — Portable Air at Atlas Copco Power Technique, Australia.

IMPORTANT RULES:
- This is a FIRST TOUCH email — keep it concise (150-200 words max), professional, and focused
- The recipient works in abrasive blasting/coating — they understand the industry
- DO NOT be salesy or pushy — be consultative and helpful
- Reference the XAVS1800's specific capabilities relevant to their role
- If project intelligence is available, reference it naturally (e.g., "I noticed your team is involved in...")
- Sign off as "Ryan Pemberton, Business Line Manager — Portable Air, Atlas Copco Power Technique"
- Include a soft CTA like "Would you be open to a brief call?" or "Happy to share more details"
- Use Australian English spelling (e.g., "optimise" not "optimize")
- Keep the tone warm but professional — like a peer reaching out, not a cold sales pitch
- Do NOT use markdown formatting in the email body — plain text only with line breaks`;

    const userPrompt = `Generate an outreach email for:

Recipient: ${fullName}
Title: ${contactTitle}
Company: ${company}

${XAVS1800_CONTEXT}

${projectContext ? `RELEVANT PROJECT INTELLIGENCE:\n${projectContext}\n` : ""}

Write a personalised first-touch email from Ryan Pemberton introducing the XAVS1800 and its relevance to their work.`;

    try {
      console.log("  Generating email...");
      const result = await invokeLLM([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);

      console.log(`  Subject: ${result.subject}`);
      console.log(`  Key Points: ${result.keyPoints.join(", ")}`);
      console.log(`  Body preview: ${result.body.substring(0, 150)}...`);
      console.log();

      // Save draft to database
      await pool.query(
        `UPDATE campaignContacts SET 
          draftSubject = ?,
          draftBody = ?,
          draftKeyPoints = ?,
          draftTone = 'first_touch',
          draftGeneratedAt = NOW(),
          outreachStatus = 'pending_approval'
        WHERE id = ?`,
        [result.subject, result.body, JSON.stringify(result.keyPoints), contactId]
      );

      console.log(`  ✓ Draft saved — pending Ryan's approval\n`);
    } catch (err) {
      console.error(`  ✗ Error generating email: ${err.message}\n`);
    }

    // Small delay between LLM calls
    await new Promise(r => setTimeout(r, 1000));
  }

  // Update campaign stats
  const [statsResult] = await pool.query(
    `SELECT COUNT(*) as pending FROM campaignContacts WHERE campaignId = 2 AND outreachStatus = 'pending_approval'`
  );
  console.log(`\n━━━ Summary ━━━`);
  console.log(`  ${statsResult[0].pending} emails pending Ryan's approval`);
  console.log(`  View them in the Approval Queue tab on the Campaigns page`);

  await pool.end();
  console.log("\n✓ Done!");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
