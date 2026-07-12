# Test database isolation summary

The Vitest configuration now ignores the application `DATABASE_URL` and exposes
only a separately supplied `TEST_DATABASE_URL` to tests.

When no test URL is supplied, `DATABASE_URL` is blanked so database-backed tests
fail closed instead of using production. A guard also rejects invalid URLs,
non-MySQL protocols, missing database names, and database names without an
explicit `test`, `testing`, or `ci` marker.
