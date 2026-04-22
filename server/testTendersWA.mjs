/**
 * Diagnostic test for the Tenders WA scraper.
 * Run with: node server/testTendersWA.mjs
 *
 * Tests:
 *   1. Session acquisition (GET /watenders/index.do → JSESSIONID + CSRFNONCE)
 *   2. Fetch all open tenders (GET /watenders/tender/search/tender-search.action?action=advanced-tender-search-open-tender)
 *   3. HTML parsing (count rows with class "odd"/"even", extract sample data)
 *   4. Local keyword filter (count rows that pass the filter)
 *
 * Does NOT call the LLM or write to the database.
 */

import * as cheerio from "cheerio";

const BASE_URL = "https://www.tenders.wa.gov.au/watenders";
const SESSION_URL = `${BASE_URL}/index.do`;
const SEARCH_URL = `${BASE_URL}/tender/search/tender-search.action`;

const SEARCH_KEYWORDS = [
  "mining", "oil gas", "compressor", "drilling", "construction",
  "infrastructure", "energy", "pipeline", "processing plant",
  "water treatment", "pump", "generator", "power station",
  "desalination",
];

const RELEVANT_CATEGORIES = [
  "Building and Facility Construction and Maintenance Services",
  "Engineering and Research and Technology Based Services",
  "Mining", "Energy", "Oil and Gas", "Industrial Cleaning Services",
  "Environmental Services", "Plant and Equipment", "Utilities",
  "Industrial Production and Manufacturing Services",
  "Transportation and Storage and Mail Services",
];

const PRIORITY_AGENCIES = [
  "Department of Mines", "Department of Energy", "Water Corporation",
  "Main Roads", "Public Transport", "Department of Primary Industries",
  "Department of Biodiversity", "Horizon Power", "Synergy", "ATCO",
  "Woodside", "Rio Tinto", "BHP", "Fortescue", "Chevron", "Santos",
];

async function getSession() {
  console.log(`\n[1] Fetching session from ${SESSION_URL}...`);
  const res = await fetch(SESSION_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-AU,en;q=0.9",
    },
    redirect: "follow",
  });

  console.log(`    HTTP ${res.status} ${res.statusText}`);
  if (!res.ok) {
    console.error(`    FAIL: HTTP ${res.status}`);
    return null;
  }

  const setCookieHeader = res.headers.get("set-cookie") || "";
  console.log(`    Set-Cookie header: ${setCookieHeader.substring(0, 100)}...`);

  const jsessionMatch = setCookieHeader.match(/JSESSIONID=([^;]+)/);
  if (!jsessionMatch) {
    console.error("    FAIL: No JSESSIONID in Set-Cookie");
    return null;
  }
  const cookies = `JSESSIONID=${jsessionMatch[1]}`;
  console.log(`    JSESSIONID: ${jsessionMatch[1].substring(0, 20)}...`);

  const html = await res.text();
  const nonceMatch = html.match(/CSRFNONCE=([A-F0-9]{32})/);
  if (!nonceMatch) {
    console.error("    FAIL: No CSRFNONCE in page HTML");
    // Show a snippet of the HTML for debugging
    console.log("    HTML snippet (first 500 chars):", html.substring(0, 500));
    return null;
  }
  console.log(`    CSRFNONCE: ${nonceMatch[1]}`);

  return { cookies, nonce: nonceMatch[1] };
}

async function fetchAllOpenTenders(session) {
  const url = `${SEARCH_URL}?action=advanced-tender-search-open-tender&CSRFNONCE=${session.nonce}`;
  console.log(`\n[2] Fetching all open tenders from:\n    ${url}`);

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-AU,en;q=0.9",
      "Cookie": session.cookies,
      "Referer": SESSION_URL,
    },
  });

  console.log(`    HTTP ${res.status} ${res.statusText}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching open tenders`);
  }

  const html = await res.text();
  console.log(`    Response size: ${html.length.toLocaleString()} chars`);
  return html;
}

