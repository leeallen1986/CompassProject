# Operations boundary

This branch changes test execution only. It does not:

- modify production database records;
- alter the Drizzle migration journal;
- remove the existing 80 test claims;
- apply migration 0089;
- publish a Manus checkpoint.

Those production operations remain separately gated behind checkpointed SQL and
postflight reconciliation.
