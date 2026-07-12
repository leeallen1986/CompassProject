# Deployment note: production test-residue incident

On 12 July 2026, database-backed Vitest suites inherited the application's
production `DATABASE_URL`. This created test-only Full Potential pipeline claims
in production.

The `fix/test-database-isolation` change prevents recurrence by making
`TEST_DATABASE_URL` the only database URL visible to Vitest and clearing
`DATABASE_URL` when no test database is supplied.

This change does not clean existing production residue. Production cleanup and
migration-journal reconciliation must remain a separately approved,
checkpointed database operation.
