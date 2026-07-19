import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { createFullPotentialAccountMatchingHandlers } from "./fullPotentialAccountMatching.http";

function request(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    query: {},
    headers: {},
    ...overrides,
  } as any;
}

function response() {
  const state = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
  };
  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      state.headers[name] = value;
      return res;
    }),
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      state.body = body;
      return res;
    }),
  } as any;
  return { res, state };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    authenticateRequest: vi.fn(async () => ({ id: 42, name: "Validation User", email: "validation@example.com", role: "user" })),
    getProjectContext: vi.fn(async (projectId: number) => ({ project: { id: projectId }, context: { primaryMatch: null } })),
    getProjectContexts: vi.fn(async (projectIds: number[]) => projectIds.map(projectId => ({ projectId, context: { primaryMatch: null } }))),
    getAwardedContexts: vi.fn(async (limit: number) => [{ awardedProject: { id: 1 }, limit, context: { primaryMatch: null } }]),
    resolveAccountName: vi.fn(async (name: string, options: unknown) => ({ name, options, match: null, unresolved: null })),
    ...overrides,
  } as any;
}

describe("Full Potential project-account matching HTTP handlers", () => {
  it("returns 401 before invoking a read service when authentication fails", async () => {
    const deps = dependencies({
      authenticateRequest: vi.fn(async () => { throw new Error("unauthenticated"); }),
    });
    const handlers = createFullPotentialAccountMatchingHandlers(deps);
    const { res, state } = response();

    await handlers.project(request({ params: { projectId: "1" } }), res);

    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: "Authentication required" });
    expect(deps.getProjectContext).not.toHaveBeenCalled();
  });

  it("returns 403 to distributor users", async () => {
    const deps = dependencies({
      authenticateRequest: vi.fn(async () => ({ id: 7, role: "distributor" })),
    });
    const handlers = createFullPotentialAccountMatchingHandlers(deps);
    const { res, state } = response();

    await handlers.projects(request({ query: { projectIds: "1,2" } }), res);

    expect(state.statusCode).toBe(403);
    expect(state.body).toEqual({ error: "Project-to-account matching requires internal sales access" });
    expect(deps.getProjectContexts).not.toHaveBeenCalled();
  });

  it("returns one project context and disables caching", async () => {
    const deps = dependencies();
    const handlers = createFullPotentialAccountMatchingHandlers(deps);
    const { res, state } = response();

    await handlers.project(request({ params: { projectId: "123" } }), res);

    expect(state.statusCode).toBe(200);
    expect(state.headers["Cache-Control"]).toBe("private, no-store");
    expect(deps.getProjectContext).toHaveBeenCalledWith(123);
    expect(state.body).toEqual({ project: { id: 123 }, context: { primaryMatch: null } });
  });

  it("rejects an invalid project ID", async () => {
    const deps = dependencies();
    const handlers = createFullPotentialAccountMatchingHandlers(deps);
    const { res, state } = response();

    await handlers.project(request({ params: { projectId: "not-a-number" } }), res);

    expect(state.statusCode).toBe(400);
    expect(deps.getProjectContext).not.toHaveBeenCalled();
  });

  it("deduplicates a comma-separated project batch", async () => {
    const deps = dependencies();
    const handlers = createFullPotentialAccountMatchingHandlers(deps);
    const { res, state } = response();

    await handlers.projects(request({ query: { projectIds: "3,2,3,1" } }), res);

    expect(deps.getProjectContexts).toHaveBeenCalledWith([3, 2, 1]);
    expect(state.body).toMatchObject({ projectIds: [3, 2, 1] });
  });

  it("rejects missing, invalid and oversized project batches", async () => {
    const deps = dependencies();
    const handlers = createFullPotentialAccountMatchingHandlers(deps);

    for (const projectIds of [undefined, "1,nope", Array.from({ length: 251 }, (_, i) => i + 1).join(",")]) {
      const { res, state } = response();
      await handlers.projects(request({ query: { projectIds } }), res);
      expect(state.statusCode).toBe(400);
    }
    expect(deps.getProjectContexts).not.toHaveBeenCalled();
  });

  it("validates the awarded-project limit", async () => {
    const deps = dependencies();
    const handlers = createFullPotentialAccountMatchingHandlers(deps);
    const invalid = response();
    await handlers.awarded(request({ query: { limit: "501" } }), invalid.res);
    expect(invalid.state.statusCode).toBe(400);

    const valid = response();
    await handlers.awarded(request({ query: { limit: "25" } }), valid.res);
    expect(deps.getAwardedContexts).toHaveBeenCalledWith(25);
    expect(valid.state.statusCode).toBe(200);
  });

  it("validates and resolves a standalone account name", async () => {
    const deps = dependencies();
    const handlers = createFullPotentialAccountMatchingHandlers(deps);

    const invalid = response();
    await handlers.account(request({ query: { name: "A" } }), invalid.res);
    expect(invalid.state.statusCode).toBe(400);

    const valid = response();
    await handlers.account(request({ query: { name: "Coates Hire", state: "National" } }), valid.res);
    expect(deps.resolveAccountName).toHaveBeenCalledWith("Coates Hire", { state: "National" });
    expect(valid.state.statusCode).toBe(200);
  });

  it("maps service TRPC errors to their HTTP status", async () => {
    const deps = dependencies({
      getProjectContext: vi.fn(async () => {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }),
    });
    const handlers = createFullPotentialAccountMatchingHandlers(deps);
    const { res, state } = response();

    await handlers.project(request({ params: { projectId: "999" } }), res);

    expect(state.statusCode).toBe(404);
    expect(state.body).toEqual({ error: "Project not found", code: "NOT_FOUND" });
  });

  it("returns a safe 500 response for unexpected service failures", async () => {
    const deps = dependencies({
      getProjectContexts: vi.fn(async () => { throw new Error("database exploded"); }),
    });
    const handlers = createFullPotentialAccountMatchingHandlers(deps);
    const { res, state } = response();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await handlers.projects(request({ query: { projectIds: "1" } }), res);

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({ error: "Resolve project account contexts failed" });
    errorSpy.mockRestore();
  });
});
