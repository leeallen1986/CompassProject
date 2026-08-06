# Issue #86 Phase 2A production preflight

Status: **development branch only — not approved for production execution**.

This tool is a read-only evidence collector for deciding whether the exact forward-only
0091 migration may be considered for a later, separately authorised production apply.
It never runs migration SQL and it never grants apply authority.

## Why the Manus draft was replaced

The exported Manus draft is retained only as provenance outside the repository. Its
reported tool SHA-256 was
`4acd3f5c9b016acfac8e4eafbad022c97b21f8cdb6a0a16e58752abe42c7361d`.
It is not approved for production use. The principal defects included invalid MySQL
`SHOW STATUS ... ORDER BY` syntax, prepared execution of transaction controls,
a false-READY path after a failed read-only check, incomplete mutation-counter
validation, a non-consuming fake transcript, and evidence claims that were broader
than the observations.

The corrected implementation is intentionally separate:

- `scripts/issue86-phase2a-preflight-core.mjs` — immutable contracts and pure policy;
- `scripts/issue86-phase2a-production-preflight.mjs` — one-connection runner and CLI;
- `scripts/issue86-phase2a-production-preflight.test.mjs` — source, policy, and strict
  query-protocol tests.

## Immutable source contract

| Artifact | Exact bytes | Exact SHA-256 |
|---|---:|---|
| `drizzle/0090_full_potential_v1_commercial_model.sql` | 5,362 | `8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2` |
| `drizzle/0091_issue86_buyer_route_evidence.sql` | 23,270 | `d6b76795819387a012768978403156b3b1b7f70fd129cbfe1484d052bf7346c4` |

The 0090 file ends in byte `0x3b` and has no terminal LF. The hash
`85ef1c42f3e252b837fcd6df2ce350f8c9af84b5854f934410a0c7b18a677d0f`
is the known one-terminal-LF variant and must block for controller review; it is not
accepted as exact committed source bytes.

The 0091 migration contains four `CREATE TABLE`, eighteen `CREATE INDEX`, seven
foreign-key `ALTER TABLE`, thirty-five `CHECK` declarations, and no DML.

## Safety boundary

The tool:

- accepts exactly `--output-dir <new-directory>`;
- reads `DATABASE_URL` only from the environment;
- rejects URL query options, fragments, unsupported schemes, missing components,
  and multi-database paths;
- constructs an allowlisted mysql2 configuration and never passes `{ uri }`;
- disables multiple statements and `LOCAL_FILES`;
- requires a certificate-authorised TLS connection and confirms the MySQL session
  cipher/version;
- requires a dedicated `REQUIRE SSL`, SELECT-only account with no active role;
- uses one raw connection and no pool, retry, or reconnect;
- executes only the fixed, source-hashed statement registry;
- routes every fixed statement through `query()`; migration SQL is never sent;
- establishes and rolls back two separate read-only, consistent snapshots;
- compares the complete journal/0090/0091 observation across those fresh snapshots;
- requires the exact 0090 physical contract derived from the attested 0090 snapshot;
- treats empty, partial, duplicate, malformed, decreased, or nonzero mutation
  counters as failure;
- writes evidence only after the connection has closed successfully;
- reports only writes by the preflight connection; global writes remain
  `NOT_PROVEN`.

A read-only MySQL transaction can still write to temporary tables. The fixed
statement registry, SELECT-only account, two rollbacks, query transcript, and
session mutation counters are therefore all mandatory layers.

## Required environment

The final controller-approved run will require these variables:

- `DATABASE_URL` — the dedicated production read-only account;
- `ISSUE86_PREFLIGHT_CA_FILE` — regular, non-symlink CA certificate file;
- `ISSUE86_PREFLIGHT_EXPECTED_NODE_VERSION` — exact rehearsed Node version;
- `ISSUE86_PREFLIGHT_EXPECTED_TOOL_SHA256` — exact controller-approved runner hash;
- `ISSUE86_PREFLIGHT_EXPECTED_CORE_SHA256` — exact controller-approved core hash;
- `ISSUE86_PREFLIGHT_EXPECTED_DB_IDENTITY_SHA256` — independently approved hash of
  the Oracle MySQL server UUID, selected database, and server port.

The expected database identity must come from a trusted production configuration
source. It must not be learned from the same untrusted connection and immediately
accepted.

## Evidence output

After a completed and successfully closed connection, the tool writes six canonical
JSON evidence files and a seventh non-self-referential SHA index. The index contains
relative filenames, byte counts, and hashes only. It does not contain absolute paths.

Exit codes:

- `0`: database state passed every preflight gate; a separate apply decision is
  still required;
- `2`: completed read-only evidence collection but blocked;
- `1`: source, configuration, connection, cleanup, or evidence-writing failure.

Every outcome keeps:

- `applyAuthorized: false`;
- `separateApplyAuthorizationRequired: true`;
- `migrationAppliedByThisPreflight: false`.

## Development verification

Run the database-free suite:

```sh
node --check scripts/issue86-phase2a-preflight-core.mjs
node --check scripts/issue86-phase2a-production-preflight.mjs
node --test scripts/issue86-phase2a-production-preflight.test.mjs
```

Production approval additionally requires a disposable, TLS-enabled Oracle MySQL
8.4 integration run using mysql2 3.16.3 and a `REQUIRE SSL`, SELECT-only test user.
The real integration must prove MySQL grammar, exact query ordering, one connection,
TLS authorisation, unchanged schema/journal fingerprints, no DML/DDL, and all-zero
mutation-counter deltas.

## Production hold

Do not give this development branch or any intermediate hash to Manus. Do not run
the preflight against production. Do not apply 0091.

The eventual Manus task is limited to executing one externally hash-verified command
on the production-connected machine and returning the evidence bundle unchanged.
Any production preflight and the later migration apply are separate controller
decisions.
