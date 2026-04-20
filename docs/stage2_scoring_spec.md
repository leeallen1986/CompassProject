# Stage 2 Authoritative Scoring Specification
# Atlas Copco Market Intelligence Platform
# Version: 2.0 — Approved for implementation

---

## 1. Scope and Carry-Forward Constraints

This specification governs contact scoring for **person records only**: `verified_contact`, `enrichable_contact`, and `review_needed` records from Stage 1 staging. `company_target` rows are **never scored by this model** and must not enter the person scoring pipeline.

---

## 2. Score Components (max 100)

| Component | Max Points | Notes |
|---|---|---|
| Title score | 45 | From `classifyTitle()` — see Section 4 |
| Email bonus | 15 | Corporate email present and not personal domain |
| Mobile bonus | 5 | Mobile/cell number present |
| Company bonus | 20 | From `classifyCompany()` — see Section 5 |
| Project match bonus | 15 | 5 pts per matched project, capped at 15 (was 30) |
| Combo bonus | 0 | **Removed** — was exploitable; absorbed into tier gates |

**Total cap: 100.**

---

## 3. Minimum Title Gate (NEW)

Before the company bonus is applied, a **minimum title score gate** is enforced:

- If `titleScore < 15` → company bonus is **not applied** (score stays title + data completeness only)
- If `titleScore >= 15` → full company bonus applies

**Rationale:** A generic labourer, admin, or unclassified contact at a blasting company should not receive the full company bonus. The gate ensures company context only amplifies contacts who have at least a coordinator/specialist-level title.

---

## 4. Title Classification — `classifyTitle()`

### 4.1 Evaluation Order

Titles are evaluated in this strict order. **First match wins.**

1. Hard exclusions (score = 0, tier = `excluded`)
2. Compound-title exclusions (score = 5, bucket = `other`)
3. Blasting/surface-prep specialists (score = 40, bucket = `blasting_specialist`)
4. C-Suite (score = 45, bucket = `c_suite`)
5. Director — with irrelevant-specialisation exclusions (score = 38, bucket = `director`)
6. Senior Manager — with BD/Sales downgrade (score = 30, bucket varies)
7. Manager — bucket-specific (score = 25, bucket varies)
8. Coordinator / Supervisor / Technical (score = 15, bucket varies)
9. Fallthrough: other (score = 10, bucket = `other`)

### 4.2 Hard Exclusions (score = 0, tier forced to `excluded`)

These titles are never useful for outreach regardless of company:

```
/^accounts?\s*(payable|receivable|officer)?$/i
/^admin(istrat(or|ive|ion))?$/i
/^receptionist?$/i
/^office\s*manager$/i
/^customer\s*(care|service|support)/i
/^sales\s*(rep(resentative)?|executive|associate)?$/i
/^data\s*entry/i
/^payroll/i
/^bookkeeper/i
/^cleaner/i
/^driver$/i
/^labourer$/i
/^casual\s*worker/i
/^intern$/i
```

### 4.3 Compound-Title Exclusion (score = 5, bucket = `other`)

If a title contains **any** of the following admin/excluded keywords **anywhere** in a compound title (i.e., title contains `/` or `,`), it is downgraded to score 5:

Excluded keywords in compound titles:
```
accounts payable, accounts receivable, accounts, payroll,
finance, financial, hr, human resources, people & culture,
legal, compliance, marketing, communications, it, information technology,
data, security, safety, admin, administration, reception
```

**Examples that trigger this rule:**
- `Director / Accounts Payable` → score 5
- `Owner / Admin` → score 5
- `Director, Finance` → score 5
- `General Manager / HR` → score 5
- `Managing Director / IT` → score 5

**Implementation:** Before any pattern matching, check if the title contains `/` or `,` and if any compound segment matches an excluded keyword.

### 4.4 Blasting/Surface-Prep Specialists (score = 40, bucket = `blasting_specialist`)

```
/blast(?:ing|er)?/i
/paint(?:ing|er)?/i
/coat(?:ing|s|er)?/i
/surface\s*(treat|protect|prep|finish)/i
/corrosion\s*(control|protection|engineer|specialist)?/i
/abrasive/i
/sandblast/i
/\buhp\b/i          — ultra-high pressure
/\bnace\b/i         — NACE certification
/\bsspc\b/i         — SSPC certification
/hydro\s*blast/i
/grit\s*blast/i
/thermal\s*spray/i
/zinc\s*spray/i
/protective\s*coat/i
```

