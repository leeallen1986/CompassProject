# Full Potential public-evidence methodology

## Purpose

Full Potential is a market-intelligence and opportunity-sizing layer. It is not a CRM and must not become a repository for confidential customer intelligence.

The governing sequence is:

```text
public observation -> transparent inference -> explicit assumptions -> confidence -> reviewed scenario
```

The September 2026 management view must explain every material number back to named public evidence and visible assumptions.

## Information boundary

### Permitted in the public-evidence layer

- company and OEM public websites;
- public catalogues, capability statements and product manuals;
- public company announcements and annual reports;
- public tenders, project awards and regulator/government sources;
- publicly visible equipment, pressure and flow bands;
- openly stated branch, site or operating footprint;
- transparent fleet bands, adoption-position classes and replacement assumptions;
- references to an approved internal planning-value set without exposing sensitive price values in public source control.

### Prohibited in the public-evidence layer

- named contact details;
- private customer conversations;
- customer purchasing intent;
- quotations, prices offered, discounts or margin;
- confidential tender or installed-base information;
- CRM activity notes;
- unpublished service, warranty or distributor intelligence presented as public evidence;
- sensitive internal price ladders or local-engineering cost assumptions committed to the public repository.

C4C/CRM remains the system for people, conversations, opportunities, quotes and close plans.

## Private planning-value boundary

Full Potential calculations require internal planning values, but those values are not public evidence.

The current management model may use a privately approved machine-value range and a separate localisation/package uplift. The exact values must be supplied through a restricted admin-only assumption pack or entered into a draft model by an authorised internal user. They must not be hard-coded in the shared public-evidence library, committed to the public repository, shown in distributor views or represented as a customer quotation.

The source-controlled model may contain only:

- scenario field names;
- calculation logic;
- qualification status;
- an opaque planning-value-set reference or methodology version;
- tests using synthetic/example values that are not asserted to be current commercial prices.

The management output should distinguish:

```text
machine planning value
+ local engineering / voltage / mine-package uplift
= indicative locally deployable package value
```

Where localisation cost is unknown, the model must show the machine-only value and a separate `localisation uplift TBC` qualification gap. It must not silently embed an invented contingency.

## Buyer, application and product

Full Potential uses three independent dimensions:

1. **Buyer segment** — where the purchase value is counted.
2. **Application** — why the equipment is required.
3. **Product/product cell** — what can be supplied.

Only a `buyer_counting` record carries monetary Full Potential.

Application and site records may remain as `application_overlay_non_counting` or `context_non_counting`. They support analysis but cannot create a second market value.

Example:

- a rental company purchase is counted under Rental Hire;
- a mining shutdown using that rental machine is an application overlay;
- the same equipment value is not counted again under Mining or Temporary Electric.

## Commercial-pool key

Every counting record requires a `commercialPoolKey`.

There may be only one monetary counting record for a commercial pool in a scenario pack. Duplicate counting keys fail closed. This is the primary software control against double counting.

Distinct product pools may be split only where the assumptions genuinely describe different equipment purchases. For example, a buyer may have separate portable-diesel and E-Air pools where their underlying unit assumptions do not overlap.

## Evidence grades

| Grade | Meaning | Example |
|---|---|---|
| **A** | Public fact / directly observed | OEM/model/CFM publicly listed; branch count publicly stated |
| **B** | Strong inference | Relevant fleet band inferred from multi-band public catalogue and operating footprint |
| **C** | Modelled adoption or market assumption | Three-year Tough Stationary adoption positions where exact fleet evidence does not exist |

The existing platform confidence mapping is:

```text
A -> high
B -> medium
C -> low
```

## Value classes

- `named_evidenced_core` — named buyer records supported by direct public evidence;
- `regional_long_tail` — evidenced but less-complete regional participants;
- `unobserved_allowance` — separately presented market allowance, never disguised as a named installed base.

