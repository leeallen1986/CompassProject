const FALSE_POSITIVE_TITLE_PATTERNS: RegExp[] = [
  /\bschool\b/i, /\bcollege\b/i, /\buniversity\b/i, /\btafe\b/i,
  /\bhospital\b/i, /\bhealth service\b/i, /\bclinic\b/i, /\bmedical centre\b/i,
  /\bprison\b/i, /\bjail\b/i, /\bcorrectional\b/i,
  /\bairport\b/i, /\bplayground\b/i, /\bzoo\b/i, /\baquarium\b/i,
  /\blibrary\b/i, /\bmuseum\b/i, /\btheatre\b/i, /\btheater\b/i,
  /\bfitout\b/i, /\bfit.out\b/i, /\brefurbishment\b/i, /\brenovation\b/i,
  /\blandscaping\b/i, /\bgarden\b/i,
  /\bcatering\b/i, /\bcleaning services\b/i, /\bsecurity services\b/i,
  /\bsoftware\b/i, /\bconsulting services\b/i,
  /\btraining\b/i, /\bauditing\b/i, /\baccounting\b/i,
  // Stage 6: additional civic/minor works suppressions
  /\bparking\b/i, /\bparking bay\b/i, /\bcar park\b/i,
  /\bfire upgrade/i, /\bfire alarm/i, /\bfire detection/i, /\bsprinkler/i,
  /\bminor roadworks\b/i, /\bminor works\b/i, /\bminor maintenance\b/i,
  /\bfencing\b.*\bpanel\b/i, /\bshade\s*(structure|sail)/i,
  /\btoilet\b/i, /\bamenities\b/i, /\bcourtyard\b/i,
  /\bdisabled\b/i, /\baccessibility\b/i,
  /\bcooling\b.*\bschool/i, /\bcooling for schools\b/i,
  /\bsports court/i, /\bbasketball court/i, /\btennis court/i,
  /\bplaying surface\b/i, /\bsensory\b/i,
  /\bchaplain/i, /\bchild care\b/i, /\bkindergarten\b/i,
];

const titles = [
  "Fire Upgrades - Helena Valley Primary School",
  "East Kimberley College Disabled Parking Bay Installation",
  "Minor Roadworks Services - Great Southern Region Panel",
  "Mackay Base Hospital Upgrades",
  "Cooling for Schools – Electrical Upgrades",
  "Basketball Courts Installation - Millen Primary School",
  "Arena Joondalup - HIF Insurance Oval UAT and Toilet Upgrade",
  "Armadale Health Service (AHS) Yorgum Courtyard Refurbishment",
  // These should NOT be blocked (legitimate PT projects):
  "Pilbara Iron Ore Mine Expansion",
  "Scarborough Gas FPSO Construction",
  "Goldfields Highway Upgrade - Earthworks Package",
  "Water Pipeline Construction - Pilbara",
];

console.log("=== Tender False Positive Pattern Test ===\n");
titles.forEach(t => {
  const matched = FALSE_POSITIVE_TITLE_PATTERNS.some(re => re.test(t));
  const status = matched ? "BLOCKED" : "PASSED";
  console.log(`[${status}] ${t}`);
});
