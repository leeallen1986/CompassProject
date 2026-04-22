import * as cheerio from "cheerio";
import { readFileSync } from "fs";

const html = readFileSync("/tmp/tenders_wa_debug.html", "utf8");
const $ = cheerio.load(html);

const SEARCH_KEYWORDS = [
  "mining", "oil gas", "compressor", "drilling", "construction",
  "infrastructure", "energy", "pipeline", "processing plant",
  "water treatment", "pump", "generator", "power station", "desalination",
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

const categoryCounts = {};
const passedRows = [];
const failedRows = [];

$("tr").filter((_idx, el) => {
  const cls = ($(el).attr("class") || "").trim();
  return cls === "odd" || cls === "even";
}).each((_idx, row) => {
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
  titleCell.find("a").each((_i, anchor) => {
    const $a = $(anchor);
    const text = $a.text().trim();
    if (text && text.length > 3 && !$a.find("img").length && !title) {
      title = text;
    }
  });
  
  if (!title || title.length < 5) return;
  
  const titleLower = title.toLowerCase();
  const categoryLower = category.toLowerCase();
  const agencyLower = agency.toLowerCase();
  
  const matchedKeywords = SEARCH_KEYWORDS.filter(kw =>
    titleLower.includes(kw.toLowerCase()) || categoryLower.includes(kw.toLowerCase())
  );
  const isRelevantCategory = RELEVANT_CATEGORIES.some(cat =>
    categoryLower.includes(cat.toLowerCase().substring(0, 20))
  );
  const isPriorityAgency = PRIORITY_AGENCIES.some(ag =>
    agencyLower.includes(ag.toLowerCase().substring(0, 15))
  );
  
  const passes = isRelevantCategory || matchedKeywords.length > 0 || isPriorityAgency;
  
  if (passes) {
    passedRows.push({ title, category, agency, matchedKeywords, isRelevantCategory, isPriorityAgency });
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  } else {
    failedRows.push({ title, category });
  }
});

console.log(`\n=== PASSED (${passedRows.length}) ===`);
console.log("\nCategory breakdown:");
const sorted = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
sorted.forEach(([cat, count]) => {
  console.log(`  ${count}x ${cat}`);
});

console.log("\nPotential noise (category-match only, no keyword match):");
passedRows.filter(r => r.isRelevantCategory && r.matchedKeywords.length === 0 && !r.isPriorityAgency)
  .forEach(r => {
    console.log(`  [${r.category.substring(0, 40)}] ${r.title.substring(0, 70)}`);
  });

console.log(`\n=== FAILED (${failedRows.length}) ===`);
failedRows.slice(0, 10).forEach(r => {
  console.log(`  [${r.category.substring(0, 40)}] ${r.title.substring(0, 70)}`);
});