The September headline must show the Named Evidenced Core separately from any long-tail or unobserved allowance.

## Low / Base / High scenarios

The public-evidence contract supports two scenario bases.

### Fleet replacement

Used primarily for Rental Hire and other visible fleet buyers.

```text
three-year modelled units
  = inferred fleet units x three-year replacement share

potential AUD
  = three-year modelled units
  x planning value AUD
  x addressable share
```

The fleet value is an inferred range, not an asserted customer fleet count.

### Adoption positions

Used where the market is an emerging application rather than a visible replacement fleet, such as Tough Stationary.

```text
potential AUD
  = three-year adoption positions
  x planning value AUD
  x addressable share
```

## Addressability status

| Status | Treatment |
|---|---|
| `addressable_now` | Product and route appear sellable now |
| `conditional_factory_confirmation` | Factory/sourceability must be confirmed |
| `conditional_voltage` | Local voltage/configuration remains a gate |
| `conditional_compliance` | Australian or mine compliance remains a gate |
| `portfolio_gap` | Demand exists but current identified portfolio does not cover it; monetary value is zero |
| `excluded` | Outside Portable Air scope or otherwise deliberately excluded; monetary value is zero |

Conditional records may remain in the scenario with an explicit addressable-share assumption. Portfolio gaps and exclusions always calculate zero.

## Tough Stationary product cells

The working product cells are:

- **TS1** — approximately 130–500 CFM relocatable electric;
- **TS2** — approximately 550–900 CFM / 8.6–17 bar;
- **TS3** — approximately 900–1,000 CFM engineered underground / 1,000 V;
- **TS4** — approximately 943–1,307 CFM / 20–25 bar;
- **35 bar portfolio gap** — evidenced demand, but not covered by the currently identified electric portfolio.

Sourceable product is not automatically locally deployable product. Voltage, compliance, mine-spec, lead time and commercial-value gates remain explicit.

## Existing platform bridge

No schema migration is required for the first controlled draft pack.

The current Full Potential V1 model already provides:

- public-source and financial-assumption evidence;
- versioned models;
- product-family/application lines;
- line-level assumptions JSON;
- evidence links;
- admin review and approval;
- account-level no-double-count relationship controls.

The governed public-evidence scenario contract is stored in the existing model-line `assumptions` JSON until a later reviewed schema extension is justified.

The Base scenario may populate the editable V1 line fields in a draft model. Low and High remain scenario sensitivities in the assumptions JSON. No account headline value changes until evidence is verified and the model is approved.

## Draft-pack safety

A draft import pack must:

- contain public-source evidence plus references to restricted financial assumptions for this workstream;
- keep observation and inference in separate fields;
- reject email addresses, phone numbers and CRM/confidential language;
- keep all model/evidence statuses draft;
- use canonical buyer accounts and non-counting context records;
- reconcile Low/Base/High totals to unique commercial-pool keys;
- include a methodology version and private planning-value-set reference;
- never trigger C4C, pipeline, provider or outreach work;
- never export or display restricted price inputs to distributor users.

## September 3 management view

The management view should show:

- Named Evidenced Core Low / Base / High;
- long-tail and unobserved allowance separately;
- buyer-segment totals;
- product and application overlays without double counting;
- evidence-grade distribution;
- current product-addressable value;
- conditional voltage/compliance/factory value;
- machine-only value versus localisation/package uplift TBC;
- portfolio gaps;
- current sales and remaining potential where approved data exists;
- the source and assumptions behind every material number.

## Release boundary

The initial Issue #130 source release defines and tests the model contract only. It does not:

- mutate production Full Potential accounts;
- import Rental or Tough Stationary evidence;
- approve account values;
- create CRM records or contacts;
- invoke providers or the production pipeline;
- deploy the web or worker;
- commit current internal commercial price ladders to public source control.

Production data loading requires a separate bounded import manifest, dry-run reconciliation and explicit approval.
