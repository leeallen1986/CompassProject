/**
 * projectOutreachGuard.test.ts
 *
 * Regression tests for the Issue #85 P0 trust boundary guard.
 * Covers: input sanity, contact lookup, project lookup, contactProjects link,
 * crmOrphan gate, slate eligibility gate, send-ready gate, and happy path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── DB mock ──────────────────────────────────────────────────────────────────
const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockDb,
} = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  return {
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    mockDb: { select: mockSelect },
  };
});

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

// ── Schema mock (pass-through eq/and) ────────────────────────────────────────
vi.mock("../drizzle/schema", () => ({
  contacts: { id: "contacts.id" },
  projects: { id: "projects.id" },
  contactProjects: { contactId: "contactProjects.contactId", projectId: "contactProjects.projectId" },
}));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({ col, val }),
    and: (...args: unknown[]) => args,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const makeContact = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Alice Smith",
  title: "Project Manager",
  company: "Acme Mining",
  email: "alice@acme.com",
  roleBucket: "manager",
  contactTrustTier: "send_ready",
  enrichmentSource: "linkedin",
  emailVerified: true,
  verificationStatus: "verified",
  rejectionReason: null,
  crmOrphan: false,
  ...overrides,
});

const makeProject = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  name: "Iron Ore Expansion",
  location: "Pilbara, WA",
  value: "$500M",
  sector: "mining",
  stage: "construction",
  overview: "Major expansion project.",
  equipmentSignals: ["compressors", "generators"],
  opportunityRoute: "Direct CAPEX",
  matchedBusinessLines: [1, 2],
  ...overrides,
});

const makeLink = () => ({ id: 99, contactId: 1, projectId: 10 });

// Configure the db mock chain for a given sequence of results
// Each call to db.select().from().where().limit() returns the next result in the array
function setupDbChain(results: (unknown[] | null)[]) {
  let callCount = 0;
  mockSelect.mockImplementation(() => ({ from: mockFrom }));
  mockFrom.mockImplementation(() => ({ where: mockWhere }));
  mockWhere.mockImplementation(() => ({ limit: mockLimit }));
  mockLimit.mockImplementation(() => {
    const result = results[callCount] ?? [];
    callCount++;
    return Promise.resolve(result);
  });
}

describe("resolveOutreachContext — Issue #85 trust boundary guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Input sanity ────────────────────────────────────────────────────────────
  describe("input sanity", () => {
    it("throws BAD_REQUEST when contactId is 0", async () => {
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(0, 10)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("valid persisted contact"),
      });
    });

    it("throws BAD_REQUEST when contactId is negative", async () => {
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(-1, 10)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("valid persisted contact"),
      });
    });

    it("throws BAD_REQUEST when contactId exceeds the safe integer range", async () => {
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(Number.MAX_SAFE_INTEGER + 1, 10))
        .rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("throws BAD_REQUEST when projectId is 0", async () => {
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 0)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("valid persisted project"),
      });
    });

    it("throws BAD_REQUEST when projectId is negative", async () => {
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, -5)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("valid persisted project"),
      });
    });
  });

  // ── Contact lookup ──────────────────────────────────────────────────────────
  describe("contact lookup", () => {
    it("throws BAD_REQUEST when contact is not found", async () => {
      setupDbChain([[], [makeProject()], [makeLink()]]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Contact not found.",
      });
    });
  });

  // ── Project lookup ──────────────────────────────────────────────────────────
  describe("project lookup", () => {
    it("throws BAD_REQUEST when project is not found", async () => {
      setupDbChain([[makeContact()], [], [makeLink()]]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Project not found.",
      });
    });
  });

  // ── contactProjects link ────────────────────────────────────────────────────
  describe("contactProjects link", () => {
    it("throws FORBIDDEN when no contactProjects link exists", async () => {
      setupDbChain([[makeContact()], [makeProject()], []]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "This contact is not linked to the selected project.",
      });
    });

    it("queries the exact contactId and projectId pair", async () => {
      setupDbChain([[makeContact()], [makeProject()], [makeLink()]]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");

      await resolveOutreachContext(1, 10);

      expect(mockWhere).toHaveBeenNthCalledWith(3, [
        { col: "contactProjects.contactId", val: 1 },
        { col: "contactProjects.projectId", val: 10 },
      ]);
    });
  });

  // ── crmOrphan gate ──────────────────────────────────────────────────────────
  describe("crmOrphan gate", () => {
    it("throws FORBIDDEN when contact is a CRM orphan even with a project link", async () => {
      setupDbChain([[makeContact({ crmOrphan: true })], [makeProject()], [makeLink()]]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "This contact is not eligible for outreach.",
      });
    });

    it.each([null, undefined])(
      "fails closed when crmOrphan is %s",
      async crmOrphan => {
        setupDbChain([
          [makeContact({ crmOrphan })],
          [makeProject()],
          [makeLink()],
        ]);
        const { resolveOutreachContext } = await import("./projectOutreachGuard");
        await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: "This contact is not eligible for outreach.",
        });
      },
    );
  });

  // ── Slate eligibility gate ──────────────────────────────────────────────────
  describe("slate eligibility gate", () => {
    it("throws FORBIDDEN with llm_inferred message for llm_inferred contacts", async () => {
      setupDbChain([
        [makeContact({ contactTrustTier: "llm_inferred" })],
        [makeProject()],
        [makeLink()],
      ]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("AI-inferred"),
      });
    });

    it("throws FORBIDDEN with rejected message for contacts with a rejectionReason", async () => {
      setupDbChain([
        [makeContact({ rejectionReason: "Duplicate contact" })],
        [makeProject()],
        [makeLink()],
      ]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("flagged"),
      });
    });
  });

  // ── Send-ready gate ─────────────────────────────────────────────────────────
  describe("send-ready gate", () => {
    it("fails closed for an LLM source even if the tier says send_ready", async () => {
      setupDbChain([
        [makeContact({ enrichmentSource: "llm" })],
        [makeProject()],
        [makeLink()],
      ]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
    it("throws FORBIDDEN when email is empty", async () => {
      setupDbChain([
        [makeContact({ email: "" })],
        [makeProject()],
        [makeLink()],
      ]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("verified email"),
      });
    });

    it("throws FORBIDDEN when emailVerified is false", async () => {
      setupDbChain([
        [makeContact({ emailVerified: false })],
        [makeProject()],
        [makeLink()],
      ]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("verified email"),
      });
    });

    it("throws FORBIDDEN when verificationStatus is not 'verified'", async () => {
      setupDbChain([
        [makeContact({ verificationStatus: "ai_suggested" })],
        [makeProject()],
        [makeLink()],
      ]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("verified email"),
      });
    });

    it("throws FORBIDDEN when contactTrustTier is named_unverified", async () => {
      setupDbChain([
        [makeContact({ contactTrustTier: "named_unverified" })],
        [makeProject()],
        [makeLink()],
      ]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("verified email"),
      });
    });

    it.each([
      ["whitespace-only email", { email: "   " }, "verified email"],
      ["missing emailVerified", { emailVerified: undefined }, "verified email"],
      ["null emailVerified", { emailVerified: null }, "verified email"],
      ["missing verificationStatus", { verificationStatus: undefined }, "verified email"],
      ["null verificationStatus", { verificationStatus: null }, "verified email"],
      ["empty rejection reason", { rejectionReason: "" }, "flagged"],
    ])("fails closed for %s", async (_label, overrides, message) => {
      setupDbChain([
        [makeContact(overrides)],
        [makeProject()],
        [makeLink()],
      ]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      await expect(resolveOutreachContext(1, 10)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining(message),
      });
    });
  });

  // ── Happy path ──────────────────────────────────────────────────────────────
  describe("happy path", () => {
    it("returns canonical OutreachContext for a fully eligible contact+project pair", async () => {
      const contact = makeContact();
      const project = makeProject();
      setupDbChain([[contact], [project], [makeLink()]]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      const ctx = await resolveOutreachContext(1, 10, { 1: "Portable Air", 2: "Pumps" });
      expect(ctx.contactId).toBe(1);
      expect(ctx.contactName).toBe("Alice Smith");
      expect(ctx.contactEmail).toBe("alice@acme.com");
      expect(ctx.projectId).toBe(10);
      expect(ctx.projectName).toBe("Iron Ore Expansion");
      expect(ctx.matchedBusinessLines).toEqual(["Portable Air", "Pumps"]);
    });

    it("never exposes the recipient email in error messages", async () => {
      // Use a contact that will fail the send-ready check
      setupDbChain([
        [makeContact({ emailVerified: false })],
        [makeProject()],
        [makeLink()],
      ]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      try {
        await resolveOutreachContext(1, 10);
        expect.fail("Should have thrown");
      } catch (err) {
        const trpcErr = err as TRPCError;
        expect(trpcErr.message).not.toContain("alice@acme.com");
      }
    });

    it("converts matchedBusinessLines number[] to string[] using businessLineNames map", async () => {
      setupDbChain([[makeContact()], [makeProject({ matchedBusinessLines: [3, 4] })], [makeLink()]]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      const ctx = await resolveOutreachContext(1, 10, { 3: "Generators", 4: "BESS" });
      expect(ctx.matchedBusinessLines).toEqual(["Generators", "BESS"]);
    });

    it("falls back to string ID when businessLineNames map is not provided", async () => {
      setupDbChain([[makeContact()], [makeProject({ matchedBusinessLines: [7] })], [makeLink()]]);
      const { resolveOutreachContext } = await import("./projectOutreachGuard");
      const ctx = await resolveOutreachContext(1, 10);
      expect(ctx.matchedBusinessLines).toEqual(["7"]);
    });
  });
});
