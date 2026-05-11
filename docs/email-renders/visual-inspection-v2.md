# Visual Inspection — Post-Fix Email Renders (v2)

## Ryan Pemberton
- Header: ATLAS COPCO | WA/OFFSHORE_AU · 2026-05-08 ✓
- Greeting: "Hi Ryan," ✓
- Summary line: "3 action-ready opportunities and 2 need contact discovery this week." ✓
- Card 1: ACTION READY | Walyering West-1 Gas Development — Portable Air | Strike Energy (operator) | Clean pitch, no mid-word cut | CTA: "Contact Diego Linares, Construction Site Manager to discuss application, timing, equipment package, and contractor route-to-buy." ✓ | Tag: "Portable Air for Oil & Gas" ✓
- Card 2: ACTION READY | Norseman Gold Project... — Multi-Line PT | Pantoro Gold | CTA: "Contact Troy Morris, Maintenance Manager to discuss application, timing, equipment package, and contractor route-to-buy." ✓ | Tag: "Multi-Line PT for Mining" ✓
- Card 3: ACTION READY | Murchison Gold Project... — Direct CAPEX | Meeka Metals | Pitch ends with "..." but at word boundary ("equipment for...") — still has minor truncation at word "for" before "..." | CTA: "Contact John Sinagra, Procurement Superintendent to discuss application, timing, equipment package, and contractor route-to-buy." ✓ | Tag: "Direct CAPEX for Mining" ✓
- Card 4: DISCOVERY NEEDED | Desert Star Project — Portable Air | Bavan Mining and Minerals (visible at bottom) ✓
- No rental language visible ✓
- No raw slugs visible ✓

## Brett Hansen
- Header: ATLAS COPCO | WA/NT/OFFSHORE_AU · 2026-05-08 ✓
- Greeting: "Hi Brett," ✓
- Card 1: ACTION READY | Kwinana Gas Power Generation 2 Project — Pumps | AGL | CTA: "Contact Paul Holland, General Manager Procurement & Property to discuss dewatering scope, pump package, and site requirements." ✓ (Pumps lane CTA) | Tag: "Pumps for Energy" ✓
- Card 2: ACTION READY | Walyering West-1 Gas Development — Portable Air | Strike Energy (operator) | CTA: "Contact Diego Linares, Construction Site Manager to discuss application, timing, equipment package, and contractor route-to-buy." ✓
- Card 3: ACTION READY | Norseman Gold Project... — Multi-Line PT | Pantoro Gold | CTA: "Contact Troy Morris, Maintenance Manager..." ✓
- Card 4: DISCOVERY NEEDED | Desert Star Project — Portable Air ✓
- No rental language ✓, No raw slugs ✓

## Daniel Zec
- Header: ATLAS COPCO | NSW/VIC/SA/TAS/OFFSHORE_AU · 2026-05-08 ✓
- Greeting: "Hi Daniel," ✓
- Card 1: ACTION READY | Bass Strait Decommissioning... — Fleet CAPEX | Unknown (related to Bass Strait operators like ExxonMobil) | CTA: "Contact Sam Leszczynski, General Manager - Mining Services to discuss application, timing, equipment package, and contractor route-to-buy." ✓ | Tag: "Fleet CAPEX for Oil & Gas" ✓
- Card 2: ACTION READY | Olympic Dam Expansion — BHP — Direct CAPEX | BHP Olympic Dam | Long CTA with full title "Head of Projects Commercial, Major Projects and New Developments" — this title is long but legitimate (not a LinkedIn headline) ✓ | Tag: "Direct CAPEX for Mining" ✓
- Card 3: ACTION READY | Snowy 2.0 Hydroelectric Project — Multi-Line PT | Snowy Hydro | CTA: "Contact Giuseppe Gulisano, Deputy Construction Manager to discuss application, timing, equipment package, and contractor route-to-buy." ✓ | Tag: "Multi-Line PT for Energy" ✓
- Card 4: DISCOVERY NEEDED | North East Link Program — Direct CAPEX ✓
- No rental language ✓, No raw slugs ✓

## Dan Day
- Header: ATLAS COPCO | SA/QLD/VIC/NSW/TAS · 2026-05-08 ✓
- Greeting: "Hi Dan," ✓
- Card 1: ACTION READY | Bass Strait Decommissioning... — Fleet CAPEX | Same as Daniel Zec ✓
- Card 2: ACTION READY | Bruce Highway Safety Upgrades Program — Multi-Line PT | Queensland Government (implied) | CTA: "Contact Abe Ninan, Manager (Procurement Analysis) to discuss application, timing, equipment package, and contractor route-to-buy." ✓ | Tag: "Multi-Line PT for Infrastructure" ✓
- Card 3: ACTION READY | Bruce Highway Targeted Safety Program (BHTSP) — Pumps | Federal and Queensland governments | CTA: "Contact Mark Nicholl, Construction Manager to discuss dewatering scope, pump package, and site requirements." ✓ (Pumps lane CTA) | Tag: "Pumps for Infrastructure" ✓
- Card 4: DISCOVERY NEEDED | Cairns Drinking Water Supply Upgrades (Bayview and Brinsmead) ✓
- No rental language ✓, No raw slugs ✓

## Amit Bhargava
- Header: ATLAS COPCO | WA/NSW/QLD/VIC/SA/TAS/NT/ACT/OFFSHORE_AU · 2026-05-08 ✓
- Greeting: "Hi Amit," ✓
- Card 1: ACTION READY | Bellambi Heights Battery Energy Storage System - Stage 2 — BESS | Vena Energy | Pitch truncates at word boundary: "Wales, expected..." ✓ | CTA: "Contact Choi JungIn, Engineering Manager, Offshore Wind to discuss project package, deployment timing, and site delivery path." ✓ (BESS lane CTA) | Tag: "BESS for Energy" ✓
- Card 2: ACTION READY | Blind Creek Solar and Battery Project — Multi-Line PT | Octopus Australia | CTA: "Contact Ubayeda Shaqer, Senior Project Manager to discuss application, timing, equipment package, and contractor route-to-buy." ✓ (LinkedIn headline sanitised to "Senior Project Manager") | Tag: "Multi-Line PT for Energy" ✓
- Card 3: ACTION READY | Koolunga BESS (Battery Energy Storage System) — Direct CAPEX | Equis | CTA: "Contact Vincenzo Gennaro, General Manager BESS & Solar Development to discuss application, timing, equipment package, and contractor route-to-buy." ✓ | Tag: "Direct CAPEX for Energy" ✓
- Card 4: DISCOVERY NEEDED | Alinta Energy 500 MW / 2,000 MWh Battery Energy Storage System (Stage 1) — Direct CAPEX ✓
- No rental language ✓, No raw slugs ✓, Ubayeda's LinkedIn headline correctly sanitised ✓

## Overall Assessment
- All 6 fixes confirmed working visually
- No rental language in any email
- No raw slugs (portable_air, multi_lane_pt, bess, OPEXMonitor) in any email
- Contact names shown with title (e.g., "Contact Diego Linares, Construction Site Manager")
- Lane-appropriate CTA language: Pumps=dewatering, BESS=deployment, Portable Air/PT=application+route-to-buy
- Word-boundary truncation working (pitches end at "..." after complete words)
- Ubayeda Shaqer's LinkedIn headline sanitised to "Senior Project Manager"