### 4.5 C-Suite (score = 45, bucket = `c_suite`)

```
/\bceo\b/i
/\bcoo\b/i
/\bcfo\b/i
/\bcto\b/i          — only if NOT "Chief Technology Officer" at non-industrial company (leave for now)
/\bchief\b/i        — Chief * Officer, Chief of *
/managing\s*director/i
/\bowner\b/i        — but NOT "Owner / Admin" (caught by compound exclusion)
/proprietor/i
/\bpresident\b/i
/\bfound(?:er|ing)/i
/\bprincipal\b/i    — NEW: Principal at small contractor = effective owner
```

### 4.6 Director — with Irrelevant Specialisation Exclusions (score = 38, bucket = `director`)

**First check:** if the title contains `director` AND any of the following irrelevant specialisation keywords, score = 5, bucket = `other`:

Irrelevant director specialisations:
```
it, information technology, data, digital, cyber, security,
safety, hse, health, hr, human resources, people & culture,
legal, compliance, finance, financial, accounts, accounting,
marketing, communications, brand, media, pr, public relations,
procurement (only if not at a target company — leave for now)
```

**If no irrelevant specialisation:** apply director patterns:
```
/\bdirector\b/i
/\bvp\b/i
/vice\s*president/i
/general\s*manager/i
/head\s+of\b/i
/\bpartner\b/i
```

### 4.7 Senior Manager — with BD/Sales Downgrade (score = 30 → 20 for BD/Sales, bucket varies)

**BD/Sales roles are downgraded to score 20, bucket = `other`:**
```
/business\s*development\s*(manager|director|lead|executive)?/i
/\bbd\s*(manager|director|lead)\b/i
/sales\s*manager/i
/national\s*sales/i
/account\s*manager/i       — usually a sales role
/key\s*account\s*manager/i
/commercial\s*manager/i    — downgraded from 35 to 20
/channel\s*manager/i
```

**Remaining senior manager patterns (score = 30, bucket = `senior_manager`):**
```
/senior\s*(project\s*)?manager/i
/national\s*manager/i
/regional\s*manager/i
/state\s*manager/i
/group\s*manager/i
/divisional\s*manager/i
/project\s*director/i      — kept here (not director level — project-specific)
```

**Note:** `business_development_manager` was previously at score 35 (senior_manager). It is now score 20 and cannot reach tier1_hot regardless of company bonus.

### 4.8 Manager Level (score = 25, bucket varies)

```
operations_manager      → bucket: operations
project_manager         → bucket: project_management
procurement_manager     → bucket: procurement
purchasing_manager      → bucket: procurement
supply_chain_manager    → bucket: procurement
fleet_manager           → bucket: fleet_equipment
equipment_manager       → bucket: fleet_equipment
maintenance_manager     → bucket: maintenance
workshop_manager        → bucket: maintenance
site_manager            → bucket: site_workshop
area_manager            → bucket: site_workshop
branch_manager          → bucket: site_workshop
production_manager      → bucket: site_workshop
/\bmanager\b/i          → bucket: operations (catch-all)
```

### 4.9 Coordinator / Supervisor / Technical (score = 15, bucket varies)

```
supervisor              → bucket: operations
superintendent          → bucket: operations
coordinator             → bucket: operations
foreman                 → bucket: site_workshop
estimator               → bucket: project_management
inspector               → bucket: operations
planner                 → bucket: project_management
/\bofficer\b/i          → bucket: operations
/\bengineer\b/i         → bucket: engineering
/\banalyst\b/i          → bucket: operations
/\bspecialist\b/i       → bucket: operations
/\btechnician\b/i       → bucket: site_workshop
/\badvisor\b/i          → bucket: operations
/\bconsultant\b/i       → bucket: operations
```

---

## 5. Company Bonus — `classifyCompany()`

The single `isBlastingCompany()` boolean is replaced with a **tiered company bonus** returning 0, 10, or 20 points.

### 5.1 Tier A — Primary Target Companies (bonus = 20)

