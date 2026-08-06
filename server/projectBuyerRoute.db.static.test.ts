import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dbSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "db.ts"),
  "utf8"
);
const loaderStart = dbSource.indexOf(
  "export async function getProjectBuyerRouteInputs("
);
const loaderEnd = dbSource.indexOf(
  "\n/**\n * Get pipeline claims",
  loaderStart
);
const loaderSource = dbSource.slice(loaderStart, loaderEnd);
const linkedLoaderStart = dbSource.indexOf(
  "export async function getLinkedContactsForProject("
);
const linkedLoaderEnd = dbSource.indexOf(
  "\n/**\n * Load only persisted, exact-ID evidence",
  linkedLoaderStart
);
const linkedLoaderSource = dbSource.slice(linkedLoaderStart, linkedLoaderEnd);

describe("getProjectBuyerRouteInputs static data boundary", () => {
  it("exists and joins contacts only through exact contactProjects records", () => {
    expect(loaderStart).toBeGreaterThan(-1);
    expect(loaderEnd).toBeGreaterThan(loaderStart);
    expect(loaderSource).toContain(".from(contactProjects)");
    expect(loaderSource).toContain(
      ".innerJoin(contacts, eq(contacts.id, contactProjects.contactId))"
    );
    expect(loaderSource).toContain(".where(and(");
    expect(loaderSource).toContain("eq(contactProjects.projectId, projectId)");
    expect(loaderSource).not.toContain("getContactsForProject");
    expect(loaderSource).not.toMatch(/\bLIKE\b/i);
    expect(loaderSource).toContain("isNull(contacts.rejectionReason)");
    expect(loaderSource).toContain("eq(contacts.crmOrphan, false)");
  });

  it("loads contractor provenance only through the exact project link", () => {
    expect(loaderSource).toContain(".from(contractorProjectLinks)");
    expect(loaderSource).toContain(
      "contractorRegistry.id, contractorProjectLinks.contractorId"
    );
    expect(loaderSource).toContain(
      "contractorProjectLinks.projectId, projectId"
    );
  });

  it("contains no write or provider operation", () => {
    expect(loaderSource).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(loaderSource).not.toMatch(
      /callDataApi|apollo|hunter|lusha|provider/i
    );
  });

  it("keeps the shared project-detail loader exact, quarantined-safe and projected", () => {
    expect(linkedLoaderStart).toBeGreaterThan(-1);
    expect(linkedLoaderEnd).toBeGreaterThan(linkedLoaderStart);
    expect(linkedLoaderSource).toContain(".from(contactProjects)");
    expect(linkedLoaderSource).toContain("isNull(contacts.rejectionReason)");
    expect(linkedLoaderSource).toContain("eq(contacts.crmOrphan, false)");
    expect(linkedLoaderSource).toContain("attachOutreachContactProjection(contactRows, links)");
    expect(linkedLoaderSource).not.toMatch(/\bLIKE\b/i);
  });
});
