import 'dotenv/config';

function isTruncatedDomain(domain, projectOwner) {
  if (!projectOwner) return false;
  const ownerNorm = projectOwner.toLowerCase().replace(/[^a-z0-9]/g, '');
  const domainPrefix = domain.split('.')[0].toLowerCase();
  if (domainPrefix === ownerNorm) return false;
  if (ownerNorm.includes(domainPrefix) && domainPrefix.length < ownerNorm.length && domainPrefix.length > 5) {
    return true;
  }
  if (domainPrefix.length >= ownerNorm.length - 4 && domainPrefix.length < ownerNorm.length) {
    let oi = 0, di = 0;
    while (oi < ownerNorm.length && di < domainPrefix.length) {
      if (ownerNorm[oi] === domainPrefix[di]) di++;
      oi++;
    }
    if (di === domainPrefix.length) return true;
  }
  return false;
}

const NON_DEFENSIBLE_DOMAINS = [
  /\.gov\.au$/i, /\.edu\.au$/i, /\.edu$/i, /\.gov$/i,
  /\.ac\.uk$/i, /gmail\.com$/i, /yahoo\.com$/i, /hotmail\.com$/i, /outlook\.com$/i,
];

const tests = [
  { domain: 'octopus.com', owner: 'Blind Creek Solar' },
  { domain: 'octopus.com', owner: 'Octopus Australia' },
  { domain: 'octopus.com.au', owner: 'Blind Creek Solar' },
  { domain: 'octopus.com.au', owner: 'Octopus Australia' },
  { domain: 'worley.com.au', owner: 'Blind Creek Solar' },
  { domain: 'acciona.com.au', owner: 'Blind Creek Solar' },
  { domain: 'octopusaustralia.com.au', owner: 'Blind Creek Solar' },
  { domain: 'ghd.com', owner: 'Blind Creek Solar' },
];

console.log('=== DOMAIN DEFENSIBILITY TEST ===');
tests.forEach(t => {
  const isTruncated = isTruncatedDomain(t.domain, t.owner);
  const isNonDefensible = NON_DEFENSIBLE_DOMAINS.some(re => re.test(t.domain));
  const passes = !isTruncated && !isNonDefensible;
  console.log(`${t.domain} vs '${t.owner}': truncated=${isTruncated}, nonDefensible=${isNonDefensible}, PASSES=${passes}`);
});
process.exit(0);
