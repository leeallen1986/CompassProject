import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import archiver from "archiver";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// Simulate the "Download All" flow — get all approved contacts from a campaign
const [campaigns] = await conn.execute(`
  SELECT id, name, senderName, senderEmail, collateralName
  FROM campaigns
  WHERE id IN (
    SELECT DISTINCT campaignId FROM campaignContacts 
    WHERE outreachStatus IN ('approved','sent') 
    AND draftBody IS NOT NULL AND draftBody != ''
  )
  LIMIT 1
`);

if (!campaigns.length) {
  console.log("No campaigns with approved emails found");
  process.exit(0);
}

const campaign = campaigns[0];
console.log(`Campaign: ${campaign.name}`);

const [contacts] = await conn.execute(`
  SELECT 
    cc.id, cc.firstName, cc.lastName, cc.title, cc.company, cc.email,
    cc.enrichedEmail, cc.draftSubject, cc.draftBody, cc.outreachStatus,
    cc.score, cc.tier, cc.roleBucket
  FROM campaignContacts cc
  WHERE cc.campaignId = ?
    AND cc.outreachStatus IN ('approved','sent','pending_approval','email_drafted')
    AND cc.draftBody IS NOT NULL AND cc.draftBody != ''
    AND cc.draftSubject IS NOT NULL
  ORDER BY cc.score DESC
`, [campaign.id]);

console.log(`Found ${contacts.length} contacts with emails for this campaign`);

const outDir = "/home/ubuntu/audit_download_all";
fs.mkdirSync(outDir, { recursive: true });

// Build EML for each
for (const contact of contacts) {
  const toEmail = contact.enrichedEmail || contact.email || "unknown@unknown.com";
  const fromEmail = campaign.senderEmail || "tim.oneil-shaw@atlascopco.com";
  const fromName = campaign.senderName || "Tim O'Neil Shaw";
  const subject = contact.draftSubject;
  const isHtml = contact.draftBody && (contact.draftBody.trim().startsWith('<') || contact.draftBody.includes('<p>') || contact.draftBody.includes('<br'));
  const now = new Date().toUTCString();
  const msgId = `<dl-${contact.id}-${Date.now()}@atlascopco.com>`;
  
  let eml;
  if (isHtml) {
    const plainText = contact.draftBody
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n').trim();
    const boundary = `----=_Part_${contact.id}_${Date.now()}`;
    eml = `MIME-Version: 1.0\nDate: ${now}\nMessage-ID: ${msgId}\nFrom: ${fromName} <${fromEmail}>\nTo: ${contact.firstName} ${contact.lastName} <${toEmail}>\nSubject: ${subject}\nContent-Type: multipart/alternative; boundary="${boundary}"\n\n--${boundary}\nContent-Type: text/plain; charset=UTF-8\n\n${plainText}\n\n--${boundary}\nContent-Type: text/html; charset=UTF-8\n\n${contact.draftBody}\n\n--${boundary}--\n`;
  } else {
    eml = `MIME-Version: 1.0\nDate: ${now}\nMessage-ID: ${msgId}\nFrom: ${fromName} <${fromEmail}>\nTo: ${contact.firstName} ${contact.lastName} <${toEmail}>\nSubject: ${subject}\nContent-Type: text/plain; charset=UTF-8\n\n${contact.draftBody}\n`;
  }
  
  const safeName = `${String(contact.score).padStart(3,'0')}_${contact.firstName}_${contact.lastName}_${contact.company}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 70);
  const filename = `${safeName}.eml`;
  fs.writeFileSync(path.join(outDir, filename), eml, 'utf8');
  console.log(`  ✓ ${filename}`);
}

// Write a README
const readme = `Atlas Copco Outreach EMLs — ${campaign.name}
Generated: ${new Date().toISOString()}
Campaign: ${campaign.name}
Collateral: ${campaign.collateralName}
Sender: ${campaign.senderName} <${campaign.senderEmail}>
Total emails: ${contacts.length}

HOW TO SEND:
1. Open each .eml file in Outlook (double-click)
2. Review the email — personalisation is pre-filled
3. Click Send
4. Files are sorted by score (highest first)

NOTE: Files named 0XX_ have lower scores — review these more carefully.
`;
fs.writeFileSync(path.join(outDir, "README.txt"), readme);

// Create ZIP
const zipPath = "/home/ubuntu/atlas_copco_download_all.zip";
const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

await new Promise((resolve, reject) => {
  output.on('close', resolve);
  archive.on('error', reject);
  archive.pipe(output);
  archive.directory(outDir, `${campaign.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0,40)}_emails`);
  archive.finalize();
});

const zipSize = fs.statSync(zipPath).size;
console.log(`\nDownload-All ZIP: ${zipPath}`);
console.log(`ZIP size: ${zipSize} bytes (${(zipSize/1024).toFixed(1)} KB)`);
console.log(`Files in ZIP: ${contacts.length + 1} (${contacts.length} EMLs + README)`);

await conn.end();
