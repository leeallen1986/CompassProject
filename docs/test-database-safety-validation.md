# Validation commands

Pure guard tests can run without a database:

```bash
pnpm exec vitest run server/testDatabaseSafety.test.ts
```

Database-backed integration suites require a dedicated test database:

```bash
TEST_DATABASE_URL='mysql://.../compass_test' \
  pnpm exec vitest run \
    server/pipeline.attribution.test.ts \
    server/pipeline.legacyCompatibility.test.ts \
    server/pipeline.accessControl.test.ts
```

The test database must already contain the committed schema.
