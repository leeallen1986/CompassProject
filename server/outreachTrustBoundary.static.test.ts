/**
 * outreachTrustBoundary.static.test.ts
 *
 * Static boundary checks for Issue #85.
 * These tests verify at the source-code level that:
 * 1. All five outreach procedures execute through executeGuardedProjectOutreach.
 * 2. None of the five procedures accept client-supplied contactName/contactEmail/projectName.
 * 3. The guard file never uses contacts.project text field or fuzzy matching.
 * 4. The guard file never includes the recipient email in error messages.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

// Slice a section of a file between two marker strings (exclusive)
function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start === -1) return "";
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end === -1) return src.slice(start);
  return src.slice(start, end);
}

describe("Issue #85 — Static trust boundary checks", () => {
  const routersSrc = readSrc("server/routers.ts");
  const guardSrc = readSrc("server/projectOutreachGuard.ts");

  // ── Guard file invariants ───────────────────────────────────────────────────
  describe("projectOutreachGuard.ts invariants", () => {
    it("does not use contacts.project text field for matching in code", () => {
      // The guard must never use the contacts.project text column in code
      // (comments are allowed to mention it as a negative example)
      const codeOnly = guardSrc
        .split("\n")
        .filter(line => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
        .join("\n");
      expect(codeOnly).not.toMatch(/contacts\.project\b/);
    });

    it("does not use fuzzy project-name matching in code (only in comments)", () => {
      // Guard must never use SQL LIKE or fuzzy matching in code (comments are allowed to mention it)
      // Strip single-line comments then check for SQL LIKE patterns
      const codeOnly = guardSrc
        .split("\n")
        .filter(line => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
        .join("\n");
      // SQL LIKE operator or fuzzy library calls should not appear in code
      expect(codeOnly).not.toMatch(/\bsql`[^`]*\bLIKE\b/i);
      expect(codeOnly).not.toMatch(/\.like\(|fuzzyMatch|stringSimilarity/);
    });

    it("does not include recipient email addresses in any error message string", () => {
      // Error messages must never contain bare email addresses (containing @)
      // The word "email" is allowed (e.g. "verified email address")
      const errorMessages = guardSrc.match(/message:\s*["'`][^"'`]*["'`]/g) || [];
      for (const msg of errorMessages) {
        expect(msg).not.toMatch(/@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      }
    });

    it("exports resolveOutreachContext function", () => {
      expect(guardSrc).toContain("export async function resolveOutreachContext");
    });

    it("calls evaluateSlateEligibility", () => {
      expect(guardSrc).toContain("evaluateSlateEligibility");
    });

    it("calls isEffectivelySendReady", () => {
      expect(guardSrc).toContain("isEffectivelySendReady");
    });

    it("checks crmOrphan before eligibility", () => {
      expect(guardSrc).toContain("contact.crmOrphan");
    });

    it("requires exact contactProjects link (not fuzzy name match)", () => {
      expect(guardSrc).toContain("contactProjects");
      expect(guardSrc).toContain("eq(contactProjects.contactId");
      expect(guardSrc).toContain("eq(contactProjects.projectId");
    });
  });

  // ── outreach.generate procedure ─────────────────────────────────────────────
  describe("outreach.generate procedure", () => {
    const section = sliceBetween(
      routersSrc,
      "generate: protectedProcedure",
      "/** Save an outreach email",
    );

    it("uses the guarded outreach executor", () => {
      expect(section).toContain("executeGuardedProjectOutreach");
    });

    it("accepts contactId (not contactName)", () => {
      expect(section).toContain("contactId: z.number()");
      expect(section).not.toContain("contactName: z.string()");
    });

    it("accepts projectId (not projectName)", () => {
      expect(section).toContain("projectId: z.number()");
      expect(section).not.toContain("projectName: z.string()");
    });

    it("does not accept contactEmail in schema", () => {
      // Only the schema input block should be checked
      const schemaBlock = sliceBetween(section, "z.object({", "}).strict()");
      expect(schemaBlock).not.toContain("contactEmail");
    });

    it("uses .strict() on the input schema", () => {
      expect(section).toContain(".strict()");
    });
  });

  // ── outreach.save procedure ─────────────────────────────────────────────────
  describe("outreach.save procedure", () => {
    const section = sliceBetween(
      routersSrc,
      "/** Save an outreach email to the database */",
      "/** Get outreach history",
    );

    it("uses the guarded outreach executor", () => {
      expect(section).toContain("executeGuardedProjectOutreach");
    });

    it("accepts contactId as required (not optional)", () => {
      expect(section).toContain("contactId: z.number().int().positive()");
    });

    it("does not accept contactName in schema", () => {
      const schemaBlock = sliceBetween(section, "z.object({", "}).strict()");
      expect(schemaBlock).not.toContain("contactName");
    });

    it("uses .strict() on the input schema", () => {
      expect(section).toContain(".strict()");
    });
  });

  // ── outreach.downloadEml procedure ──────────────────────────────────────────
  describe("outreach.downloadEml procedure", () => {
    const section = sliceBetween(
      routersSrc,
      "/** Generate a downloadable .eml file",
      "/** Prepare a mailto URI",
    );

    it("uses the guarded outreach executor", () => {
      expect(section).toContain("executeGuardedProjectOutreach");
    });

    it("accepts contactId as required (not optional)", () => {
      expect(section).toContain("contactId: z.number().int().positive()");
    });

    it("does not accept contactName or contactEmail in schema", () => {
      const schemaBlock = sliceBetween(section, "z.object({", "}).strict()");
      expect(schemaBlock).not.toContain("contactName");
      expect(schemaBlock).not.toContain("contactEmail");
    });

    it("uses .strict() on the input schema", () => {
      expect(section).toContain(".strict()");
    });

    it("uses ctx85.contactEmail for the EML toEmail field", () => {
      expect(section).toContain("ctx85.contactEmail");
    });
  });

  // ── outreach.prepareOpenInEmail procedure ────────────────────────────────────
  describe("outreach.prepareOpenInEmail procedure", () => {
    const section = sliceBetween(
      routersSrc,
      "/** Prepare a mailto URI for opening in email client",
      "/** Get outreach leaderboard",
    );

    it("uses the guarded outreach executor", () => {
      expect(section).toContain("executeGuardedProjectOutreach");
    });

    it("records the outreach event via saveOutreachEmail before returning", () => {
      expect(section).toContain("saveOutreachEmail");
      // saveOutreachEmail must appear before the return statement
      const saveIdx = section.indexOf("saveOutreachEmail");
      const returnIdx = section.indexOf("return {");
      expect(saveIdx).toBeLessThan(returnIdx);
    });

    it("returns a mailtoUri using ctx85.contactEmail (not client-supplied email)", () => {
      expect(section).toContain("ctx85.contactEmail");
      expect(section).toContain("mailtoUri");
    });

    it("uses .strict() on the input schema", () => {
      expect(section).toContain(".strict()");
    });
  });

  // ── templates.personalise procedure ─────────────────────────────────────────
  describe("templates.personalise procedure", () => {
    const section = sliceBetween(
      routersSrc,
      "personalise: protectedProcedure",
      "/** Get template library stats",
    );

    it("uses the guarded outreach executor", () => {
      expect(section).toContain("executeGuardedProjectOutreach");
    });

    it("accepts contactId (not contactName)", () => {
      expect(section).toContain("contactId: z.number()");
      expect(section).not.toContain("contactName: z.string()");
    });

    it("does not accept contactEmail in schema", () => {
      const schemaBlock = sliceBetween(section, "z.object({", "}).strict()");
      expect(schemaBlock).not.toContain("contactEmail");
    });

    it("uses .strict() on the input schema", () => {
      expect(section).toContain(".strict()");
    });
  });
});
