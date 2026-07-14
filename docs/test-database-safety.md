# Test database safety

Vitest is deliberately prevented from inheriting the application's
`DATABASE_URL`.

## Required setup for database-backed tests

1. Provision a separate MySQL/TiDB database for automated tests.
2. Name the database with a standalone `test`, `testing`, or `ci` marker, for
   example `compass_test` or `ci_compass`.
3. Copy `.env.test.example` to `.env.test.local` and set
   `TEST_DATABASE_URL` to that database.
4. Apply the committed migrations to the test database.
5. Run the required test command.

```bash
cp .env.test.example .env.test.local
# Edit TEST_DATABASE_URL in .env.test.local
pnpm exec drizzle-kit migrate
pnpm test
```

For migration commands targeting the test database, explicitly export the test
URL into the command environment:

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm exec drizzle-kit migrate
```

## Fail-closed behaviour

- `DATABASE_URL` is always overwritten for Vitest.
- When `TEST_DATABASE_URL` is absent, Vitest exposes an empty `DATABASE_URL`.
  Pure unit tests can still run; database-backed tests fail instead of falling
  back to production.
- Invalid URLs, non-MySQL protocols, missing database names, and database names
  without a `test`, `testing`, or `ci` marker are rejected before test modules
  execute.

Never use a production database URL as `TEST_DATABASE_URL`, even temporarily.
