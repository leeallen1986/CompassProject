# Owner note

Database-backed tests must not be executed until a dedicated
`TEST_DATABASE_URL` is configured. The production database must remain frozen
for test execution even after the current residue is removed.
