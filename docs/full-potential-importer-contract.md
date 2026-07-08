# Full Potential Importer Contract

The Full Potential importer accepts admin-uploaded XLSX/XLS/CSV data as base64 and returns a typed import summary.

## Mutation

```ts
fullPotential.import({
  fileName: string,
  fileBase64: string,
  sheetName?: string,
  dryRun?: boolean,
  sourceWorkbookVersion?: string,
  clearBlankValues?: boolean,
})
```

## Defaults

```ts
dryRun = true
clearBlankValues = false
```

## Writes

When `dryRun` is `false`, the importer writes only:

- `fullPotentialAccounts`
- `fullPotentialAccountAliases`
- `fullPotentialImports`

It does not write:

- `fullPotentialSignals`
- `fullPotentialActions`
- C4C/CRM records

## Row validation

Rows are skipped if these cannot be mapped:

- `canonicalName`
- `rowClass`
- `routeToMarket`
- `fpStatus`
- `platformPushDecision`

The error array is capped to the first 100 row errors.
