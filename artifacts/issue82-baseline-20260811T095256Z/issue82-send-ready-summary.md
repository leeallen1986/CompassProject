# Issue #82 — Global Send-Ready Census

## Counts

| Metric | Value |
|--------|-------|
| Raw send-ready | 4439 |
| Effective send-ready | 2273 |
| Fully project-eligible | 2273 |
| Invalid raw send-ready | 2166 |
| Exact regression shape | 2158 |

## Breakdowns

### By failure condition

| Condition | Count |
|-----------|-------|
| emailVerified_not_true | 1944 |
| verificationStatus_not_verified | 1563 |
| no_contactProjects_link | 15 |
| rejection_present | 11 |
| null_email | 3 |

### By enrichmentSource

| Source | Count |
|--------|-------|
| linkedin | 745 |
| manual | 741 |
| web_search | 598 |
| apollo | 82 |

### Single vs multiple failures

| Type | Count |
|------|-------|
| Single failure | 814 |
| Multiple failures | 1352 |
