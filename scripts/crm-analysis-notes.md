# CRM Export Analysis — LA9thDecContacts2025.xlsx

## Overview
- **55,875 contacts** from Atlas Copco CRM (HubSpot/SAP hybrid)
- No header row — columns inferred from data patterns
- Date range: Sep 2018 – Oct 2025 (last modified dates)

## Column Mapping (inferred)
| Col | Field | Coverage |
|-----|-------|----------|
| 0 | Unknown (always null) | 0% |
| 1 | Name (Last, First format) | ~100% |
| 2 | Company | 100% |
| 3 | Email | 84% (47,156) |
| 4 | Title/Position | 38% (21,262) |
| 5 | Department | ~45% |
| 6 | Mobile Phone | 48% (27,361) |
| 7 | Office Phone | 77% (43,025) |
| 8 | Status | Active/Blocked/In Prep |
| 9 | Account ID? | ~sparse |
| 10 | CRM Contact ID | ~100% |
| 11 | Owner (sales rep name) | ~90% |
| 12 | Last Modified (Excel date) | ~100% |

## Data Quality
- **Corporate emails:** 46,338 (83%)
- **Personal emails:** 818 (1.5%)
- **No email:** 8,719 (15.6%)
- **Has title:** 38% — needs enrichment
- **21,455 unique companies**

## Sector Relevance (by company name keyword)
- Mining: ~3,714 contacts
- Oil & Gas: ~1,565 contacts
- Infrastructure/Construction: ~3,084 contacts
- Drilling contractors: ~78 contacts
- **Total sector-relevant: ~8,441 contacts (15%)**
- Remaining ~47,434 are general industrial customers (food, beverage, manufacturing, retail)

## Key Companies Already in Our Project DB
- BHP (multiple entities): ~325+ contacts
- Rio Tinto: 81 contacts
- Fortescue: 90 contacts
- Woodside: 121 contacts
- Byrnecut: 104 contacts
- Citic Pacific Mining: 77 contacts
- OK Tedi Mining: 73 contacts

## Recommended Import Strategy
1. Import ALL 55,875 contacts (they're all Atlas Copco customers)
2. Tag with source="crm" and preserve CRM ID for dedup
3. Match to existing projects by company name fuzzy matching
4. Queue sector-relevant contacts (mining/oil_gas/infra/drilling) for Apollo enrichment first
5. Enrich remaining contacts in background batches
