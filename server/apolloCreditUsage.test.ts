/**
 * Tests for Apollo Credit Usage Tracking
 * Validates: logCreditUsage, getCreditUsageSummary, apolloCreditUsage endpoint
 */
import { describe, it, expect } from "vitest";
import {
  logCreditUsage,
  getCreditUsageSummary,
} from "./apolloEnrichment";
import { getDb } from "./db";
import { apolloCreditLog } from "../drizzle/schema";
import { eq, sql, desc } from "drizzle-orm";

describe("Apollo Credit Usage Tracking", () => {
  describe("logCreditUsage", () => {
    it("should insert a credit usage record into the database", async () => {
      const db = await getDb();
      if (!db) {
        console.warn("Database not available, skipping test");
        return;
      }

      // Log a test credit usage
      await logCreditUsage({
        userId: 999,
        userName: "Test User",
        action: "reveal",
        creditsUsed: 1,
        contactName: "John Doe",
        projectName: "Test Project",
        apolloPersonId: "test-apollo-id-001",
      });

      // Verify it was inserted
      const rows = await db
        .select()
        .from(apolloCreditLog)
        .where(eq(apolloCreditLog.apolloPersonId, "test-apollo-id-001"))
        .limit(1);

      expect(rows.length).toBe(1);
      expect(rows[0].userId).toBe(999);
      expect(rows[0].userName).toBe("Test User");
      expect(rows[0].action).toBe("reveal");
      expect(rows[0].creditsUsed).toBe(1);
      expect(rows[0].contactName).toBe("John Doe");
      expect(rows[0].projectName).toBe("Test Project");
      expect(rows[0].createdAt).toBeDefined();

      // Clean up
      await db.delete(apolloCreditLog).where(eq(apolloCreditLog.apolloPersonId, "test-apollo-id-001"));
    });

    it("should handle null optional fields gracefully", async () => {
      const db = await getDb();
      if (!db) return;

      await logCreditUsage({
        userId: 998,
        userName: "System",
        action: "verify_email",
        creditsUsed: 1,
      });

      // Verify it was inserted with null optional fields
      const rows = await db
        .select()
        .from(apolloCreditLog)
        .where(eq(apolloCreditLog.userId, 998))
        .orderBy(desc(apolloCreditLog.id))
        .limit(1);

      expect(rows.length).toBe(1);
      expect(rows[0].contactName).toBeNull();
      expect(rows[0].projectName).toBeNull();
      expect(rows[0].apolloPersonId).toBeNull();

      // Clean up
      await db.delete(apolloCreditLog).where(eq(apolloCreditLog.userId, 998));
    });

    it("should log different action types correctly", async () => {
      const db = await getDb();
      if (!db) return;

      const testUserId = 997;
      const actions: Array<"reveal" | "enrich_project" | "verify_email"> = [
        "reveal",
        "enrich_project",
        "verify_email",
      ];

      for (const action of actions) {
        await logCreditUsage({
          userId: testUserId,
          userName: "Action Test User",
          action,
          creditsUsed: action === "enrich_project" ? 3 : 1,
        });
      }

      const rows = await db
        .select()
        .from(apolloCreditLog)
        .where(eq(apolloCreditLog.userId, testUserId))
        .orderBy(apolloCreditLog.id);

      expect(rows.length).toBe(3);
      expect(rows.map(r => r.action)).toEqual(["reveal", "enrich_project", "verify_email"]);
      expect(rows[1].creditsUsed).toBe(3); // enrich_project

      // Clean up
      await db.delete(apolloCreditLog).where(eq(apolloCreditLog.userId, testUserId));
    });
  });

  describe("getCreditUsageSummary", () => {
    it("should return summary structure with correct fields", async () => {
      const summary = await getCreditUsageSummary();
      expect(summary).toBeDefined();
      expect(summary).toHaveProperty("totalCredits");
      expect(summary).toHaveProperty("byUser");
      expect(summary).toHaveProperty("byAction");
      expect(summary).toHaveProperty("recentActivity");
      expect(typeof summary.totalCredits).toBe("number");
      expect(Array.isArray(summary.byUser)).toBe(true);
      expect(Array.isArray(summary.byAction)).toBe(true);
      expect(Array.isArray(summary.recentActivity)).toBe(true);
    });

    it("should aggregate credits correctly for a test period", async () => {
      const db = await getDb();
      if (!db) return;

      const testUserId = 996;

      // Insert test data
      for (let i = 0; i < 5; i++) {
        await logCreditUsage({
          userId: testUserId,
          userName: "Summary Test User",
          action: "reveal",
          creditsUsed: 1,
          contactName: `Contact ${i}`,
          apolloPersonId: `summary-test-${i}`,
        });
      }

      // Get summary from beginning of time to capture our test data
      const summary = await getCreditUsageSummary({ since: new Date(2020, 0, 1) });

      // Should include our 5 test credits
      expect(summary.totalCredits).toBeGreaterThanOrEqual(5);

      // Should have our test user in byUser
      const testUserEntry = summary.byUser.find(u => u.userId === testUserId);
      expect(testUserEntry).toBeDefined();
      expect(testUserEntry!.credits).toBe(5);
      expect(testUserEntry!.userName).toBe("Summary Test User");

      // Should have "reveal" in byAction
      const revealAction = summary.byAction.find(a => a.action === "reveal");
      expect(revealAction).toBeDefined();
      expect(revealAction!.credits).toBeGreaterThanOrEqual(5);
      expect(revealAction!.count).toBeGreaterThanOrEqual(5);

      // Recent activity should include our entries
      expect(summary.recentActivity.length).toBeGreaterThan(0);

      // Clean up
      await db.delete(apolloCreditLog).where(eq(apolloCreditLog.userId, testUserId));
    });

    it("should respect the since date filter", async () => {
      const db = await getDb();
      if (!db) return;

      const testUserId = 995;

      // Insert test data
      await logCreditUsage({
        userId: testUserId,
        userName: "Date Filter Test",
        action: "reveal",
        creditsUsed: 1,
        apolloPersonId: "date-filter-test",
      });

      // Get summary for future date — should not include our data
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const summary = await getCreditUsageSummary({ since: futureDate });

      const testUserEntry = summary.byUser.find(u => u.userId === testUserId);
      expect(testUserEntry).toBeUndefined();

      // Clean up
      await db.delete(apolloCreditLog).where(eq(apolloCreditLog.userId, testUserId));
    });

    it("should return empty results when no data exists for period", async () => {
      // Use a future date range
      const futureDate = new Date(2099, 0, 1);
      const summary = await getCreditUsageSummary({ since: futureDate });

      expect(summary.totalCredits).toBe(0);
      expect(summary.byUser).toHaveLength(0);
      expect(summary.byAction).toHaveLength(0);
      expect(summary.recentActivity).toHaveLength(0);
    });
  });

  describe("apolloCreditLog schema", () => {
    it("should have the expected table structure", async () => {
      const db = await getDb();
      if (!db) return;

      // Verify we can query the table (schema is correct)
      const rows = await db
        .select({
          id: apolloCreditLog.id,
          userId: apolloCreditLog.userId,
          userName: apolloCreditLog.userName,
          action: apolloCreditLog.action,
          creditsUsed: apolloCreditLog.creditsUsed,
          contactId: apolloCreditLog.contactId,
          contactName: apolloCreditLog.contactName,
          projectId: apolloCreditLog.projectId,
          projectName: apolloCreditLog.projectName,
          apolloPersonId: apolloCreditLog.apolloPersonId,
          createdAt: apolloCreditLog.createdAt,
        })
        .from(apolloCreditLog)
        .limit(1);

      // Should not throw — schema matches DB
      expect(Array.isArray(rows)).toBe(true);
    });
  });
});
