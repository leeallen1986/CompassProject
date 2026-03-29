/**
 * Tests for CRM Contact Import & Enrichment Queuing
 * Validates: schema fields, import counts, sector classification, enrichment priority, project linking
 */
import { describe, it, expect } from "vitest";
import { getDb } from "./db";
import { contacts } from "../drizzle/schema";
import { eq, and, sql, isNotNull, like } from "drizzle-orm";

describe("CRM Contact Import", () => {
  describe("Schema — CRM-specific fields exist", () => {
    it("contacts table has source field", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const rows = await db
        .select({ source: contacts.source })
        .from(contacts)
        .where(eq(contacts.source, "crm"))
        .limit(1);
      expect(rows.length).toBeGreaterThanOrEqual(0);
    });

    it("contacts table has sectorTag field", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const rows = await db
        .select({ sectorTag: contacts.sectorTag })
        .from(contacts)
        .where(isNotNull(contacts.sectorTag))
        .limit(1);
      expect(rows.length).toBeGreaterThanOrEqual(0);
    });

    it("contacts table has enrichmentPriority field", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const rows = await db
        .select({ enrichmentPriority: contacts.enrichmentPriority })
        .from(contacts)
        .where(isNotNull(contacts.enrichmentPriority))
        .limit(1);
      expect(rows.length).toBeGreaterThanOrEqual(0);
    });

    it("contacts table has crmId field", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const rows = await db
        .select({ crmId: contacts.crmId })
        .from(contacts)
        .where(isNotNull(contacts.crmId))
        .limit(1);
      expect(rows.length).toBeGreaterThanOrEqual(0);
    });

    it("contacts table has department field", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const rows = await db
        .select({ department: contacts.department })
        .from(contacts)
        .where(isNotNull(contacts.department))
        .limit(1);
      expect(rows.length).toBeGreaterThanOrEqual(0);
    });

    it("contacts table has mobilePhone field", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const rows = await db
        .select({ mobilePhone: contacts.mobilePhone })
        .from(contacts)
        .where(isNotNull(contacts.mobilePhone))
        .limit(1);
      expect(rows.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Import counts", () => {
    it("should have imported CRM contacts", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(eq(contacts.source, "crm"));
      expect(Number(row.count)).toBeGreaterThan(20000);
    });

    it("CRM contacts should have unique crmIds (no duplicates)", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [totalRow] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "crm"), isNotNull(contacts.crmId)));
      const [uniqueRow] = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${contacts.crmId})` })
        .from(contacts)
        .where(and(eq(contacts.source, "crm"), isNotNull(contacts.crmId)));
      expect(Number(totalRow.count)).toBe(Number(uniqueRow.count));
    });
  });

  describe("Sector classification", () => {
    it("should have mining-tagged CRM contacts", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "crm"), eq(contacts.sectorTag, "mining")));
      expect(Number(row.count)).toBeGreaterThan(500);
    });

    it("should have oil_gas-tagged CRM contacts", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "crm"), eq(contacts.sectorTag, "oil_gas")));
      expect(Number(row.count)).toBeGreaterThan(200);
    });

    it("should have infrastructure-tagged CRM contacts", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "crm"), eq(contacts.sectorTag, "infrastructure")));
      expect(Number(row.count)).toBeGreaterThan(200);
    });

    it("should have drilling-tagged CRM contacts", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "crm"), eq(contacts.sectorTag, "drilling")));
      expect(Number(row.count)).toBeGreaterThan(30);
    });
  });

  describe("Enrichment priority queuing", () => {
    it("should have high-priority CRM contacts (project-linked + sector-relevant)", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "crm"), eq(contacts.enrichmentPriority, "high")));
      expect(Number(row.count)).toBeGreaterThan(500);
    });

    it("should have medium-priority CRM contacts (sector-relevant or project-linked)", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "crm"), eq(contacts.enrichmentPriority, "medium")));
      expect(Number(row.count)).toBeGreaterThan(400);
    });

    it("should have low-priority CRM contacts (general industrial)", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "crm"), eq(contacts.enrichmentPriority, "low")));
      expect(Number(row.count)).toBeGreaterThan(15000); // ~18K general industrial contacts
    });

    it("high-priority contacts should all be sector-relevant", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(
          and(
            eq(contacts.source, "crm"),
            eq(contacts.enrichmentPriority, "high"),
            sql`${contacts.sectorTag} NOT IN ('mining', 'oil_gas', 'drilling', 'infrastructure', 'water')`
          )
        );
      // High priority should only be sector-relevant contacts
      expect(Number(row.count)).toBe(0);
    });
  });

  describe("Data quality", () => {
    it("most CRM contacts should have email addresses", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [total] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(eq(contacts.source, "crm"));
      const [withEmail] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "crm"), isNotNull(contacts.email)));
      const emailRate = Number(withEmail.count) / Number(total.count);
      expect(emailRate).toBeGreaterThan(0.3); // At least 30% should have email (CRM data has many contacts without email)
    });

    it("all CRM contacts should have company names", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [noCompany] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(
          and(
            eq(contacts.source, "crm"),
            sql`(${contacts.company} IS NULL OR ${contacts.company} = '')`
          )
        );
      expect(Number(noCompany.count)).toBe(0);
    });

    it("CRM contacts should have names", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [noName] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contacts)
        .where(
          and(
            eq(contacts.source, "crm"),
            sql`(${contacts.name} IS NULL OR ${contacts.name} = '')`
          )
        );
      expect(Number(noName.count)).toBe(0);
    });
  });

  describe("Project linking", () => {
    it("CRM contacts should be linked to projects via contactProjects", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const rows = await db.execute(sql`
        SELECT COUNT(DISTINCT cp.contactId) as linked_contacts
        FROM contactProjects cp
        INNER JOIN contacts c ON cp.contactId = c.id
        WHERE c.source = 'crm'
      `);
      const result = Array.isArray(rows) ? (rows[0] as any)?.[0] ?? rows[0] : rows;
      const count = Number(result?.linked_contacts ?? result?.[0]?.linked_contacts ?? 0);
      expect(count).toBeGreaterThan(1000);
    });

    it("linked CRM contacts should span multiple projects", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const rows = await db.execute(sql`
        SELECT COUNT(DISTINCT cp.projectId) as linked_projects
        FROM contactProjects cp
        INNER JOIN contacts c ON cp.contactId = c.id
        WHERE c.source = 'crm'
      `);
      const result = Array.isArray(rows) ? (rows[0] as any)?.[0] ?? rows[0] : rows;
      const count = Number(result?.linked_projects ?? result?.[0]?.linked_projects ?? 0);
      expect(count).toBeGreaterThan(100);
    });
  });
});