function parseTenderResults(html) {
  const $ = cheerio.load(html);

  // Count all tr elements
  const allTrs = $("tr").length;
  console.log(`\n[3] HTML parsing:`);
  console.log(`    Total <tr> elements: ${allTrs}`);

  // Count rows with class "odd" or "even" (with possible whitespace)
  let oddEvenCount = 0;
  const rows = [];

  $("tr").filter((_idx, el) => {
    const cls = ($(el).attr("class") || "").trim();
    return cls === "odd" || cls === "even";
  }).each((_idx, row) => {
    oddEvenCount++;
    const $row = $(row);

    const agency = $row.find("td.firstTableColumn").text().trim();
    const category = $row.find("td.nowrap").filter((_i, el) => {
      const cls = $(el).attr("class") || "";
      return !cls.includes("firstTableColumn");
    }).first().text().trim();

    const tenderNumCell = $row.find("td").filter((_i, el) => {
      const cls = $(el).attr("class") || "";
      return cls.includes("left") && cls.includes("top");
    }).first();
    const tenderNumber = tenderNumCell.find("b").first().text().trim();

    const titleCell = $row.find("td.top").filter((_i, el) => {
      const cls = $(el).attr("class") || "";
      return !cls.includes("nowrap") && !cls.includes("left");
    }).first();

    let title = "";
    let href = "";
    let tenderId = "";
    titleCell.find("a").each((_i, anchor) => {
      const $a = $(anchor);
      const text = $a.text().trim();
      const h = $a.attr("href") || "";
      if (text && text.length > 3 && !$a.find("img").length) {
        title = text;
        href = h;
        const idMatch = h.match(/[?&]id=(\d+)/);
        tenderId = idMatch ? idMatch[1] : "";
        return false;
      }
    });

    const closeDateRaw = $row.find("span.SUMMARY_CLOSINGDATE").text().trim();

    if (title && title.length > 5) {
      rows.push({ tenderNumber, tenderId, title, agency, category, closeDate: closeDateRaw || null, href });
    }
  });

  console.log(`    Rows with class "odd"/"even": ${oddEvenCount}`);
  console.log(`    Rows with valid title: ${rows.length}`);

  // Show first 5 rows
  console.log(`\n    Sample rows (first 5):`);
  rows.slice(0, 5).forEach((r, i) => {
    console.log(`    [${i+1}] ${r.title.substring(0, 60)}`);
    console.log(`         Agency: ${r.agency.substring(0, 50)}`);
    console.log(`         Category: ${r.category.substring(0, 50)}`);
    console.log(`         Tender#: ${r.tenderNumber || "(none)"} | ID: ${r.tenderId || "(none)"}`);
    console.log(`         Close: ${r.closeDate || "(none)"}`);
  });

  return rows;
}

function filterRows(rows) {
  const filtered = rows.filter(r => {
    const titleLower = r.title.toLowerCase();
    const categoryLower = r.category.toLowerCase();
    const agencyLower = r.agency.toLowerCase();

    const matchedKeywords = SEARCH_KEYWORDS.filter(kw =>
      titleLower.includes(kw.toLowerCase()) ||
      categoryLower.includes(kw.toLowerCase())
    );

    const isRelevantCategory = RELEVANT_CATEGORIES.some(cat =>
      categoryLower.includes(cat.toLowerCase().substring(0, 20))
    );

    const isPriorityAgency = PRIORITY_AGENCIES.some(ag =>
      agencyLower.includes(ag.toLowerCase().substring(0, 15))
    );

    return isRelevantCategory || matchedKeywords.length > 0 || isPriorityAgency;
  });

  console.log(`\n[4] Local keyword/category filter:`);
  console.log(`    Total rows: ${rows.length}`);
  console.log(`    Rows passing filter: ${filtered.length}`);
  console.log(`    Filter rate: ${((filtered.length / rows.length) * 100).toFixed(1)}%`);

  // Show first 10 filtered rows
  console.log(`\n    Filtered rows (first 10):`);
  filtered.slice(0, 10).forEach((r, i) => {
    console.log(`    [${i+1}] ${r.title.substring(0, 70)}`);
    console.log(`         Category: ${r.category.substring(0, 50)} | Close: ${r.closeDate || "(none)"}`);
  });

  return filtered;
}

async function main() {
  console.log("=== Tenders WA Diagnostic Test ===");
  console.log(`Date: ${new Date().toISOString()}`);

  try {
    const session = await getSession();
    if (!session) {
      console.error("\nFAIL: Could not acquire session. Aborting.");
      process.exit(1);
    }

    const html = await fetchAllOpenTenders(session);
    const rows = parseTenderResults(html);

    if (rows.length === 0) {
      console.error("\nFAIL: No rows parsed from HTML. Check selectors.");
      // Save HTML for inspection
      const fs = await import("fs");
      fs.writeFileSync("/tmp/tenders_wa_debug.html", html);
      console.log("    HTML saved to /tmp/tenders_wa_debug.html for inspection");
      process.exit(1);
    }

    filterRows(rows);

    console.log("\n=== PASS: Tenders WA scraper is working correctly ===");
  } catch (err) {
    console.error("\nFAIL:", err.message);
    process.exit(1);
  }
}

main();
