/**
 * Account Priors Router
 * CRUD operations for the WA Top 100 target accounts.
 * Admin-only write access; all authenticated users can read.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { accountPriors } from "../../drizzle/schema";
import { eq, like, or, desc, asc, sql } from "drizzle-orm";

// ── List all account priors with optional filters ──
const list = protectedProcedure
  .input(z.object({
    search: z.string().optional(),
    priorityLevel: z.string().optional(),
    state: z.string().optional(),
    segment: z.string().optional(),
    status: z.string().optional(),
    sortBy: z.enum(["rank", "canonicalName", "scoreOutOf100", "priorityLevel", "status", "updatedAt"]).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  }).optional())
  .query(async ({ input }) => {
    const db = await getDb();
    if (!db) return { accounts: [], total: 0 };

    const filters = input ?? {};
    let query = db.select().from(accountPriors).$dynamic();

    // Build WHERE conditions
    const conditions: any[] = [];
    if (filters.search) {
      const q = `%${filters.search}%`;
      conditions.push(or(
        like(accountPriors.canonicalName, q),
        like(accountPriors.segment, q),
        like(accountPriors.state, q),
        like(accountPriors.likelyApplication, q),
      ));
    }
    if (filters.priorityLevel) {
      conditions.push(eq(accountPriors.priorityLevel, filters.priorityLevel));
    }
    if (filters.state) {
      conditions.push(eq(accountPriors.state, filters.state));
    }
    if (filters.segment) {
      conditions.push(eq(accountPriors.segment, filters.segment));
    }
    if (filters.status) {
      conditions.push(eq(accountPriors.status, filters.status));
    }

    if (conditions.length > 0) {
      for (const cond of conditions) {
        query = query.where(cond) as any;
      }
    }

    // Sort
    const sortField = filters.sortBy || "rank";
    const sortDirection = filters.sortDir || "asc";
    const sortMap: Record<string, any> = {
      rank: accountPriors.rank,
      canonicalName: accountPriors.canonicalName,
      scoreOutOf100: accountPriors.scoreOutOf100,
      priorityLevel: accountPriors.priorityLevel,
      status: accountPriors.status,
      updatedAt: accountPriors.updatedAt,
    };
    const col = sortMap[sortField] || accountPriors.rank;
    query = (sortDirection === "desc" ? query.orderBy(desc(col)) : query.orderBy(asc(col))) as any;

    const accounts = await query;
    return { accounts, total: accounts.length };
  });

// ── Get a single account prior by ID ──
const getById = protectedProcedure
  .input(z.object({ id: z.number() }))
  .query(async ({ input }) => {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(accountPriors).where(eq(accountPriors.id, input.id)).limit(1);
    return rows[0] ?? null;
  });

// ── Update an account prior (admin only) ──
const update = protectedProcedure
  .input(z.object({
    id: z.number(),
    salesNotes: z.string().optional(),
    status: z.enum(["not_started", "in_progress", "contacted", "qualified", "won", "lost", "parked"]).optional(),
    owner: z.string().optional(),
    nextActionDate: z.string().nullable().optional(), // ISO date string
    priorityLevel: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "admin") {
      // Allow reps to update salesNotes and status only
      const db = await getDb();
      if (!db) return { success: false };
      const updateData: any = {};
      if (input.salesNotes !== undefined) updateData.salesNotes = input.salesNotes;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.owner !== undefined) updateData.owner = input.owner;
      if (input.nextActionDate !== undefined) updateData.nextActionDate = input.nextActionDate ? new Date(input.nextActionDate) : null;
      if (Object.keys(updateData).length === 0) return { success: false };
      await db.update(accountPriors).set(updateData).where(eq(accountPriors.id, input.id));
      return { success: true };
    }
    // Admin can update everything
    const db = await getDb();
    if (!db) return { success: false };
    const updateData: any = {};
    if (input.salesNotes !== undefined) updateData.salesNotes = input.salesNotes;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.owner !== undefined) updateData.owner = input.owner;
    if (input.nextActionDate !== undefined) updateData.nextActionDate = input.nextActionDate ? new Date(input.nextActionDate) : null;
    if (input.priorityLevel !== undefined) updateData.priorityLevel = input.priorityLevel;
    if (Object.keys(updateData).length === 0) return { success: false };
    await db.update(accountPriors).set(updateData).where(eq(accountPriors.id, input.id));
    return { success: true };
  });

// ── Get distinct filter values for dropdowns ──
const filterOptions = protectedProcedure
  .query(async () => {
    const db = await getDb();
    if (!db) return { states: [], segments: [], priorityLevels: [], statuses: [] };

    const [states, segments, priorityLevels, statuses] = await Promise.all([
      db.selectDistinct({ value: accountPriors.state }).from(accountPriors).where(sql`${accountPriors.state} IS NOT NULL`),
      db.selectDistinct({ value: accountPriors.segment }).from(accountPriors).where(sql`${accountPriors.segment} IS NOT NULL`),
      db.selectDistinct({ value: accountPriors.priorityLevel }).from(accountPriors).where(sql`${accountPriors.priorityLevel} IS NOT NULL`),
      db.selectDistinct({ value: accountPriors.status }).from(accountPriors),
    ]);

    return {
      states: states.map(r => r.value).filter(Boolean) as string[],
      segments: segments.map(r => r.value).filter(Boolean) as string[],
      priorityLevels: priorityLevels.map(r => r.value).filter(Boolean) as string[],
      statuses: statuses.map(r => r.value).filter(Boolean) as string[],
    };
  });

// ── Global stats (unfiltered, for KPI cards) ──
const stats = protectedProcedure
  .query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, priorityA: 0, priorityB: 0, contacted: 0, notStarted: 0 };

    const all = await db.select({
      priorityLevel: accountPriors.priorityLevel,
      status: accountPriors.status,
    }).from(accountPriors);

    return {
      total: all.length,
      priorityA: all.filter(a => a.priorityLevel?.startsWith("A")).length,
      priorityB: all.filter(a => a.priorityLevel?.startsWith("B")).length,
      contacted: all.filter(a => ["contacted", "qualified", "won"].includes(a.status ?? "")).length,
      notStarted: all.filter(a => a.status === "not_started" || !a.status).length,
    };
  });

export const accountPriorsRouter = router({
  list,
  getById,
  update,
  filterOptions,
  stats,
});
