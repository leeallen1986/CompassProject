import { createHash } from "node:crypto";
import {
  RECURRING_PROJECT_SNAPSHOT_VERSION,
  type RecurringProjectSnapshotDocument,
  type RecurringProjectSnapshotRow,
  type RecurringSnapshotSource,
} from "@shared/recurringProjectDiscoveryContract";

export const RECURRING_PROJECT_SNAPSHOT_MAX_ROWS = 20_000 as const;

export const RECURRING_PROJECT_REQUIRED_COLUMNS = [
  "id",
  "reportId",
  "projectKey",
  "name",
  "location",
  "owner",
  "sector",
  "stage",
  "stageCode",
  "lifecycleStatus",
  "projectType",
  "productLane",
  "sourcePurpose",
  "tenderNumber",
  "tenderCloseDate",
  "timeline",
  "completion",
  "sources",
  "duplicateClusterId",
  "mergedIntoId",
  "duplicateDismissed",
  "suppressed",
  "projectCountry",
  "projectState",
  "sourceLastSeenAt",
  "lastActivityAt",
  "createdAt",
  "updatedAt",
] as const;

const S = (sql: string) => ({ method: "query" as const, sql });

/**
 * The production snapshot executor may call only these fixed statements.
 * User input is passed exclusively as bound values.
 */
export const RECURRING_PROJECT_SNAPSHOT_SQL = Object.freeze({
  ENGINE_IDENTITY: S(
    "SELECT VERSION() AS engineVersion, @@version_comment AS engineComment, SHA2(CURRENT_USER(), 256) AS currentUserSha256, SHA2(CONCAT_WS(CHAR(0), DATABASE(), @@port), 256) AS targetIdentitySha256",
  ),
  SHOW_GRANTS: S("SHOW GRANTS FOR CURRENT_USER()"),
  REQUIRED_COLUMNS: S(
    `SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME IN (${RECURRING_PROJECT_REQUIRED_COLUMNS.map(() => "?").join(",")}) ORDER BY BINARY COLUMN_NAME`,
  ),
  RANGE_COUNT: S(
    "SELECT COUNT(*) AS rowCount, MIN(id) AS minimumProjectId, MAX(id) AS maximumProjectId FROM projects WHERE id >= ? AND id <= ?",
  ),
  PROJECT_ROWS: S(
    `SELECT ${RECURRING_PROJECT_REQUIRED_COLUMNS.map(column => `\`${column}\``).join(", ")} FROM projects WHERE id >= ? AND id <= ? ORDER BY id LIMIT ?`,
  ),
});

export interface RecurringSnapshotBounds {
  fromProjectId: number;
  toProjectId: number;
  maximumRows: number;
}

export interface SnapshotGrantProfile {
  matched: true;
  classification: "select_only";
  grantCount: number;
  grantProfileSha256: string;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortDeep(child)]),
  );
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function assertSnapshotSqlManifest(): {
  passed: true;
  statementCount: number;
  queryManifestSha256: string;
} {
  const entries = Object.entries(RECURRING_PROJECT_SNAPSHOT_SQL);
  const forbidden =
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|DROP|CREATE|ALTER|REVOKE|CALL|HANDLER|LOAD\s+DATA|LOCK\s+TABLES|GET_LOCK|SLEEP|BENCHMARK|INTO\s+OUTFILE|INTO\s+DUMPFILE|FOR\s+UPDATE|FOR\s+SHARE)\b/i;
  for (const [statementId, statement] of entries) {
    if (statement.method !== "query") {
      throw new Error(`SNAPSHOT_SQL_METHOD_REJECTED:${statementId}`);
    }
    if (!/^(?:SELECT|SHOW)\b/i.test(statement.sql)) {
      throw new Error(`SNAPSHOT_SQL_START_REJECTED:${statementId}`);
    }
    if (statement.sql.includes(";")) {
      throw new Error(`SNAPSHOT_SQL_SEMICOLON_REJECTED:${statementId}`);
    }
    if (forbidden.test(statement.sql)) {
      throw new Error(`SNAPSHOT_SQL_SIDE_EFFECT_REJECTED:${statementId}`);
    }
    if (/\bGRANT\b/i.test(statement.sql) && statementId !== "SHOW_GRANTS") {
      throw new Error(`SNAPSHOT_SQL_GRANT_TOKEN_REJECTED:${statementId}`);
    }
  }
  return {
    passed: true,
    statementCount: entries.length,
    queryManifestSha256: canonicalSha256(RECURRING_PROJECT_SNAPSHOT_SQL),
  };
}

export function assertRecurringSnapshotBounds(
  input: RecurringSnapshotBounds,
): RecurringSnapshotBounds {
  const values = [
    input.fromProjectId,
    input.toProjectId,
    input.maximumRows,
  ];
  if (!values.every(value => Number.isSafeInteger(value))) {
    throw new Error("SNAPSHOT_BOUNDS_MUST_BE_SAFE_INTEGERS");
  }
  if (input.fromProjectId < 1 || input.toProjectId < input.fromProjectId) {
    throw new Error("SNAPSHOT_PROJECT_ID_RANGE_INVALID");
  }
  if (
    input.maximumRows < 1 ||
    input.maximumRows > RECURRING_PROJECT_SNAPSHOT_MAX_ROWS
  ) {
    throw new Error("SNAPSHOT_MAXIMUM_ROWS_INVALID");
  }
  return { ...input };
}

function oneStringPerRow(rows: unknown[]): string[] {
  return rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("SNAPSHOT_GRANT_ROW_INVALID");
    }
    const values = Object.values(row as Record<string, unknown>);
    if (values.length !== 1 || typeof values[0] !== "string") {
      throw new Error("SNAPSHOT_GRANT_ROW_SHAPE_INVALID");
    }
    return values[0].trim();
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * TiDB parses unqualified START TRANSACTION READ ONLY as compatibility syntax
 * without making the transaction read-only. The connected account itself must
 * therefore be demonstrably SELECT-only before project rows are read.
 */
export function assertSelectOnlyGrantProfile(
  grantRows: unknown[],
  databaseName: string,
): SnapshotGrantProfile {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(databaseName)) {
    throw new Error("SNAPSHOT_DATABASE_IDENTIFIER_INVALID");
  }
  const grants = oneStringPerRow(grantRows);
  if (grants.length < 1 || grants.length > 10) {
    throw new Error("SNAPSHOT_GRANT_COUNT_REJECTED");
  }
  const normalised = grants.map(grant => grant.replace(/`/g, ""));
  const databasePattern = escapeRegExp(databaseName).replace(
    /_/g,
    "(?:_|\\\\_)",
  );
  const usagePattern = /^GRANT USAGE ON \*\.\* TO .+$/i;
  const selectPattern = new RegExp(
    `^GRANT SELECT ON ${databasePattern}\\.(?:\\*|projects) TO .+$`,
    "i",
  );
  const forbidden =
    /\b(?:ALL PRIVILEGES|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|INDEX|TRIGGER|EVENT|EXECUTE|FILE|PROCESS|SUPER|RELOAD|SHUTDOWN|REPLICATION|GRANT OPTION|SYSTEM_USER|CONNECTION_ADMIN|SYSTEM_VARIABLES_ADMIN|RESTRICTED_VARIABLES_ADMIN|RESTRICTED_REPLICA_WRITER_ADMIN)\b/i;
  const allowed = normalised.every(
    grant => usagePattern.test(grant) || selectPattern.test(grant),
  );
  const selectCount = normalised.filter(grant => selectPattern.test(grant)).length;
  if (!allowed || selectCount < 1 || normalised.some(grant => forbidden.test(grant))) {
    throw new Error("SNAPSHOT_GRANT_PROFILE_NOT_SELECT_ONLY");
  }
  return {
    matched: true,
    classification: "select_only",
    grantCount: grants.length,
    grantProfileSha256: canonicalSha256([...grants].sort()),
  };
}

