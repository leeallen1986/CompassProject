# Full Potential Rental economics — aggregate internal data request

## Purpose

This request is designed to validate the Rental and Tough Stationary market model using factual Atlas Copco Rental performance without turning Full Potential into a CRM or exposing customer-sensitive information.

The requested data must be aggregated by equipment family or product cell. Do not include customer names, contacts, quotations, negotiated discounts, project notes or individual contract terms.

## Current working knowledge

The present internal view is:

- conventional towable compressor performance is not especially strong in the rental fleet;
- skid-mounted GA packages have achieved meaningful rental success;
- exact utilisation, achieved daily rate and product-level fleet economics are not yet available in the Full Potential model;
- factual rental revenue streams are available and can be used to ground the model;
- revenue alone is insufficient to infer market attractiveness without fleet count and utilisation context.

These points are internal operational evidence, not public market evidence. They must remain in a restricted management/product-assumption layer.

## Minimum useful extract

Provide 2025 full-year and rolling-12-month values where available.

| Field | Required aggregation | Why it matters |
|---|---|---|
| Product cell | Towable diesel, portable electric, GA skid, 1,000 V/mine skid, oil-free electric, high-pressure, dryer/receiver package | Separates materially different rental motions |
| Model or power band | Broad family only where practical | Links performance to TS1–TS4 and core Portable Air |
| Fleet units available | Count at period end and average count if available | Revenue without fleet count can mislead |
| Revenue | Total rental revenue by product cell | Grounds the observed commercial demand |
| Physical utilisation | Days on hire / available days or equivalent | Distinguishes genuine demand from isolated high-rate jobs |
| Financial utilisation | Revenue versus theoretical fleet rate, if tracked | Shows yield quality |
| Average achieved daily rate | Aggregate by product cell | Supports rental value and customer-economics modelling |
| Average hire duration | Days per contract or broad duration band | Indicates project versus spot-hire behaviour |
| Maintenance/repair cost | Aggregate by product cell if available | Tests whether revenue quality is sustainable |
| Fleet age | Average age or age band | Supports replacement timing |
| Original or replacement capex | Aggregate/indicative, not individual deal pricing | Supports return and replacement assumptions |
| Local modification cost | Aggregate Low/Base/High where applicable | Supports China-to-Australia product economics |
| Application mix | Mining underground, mining surface, shutdown, industrial, construction, other | Connects buyer value to application without double counting |
| Region | WA, QLD/NSW, VIC/SA/TAS/NT or national aggregate | Identifies where the use case is proven |

## Preferred first-pass output

A simple spreadsheet is sufficient. One row per product cell and period is preferable to detailed transaction data.

Suggested columns:

```text
period
product_cell
model_or_power_band
fleet_units
rental_revenue_aud
physical_utilisation_pct
financial_utilisation_pct
average_achieved_daily_rate_aud
average_hire_duration_days
maintenance_cost_aud
average_fleet_age_years
indicative_replacement_capex_aud
local_modification_cost_aud
primary_application_mix
region
notes_aggregate_only
```

Fields may be blank where not tracked. Do not delay the first extract waiting for perfect completeness.

## Interpretation rules

1. **Revenue is not fleet demand by itself.** High revenue may reflect a small fleet at high rates.
2. **Low towable revenue is not proof that the wider portable-air market is weak.** It may indicate product, route-to-market or rental-fleet positioning issues.
3. **GA skid success is relevant evidence for Tough Stationary**, but only after fleet count, utilisation and application mix are understood.
4. **Rental fleet purchases are counted once under the Rental buyer segment.** Mining, shutdown and industrial uses are application overlays and do not create additional monetary pools.
5. **Customer and contract detail stays outside Full Potential.** Only aggregated product economics may support the management model.
6. **Internal rental data does not replace public evidence.** It validates product/application economics and current performance; public evidence continues to define the external market universe.

## Minimum decision set for 3 September

The most valuable first answers are:

- 2025 and rolling-12-month revenue for towables versus GA skids;
- fleet unit count for each of those categories;
- physical utilisation for each;
- average achieved daily rate or revenue per available unit;
- broad mining versus industrial/application split;
- any known local modification cost for existing skid or mine packages.

With these fields, the management model can distinguish:

- a weak product format;
- a weak market;
- under-deployed fleet;
- high-value niche demand;
- genuine Tough Stationary product-market fit.

## Platform treatment

The aggregate extract is not loaded as `public_source` evidence.

It may be retained as a restricted internal planning input or `financial_assumption` supporting a management-only model. It must not be shown in distributor views or represented as customer-specific evidence.
