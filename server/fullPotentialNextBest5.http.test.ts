import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { createReadOnlyNextBest5Handler } from "./fullPotentialNextBest5.http";

function request() {
  return { headers: {} } as any;
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
    authenticateRequest: vi.fn(async () => ({
      id: 42,
      name: "Validation User",
      email: "validation@example.com",
      role: "user",
    })),
    getNextBest5: vi.fn(async () => ({
      readOnly: true,
      recommendations: [],
    })),
    ...overrides,
  } as any;
}

describe("read-only Next Best 5 HTTP handler", () => {
  it("returns 401 before invoking the recommendation service", async () => {
    const deps = dependencies({
      authenticateRequest: vi.fn(async () => {
        throw new Error("unauthenticated");
      }),
    });
    const handler = createReadOnlyNextBest5Handler(deps);
    const { res, state } = response();

    await handler(request(), res);

    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: "Authentication required" });
    expect(deps.getNextBest5).not.toHaveBeenCalled();
  });

  it("returns 403 to distributor users", async () => {
    const deps = dependencies({
      authenticateRequest: vi.fn(async () => ({
        id: 7,
        role: "distributor",
      })),
    });
    const handler = createReadOnlyNextBest5Handler(deps);
    const { res, state } = response();

    await handler(request(), res);

    expect(state.statusCode).toBe(403);
    expect(state.body).toEqual({
      error: "Next Best 5 requires internal sales access",
    });
    expect(deps.getNextBest5).not.toHaveBeenCalled();
  });

  it("returns a no-store read-only response for an internal user", async () => {
    const deps = dependencies();
    const handler = createReadOnlyNextBest5Handler(deps);
    const { res, state } = response();

    await handler(request(), res);

    expect(state.statusCode).toBe(200);
    expect(state.headers["Cache-Control"]).toBe("private, no-store");
    expect(deps.getNextBest5).toHaveBeenCalledWith({
      id: 42,
      name: "Validation User",
      email: "validation@example.com",
      role: "user",
    });
    expect(state.body).toEqual({
      readOnly: true,
      recommendations: [],
    });
  });

  it("maps service TRPC errors safely", async () => {
    const deps = dependencies({
      getNextBest5: vi.fn(async () => {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid recommendation context",
        });
      }),
    });
    const handler = createReadOnlyNextBest5Handler(deps);
    const { res, state } = response();

    await handler(request(), res);

    expect(state.statusCode).toBe(400);
    expect(state.body).toEqual({
      error: "Invalid recommendation context",
      code: "BAD_REQUEST",
    });
  });

  it("returns a safe 500 response for unexpected service failures", async () => {
    const deps = dependencies({
      getNextBest5: vi.fn(async () => {
        throw new Error("database exploded");
      }),
    });
    const handler = createReadOnlyNextBest5Handler(deps);
    const { res, state } = response();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await handler(request(), res);

    expect(state.statusCode).toBe(500);
    expect(state.body).toEqual({
      error: "Load read-only Next Best 5 failed",
    });
    errorSpy.mockRestore();
  });
});