export function assertRequiredProjectColumns(rows: unknown[]): void {
  const found = new Set(
    rows.map(row => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("SNAPSHOT_COLUMN_ROW_INVALID");
      }
      const value = (row as Record<string, unknown>).columnName;
      if (typeof value !== "string") {
        throw new Error("SNAPSHOT_COLUMN_NAME_INVALID");
      }
      return value;
    }),
  );
  const missing = RECURRING_PROJECT_REQUIRED_COLUMNS.filter(
    column => !found.has(column),
  );
  if (missing.length > 0 || found.size !== RECURRING_PROJECT_REQUIRED_COLUMNS.length) {
    throw new Error(`SNAPSHOT_REQUIRED_COLUMNS_MISMATCH:${missing.join(",")}`);
  }
}

function cleanText(value: unknown, maximumLength: number): string {
  const result = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return result.slice(0, maximumLength);
}

function nullableText(value: unknown, maximumLength: number): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = cleanText(value, maximumLength);
  return cleaned || null;
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`SNAPSHOT_INTEGER_INVALID:${field}`);
  }
  return parsed;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function canonicalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const text = cleanText(value, 64);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const mysqlTimestamp = text.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z)?$/,
  );
  if (mysqlTimestamp) return `${mysqlTimestamp[1]}T${mysqlTimestamp[2]}.000Z`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("SNAPSHOT_DATE_INVALID");
  }
  return parsed.toISOString();
}

/**
 * Public-source date strings are optional evidence. A malformed value must not
 * block an otherwise valid bounded snapshot; retain the source and omit only
 * the unusable date. Database-owned project timestamps remain strict.
 */
function optionalSourceDate(value: unknown): string | null {
  try {
    return canonicalDate(value);
  } catch {
    return null;
  }
}

