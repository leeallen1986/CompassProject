# Full Potential Importer Review Notes

This PR adds the backend importer module for the Full Potential account universe.

## Important scope note

The importer logic is implemented in `server/routers/fullPotential.ts` and exported as `fullPotentialRouter` with an admin-only `import` mutation.

The app-router wire-up is intentionally left for a tiny follow-up commit/PR if needed, because `server/routers.ts` is a very large legacy file. The intended wire-up is:

```ts
import { fullPotentialRouter } from "./routers/fullPotential";

export const appRouter = router({
  // ...existing routers
  fullPotential: fullPotentialRouter,
});
```

No UI, C4C integration, signal writes, action writes, or workbook files are included.

## Safety defaults

- `dryRun` defaults to `true`.
- Only admin users can call the mutation.
- Blank spreadsheet cells do not overwrite existing account values unless `clearBlankValues` is explicitly true.
- Committed imports write accounts, aliases and one audit row only.
- Dry-runs write nothing.
