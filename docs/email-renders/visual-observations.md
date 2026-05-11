# Visual Observations — Email Screenshots (Full-Page)

## Ryan Pemberton
- Header: dark navy, "ATLAS COPCO" gold, territory+date top-right — renders correctly
- Cards: ACTION READY (green pill) and DISCOVERY NEEDED (red pill) — visually distinct
- Product tags: raw slugs visible — "portable_air for oil gas", "multi_lane_pt for mining", "Direct CAPEX for mining"
- Pitch truncation: "...potential for new equipment for u..." — mid-word cut visible
- CTA links: teal italic, functional-looking
- Large blank whitespace at bottom (empty page area below footer) — cosmetic only
- No header greeting visible in screenshot (cut off at top) — header is there in HTML

## Brett Hansen
- Same structure as Ryan
- Product tags: "pumps for energy", "portable_air for oil gas", "multi_lane_pt for mining" — raw slugs
- All 3 action-ready cards visible, 2 discovery-needed
- No truncation issues visible in this rep's pitches
- Large blank whitespace at bottom

## Daniel Zec
- Product tags: "Fleet CAPEX for oil gas", "Direct CAPEX for mining", "multi_lane_pt for energy", "Direct CAPEX for infrastructure"
- "Direct CAPEX" is a human-readable opportunity route — renders fine
- CTA for Olympic Dam: "Contact the Head of Projects Commercial, Major Projects and New Developments..." — very long but wraps cleanly
- No truncation visible

## Dan Day
- Product tags: "Fleet CAPEX for oil gas", "multi_lane_pt for infrastructure", "pumps for infrastructure", "OPEXMonitor for infrastructure", "Direct CAPEX for infrastructure"
- "OPEXMonitor" appears as one word — raw slug leaking through (should be "OPEX/Monitor")
- Pitch for Cairns project truncated with "Contractors are all..." — mid-sentence cut
- All cards render cleanly otherwise

## Amit Bhargava
- Product tags: "bess for energy", "multi_lane_pt for energy", "Direct CAPEX for energy", "Fleet CAPEX for energy"
- "bess" is a raw lowercase slug — should be "BESS" or "Battery Energy Storage System"
- "multi_lane_pt" is a raw slug — should be "Multi-Lane PT" or similar
- Blind Creek CTA: "Contact the Senior Project Manager | Project Development | Engineering Management | Utilities | Renewable Energy | Infrastructure | Data Centers..." — LinkedIn headline used verbatim as job title, wraps across 2 lines in the card
- Pitch for Alinta: "This project will be a significan..." — truncated mid-word
- Pitch for Koolunga BESS: "This project..." — very short truncation

## Common Issues Across All Reps
1. RAW PRODUCT SLUGS: "portable_air", "multi_lane_pt", "bess" appear verbatim in product tag pills
2. PITCH TRUNCATION: 200-char hard cut sometimes lands mid-word ("for u...", "significan...")
3. EXCESSIVE WHITESPACE: Large blank area below footer (chromium renders full 4000px height regardless)
4. CONTACT TITLE VERBATIM: LinkedIn-style titles used as job title in CTA (Amit/Ubayeda)
5. HEADER NOT VISIBLE IN PARTIAL SCREENSHOTS: The dark navy header is present in HTML but cropped in early screenshots
