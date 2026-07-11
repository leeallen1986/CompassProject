import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullPotentialAccounts, fullPotentialActions } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: {
    authenticateRequest: mocks.authenticateRequest,
  },
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
}));

import { handleFullPotentialRentalRemediation } from "./fullPotentialRentalHire";

function rentalAccount(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    stableKey: `handler-${id}`,
    canonicalName: `Rental Handler Account ${id}`,
    displayName: null,
    parentGroup: null,
    rowClass: "account",
    country: "AU",
    state: "WA",
    region: "Metro",
    segment: "Rental Hire",
    subsegment: "Regional Rental",
    applicationPlays: ["Fleet replacement"],
    routeToMarket: "direct_ape",
    ownerName: "Ryan Pemberton",
    channelOwner: null,
    fpStatus: "active_target",
    priorityTier: "tier_b",
    platformPushDecision: "push_context",
    currentRevenueAud: "100000.00",
    fullPotentialAud: "0.00",
    target2026Aud: null,
    remainingPotentialAud: "0.00",
    currentSupplier: null,
    installedBaseStatus: "unknown",
    c4cStatus: "prospect",
    nextAction: "Review fleet",
    nextActionDate: new Date("2099-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

type FakeDbOptions = {
  accounts?: ReturnType<typeof rentalAccount>[];
  actions?: Record<string, unknown>[];
  insertError?: Error;
};

function createFakeDb(options: FakeDbOptions = {}) {
  const accounts = options.accounts ?? [];
  const actions = options.actions ?? [];
  const insertedValues: unknown[][] = [];

  const values = vi.fn(async (payload: unknown[]) => {
    if (options.insertError) throw options.insertError;
    insertedValues.push(payload);
    return undefined;
  });

  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: vi.fn(async () => table === fullPotentialAccounts ? accounts : table === fullPotentialActions ? actions : []),
      }),
    })),
    insert: vi.fn(() => ({ values })),
  };

  return { db, values, insertedValues };
}

function createRequest(body: unknown): Request {
  return { body } as Request;
}

