# Full Potential UI Shell Notes

This sprint adds the first read-only Full Potential operating page.

## Scope included

- Read endpoints added to `server/routers/fullPotential.ts`:
  - `fullPotential.list`
  - `fullPotential.stats`
  - `fullPotential.filterOptions`
  - `fullPotential.importHistory`
- New `/full-potential` route.
- New `client/src/pages/FullPotential.tsx` page.
- KPI cards, filters, paginated account table and import history panel.

## Scope intentionally excluded

- Account editing.
- Upload/import UI.
- Account Attack linking.
- My Week integration.
- Signal matching.
- C4C integration.
- Lusha/contact enrichment.

## Design choice

The read endpoints currently query the imported Full Potential account table and perform lightweight filtering in the server process. This is acceptable for the first imported universe size (~1,168 records) and keeps the initial UI shell simple. We can move filtering deeper into SQL when the universe grows materially or when we add more complex signal/account matching.
