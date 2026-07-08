# Full Potential Schema Review Resolution

This note captures the follow-up changes made after the initial Full Potential data-model review.

## Review items resolved

### 1. Schema integration

The original PR added `drizzle/fullPotentialSchema.ts` as a standalone schema file. The project `drizzle.config.ts` only referenced `./drizzle/schema.ts`, so Drizzle Kit would not discover the new tables.

Resolution:

```ts
schema: ["./drizzle/schema.ts", "./drizzle/fullPotentialSchema.ts"]
```

This keeps the Full Potential schema physically separate while ensuring Drizzle Kit includes it.

### 2. Route-to-market enum

The first version embedded individual rep names in the MySQL enum:

- `direct_ape_ryan`
- `direct_ape_paul_lueth`
- `direct_ape_dan`

That was changed to a single role/channel value:

- `direct_ape`

Individual ownership now belongs in `ownerName` / future `userId` mapping rather than in a MySQL enum.

### 3. Full Potential status enum

The first version included `channel_managed` in `fpStatus`. This duplicated `rowClass` and `routeToMarket`.

Resolution:

- `channel_managed` removed from `fpStatus`.
- Channel ownership should be represented by `rowClass` + `routeToMarket` + `channelOwner`.

## Remaining notes

- No production migration should run until schema shape is accepted.
- Relations should be added in a follow-up sprint when wiring the schema into the API.
- Importer and UI remain out of scope for this schema fix.