function createResponse() {
  let statusCode = 200;
  let body: unknown;
  const res = {} as Response;
  res.setHeader = vi.fn() as unknown as Response["setHeader"];
  res.status = vi.fn((code: number) => {
    statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((payload: unknown) => {
    body = payload;
    return res;
  }) as unknown as Response["json"];
  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body as Record<string, any>,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    accountIds: [1],
    remediationType: "financial_potential",
    dueDate: "2099-08-15",
    dryRun: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({
    id: 42,
    name: "Validation User",
    email: "validation@example.com",
    role: "user",
  });
});

describe("Rental Hire remediation HTTP handler", () => {
  it("returns 401 before database access when authentication fails", async () => {
    mocks.authenticateRequest.mockRejectedValue(new Error("No session"));
    const { res, getStatus, getBody } = createResponse();

    await handleFullPotentialRentalRemediation(createRequest(validBody()), res);

    expect(getStatus()).toBe(401);
    expect(getBody()).toEqual({ error: "Authentication required" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid request after authentication", async () => {
    const { res, getStatus, getBody } = createResponse();

    await handleFullPotentialRentalRemediation(createRequest({ remediationType: "financial_potential" }), res);

    expect(getStatus()).toBe(400);
    expect(getBody().error).toBe("Invalid Rental Hire remediation request");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects a past due date before database access", async () => {
    const { res, getStatus, getBody } = createResponse();

    await handleFullPotentialRentalRemediation(createRequest(validBody({ dueDate: "2000-01-01" })), res);

    expect(getStatus()).toBe(400);
    expect(getBody()).toEqual({ error: "Remediation due date cannot be in the past" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects requests containing more than 100 account IDs", async () => {
    const { res, getStatus, getBody } = createResponse();
    const accountIds = Array.from({ length: 101 }, (_, index) => index + 1);

    await handleFullPotentialRentalRemediation(createRequest(validBody({ accountIds })), res);

    expect(getStatus()).toBe(400);
    expect(getBody().error).toBe("Invalid Rental Hire remediation request");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns a dry-run preview without inserting actions for an authenticated distributor", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      id: 77,
      name: "Distributor User",
      email: "distributor@example.com",
      role: "distributor",
    });
    const fake = createFakeDb({ accounts: [rentalAccount(1)] });
    mocks.getDb.mockResolvedValue(fake.db);
    const { res, getStatus, getBody } = createResponse();

    await handleFullPotentialRentalRemediation(createRequest(validBody()), res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({
      dryRun: true,
      created: 0,
      requested: 1,
      eligible: 1,
      alreadyManaged: 0,
      notEligible: 0,
      notRental: 0,
      notFound: 0,
    });
    expect(fake.db.insert).not.toHaveBeenCalled();
    expect(fake.values).not.toHaveBeenCalled();
  });

  it("deduplicates duplicate account IDs before planning", async () => {
    const fake = createFakeDb({ accounts: [rentalAccount(1)] });
    mocks.getDb.mockResolvedValue(fake.db);
    const { res, getBody } = createResponse();

    await handleFullPotentialRentalRemediation(createRequest(validBody({ accountIds: [1, 1, 1] })), res);

    expect(getBody()).toMatchObject({ requested: 1, eligible: 1, created: 0, dryRun: true });
    expect(fake.db.insert).not.toHaveBeenCalled();
  });

  it("reports an existing open remediation action as already managed", async () => {
    const fake = createFakeDb({
      accounts: [rentalAccount(1)],
      actions: [{
        id: 9,
        accountId: 1,
        status: "not_started",
        actionType: "account_review",
        recommendedAction: "Validate and record Rental Hire Full Potential, 2026 target and remaining potential",
        notes: "[rental_remediation:financial_potential]",
        dueDate: new Date("2099-08-10T00:00:00.000Z"),
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
      }],
    });
    mocks.getDb.mockResolvedValue(fake.db);
    const { res, getBody } = createResponse();

    await handleFullPotentialRentalRemediation(createRequest(validBody()), res);

    expect(getBody()).toMatchObject({ eligible: 0, alreadyManaged: 1, created: 0, dryRun: true });
    expect(getBody().items[0]).toMatchObject({ status: "already_managed", existingActionId: 9 });
    expect(fake.db.insert).not.toHaveBeenCalled();
  });

  it("inserts only eligible actions with the authenticated creator and stable marker", async () => {
    const eligible = rentalAccount(1);
    const healthy = rentalAccount(2, {
      fullPotentialAud: "500000.00",
      target2026Aud: "250000.00",
      remainingPotentialAud: "400000.00",
    });
    const fake = createFakeDb({ accounts: [eligible, healthy] });
    mocks.getDb.mockResolvedValue(fake.db);
    const { res, getStatus, getBody } = createResponse();

    await handleFullPotentialRentalRemediation(createRequest(validBody({
      accountIds: [1, 2],
      dryRun: false,
      notes: "Manager-approved test context",
    })), res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({
      dryRun: false,
      requested: 2,
      eligible: 1,
      notEligible: 1,
      created: 1,
    });
    expect(fake.db.insert).toHaveBeenCalledWith(fullPotentialActions);
    expect(fake.values).toHaveBeenCalledTimes(1);
    const payload = fake.values.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      accountId: 1,
      userId: 42,
      ownerName: "Validation User",
      actionType: "account_review",
      recommendedAction: "Validate and record Rental Hire Full Potential, 2026 target and remaining potential",
      status: "not_started",
      notes: "[rental_remediation:financial_potential] Manager-approved test context",
    });
    expect(payload[0].dueDate).toBeInstanceOf(Date);
  });

  it("returns 500 when the action insert fails", async () => {
    const fake = createFakeDb({
      accounts: [rentalAccount(1)],
      insertError: new Error("Insert failed"),
    });
    mocks.getDb.mockResolvedValue(fake.db);
    const { res, getStatus, getBody } = createResponse();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await handleFullPotentialRentalRemediation(createRequest(validBody({ dryRun: false })), res);

    expect(getStatus()).toBe(500);
    expect(getBody()).toEqual({ error: "Failed to manage Rental Hire remediation actions" });
    expect(fake.values).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
