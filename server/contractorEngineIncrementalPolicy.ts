export const CONTRACTOR_ENGINE_CURSOR_VERSION = 1 as const;
export const CONTRACTOR_ENGINE_CURSOR_KEY = "contractorEngine.incremental.v1";
export const CONTRACTOR_ENGINE_PROGRESS_KEY = "contractorEngine.incremental.progress.v1";

export const DEFAULT_PROJECT_BATCH_SIZE = 120;
export const MAX_PROJECT_BATCH_SIZE = 500;
export const PROJECT_CHUNK_SIZE = 20;

export const DEFAULT_AWARD_BATCH_SIZE = 120;
export const MAX_AWARD_BATCH_SIZE = 500;

export const DEFAULT_SCORING_BATCH_SIZE = 160;
export const MAX_SCORING_BATCH_SIZE = 500;
export const SCORING_CHUNK_SIZE = 40;

export const MAX_PERSISTED_PAIRINGS = 2_000;
export const CONTRACTOR_ENGINE_SOFT_RUNTIME_MS = 35 * 60 * 1000;

export interface ContractorEngineCursorState {
  version: typeof CONTRACTOR_ENGINE_CURSOR_VERSION;
  projectCursor: number;
  awardedCursor: number;
  scoringCursor: number;
  projectCycles: number;
  awardedCycles: number;
  scoringCycles: number;
}

export interface ContractorEngineProgressCounts {
  projectsProcessed: number;
  projectChunksCompleted: number;
  contractorsTouched: number;
  linksWritten: number;
  awardsProcessed: number;
  contractorsScored: number;
  pairingsRebuilt: number;
  patternsDetected: number;
  projectCursor: number;
  awardedCursor: number;
  scoringCursor: number;
  projectCycles: number;
  awardedCycles: number;
  scoringCycles: number;
  registryMs: number;
  awardsMs: number;
  pairingsMs: number;
  scoringMs: number;
  patternsMs: number;
  totalMs: number;
  softBudgetExhausted: number;
}

export interface ContractorEngineProgressSnapshot {
  phase: string;
  counts: ContractorEngineProgressCounts;
}

export const EMPTY_CURSOR_STATE: ContractorEngineCursorState = {
  version: CONTRACTOR_ENGINE_CURSOR_VERSION,
  projectCursor: 0,
  awardedCursor: 0,
  scoringCursor: 0,
  projectCycles: 0,
  awardedCycles: 0,
  scoringCycles: 0,
};

export const EMPTY_PROGRESS_COUNTS: ContractorEngineProgressCounts = {
  projectsProcessed: 0,
  projectChunksCompleted: 0,
  contractorsTouched: 0,
  linksWritten: 0,
  awardsProcessed: 0,
  contractorsScored: 0,
  pairingsRebuilt: 0,
  patternsDetected: 0,
  projectCursor: 0,
  awardedCursor: 0,
  scoringCursor: 0,
  projectCycles: 0,
  awardedCycles: 0,
  scoringCycles: 0,
  registryMs: 0,
  awardsMs: 0,
  pairingsMs: 0,
  scoringMs: 0,
  patternsMs: 0,
  totalMs: 0,
  softBudgetExhausted: 0,
};

function safeNonNegativeInteger(value: unknown, fallback = 0): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

export function parseContractorEngineCursor(raw: string | null | undefined): ContractorEngineCursorState {
  if (!raw) return { ...EMPTY_CURSOR_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<ContractorEngineCursorState>;
    if (parsed.version !== CONTRACTOR_ENGINE_CURSOR_VERSION) return { ...EMPTY_CURSOR_STATE };
    return {
      version: CONTRACTOR_ENGINE_CURSOR_VERSION,
      projectCursor: safeNonNegativeInteger(parsed.projectCursor),
      awardedCursor: safeNonNegativeInteger(parsed.awardedCursor),
      scoringCursor: safeNonNegativeInteger(parsed.scoringCursor),
      projectCycles: safeNonNegativeInteger(parsed.projectCycles),
      awardedCycles: safeNonNegativeInteger(parsed.awardedCycles),
      scoringCycles: safeNonNegativeInteger(parsed.scoringCycles),
    };
  } catch {
    return { ...EMPTY_CURSOR_STATE };
  }
}

export function serializeContractorEngineCursor(state: ContractorEngineCursorState): string {
  return JSON.stringify({
    version: CONTRACTOR_ENGINE_CURSOR_VERSION,
    projectCursor: safeNonNegativeInteger(state.projectCursor),
    awardedCursor: safeNonNegativeInteger(state.awardedCursor),
    scoringCursor: safeNonNegativeInteger(state.scoringCursor),
    projectCycles: safeNonNegativeInteger(state.projectCycles),
    awardedCycles: safeNonNegativeInteger(state.awardedCycles),
    scoringCycles: safeNonNegativeInteger(state.scoringCycles),
  });
}

export function boundedBatchSize(raw: string | undefined, fallback: number, maximum: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(maximum, Math.max(1, parsed));
}

export function nextCursorAfterChunk(
  currentCursor: number,
  completedIds: number[],
  wrapped: boolean,
): { cursor: number; cycleIncrement: number } {
  const clean = completedIds.filter(id => Number.isSafeInteger(id) && id > 0);
  if (clean.length === 0) return { cursor: currentCursor, cycleIncrement: 0 };
  return {
    cursor: Math.max(...clean),
    cycleIncrement: wrapped ? 1 : 0,
  };
}

export function selectAfterCursor<T extends { id: number }>(
  input: readonly T[],
  cursor: number,
  limit: number,
): { rows: T[]; wrapped: boolean } {
  const sorted = [...input].sort((a, b) => a.id - b.id);
  const after = sorted.filter(row => row.id > cursor).slice(0, limit);
  if (after.length > 0 || cursor === 0) return { rows: after, wrapped: false };
  return { rows: sorted.slice(0, limit), wrapped: true };
}

export function dedupeLinkKeys<T extends { contractorId: number; projectId: number; role: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const row of rows) {
    const key = `${row.contractorId}:${row.projectId}:${row.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

export function shouldStartPhase(startedAtMs: number, nowMs: number, minimumRemainingMs = 0): boolean {
  const elapsed = Math.max(0, nowMs - startedAtMs);
  return elapsed + Math.max(0, minimumRemainingMs) < CONTRACTOR_ENGINE_SOFT_RUNTIME_MS;
}

export function buildHardTimeoutSummary(durationMs: number, phase?: string | null): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  const safePhase = (phase || "unknown").replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 64) || "unknown";
  return `Contractor Engine hard timeout after ${seconds}s; child process killed; last phase=${safePhase}`;
}
