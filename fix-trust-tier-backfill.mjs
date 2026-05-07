import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Fix 4a: Apollo contacts with verified email stuck at named_unverified
const [r1] = await conn.execute(`
  UPDATE contacts
  SET contactTrustTier = 'send_ready'
  WHERE enrichmentSource = 'apollo'
    AND emailVerified = 1
    AND verificationStatus = 'verified'
    AND contactTrustTier = 'named_unverified'
`);
console.log('Apollo named_unverified → send_ready:', r1.affectedRows);

// Fix 4b: Any web_search/linkedin contact with emailVerified=1 (defensive)
const [r2] = await conn.execute(`
  UPDATE contacts
  SET contactTrustTier = 'send_ready'
  WHERE enrichmentSource IN ('web_search', 'linkedin')
    AND emailVerified = 1
    AND contactTrustTier = 'named_unverified'
    AND crmOrphan = 0
`);
console.log('web_search/linkedin emailVerified=1 → send_ready:', r2.affectedRows);

// Fix 5: Reset stuck discovery_running projects
const [r3] = await conn.execute(`
  UPDATE projects
  SET discoveryStatus = 'discovery_queued'
  WHERE discoveryStatus = 'discovery_running'
    AND (lastDiscoveryAt IS NULL OR lastDiscoveryAt < DATE_SUB(NOW(), INTERVAL 1 HOUR))
`);
console.log('Stuck discovery_running → discovery_queued:', r3.affectedRows);

// Final send_ready count by source
const [sendReady] = await conn.execute(`
  SELECT 
    c.enrichmentSource,
    COUNT(*) as send_ready_count
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  WHERE c.contactTrustTier = 'send_ready'
    AND c.crmOrphan = 0
  GROUP BY c.enrichmentSource
  ORDER BY send_ready_count DESC
`);
console.log('Send-ready contacts by source (after all fixes):');
console.log(JSON.stringify(sendReady, null, 2));

// Total send_ready
const [total] = await conn.execute(`
  SELECT COUNT(DISTINCT c.id) as total_send_ready
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  WHERE c.contactTrustTier = 'send_ready'
    AND c.crmOrphan = 0
`);
console.log('Total unique send_ready contacts:', total[0].total_send_ready);

await conn.end();
