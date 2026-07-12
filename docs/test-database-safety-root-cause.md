# Root cause

Vitest loaded the repository environment and database-backed integration tests
used the same `DATABASE_URL` as the application. The test suites were correctly
written to create and clean records, but an interrupted or failed run could
leave residue in whichever database was configured.

The permanent control is configuration isolation, not relying solely on cleanup:
Vitest receives only `TEST_DATABASE_URL`, and that URL must point to an explicitly
named test/CI database.
