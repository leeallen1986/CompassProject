# Full Potential electric product qualification matrix

## Purpose

This is the internal product gate for Tough Stationary / E-Air modelling. It is intentionally separate from customer/public evidence.

A sourceable product is not counted as fully addressable in Australia until voltage, compliance, package, lead-time and planning-value questions are resolved.

The values and operating assumptions in this document are internal planning inputs. They must not be represented as public customer evidence.

## Current confirmed working position — Oceania

The present working route is to source the China-based electric compressor and complete the Australian/mining adaptation locally until repeat volume and a stable factory specification are proven.

The following points are currently treated as internal product facts or approved planning assumptions:

- local modification is likely to be required for the first Australian machines;
- Australia has the engineering, fabrication and mining-package capability to complete the required local adaptation;
- local engineering will increase landed cost, but the cost is not yet quantified and remains under investigation;
- standard source lead time is approximately three months, followed by approximately one month sea freight to Australia;
- the current planning lead time is therefore approximately four months before local modification, commissioning and customer delivery;
- local modification is not itself a portfolio gap: it is a product-qualification and commercial-cost gate;
- competitor packages are also believed to require market-specific adaptation, but competitor scope and costs are not known and must not be presented as verified evidence.

Until the local engineering scope and cost are understood, the machines should be treated as technically feasible but commercially conditional. The Full Potential model must retain a conservative addressable-share assumption and show the qualification gap rather than assigning an unqualified full market share.

## China Medium Air portfolio supplied for review

Source slide: Medium Air Product Portfolio, 380 V / 50 Hz / 3-phase / IE3.

| Product family | Motor | Public/model flow | Pressure | Approx. CFM | Working cell |
|---|---:|---:|---:|---:|---|
| XAMS800E / XAHS650E / XAVS550E | 132 kW | 15.4–21.5 m³/min | 8.6–14 bar | 544–759 | TS2 |
| XAMS850E / XAHS710E / XAVS650E / XAXS600E | 160 kW | 17–25.5 m³/min | 8.6–17 bar | 600–901 | TS2 / TS3 candidate |
| XATS1050E / XRHS930E | 210 / 230 kW | 26.7 m³/min | 20 bar | 943 | TS4 |
| XRVS960E | 275 kW | 27 m³/min | 25 bar | 953 | TS4 |
| XRHS1150E | 275 kW | 32 m³/min | 20 bar | 1,130 | TS4 |
| XRHE1300 | 315 kW | 37 m³/min | 20 bar | 1,307 | TS4 |

The identified portfolio does not currently show a 35 bar electric solution. Public 35 bar demand remains a portfolio gap unless another sourceable product is confirmed.

## Required factory/product confirmation

Complete one row for every product family before its model status changes to `addressable_now`.

| Qualification field | Required answer |
|---|---|
| Factory source / legal product owner | Wuxi / other; responsible product company |
| True 400/415 V option | Yes / no / engineering review; exact nameplate voltage |
| Permitted voltage tolerance | Minimum / nominal / maximum at 50 Hz |
| Motor winding | Factory winding or local rewind required |
| Main drive / VFD compatibility | Confirm all drive ratings and configuration |
| Auxiliary motors | Fan, pump and other motor voltage ratings |
| Controls | Control transformer, contactors, breaker and phase monitoring suitability |
| 1,000 V option | Factory / engineered conversion / transformer-fed / unavailable |
| Start current / site supply | DOL, star-delta, soft starter or VFD; required breaker/cable/transformer |
| Maximum ambient | Rating and any derating above 40°C / 45°C / 50°C |
| Ingress / dust protection | Motor, controller and drive IP ratings |
| Package formats | Trailer, wheeled, skid, drag skid, container or engineered pack |
| Mine-spec options | Fire suppression, E-stop, isolation, guards, lifting, lighting, containment |
| Dryer / receiver integration | Standard / engineered / unavailable |
| Australian electrical compliance | Required design review, certification and documentation |
| Pressure-vessel compliance | Receiver/vessel registration or design verification requirement |
| Lifting / frame compliance | AS 4991 or other applicable requirement |
| Road registration | Whether any undercarriage is suitable for Australian road use |
| Noise data | Rated sound pressure / sound power |
| Factory lead time | Current working assumption: approximately three months |
| Freight lead time | Current working assumption: approximately one month sea freight |
| Local modification duration | To be established by the selected Australian engineering route |
| MOQ / order constraints | Minimum order or batch requirement |
| Spare-parts availability | Stocking strategy and lead time |
| Service competence | Training/tooling required in Australia |
| Warranty | Standard and engineered-conversion treatment |
| Factory transfer price | AUD or source currency; internal only |
| Landed-cost assumption | Freight, duty, local engineering and commissioning |
| Local engineering cost | Unknown; establish Low / Base / High range by product family |
| Indicative Australia net sales value | Internal planning value, not customer quotation |
| Commercial status | Addressable now / conditional / gap / excluded |
| Evidence owner and date | Person/function confirming the answer |

## Working addressability rules

### `addressable_now`

Use only when the factory/product company has confirmed a locally deployable configuration and the remaining compliance work is routine and costed.

### `conditional_factory_confirmation`

Use where the sourceable product exists but Australian configuration, documentation or commercial availability is not confirmed.

### `conditional_voltage`

Use where 380 V is the only confirmed source configuration and 400/415 V or 1,000 V suitability remains unresolved.

### `conditional_compliance`

Use where the sourceable machine can be adapted locally, but mine, electrical, lifting, pressure-vessel, package or road requirements remain material or uncosted.

For the current China-based route, this is the normal working status after voltage feasibility is established and before local-engineering scope and cost are approved.

### `portfolio_gap`

Use where public demand exists but the current identified product portfolio does not meet the pressure/flow/configuration requirement.

Local modification alone is not a portfolio gap.

## Minimum planning values needed for the September model

Exact transfer prices are not required for the first management sensitivity. A defensible range is sufficient.

Please provide a Low / Base / High indicative Australia net sales value for:

1. TS1 small/medium relocatable electric (~130–500 CFM).
2. TS2 132 kW electric (~550–760 CFM).
3. TS2 160 kW electric (~600–900 CFM).
4. TS3 engineered 1,000 V mine package (~900–1,000 CFM).
5. TS4 210–230 kW / 20 bar.
6. TS4 275 kW / 20–25 bar.
7. TS4 315 kW / 20 bar.
8. Dryer/receiver/fire-suppression/package uplift where separately chargeable.
9. Local electrical, structural and mine-spec modification uplift by product family.

A range is preferable to a false exact price. The Full Potential model will retain these as `financial_assumption` evidence, not as public observations.

## Immediate internal support request

The highest-value inputs are:

- confirmation that 400/415 V factory configurations can be supplied for each China family;
- an initial view of which families can be engineered to 1,000 V;
- rough Australia net sales value bands;
- first-pass local-modification scope and cost bands;
- current MOQ;
- any existing application or compliance pack already used in another market.

Factory and freight lead time are sufficiently understood for the first model: approximately three months ex-factory plus one month freight. The remaining commercial uncertainty is mainly local-engineering scope, cost and final compliance approval.

These inputs unlock the monetary TS2–TS4 model. Public market research can continue without them, but the output must remain a position count or a broad financial sensitivity rather than a committed revenue value.
