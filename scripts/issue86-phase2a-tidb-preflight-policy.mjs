import { TIDB_SQL } from "./issue86-phase2a-tidb-preflight-core.mjs";
import { canonicalHash } from "./issue86-phase2a-preflight-core.mjs";

const FORBIDDEN = Object.freeze([
  /^(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|SET|CALL|DO|LOAD|LOCK|UNLOCK|ADMIN)\b/i,
  /\bINTO\s+(?:OUTFILE|DUMPFILE)\b/i,
  /\bFOR\s+UPDATE\b/i,
  /\bLOCK\s+IN\s+SHARE\s+MODE\b/i,
  /\bGET_LOCK\s*\(/i,
  /(^|[^@])@[A-Za-z0-9_]+\s*:=/i,
]);

export function lintTidbReadOnlySqlManifest() {
  const errors = [];
  for (const [statementId, statement] of Object.entries(TIDB_SQL)) {
    const sql = String(statement?.sql ?? "").trim();
    if (statement?.method !== "query") {
      errors.push(`${statementId}_METHOD_INVALID`);
    }
    if (statement?.kind !== "READ") {
      errors.push(`${statementId}_KIND_INVALID`);
    }
    if (!/^(?:SELECT|SHOW)\b/i.test(sql)) {
      errors.push(`${statementId}_NOT_READ_ONLY`);
    }
    if (sql.includes(";")) {
      errors.push(`${statementId}_SEMICOLON_REJECTED`);
    }
    if (FORBIDDEN.some((pattern) => pattern.test(sql))) {
      errors.push(`${statementId}_FORBIDDEN_SQL`);
    }
  }
  return {
    passed: errors.length === 0,
    errors,
    statementCount: Object.keys(TIDB_SQL).length,
    sha256: canonicalHash(TIDB_SQL),
  };
}
