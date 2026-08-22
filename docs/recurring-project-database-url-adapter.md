# Recurring project snapshot database URL adapter

## Production blocker

The first authorised Issue #135 production snapshot stopped before opening a
database connection because the available `DATABASE_URL` contained query
options and the strict shared parser rejected every query string.

That result did not establish whether the database account was SELECT-only. The
failure occurred before the existing `SHOW GRANTS FOR CURRENT_USER()` gate.

## Accepted URL shapes

The recurring-project snapshot accepts only:

1. a normal `mysql://` URL with no query string or fragment; or
2. a `mysql://` URL containing exactly one `ssl` query option.

The second shape reuses the reviewed Issue #86 URL policy. The query string is
removed before the strict parser is called. The option value is never used for
connection configuration and is never written to stdout, stderr, the snapshot,
the manifest or the review package.

Unknown keys, repeated `ssl` options, multiple options, fragments, malformed
encoding and oversized values fail closed.

## TLS and connection controls

Removing the provider-style `ssl` query does not disable TLS. The approved
parser still sets:

```text
ssl.rejectUnauthorized = true
ssl.minVersion = TLSv1.2
multipleStatements = false
flags = -LOCAL_FILES
```

The existing production override for insecure localhost remains limited to the
synthetic CI database and must not be used in production.

## Bounded manifest evidence

The snapshot manifest records only:

- policy version;
- accepted URL shape;
- ignored query parameter name;
- ignored parameter occurrence count;
- whether the query string was removed;
- confirmation that query values were not used for connection configuration;
- policy SHA-256.

It never records the raw URL, option value, username, password, hostname,
database name or raw grants.

## Privilege gate remains authoritative

URL adaptation only permits the snapshot command to reach the existing database
privilege check. It does not make an account read-only.

The command must still reject any account whose effective grants extend beyond:

- `USAGE` on `*.*`; and
- `SELECT` on the selected database or its `projects` table.

A successful URL adaptation followed by
`SNAPSHOT_GRANT_PROFILE_NOT_SELECT_ONLY` means a dedicated SELECT-only account
must be provisioned. The URL must not be edited manually and the grant gate must
not be bypassed.

## Safety boundary

This adapter performs no production connection by itself and authorises no:

- database write;
- migration or schema registration;
- project mutation;
- recurring programme, occurrence, link or action creation;
- Full Potential financial mutation;
- CRM/C4C mutation;
- provider call;
- pipeline invocation;
- deployment.
