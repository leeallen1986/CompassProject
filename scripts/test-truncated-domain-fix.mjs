/**
 * Test the fixed isTruncatedDomain logic
 */

function isTruncatedDomainFixed(domain, projectOwner) {
  if (!projectOwner) return false;
  const ownerNorm = projectOwner.toLowerCase().replace(/[^a-z0-9]/g, "");
  const domainPrefix = domain.split(".")[0].toLowerCase();
  // Exact match is fine
  if (domainPrefix === ownerNorm) return false;
  // If domain prefix is a clean prefix of the owner name, it's a legitimate shorter brand domain
  // e.g., "fortescuemetals" is a prefix of "fortescuemetalsgroupltd" → NOT truncated
  if (ownerNorm.startsWith(domainPrefix)) return false;
  // If owner name starts with the domain prefix but with internal characters missing,
  // that's genuine truncation (e.g., "wateroration" from "watercorporation")
  // Use subsequence check: if domainPrefix is a subsequence of ownerNorm with 1-4 gaps
  if (domainPrefix.length >= ownerNorm.length - 4 && domainPrefix.length < ownerNorm.length) {
    let oi = 0, di = 0;
    while (oi < ownerNorm.length && di < domainPrefix.length) {
      if (ownerNorm[oi] === domainPrefix[di]) di++;
      oi++;
    }
    if (di === domainPrefix.length) return true;
  }
  // Also check: if domain prefix is a substring (not prefix) of owner and differs by 1-4 chars,
  // it could be a typo/truncation. Only flag if it's NOT a clean prefix.
  if (ownerNorm.includes(domainPrefix) && domainPrefix.length > 5) {
    const diff = ownerNorm.length - domainPrefix.length;
    if (diff >= 1 && diff <= 4) {
      return true;
    }
  }
  return false;
}

const cases = [
  ["fortescuemetals.com.au", "Fortescue Metals Group Ltd", false],
  ["chevron.com.au", "Chevron Australia Pty Limited", false],
  ["woodsideenergy.com", "Woodside Energy Ltd", false],
  ["baesystems.com.au", "BAE Systems Australia Limited", false],
  ["wateroration.com.au", "Water Corporation", true],   // genuine truncation
  ["bhp.com", "BHP Group", false],
  ["riotinto.com", "Rio Tinto", false],
  ["monadelphous.com.au", "Monadelphous Group", false],
  ["watercorporation.com.au", "Water Corporation", false],  // exact match after norm
  ["cyber.qld.gov.au", "Queensland Government", false],  // gov domain handled separately
];

let allPass = true;
for (const [domain, owner, expected] of cases) {
  const result = isTruncatedDomainFixed(domain, owner);
  const pass = result === expected;
  if (!pass) allPass = false;
  console.log(
    pass ? "PASS" : "FAIL",
    result ? "FLAGGED" : "OK     ",
    domain.padEnd(30),
    "| owner:", owner.padEnd(35),
    "| expected:", expected
  );
}
console.log(allPass ? "\nALL TESTS PASS ✓" : "\nSOME TESTS FAILED ✗");
process.exit(allPass ? 0 : 1);
