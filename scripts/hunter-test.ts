/**
 * Quick test: verify Hunter.io API is responding for email finder calls
 */
import "dotenv/config";

const HUNTER_API_BASE = "https://api.hunter.io/v2";
const apiKey = process.env.HUNTER_API_KEY;

async function testEmailFinder() {
  console.log("Testing Hunter.io Email Finder...");
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  
  try {
    const params = new URLSearchParams({
      api_key: apiKey!,
      first_name: "John",
      last_name: "Smith",
      domain: "atlascopco.com",
    });
    
    const url = `${HUNTER_API_BASE}/email-finder?${params}`;
    console.log("Calling:", url.replace(apiKey!, "***"));
    
    const start = Date.now();
    const res = await fetch(url, { signal: controller.signal });
    const elapsed = Date.now() - start;
    
    console.log(`Response: ${res.status} in ${elapsed}ms`);
    const json = await res.json();
    console.log("Result:", JSON.stringify(json.data, null, 2));
  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function testDomainSearch() {
  console.log("\nTesting Hunter.io Domain Search...");
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  
  try {
    const params = new URLSearchParams({
      api_key: apiKey!,
      domain: "atlascopco.com",
      type: "personal",
      limit: "5",
    });
    
    const url = `${HUNTER_API_BASE}/domain-search?${params}`;
    console.log("Calling:", url.replace(apiKey!, "***"));
    
    const start = Date.now();
    const res = await fetch(url, { signal: controller.signal });
    const elapsed = Date.now() - start;
    
    console.log(`Response: ${res.status} in ${elapsed}ms`);
    const json = await res.json();
    console.log(`Found ${json.data?.emails?.length || 0} emails`);
    if (json.data?.emails?.[0]) {
      console.log("Sample:", JSON.stringify(json.data.emails[0], null, 2));
    }
  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function testAccountInfo() {
  console.log("\nChecking Hunter.io Account Info...");
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  
  try {
    const params = new URLSearchParams({ api_key: apiKey! });
    const url = `${HUNTER_API_BASE}/account?${params}`;
    
    const start = Date.now();
    const res = await fetch(url, { signal: controller.signal });
    const elapsed = Date.now() - start;
    
    console.log(`Response: ${res.status} in ${elapsed}ms`);
    const json = await res.json();
    const acct = json.data;
    console.log(`Plan: ${acct?.plan_name}`);
    console.log(`Searches: ${acct?.requests?.searches?.used}/${acct?.requests?.searches?.available}`);
    console.log(`Verifications: ${acct?.requests?.verifications?.used}/${acct?.requests?.verifications?.available}`);
  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  if (!apiKey) {
    console.error("HUNTER_API_KEY not set");
    process.exit(1);
  }
  
  await testAccountInfo();
  await testDomainSearch();
  await testEmailFinder();
}

main().catch(console.error);
