# Test database safety checklist

Before running any database-backed Vitest suite:

- [ ] A dedicated non-production database exists.
- [ ] Its database name includes `test`, `testing`, or `ci` as a standalone marker.
- [ ] `TEST_DATABASE_URL` points to that database.
- [ ] `DATABASE_URL` is not manually set to production in the test shell.
- [ ] Committed migrations have been applied to the test database.
- [ ] The production safety checkpoint is not being used as a test target.

After the test run:

- [ ] Test-created claims, activity, outreach, and account fixtures were cleaned.
- [ ] No production database counts changed.
