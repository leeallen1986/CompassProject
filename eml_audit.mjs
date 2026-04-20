import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import archiver from "archiver";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// Get contacts with email drafts
const [rows] = await conn.execute(`
  SELECT 
    cc.id, cc.firstName, cc.lastName, cc.title, cc.company, cc.email,
    cc.enrichedEmail, cc.draftSubject, cc.draftBody, cc.outreachStatus,
    cc.enrichmentSource_cc as enrichmentSource,
    cc.hunterConfidence, cc.hunterVerificationStatus,
    cc.score, cc.tier, cc.roleBucket, cc.titleRelevance,
    cc.matchedProjectCount,
    c.name as campaignName, c.senderName, c.senderEmail, c.collateralName
  FROM campaignContacts cc
  JOIN campaigns c ON cc.campaignId = c.id
  WHERE cc.outreachStatus IN ('approved','sent','pending_approval','email_drafted')
    AND cc.draftBody IS NOT NULL 
    AND cc.draftBody != ''
    AND cc.draftSubject IS NOT NULL
  ORDER BY 
    CASE cc.outreachStatus 
      WHEN 'sent' THEN 1 
      WHEN 'approved' THEN 2 
      WHEN 'email_drafted' THEN 3 
      WHEN 'pending_approval' THEN 4 
    END ASC,
    cc.score DESC
  LIMIT 10
`);

console.log(`Found ${rows.length} contacts with email drafts`);

// Build EML for each
const outDir = "/home/ubuntu/audit_emls";
fs.mkdirSync(outDir, { recursive: true });

function buildEml(contact) {
  const toEmail = contact.enrichedEmail || contact.email || `${contact.firstName.toLowerCase()}.${contact.lastName.toLowerCase()}@${contact.company.toLowerCase().replace(/\s+/g, '')}.com.au`;
  const fromEmail = contact.senderEmail || "tim.oneil-shaw@atlascopco.com";
  const fromName = contact.senderName || "Tim O'Neil Shaw";
  const subject = contact.draftSubject || `Atlas Copco — ${contact.collateralName}`;
  
  // Detect if body is HTML
  const isHtml = contact.draftBody && (contact.draftBody.trim().startsWith('<') || contact.draftBody.includes('<p>') || contact.draftBody.includes('<br'));
  
  const now = new Date().toUTCString();
  const msgId = `<audit-${contact.id}-${Date.now()}@atlascopco.com>`;
  
  let eml;
  if (isHtml) {
    // Strip HTML for plain text fallback
    const plainText = contact.draftBody
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    
    const boundary = `----=_Part_${contact.id}_${Date.now()}`;
    eml = `MIME-Version: 1.0
Date: ${now}
Message-ID: ${msgId}
From: ${fromName} <${fromEmail}>
To: ${contact.firstName} ${contact.lastName} <${toEmail}>
Subject: ${subject}
Content-Type: multipart/alternative; boundary="${boundary}"

--${boundary}
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

${plainText}

--${boundary}
Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

${contact.draftBody}

--${boundary}--
`;
  } else {
    eml = `MIME-Version: 1.0
Date: ${now}
Message-ID: ${msgId}
From: ${fromName} <${fromEmail}>
To: ${contact.firstName} ${contact.lastName} <${toEmail}>
Subject: ${subject}
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

${contact.draftBody}
`;
  }
  
  return eml;
}

const manifest = [];

for (const contact of rows) {
  const eml = buildEml(contact);
  const safeName = `${contact.firstName}_${contact.lastName}_${contact.company}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
  const filename = `${contact.outreachStatus}_${safeName}.eml`;
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, eml, 'utf8');
  
  manifest.push({
    file: filename,
    status: contact.outreachStatus,
    name: `${contact.firstName} ${contact.lastName}`,
    title: contact.title,
    company: contact.company,
    toEmail: contact.enrichedEmail || contact.email || "(no email)",
    subject: contact.draftSubject,
    campaign: contact.campaignName,
    collateral: contact.collateralName,
    score: contact.score,
    tier: contact.tier,
    roleBucket: contact.roleBucket,
    enrichmentSource: contact.enrichmentSource,
    hunterConfidence: contact.hunterConfidence,
    bodyLength: contact.draftBody?.length || 0,
    isHtml: contact.draftBody?.includes('<p>') || contact.draftBody?.trim().startsWith('<') || false
  });
  
  console.log(`✓ ${filename}`);
}

// Write manifest
fs.writeFileSync(path.join(outDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2));

// Create ZIP
const zipPath = "/home/ubuntu/atlas_copco_emls_audit.zip";
const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

await new Promise((resolve, reject) => {
  output.on('close', resolve);
  archive.on('error', reject);
  archive.pipe(output);
  archive.directory(outDir, 'atlas_copco_emls');
  archive.finalize();
});

console.log(`\nZIP created: ${zipPath} (${fs.statSync(zipPath).size} bytes)`);
console.log("\nMANIFEST:");
manifest.forEach(m => {
  console.log(`  [${m.status}] ${m.name} @ ${m.company} → ${m.toEmail}`);
  console.log(`    Subject: ${m.subject}`);
  console.log(`    Score: ${m.score} | Tier: ${m.tier} | Role: ${m.roleBucket} | HTML: ${m.isHtml}`);
  console.log();
});

await conn.end();
