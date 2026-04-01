/**
 * campaignBuilder.test.ts — Tests for Campaign Builder services
 *
 * Covers:
 * - CSV/Excel import parsing and column detection
 * - Hunter.io contact search role filtering
 * - Available roles listing
 */

import { describe, it, expect, vi } from "vitest";
import { previewImportFile, parseImportFile, type ColumnMapping } from "./campaignCsvImport";
import { PREDEFINED_ROLES, getAvailableRoles } from "./hunterContactSearch";
import * as XLSX from "xlsx";

// ── Helper: create a test CSV buffer ──

function createCsvBuffer(rows: string[][]): Buffer {
  const csv = rows.map(r => r.join(",")).join("\n");
  return Buffer.from(csv, "utf-8");
}

function createExcelBuffer(rows: string[][], sheetName = "Sheet1"): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ── CSV Import Tests ──

describe("campaignCsvImport", () => {
  describe("previewImportFile", () => {
    it("should detect standard column headers", () => {
      const buf = createCsvBuffer([
        ["First Name", "Last Name", "Email", "Company", "Job Title", "Phone"],
        ["John", "Doe", "john@example.com", "Acme Corp", "Driller", "0412345678"],
        ["Jane", "Smith", "jane@example.com", "BHP", "Operations Manager", "0498765432"],
      ]);

      const preview = previewImportFile(buf);

      expect(preview.headers).toEqual(["First Name", "Last Name", "Email", "Company", "Job Title", "Phone"]);
      expect(preview.totalRows).toBe(2);
      expect(preview.sampleRows).toHaveLength(2);
      expect(preview.detectedMapping.firstName).toBe(0);
      expect(preview.detectedMapping.lastName).toBe(1);
      expect(preview.detectedMapping.email).toBe(2);
      expect(preview.detectedMapping.company).toBe(3);
      expect(preview.detectedMapping.title).toBe(4);
      expect(preview.detectedMapping.phone).toBe(5);
    });

    it("should detect alternative column header names", () => {
      const buf = createCsvBuffer([
        ["Contact Name", "Organisation", "E-Mail", "Position", "Mobile"],
        ["John Doe", "Acme", "john@acme.com", "Manager", "0412345678"],
      ]);

      const preview = previewImportFile(buf);

      expect(preview.detectedMapping.fullName).toBe(0);
      expect(preview.detectedMapping.company).toBe(1);
      expect(preview.detectedMapping.email).toBe(2);
      expect(preview.detectedMapping.title).toBe(3);
      expect(preview.detectedMapping.mobile).toBe(4);
    });

    it("should handle Excel files", () => {
      const buf = createExcelBuffer([
        ["First Name", "Last Name", "Company", "Email"],
        ["Alice", "Wong", "Rio Tinto", "alice@riotinto.com"],
        ["Bob", "Jones", "BHP", "bob@bhp.com"],
        ["Charlie", "Brown", "FMG", "charlie@fmg.com"],
      ]);

      const preview = previewImportFile(buf);

      expect(preview.totalRows).toBe(3);
      expect(preview.detectedMapping.firstName).toBe(0);
      expect(preview.detectedMapping.lastName).toBe(1);
      expect(preview.detectedMapping.company).toBe(2);
      expect(preview.detectedMapping.email).toBe(3);
    });

    it("should return sample rows (max 5)", () => {
      const rows = [
        ["Name", "Company"],
        ...Array.from({ length: 20 }, (_, i) => [`Person ${i}`, `Company ${i}`]),
      ];
      const buf = createCsvBuffer(rows);

      const preview = previewImportFile(buf);

      expect(preview.totalRows).toBe(20);
      expect(preview.sampleRows).toHaveLength(5);
    });

    it("should handle empty file gracefully", () => {
      // XLSX.read handles empty buffers by creating a workbook with an empty sheet
      // The preview should return 0 rows
      const buf = createCsvBuffer([["Name", "Company"]]);
      const preview = previewImportFile(buf);
      expect(preview.totalRows).toBe(0);
      expect(preview.sampleRows).toHaveLength(0);
    });
  });

  describe("parseImportFile", () => {
    it("should parse contacts with first/last name mapping", () => {
      const buf = createCsvBuffer([
        ["First Name", "Last Name", "Company", "Email", "Title"],
        ["John", "Doe", "Acme Corp", "john@acme.com", "Driller"],
        ["Jane", "Smith", "BHP", "jane@bhp.com", "Operations Manager"],
      ]);

      const mapping: ColumnMapping = {
        firstName: 0,
        lastName: 1,
        company: 2,
        email: 3,
        title: 4,
      };

      const result = parseImportFile(buf, mapping);

      expect(result.totalParsed).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.contacts[0].firstName).toBe("John");
      expect(result.contacts[0].lastName).toBe("Doe");
      expect(result.contacts[0].company).toBe("Acme Corp");
      expect(result.contacts[0].email).toBe("john@acme.com");
      expect(result.contacts[0].title).toBe("Driller");
    });

    it("should parse contacts with full name mapping", () => {
      const buf = createCsvBuffer([
        ["Contact Name", "Company", "Email"],
        ["John Doe", "Acme Corp", "john@acme.com"],
        ["Jane Marie Smith", "BHP", "jane@bhp.com"],
      ]);

      const mapping: ColumnMapping = {
        fullName: 0,
        company: 1,
        email: 2,
      };

      const result = parseImportFile(buf, mapping);

      expect(result.totalParsed).toBe(2);
      expect(result.contacts[0].firstName).toBe("John");
      expect(result.contacts[0].lastName).toBe("Doe");
      expect(result.contacts[1].firstName).toBe("Jane");
      expect(result.contacts[1].lastName).toBe("Marie Smith");
    });

    it("should skip empty rows", () => {
      const buf = createCsvBuffer([
        ["Name", "Company"],
        ["John Doe", "Acme"],
        ["", ""],
        ["", ""],
        ["Jane Smith", "BHP"],
      ]);

      const mapping: ColumnMapping = {
        fullName: 0,
        company: 1,
      };

      const result = parseImportFile(buf, mapping);

      expect(result.totalParsed).toBe(2);
      expect(result.skipped).toBe(2);
    });

    it("should skip rows with no name and no company", () => {
      const buf = createCsvBuffer([
        ["First Name", "Company", "Email"],
        ["", "", "orphan@email.com"],
        ["John", "Acme", "john@acme.com"],
      ]);

      const mapping: ColumnMapping = {
        firstName: 0,
        company: 1,
        email: 2,
      };

      const result = parseImportFile(buf, mapping);

      expect(result.totalParsed).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it("should clean N/A and dash values to null", () => {
      const buf = createCsvBuffer([
        ["First Name", "Last Name", "Company", "Phone", "Email"],
        ["John", "Doe", "Acme", "N/A", "-"],
      ]);

      const mapping: ColumnMapping = {
        firstName: 0,
        lastName: 1,
        company: 2,
        phone: 3,
        email: 4,
      };

      const result = parseImportFile(buf, mapping);

      expect(result.contacts[0].phone).toBeNull();
      expect(result.contacts[0].email).toBeNull();
    });

    it("should set sourceRow correctly (1-indexed, accounting for header)", () => {
      const buf = createCsvBuffer([
        ["Name", "Company"],
        ["John", "Acme"],
        ["Jane", "BHP"],
      ]);

      const mapping: ColumnMapping = {
        firstName: 0,
        company: 1,
      };

      const result = parseImportFile(buf, mapping);

      expect(result.contacts[0].sourceRow).toBe(2); // Row 2 in spreadsheet
      expect(result.contacts[1].sourceRow).toBe(3); // Row 3 in spreadsheet
    });
  });
});

// ── Hunter Contact Search Tests ──

describe("hunterContactSearch", () => {
  describe("PREDEFINED_ROLES", () => {
    it("should have all expected role categories", () => {
      const expectedKeys = [
        "rc_driller", "water_well", "exploration", "blasting",
        "operations", "procurement", "project_management",
        "fleet_equipment", "engineering", "site_management",
      ];
      for (const key of expectedKeys) {
        expect(PREDEFINED_ROLES[key]).toBeDefined();
        expect(PREDEFINED_ROLES[key].name).toBeTruthy();
        expect(PREDEFINED_ROLES[key].patterns.length).toBeGreaterThan(0);
      }
    });

    it("should match RC drilling titles", () => {
      const patterns = PREDEFINED_ROLES.rc_driller.patterns;
      const titles = ["RC Driller", "Drill Rig Operator", "Rig Manager", "Reverse Circulation Driller"];
      for (const title of titles) {
        expect(patterns.some(p => p.test(title))).toBe(true);
      }
    });

    it("should match water well drilling titles", () => {
      const patterns = PREDEFINED_ROLES.water_well.patterns;
      const titles = ["Water Well Driller", "Bore Driller", "Hydrogeologist", "Groundwater Specialist"];
      for (const title of titles) {
        expect(patterns.some(p => p.test(title))).toBe(true);
      }
    });

    it("should match blasting and coating titles", () => {
      const patterns = PREDEFINED_ROLES.blasting.patterns;
      const titles = ["Blasting Supervisor", "Coating Inspector", "Surface Preparation Technician", "NACE Inspector", "Abrasive Blaster"];
      for (const title of titles) {
        expect(patterns.some(p => p.test(title))).toBe(true);
      }
    });

    it("should match operations and management titles", () => {
      const patterns = PREDEFINED_ROLES.operations.patterns;
      const titles = ["Operations Manager", "General Manager", "Managing Director", "CEO", "COO", "Director of Operations"];
      for (const title of titles) {
        expect(patterns.some(p => p.test(title))).toBe(true);
      }
    });

    it("should match procurement titles", () => {
      const patterns = PREDEFINED_ROLES.procurement.patterns;
      const titles = ["Procurement Manager", "Purchasing Officer", "Supply Chain Manager", "Senior Buyer", "Sourcing Specialist"];
      for (const title of titles) {
        expect(patterns.some(p => p.test(title))).toBe(true);
      }
    });

    it("should match fleet and equipment titles", () => {
      const patterns = PREDEFINED_ROLES.fleet_equipment.patterns;
      const titles = ["Fleet Manager", "Equipment Manager", "Plant Manager", "Maintenance Supervisor", "Workshop Manager"];
      for (const title of titles) {
        expect(patterns.some(p => p.test(title))).toBe(true);
      }
    });
  });

  describe("getAvailableRoles", () => {
    it("should return all predefined roles with key and name", () => {
      const roles = getAvailableRoles();

      expect(roles.length).toBe(Object.keys(PREDEFINED_ROLES).length);
      for (const role of roles) {
        expect(role.key).toBeTruthy();
        expect(role.name).toBeTruthy();
        expect(PREDEFINED_ROLES[role.key]).toBeDefined();
      }
    });

    it("should include RC Drillers and Water Well Drillers", () => {
      const roles = getAvailableRoles();
      const names = roles.map(r => r.name);

      expect(names).toContain("RC Drillers");
      expect(names).toContain("Water Well Drillers");
      expect(names).toContain("Blasting & Coating");
      expect(names).toContain("Operations & Management");
    });
  });
});