These are direct buyers of Atlas Copco portable air compressors for blasting/surface prep:

```
/abrasive\s*blast/i
/sandblast/i
/grit\s*blast/i
/hydro\s*blast/i
/\buhp\b/i
/blast(?:ing)?\s*(service|contractor|solution|group|co)/i
/surface\s*(prep|treat|protect|finish)/i
/corrosion\s*(control|protection|service)/i
/protective\s*coat/i
/industrial\s*coat/i
/\bnace\b/i
/thermal\s*spray/i
/zinc\s*spray/i
/drill\s*(and|&)\s*blast/i
/drill\s*blast/i
/\bdrilling\s*contractor/i   — portable air directly relevant
/\bblast\b.*\bcoat\b/i
/\bcoat\b.*\bblast\b/i
```

Named companies known to be primary targets (exact match, case-insensitive):
```
wa corrosion, matrix corrosion, orontide, alphablast, cleanco,
rema tip top, master flow, allblast, globalblast, corrocoat
```

### 5.2 Tier B — Adjacent / Credible Secondary Companies (bonus = 10)

These companies use portable air equipment but are not the primary campaign target:

```
/paint(?:ing)?\s*(service|contractor|solution|group)/i
/industrial\s*paint/i
/\bmonadelphous\b/i
/\blinkforce\b/i
/\baltrad\b/i
/\bkaefer\b/i
/mining\s*contractor/i
/civil\s*contractor/i
/construction\s*contractor/i
/\bEPC\b/i                   — Engineering, Procurement, Construction
/\bEPCM\b/i
```

### 5.3 Tier C — Adjacent but Low Fit (bonus = 0, previously incorrectly included)

These companies were in the old `BLASTING_COMPANY_PATTERNS` and should receive **no bonus**:

```
/rope\s*access/i       — removed
/scaffold/i            — removed
/insulation/i          — removed
/fireproof/i           — removed
```

Generic hire firms also receive no bonus unless the campaign profile explicitly enables them.

### 5.4 Return Value

`classifyCompany(company)` returns:
```typescript
{ bonus: 0 | 10 | 20; companyTier: "primary" | "secondary" | "none" }
```

---

## 6. Role Bucket Definitions

| Bucket | Description | Buyer Likelihood | Default Score Band | Can Reach tier1_hot? |
|---|---|---|---|---|
| `c_suite` | CEO, MD, Owner, Founder, Principal | Very High | 45–80+ | Yes |
| `director` | Director (non-excluded), VP, GM, Head of | High | 38–73+ | Yes |
| `senior_manager` | Senior/National/Regional/State Manager | High | 30–65+ | Yes |
| `operations` | Operations Manager, catch-all Manager | Medium | 25–60+ | Yes (with email + primary company) |
| `procurement` | Procurement/Purchasing/Supply Chain Manager | High | 25–60+ | Yes (with email + primary company) |
| `fleet_equipment` | Fleet/Equipment Manager | High | 25–60+ | Yes (with email + primary company) |
| `maintenance` | Maintenance/Workshop Manager | High | 25–60+ | Yes (with email + primary company) |
| `project_management` | Project Manager/Director, Estimator, Planner | Medium-High | 15–50+ | Yes (with email + primary company) |
| `engineering` | Engineers (all types) | Low-Medium | 15–50 | No — capped at tier2_warm |
| `site_workshop` | Site/Area/Branch Manager, Foreman, Technician | Medium | 15–50 | No — capped at tier2_warm |
| `blasting_specialist` | Blasters, Coaters, Surface Prep specialists | Very High (operational) | 40–75+ | Yes |
| `coordinator` | Coordinators, Supervisors, Inspectors | Low | 15–35 | No — capped at tier3_enrich |
| `other` | BD/Sales, excluded specialisations, catch-all | Very Low | 5–20 | No |
| `unknown` | No title or unparseable | Unknown | 0 | No |

---

## 7. Tier Thresholds and Gates

### 7.1 Tier Definitions

