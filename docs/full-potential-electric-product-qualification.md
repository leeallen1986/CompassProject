# Full Potential electric product qualification framework

## Purpose

This document defines the **public-source-safe** qualification framework for
Tough Stationary / E-Air modelling.

It does not contain internal factory availability, transfer prices, local
engineering costs, lead times, unpublished model plans or confidential product
roadmap detail. Those inputs belong in a separately authorised restricted
planning pack referenced only by an opaque `planningValueSetRef`.

A publicly visible product or application is not automatically counted as fully
addressable in Australia. Product availability, voltage, local engineering,
compliance, package format and commercial competitiveness remain explicit gates.

## Publicly visible product cells

The platform uses abstract product cells rather than an internal factory list.
Public product pages and case studies currently support the following analytical
cells:

| Product cell | Publicly visible capability | Full Potential treatment |
|---|---|---|
| **TS1** | Relocatable electric air around 130–500 CFM, including VSD and fixed-speed products | Product/application overlay and named-buyer modelling |
| **TS2** | Rugged electric air around 550–900 CFM and approximately 8.6–17 bar | Priority surface-mining, rental and industrial application cell |
| **TS3** | Engineered underground electric packages around 900–1,000 CFM, including publicly documented 415 V / 1,000 V configurations | Underground adoption-position modelling |
| **TS4** | Publicly visible 20–25 bar electric equipment around the large-air class | Specialist high-pressure adoption modelling, subject to local product qualification |
| **35 bar gap** | Public high-pressure demand exists above the currently evidenced electric range | Retain as `portfolio_gap`; monetary value remains zero |

The public layer may describe these broad cells and cite public sources. It must
not disclose or imply an unpublished internal model-release plan.

## Qualification fields held outside public source control

The following information is required before a conditional product cell becomes
`addressable_now`, but the answers are restricted internal planning inputs:

- legal product owner and approved source location;
- confirmed Australian sourceability;
- true 400/415 V configuration and voltage tolerance;
- 1,000 V factory, conversion or transformer-fed path;
- main motor, VFD, auxiliary motor and control-system compatibility;
- start-current and site-supply requirements;
- maximum ambient and any derating;
- ingress, dust and cooling protection;
- skid, drag-skid, trailer, wheeled or container options;
- mine-spec and fire-suppression options;
- receiver and dryer integration;
- Australian electrical, pressure-vessel, lifting and road compliance;
- factory and local engineering lead time;
- MOQ and order constraints;
- parts, service competence and warranty treatment;
- factory transfer price, landed cost and local modification cost;
- indicative Australia net sales value;
- evidence owner and confirmation date.

The restricted answer pack must never contain customer-specific pricing,
quotation history, discounts, contacts or CRM notes.

## Addressability rules

### `addressable_now`

Use only when a locally deployable configuration is confirmed and the remaining
compliance work is routine, understood and commercially manageable.

### `conditional_factory_confirmation`

Use where the public capability is visible but approved sourceability or product
ownership has not been confirmed internally.

### `conditional_voltage`

Use where the public product exists but local voltage or 1,000 V compatibility
remains unresolved.

### `conditional_compliance`

Use where the product is technically sourceable but local engineering,
Australian compliance, mine-spec scope or cost remains material and unresolved.
Local modification is not itself a portfolio gap; it is a qualification and
commercial-competitiveness gate.

### `portfolio_gap`

Use where public demand exists but the currently evidenced product portfolio
does not meet the pressure, flow or configuration requirement.

### `excluded`

Use where the application is conventional permanent compressor-room equipment,
outside Portable Air scope, or otherwise deliberately excluded.

## Restricted planning-value treatment

The public repository stores only:

- an opaque planning-value-set reference;
- whether the basis is `machine_only`, `locally_deployable_package` or
  `blended_portfolio`;
- whether localisation uplift is included, not applicable or excluded/TBC.

The actual Low/Base/High planning values and local-engineering uplift are supplied
only through a separately authorised restricted pack. Machine-only values must
not claim that localisation is included.

## Buyer/application/product discipline

Only a buyer-counting record carries money.

Examples:

- a rental company buying an electric compressor is counted under Rental Hire;
- the mining shutdown or industrial contingency supported by that machine is an
  application overlay and is non-counting;
- a mine owner buying a direct relocatable electric package is a separate direct
  buyer pool only when the assumed equipment purchase is genuinely distinct;
- a permanent conventional compressor-room installation is excluded unless a
  rugged, exposed or relocatable requirement clearly differentiates the Portable
  Air offer.

## Release boundary

This framework contains no internal factory answer pack, price ladder, import,
production database mutation, account-value approval, CRM write, provider call,
pipeline invocation or deployment.
