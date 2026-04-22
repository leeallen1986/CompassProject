import * as cheerio from "cheerio";
import { readFileSync } from "fs";

const html = readFileSync("/tmp/tenders_wa_debug.html", "utf8");
const $ = cheerio.load(html);

let count = 0;
let titlesFound = 0;

$("tr").filter((_idx, el) => {
  const cls = ($(el).attr("class") || "").trim();
  return cls === "odd" || cls === "even";
}).each((_idx, row) => {
  count++;
  const $row = $(row);
  
  // Agency: td with firstTableColumn class
  const agency = $row.find("td.firstTableColumn").text().trim();
  
  // Category: td.nowrap that does NOT have firstTableColumn (second td.nowrap)
  const category = $row.find("td.nowrap").filter((_i, el) => {
    const cls = $(el).attr("class") || "";
    return !cls.includes("firstTableColumn");
  }).first().text().trim();
  
  // Tender number: td with "left" AND "top" in class → <b> tag
  const tenderNumCell = $row.find("td").filter((_i, el) => {
    const cls = $(el).attr("class") || "";
    return cls.includes("left") && cls.includes("top");
  }).first();
  const tenderNumber = tenderNumCell.find("b").first().text().trim();
  
  // Title: td.top that does NOT have "nowrap" AND does NOT have "left" in class
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
    const hasImg = $a.find("img").length > 0;
    
    if (count <= 3) {
      console.log(`  [anchor] text="${text.substring(0, 50)}" hasImg=${hasImg} len=${text.length}`);
    }
    
    if (text && text.length > 3 && !hasImg && !title) {
      title = text;
      href = h;
      const idMatch = h.match(/[?&]id=(\d+)/);
      tenderId = idMatch ? idMatch[1] : "";
    }
  });
  
  // Close date
  const closeDate = $row.find("span.SUMMARY_CLOSINGDATE").text().trim();
  
  if (count <= 5) {
    console.log(`Row ${count}:`);
    console.log(`  agency="${agency.substring(0, 50)}"`);
    console.log(`  category="${category.substring(0, 50)}"`);
    console.log(`  tenderNumber="${tenderNumber}"`);
    console.log(`  title="${title.substring(0, 70)}"`);
    console.log(`  tenderId="${tenderId}"`);
    console.log(`  closeDate="${closeDate}"`);
    console.log();
  }
  
  if (title && title.length > 5) {
    titlesFound++;
  }
});

console.log(`Total odd/even rows: ${count}`);
console.log(`Rows with valid title: ${titlesFound}`);
