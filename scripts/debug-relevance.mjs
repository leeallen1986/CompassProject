import { classifyRoleRelevance, MEDIUM_RELEVANCE_KEYWORDS, LOW_RELEVANCE_KEYWORDS } from '../server/roleRelevance.ts';

// Check if 'project director' is in the MEDIUM list
console.log('MEDIUM has "project director":', MEDIUM_RELEVANCE_KEYWORDS.includes('project director'));
console.log('MEDIUM has "technical director":', MEDIUM_RELEVANCE_KEYWORDS.includes('technical director'));
console.log('MEDIUM has "technical manager":', MEDIUM_RELEVANCE_KEYWORDS.includes('technical manager'));

// Manually test the includes check
const title = 'project director';
console.log('\nChecking MEDIUM keywords against "project director":');
for (const kw of MEDIUM_RELEVANCE_KEYWORDS) {
  if (title.includes(kw)) {
    console.log('  MEDIUM MATCH found:', kw);
  }
}

console.log('\nChecking LOW keywords against "project director":');
for (const kw of LOW_RELEVANCE_KEYWORDS) {
  if (title.includes(kw)) {
    console.log('  LOW MATCH found:', kw);
  }
}

// Test the actual function
console.log('\nActual results:');
console.log('  Project Director:', classifyRoleRelevance('Project Director', null));
console.log('  Technical Director:', classifyRoleRelevance('Technical Director', null));
console.log('  Bid Coordinator + commercial:', classifyRoleRelevance('Bid Coordinator', 'commercial'));
console.log('  GM Corporate Strategy + gm:', classifyRoleRelevance('General Manager, Corporate Strategy', 'general_manager'));