function sanitisePublicUrl(value: unknown): string | null {
  const text = nullableText(value, 2_048);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normaliseSources(value: unknown): RecurringSnapshotSource[] {
  let sourceValue = value;
  if (typeof sourceValue === "string") {
    try {
      sourceValue = JSON.parse(sourceValue);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(sourceValue)) return [];
  return sourceValue
    .slice(0, 50)
    .map(source => {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        return null;
      }
      const row = source as Record<string, unknown>;
      const label = nullableText(row.label, 512);
      if (!label) return null;
      return {
        label,
        url: sanitisePublicUrl(row.url),
        date: optionalSourceDate(row.date),
      } satisfies RecurringSnapshotSource;
    })
    .filter((source): source is RecurringSnapshotSource => source !== null)
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

export function normaliseRecurringProjectSnapshotRow(
  row: Record<string, unknown>,
): RecurringProjectSnapshotRow {
  const id = integer(row.id, "id");
  if (id < 1) throw new Error("SNAPSHOT_PROJECT_ID_INVALID");
  const reportId = integer(row.reportId, "reportId");
  if (reportId < 1) throw new Error("SNAPSHOT_REPORT_ID_INVALID");
  const projectKey = cleanText(row.projectKey, 128);
  const name = cleanText(row.name, 512);
  const location = cleanText(row.location, 256);
  const owner = cleanText(row.owner, 256);
  const sector = cleanText(row.sector, 64);
  if (!projectKey || !name || !location || !owner || !sector) {
    throw new Error(`SNAPSHOT_REQUIRED_PROJECT_TEXT_MISSING:${id}`);
  }
  const createdAt = canonicalDate(row.createdAt);
  if (!createdAt) throw new Error(`SNAPSHOT_CREATED_AT_MISSING:${id}`);
  return {
    id,
    reportId,
    projectKey,
    name,
    location,
    owner,
    sector,
    stage: nullableText(row.stage, 256),
    stageCode: nullableText(row.stageCode, 64),
    lifecycleStatus: cleanText(row.lifecycleStatus, 64),
    projectType: nullableText(row.projectType, 64),
    productLane: nullableText(row.productLane, 64),
    sourcePurpose: nullableText(row.sourcePurpose, 64),
    tenderNumber: nullableText(row.tenderNumber, 64),
    tenderCloseDate: canonicalDate(row.tenderCloseDate),
    timeline: nullableText(row.timeline, 256),
    completion: nullableText(row.completion, 256),
    sources: normaliseSources(row.sources),
    duplicateClusterId: nullableText(row.duplicateClusterId, 64),
    mergedIntoId:
      row.mergedIntoId === null || row.mergedIntoId === undefined
        ? null
        : integer(row.mergedIntoId, "mergedIntoId"),
    duplicateDismissed: booleanValue(row.duplicateDismissed),
    suppressed: booleanValue(row.suppressed),
    projectCountry: nullableText(row.projectCountry, 2),
    projectState: nullableText(row.projectState, 64),
    sourceLastSeenAt: canonicalDate(row.sourceLastSeenAt),
    lastActivityAt: canonicalDate(row.lastActivityAt),
    createdAt,
    updatedAt: canonicalDate(row.updatedAt),
  };
}

export function buildRecurringProjectSnapshotDocument(input: {
  sourceSha: string;
  bounds: RecurringSnapshotBounds;
  rows: Record<string, unknown>[];
}): RecurringProjectSnapshotDocument {
  if (!/^[0-9a-f]{40}$/.test(input.sourceSha)) {
    throw new Error("SNAPSHOT_SOURCE_SHA_INVALID");
  }
  const bounds = assertRecurringSnapshotBounds(input.bounds);
  if (input.rows.length > bounds.maximumRows) {
    throw new Error("SNAPSHOT_RESULT_EXCEEDS_MAXIMUM_ROWS");
  }
  const projects = input.rows
    .map(normaliseRecurringProjectSnapshotRow)
    .sort((left, right) => left.id - right.id);
  const ids = new Set<number>();
  for (const project of projects) {
    if (ids.has(project.id)) throw new Error("SNAPSHOT_DUPLICATE_PROJECT_ID");
    ids.add(project.id);
    if (
      project.id < bounds.fromProjectId ||
      project.id > bounds.toProjectId
    ) {
      throw new Error("SNAPSHOT_PROJECT_OUTSIDE_REQUESTED_RANGE");
    }
  }
  const snapshotRef = [
    "recurring-project-snapshot-v1",
    input.sourceSha,
    bounds.fromProjectId,
    bounds.toProjectId,
  ].join(":");
  return {
    version: RECURRING_PROJECT_SNAPSHOT_VERSION,
    mode: "read_only_project_snapshot",
    sourceSha: input.sourceSha,
    snapshotRef,
    rowBounds: bounds,
    projects,
  };
}