| Tier | Score Threshold | Additional Gates | Meaning |
|---|---|---|---|
| `tier1_hot` | ≥ 60 | Must have email; bucket must NOT be `engineering`, `site_workshop`, `coordinator`, `other`, `unknown` | Prioritised for immediate outreach |
| `tier2_warm` | ≥ 40 | Must have email | Strong influencer or mid-level operational buyer |
| `tier3_enrich` | ≥ 15 | No email gate | Promising but incomplete — needs enrichment |
| `tier4_low` | < 15 | — | Low fit or junk |
| `excluded` | Any | Hard exclusion title OR `company_target` record type | Never enters outreach |

### 7.2 Changes from v1

| Parameter | v1 | v2 |
|---|---|---|
| tier1_hot threshold | 55 | 60 |
| tier2_warm threshold | 35 | 40 |
| tier3_enrich threshold | 15 | 15 (unchanged) |
| Engineering bucket tier1_hot | Allowed | Blocked |
| site_workshop bucket tier1_hot | Allowed | Blocked |
| coordinator bucket tier1_hot | Allowed | Blocked |
| BD/Sales score | 35 | 20 |
| Director (irrelevant spec) score | 40 | 5 |
| Compound admin title score | 40 (if director) | 5 |
| Scaffold/rope-access company bonus | 20 | 0 |
| Project match cap | 30 | 15 |
| Combo bonus | +10 | Removed |
| Minimum title gate for company bonus | None | titleScore ≥ 15 |

---

## 8. ScoreBreakdown — Explainability Output

Every call to `computeScore()` returns a `ScoreBreakdown` object:

```typescript
interface ScoreBreakdown {
  titleScore: number;           // 0-45
  emailBonus: number;           // 0 or 15
  mobileBonus: number;          // 0 or 5
  companyBonus: number;         // 0, 10, or 20
  companyTier: "primary" | "secondary" | "none";
  projectMatchBonus: number;    // 0-15
  penalties: number;            // 0 (reserved for future penalty logic)
  finalScore: number;           // 0-100
  finalTier: "tier1_hot" | "tier2_warm" | "tier3_enrich" | "tier4_low" | "excluded";
  roleBucket: RoleBucket;
  titleRelevance: TitleRelevance;
  reasoningSummary: string;     // Human-readable explanation
  companyBonusBlocked: boolean; // True if title gate prevented company bonus
  tier1Blocked: boolean;        // True if bucket gate prevented tier1_hot
}
```

The `reasoningSummary` is a short English sentence, e.g.:
- `"Director at primary blasting company with email → tier1_hot (score 73)"`
- `"BD Manager downgraded to score 20; company bonus blocked by title gate → tier3_enrich"`
- `"Compound title 'Director / Accounts Payable' — admin keyword detected → excluded from hot scoring"`

---

## 9. Campaign Profile (Forward-Compatibility)

The scoring engine accepts an optional `CampaignProfile` parameter to allow future campaign-type variation:

```typescript
interface CampaignProfile {
  campaignType: "blasting" | "drilling" | "portable_air_general" | "custom";
  // Future: custom company bonus patterns, custom title weights
}
```

For Stage 2, only `"blasting"` is implemented. The parameter is accepted but other values fall back to `"blasting"` behaviour. This ensures the interface is stable for Stage 3.

---

## 10. Before/After Expected Results

| Contact | v1 Score | v1 Tier | v2 Score | v2 Tier | Change |
|---|---|---|---|---|---|
| Director / Accounts Payable, any company, email | 55 | tier1_hot | 5 | excluded | Fixed |
| Business Development Manager, blasting co, email | 70 | tier1_hot | 20 | tier4_low | Fixed |
| Director of Data Center Operations, email | 55 | tier1_hot | 5 | excluded | Fixed |
| Director of Safety and Security, email | 55 | tier1_hot | 5 | excluded | Fixed |
| Engineer at blasting company, email | 50 | tier2_warm | 30 | tier3_enrich | Fixed |
| Owner/Director at true blasting company, email | 80 | tier1_hot | 80 | tier1_hot | Preserved |
| Scaffold company director, email | 55 | tier1_hot | 38 | tier2_warm | Fixed |
| Operator/Blaster at blasting company, email | 75 | tier1_hot | 75 | tier1_hot | Preserved |
| Procurement Manager at target company, email | 60 | tier1_hot | 60 | tier1_hot | Preserved |
| Maintenance/Fleet Manager at target company, email | 60 | tier1_hot | 60 | tier1_hot | Preserved |
