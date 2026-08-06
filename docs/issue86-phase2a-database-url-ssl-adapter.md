# Issue #86 Phase 2A — provider `ssl` URL adapter

The production `DATABASE_URL` contains one query parameter named `ssl`. The
reviewed Phase 2A runner intentionally rejects every URL query string so that
provider options cannot be merged into mysql2 and weaken its fixed TLS and
connection configuration.

This adapter is a narrow compatibility boundary. It accepts exactly one
lowercase `ssl` occurrence, discards the value, removes the complete query
string, and delegates to the unchanged reviewed runner. The value is never
used as connection configuration and is never written to evidence or logs.

The underlying runner still controls:

- certificate-authorised TLS and CA/leaf pinning;
- `multipleStatements=false`;
- `flags=-LOCAL_FILES`;
- the exact MySQL 8.4 engine patch;
- the target database and account identity hashes;
- the exact SELECT-only / `REQUIRE SSL` grant profile;
- the fixed query manifest, mutation counters, two read-only snapshots,
  rollbacks and evidence pack.

## Rejection rules

The adapter rejects:

- no query parameter;
- duplicate `ssl` parameters;
- any key other than exact lowercase `ssl`;
- a fragment;
- control characters or oversized values;
- non-MySQL URLs;
- all CLI shapes except `--output-dir <new-directory>`.

The adapter does not authorise migration `0091`, database writes, grant
changes, deployment or provider calls. Production execution remains separately
controller-authorised and hash-pinned.

## Read-only discovery

`issue86-phase2a-production-discovery.mjs` uses the same exact URL policy and
the approved query-free parser. It opens one TLS-authenticated connection and
executes only five fixed SELECT/SHOW statements to return engine, TLS, hashed
database/account identity and grant-profile evidence. It cannot run a migration
or write data. This discovery remains separately controller-authorised.
