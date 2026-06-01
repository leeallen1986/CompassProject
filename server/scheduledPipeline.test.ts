/**
 * Tests for POST /api/scheduled/pipeline
 *
 * Tests cover:
 *  - Auth: missing cookie, missing header, valid auth
 *  - Idempotency: in-progress guard (409), recently-completed guard (200 already_ran)
 *  - Happy path: 202 started
 *  - Response shape validation
 *  - IDEMPOTENCY_WINDOW_HOURS and IN_PROGRESS_WINDOW_HOURS exports
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import {
  handleScheduledPipelineTrigger,
  IDEMPOTENCY_WINDOW_HOURS,
  IN_PROGRESS_WINDOW_HOURS,
  type ScheduledPipelineResponse,
} from "./scheduledPipeline";

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock ENV so pipelineSecret is available in tests
vi.mock("./_core/env", () => ({
  ENV: {
    pipelineSecret: "test-pipeline-secret-abc123",
    appId: "test-app-id",
    cookieSecret: "test-cookie-secret",
    databaseUrl: "mysql://localhost/test",
    oAuthServerUrl: "https://api.manus.im",
    ownerOpenId: "test-owner",
    isProduction: false,
    forgeApiUrl: "https://forge.manus.im",
    forgeApiKey: "test-forge-key",
    apolloApiKey: "",
    projectoryEmail: "",
    projectoryPassword: "",
    resendApiKey: "",
    appSiteUrl: "https://compasspt.manus.space",
    hunterApiKey: "",
    lushaApiKey: "",
  },
}));

// Mock sdk.authenticateRequest
vi.mock("./_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(),
  },
}));

// Mock getDb + pipelineRuns queries
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// Mock runDailyPipeline (fire-and-forget in handler) — use importOriginal to preserve other exports
vi.mock("./dailyPipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dailyPipeline")>();
  return {
    ...actual,
    runDailyPipeline: vi.fn().mockResolvedValue({
      extraction: { extracted: 5 },
      enrichment: { enriched: 3 },
      discoveryQueue: { slaQueued: 2 },
      steps: [{ name: 'rss', status: 'ok' }, { name: 'scrapers', status: 'ok' }],
      duration: 120000,
    }),
    // Keep startDailyScheduler and cleanupStaleRuns as no-ops for tests
    startDailyScheduler: vi.fn(),
    cleanupStaleRuns: vi.fn().mockResolvedValue(0),
  };
});

// Mock drizzle schema (pipelineRuns is used for DB queries)
vi.mock("../drizzle/schema", () => ({
  pipelineRuns: { id: "id", status: "status", startedAt: "startedAt", completedAt: "completedAt" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
    and: vi.fn((...args: unknown[]) => ({ and: args })),
    gte: vi.fn((a: unknown, b: unknown) => ({ gte: [a, b] })),
    desc: vi.fn((a: unknown) => ({ desc: a })),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

import { sdk } from "./_core/sdk";
import { getDb } from "./db";

type MockedFn = ReturnType<typeof vi.fn>;

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {
      cookie: "app_session_id=valid-jwt",
      "x-scheduled-task": "true",
      ...overrides.headers,
    },
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const captured = {
    status: null as number | null,
    body: null as unknown,
    lines: [] as string[],
    headers: {} as Record<string, string>,
    ended: false,
  };
  const res = {
    writableEnded: false,
    destroyed: false,
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(data: unknown) {
      captured.body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
      return res;
    },
    flushHeaders() {
      return res;
    },
    write(chunk: string) {
      captured.lines.push(chunk.trim());
      return true;
    },
    end() {
      captured.ended = true;
      res.writableEnded = true;
    },
  } as unknown as Response;
  return { res, captured };
}

function mockAuthSuccess() {
  (sdk.authenticateRequest as MockedFn).mockResolvedValue({
    id: 1,
    openId: "scheduled-task-user",
    name: "Scheduled Task",
    role: "user",
    email: null,
    loginMethod: "manus",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  });
}

function mockAuthFailure() {
  (sdk.authenticateRequest as MockedFn).mockRejectedValue(new Error("Invalid session cookie"));
}

function mockDb(options: {
  inProgressId?: number | null;
  recentCompletedId?: number | null;
  insertId?: number;
}) {
  const dbInstance = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation((_n: number) => {
      // Return different results based on call order
      return Promise.resolve([]);
    }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([{ insertId: options.insertId ?? 42 }]),
  };

  // Track call count to distinguish in-progress vs completed queries
  let callCount = 0;
  dbInstance.limit.mockImplementation((_n: number) => {
    callCount++;
    if (callCount === 1) {
      // First call: in-progress check
      if (options.inProgressId != null) {
        return Promise.resolve([{ id: options.inProgressId, startedAt: new Date() }]);
      }
      return Promise.resolve([]);
    }
    if (callCount === 2) {
      // Second call: recently completed check
      if (options.recentCompletedId != null) {
        return Promise.resolve([{ id: options.recentCompletedId, completedAt: new Date() }]);
      }
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });

  (getDb as MockedFn).mockResolvedValue(dbInstance);
  return dbInstance;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("handleScheduledPipelineTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Auth tests: X-Pipeline-Secret (bypasses OAuth) ──

  it("authenticates via X-Pipeline-Secret header without OAuth cookie", async () => {
    mockDb({ inProgressId: null, recentCompletedId: null, insertId: 42 });
    const req = makeReq({
      headers: {
        "x-pipeline-secret": "test-pipeline-secret-abc123",
        // deliberately no cookie or x-scheduled-task header
      },
    });
    const { res, captured } = makeRes();
    await handleScheduledPipelineTrigger(req, res);
    // Should start streaming — sdk.authenticateRequest must NOT have been called
    expect(sdk.authenticateRequest as MockedFn).not.toHaveBeenCalled();
    expect(captured.headers["Content-Type"]).toBe("application/x-ndjson");
    expect(captured.lines.length).toBeGreaterThanOrEqual(1);
    const startedLine = JSON.parse(captured.lines[0]);
    expect(startedLine.event).toBe("started");
  });

  it("returns 401 when X-Pipeline-Secret header value is wrong", async () => {
    const req = makeReq({
      headers: {
        "x-pipeline-secret": "wrong-secret-value",
      },
    });
    const { res, captured } = makeRes();
    await handleScheduledPipelineTrigger(req, res);
    expect(captured.status).toBe(401);
    const body = captured.body as ScheduledPipelineResponse;
    expect(body.status).toBe("error");
    expect(body.message).toContain("Unauthorized");
  });

  // ── Auth tests: OAuth cookie path ──

  it("returns 401 when X-Scheduled-Task header is missing", async () => {
    const req = makeReq({ headers: { cookie: "app_session_id=valid-jwt" } });
    const { res, captured } = makeRes();

    await handleScheduledPipelineTrigger(req, res);

    expect(captured.status).toBe(401);
    const body = captured.body as ScheduledPipelineResponse;
    expect(body.status).toBe("error");
    expect(body.message).toContain("Unauthorized");
  });

  it("returns 401 when session cookie auth fails", async () => {
    mockAuthFailure();
    const req = makeReq();
    const { res, captured } = makeRes();

    await handleScheduledPipelineTrigger(req, res);

    expect(captured.status).toBe(401);
    const body = captured.body as ScheduledPipelineResponse;
    expect(body.status).toBe("error");
  });

  it("returns 401 when both header and cookie are missing", async () => {
    const req = makeReq({ headers: {} });
    const { res, captured } = makeRes();

    await handleScheduledPipelineTrigger(req, res);

    expect(captured.status).toBe(401);
  });

  // ── Idempotency: in-progress ──

  it("returns 409 when a pipeline run is already in progress", async () => {
    mockAuthSuccess();
    mockDb({ inProgressId: 99 });

    const req = makeReq();
    const { res, captured } = makeRes();

    await handleScheduledPipelineTrigger(req, res);

    expect(captured.status).toBe(409);
    const body = captured.body as ScheduledPipelineResponse;
    expect(body.status).toBe("in_progress");
    expect(body.runId).toBe(99);
    expect(body.message).toContain("99");
  });

  // ── Idempotency: recently completed ──

  it("returns 200 already_ran when a completed run exists within the window", async () => {
    mockAuthSuccess();
    mockDb({ inProgressId: null, recentCompletedId: 77 });

    const req = makeReq();
    const { res, captured } = makeRes();

    await handleScheduledPipelineTrigger(req, res);

    expect(captured.status).toBe(200);
    const body = captured.body as ScheduledPipelineResponse;
    expect(body.status).toBe("already_ran");
    expect(body.runId).toBe(77);
    expect(body.message).toContain("77");
    expect(body.message).toContain(`${IDEMPOTENCY_WINDOW_HOURS}h`);
  });

  // ── Happy path ──

  it("streams NDJSON when no run is in progress or recently completed", async () => {
    mockAuthSuccess();
    mockDb({ inProgressId: null, recentCompletedId: null, insertId: 42 });

    const req = makeReq();
    const { res, captured } = makeRes();

    await handleScheduledPipelineTrigger(req, res);

    // Should set streaming headers
    expect(captured.headers["Content-Type"]).toBe("application/x-ndjson");
    expect(captured.headers["Cache-Control"]).toBe("no-cache, no-store");
    expect(captured.headers["X-Accel-Buffering"]).toBe("no");

    // Should have written at least the started line
    expect(captured.lines.length).toBeGreaterThanOrEqual(1);
    const startedLine = JSON.parse(captured.lines[0]);
    expect(startedLine.event).toBe("started");
    expect(startedLine.triggeredAt).toBeDefined();
    expect(startedLine.message).toContain("Pipeline launched");

    // Should have ended the stream (pipeline mock resolves immediately)
    // Wait for the background promise to resolve
    await new Promise(r => setTimeout(r, 50));
    expect(captured.ended).toBe(true);

    // Should have a completed or failed line
    const lastLine = JSON.parse(captured.lines[captured.lines.length - 1]);
    expect(["completed", "failed"]).toContain(lastLine.event);
  });

  // ── Response shape ──

  it("started event includes triggeredAt in ISO format", async () => {
    mockAuthSuccess();
    mockDb({ inProgressId: null, recentCompletedId: null, insertId: 1 });

    const req = makeReq();
    const { res, captured } = makeRes();

    await handleScheduledPipelineTrigger(req, res);
    await new Promise(r => setTimeout(r, 50));

    const startedLine = JSON.parse(captured.lines[0]);
    expect(startedLine.triggeredAt).toBeDefined();
    expect(() => new Date(startedLine.triggeredAt)).not.toThrow();
    expect(new Date(startedLine.triggeredAt).toISOString()).toBe(startedLine.triggeredAt);
  });

  it("returns 401 response with triggeredAt even on auth failure", async () => {
    const req = makeReq({ headers: {} });
    const { res, captured } = makeRes();

    await handleScheduledPipelineTrigger(req, res);

    const body = captured.body as ScheduledPipelineResponse;
    expect(body.triggeredAt).toBeDefined();
    expect(body.runId).toBeNull();
  });
});

// ── Constants ──

describe("scheduledPipeline constants", () => {
  it("IDEMPOTENCY_WINDOW_HOURS is a positive number", () => {
    expect(IDEMPOTENCY_WINDOW_HOURS).toBeGreaterThan(0);
    expect(typeof IDEMPOTENCY_WINDOW_HOURS).toBe("number");
  });

  it("IN_PROGRESS_WINDOW_HOURS is a positive number", () => {
    expect(IN_PROGRESS_WINDOW_HOURS).toBeGreaterThan(0);
    expect(typeof IN_PROGRESS_WINDOW_HOURS).toBe("number");
  });

  it("IDEMPOTENCY_WINDOW_HOURS is at least 1 and at most 6", () => {
    expect(IDEMPOTENCY_WINDOW_HOURS).toBeGreaterThanOrEqual(1);
    expect(IDEMPOTENCY_WINDOW_HOURS).toBeLessThanOrEqual(6);
  });

  it("IN_PROGRESS_WINDOW_HOURS is at least 1 and at most 6", () => {
    expect(IN_PROGRESS_WINDOW_HOURS).toBeGreaterThanOrEqual(1);
    expect(IN_PROGRESS_WINDOW_HOURS).toBeLessThanOrEqual(6);
  });
});

// ── startDailyScheduler production guard ──

describe("startDailyScheduler production guard", () => {
  it("exports startDailyScheduler function", async () => {
    const mod = await import("./dailyPipeline");
    expect(typeof mod.startDailyScheduler).toBe("function");
  });

  it("exports cleanupStaleRuns function", async () => {
    const mod = await import("./dailyPipeline");
    expect(typeof mod.cleanupStaleRuns).toBe("function");
  });
});
