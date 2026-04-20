import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// Get contacts with email drafts (approved, sent, pending_approval, email_drafted)
const [rows] = await conn.execute(`
  SELECT 
    cc.id, cc.firstName, cc.lastName, cc.title, cc.company, cc.email,
    cc.enrichedEmail, cc.draftSubject, cc.draftBody, cc.outreachStatus,
    cc.enrichmentSource,
    c.name as campaignName, c.senderName, c.senderEmail, c.collateralName
  FROM campaignContacts cc
  JOIN campaigns c ON cc.campaignId = c.id
  WHERE cc.outreachStatus IN ('approved','sent','pending_approval','email_drafted')
    AND cc.draftBody IS NOT NULL 
    AND cc.draftBody != ''
    AND cc.draftSubject IS NOT NULL
  ORDER BY cc.outreachStatus ASC, cc.id DESC
  LIMIT 20
`);

console.log(JSON.stringify(rows, null, 2));
await conn.end();
