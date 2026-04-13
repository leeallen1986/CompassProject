/**
 * emlGenerator.test.ts — Tests for the plain-text-style .eml file generator
 */
import { describe, it, expect } from "vitest";
import { buildEmlFile, detectBrand } from "./emlGenerator";

const baseInput = {
  fromName: "Leo Williams",
  fromEmail: "leo.williams@atlascopco.com",
  toName: "John Smith",
  toEmail: "john.smith@example.com",
  subject: "CP Truck Air — Reliable Compressor Solutions for Tieman",
  bodyText: "Hi John,\n\nI'm reaching out from Chicago Pneumatic, part of the Atlas Copco Group.\n\nWe've developed the CP Truck Air range specifically for vehicle integration.\n\nWould you be open to a quick 15-minute chat?",
  brand: "atlasCopco" as const,
};

describe("EML Generator — buildEmlFile (plain-text style)", () => {
  it("generates a valid .eml string with required MIME headers", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).toContain("MIME-Version: 1.0");
    expect(eml).toContain("Content-Type: multipart/");
    expect(eml).toContain("john.smith@example.com");
    expect(eml).toContain("leo.williams@atlascopco.com");
    expect(eml).toContain("Subject:");
  });

  it("includes the subject line correctly", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).toContain("CP Truck Air");
    expect(eml).toContain("Tieman");
  });

  it("includes the email body text in the plain text part", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).toContain("Hi John");
    expect(eml).toContain("Chicago Pneumatic");
    expect(eml).toContain("CP Truck Air range");
  });

  it("includes minimal HTML that looks like a normal written email", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).toContain("<html");
    expect(eml).toContain("</html>");
    // Should use Calibri (Outlook default font)
    expect(eml).toContain("Calibri");
    // Should use 11pt (Outlook default size)
    expect(eml).toContain("11pt");
  });

  it("does NOT contain branded elements (no logo, no hero, no colored header)", () => {
    const eml = buildEmlFile(baseInput);
    // No image tags at all
    expect(eml).not.toContain("<img");
    // No brand color backgrounds
    expect(eml).not.toContain("#0A2240"); // Atlas Copco navy
    expect(eml).not.toContain("#C41230"); // CP red
    expect(eml).not.toContain("#D4A843"); // Gold accent
    // No marketing-style elements
    expect(eml).not.toContain("border-radius");
    expect(eml).not.toContain("letter-spacing");
    expect(eml).not.toContain("text-transform");
  });

  it("does NOT contain table-based layout (no marketing template)", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).not.toContain("<table");
    expect(eml).not.toContain("</table>");
  });

  it("uses white background only", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).toContain("background-color:#FFFFFF");
    expect(eml).not.toContain("background-color:#F4F4F4");
  });

  it("uses black text color for body content", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).toContain("color:#000000");
  });

  it("converts body text paragraphs into HTML <p> tags", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).toMatch(/<p[^>]*>/);
  });

  it("generates multipart/mixed when attachment is provided", () => {
    const inputWithAttachment = {
      ...baseInput,
      attachment: {
        filename: "cp_truck_air_flyer.pdf",
        mimeType: "application/pdf",
        contentBase64: "JVBERi0xLjQKMSAwIG9iago=",
      },
    };
    const eml = buildEmlFile(inputWithAttachment);
    expect(eml).toContain("multipart/mixed");
    expect(eml).toContain("cp_truck_air_flyer.pdf");
    expect(eml).toContain("Content-Disposition: attachment");
  });

  it("encodes the attachment in base64", () => {
    const inputWithAttachment = {
      ...baseInput,
      attachment: {
        filename: "test.pdf",
        mimeType: "application/pdf",
        contentBase64: "SGVsbG8gV29ybGQ=",
      },
    };
    const eml = buildEmlFile(inputWithAttachment);
    expect(eml).toContain("Content-Transfer-Encoding: base64");
    expect(eml).toContain("SGVsbG8gV29ybGQ=");
  });

  it("handles empty body text gracefully", () => {
    const input = {
      ...baseInput,
      bodyText: "",
    };
    const eml = buildEmlFile(input);
    expect(eml).toContain("MIME-Version: 1.0");
    expect(eml).toContain("<html");
  });

  it("includes X-Unsent: 1 header for Outlook compose mode", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).toContain("X-Unsent: 1");
  });

  it("includes X-Unsent: 1 header when attachment is present", () => {
    const inputWithAttachment = {
      ...baseInput,
      attachment: {
        filename: "test.pdf",
        mimeType: "application/pdf",
        contentBase64: "SGVsbG8gV29ybGQ=",
      },
    };
    const eml = buildEmlFile(inputWithAttachment);
    expect(eml).toContain("X-Unsent: 1");
  });

  it("includes CTA text as a plain paragraph when provided", () => {
    const eml = buildEmlFile({ ...baseInput, ctaText: "Schedule a 15-minute call" });
    expect(eml).toContain("Schedule a 15-minute call");
    // CTA should NOT be in a styled card
    expect(eml).not.toContain("border-left:4px");
    expect(eml).not.toContain("font-style:italic");
  });

  it("does NOT include attachment notice box in HTML", () => {
    const inputWithAttachment = {
      ...baseInput,
      attachment: {
        filename: "CP-Truck-Air.pdf",
        mimeType: "application/pdf",
        contentBase64: "SGVsbG8gV29ybGQ=",
      },
    };
    const eml = buildEmlFile(inputWithAttachment);
    expect(eml).toContain("Content-Disposition: attachment");
    expect(eml).not.toContain("is attached for your reference");
  });

  it("produces identical styling regardless of brand parameter", () => {
    const emlAC = buildEmlFile({ ...baseInput, brand: "atlasCopco" });
    const emlCP = buildEmlFile({ ...baseInput, brand: "chicagoPneumatic" });
    // Both should use the same Calibri font, same black text, no brand colors
    expect(emlAC).toContain("Calibri");
    expect(emlCP).toContain("Calibri");
    expect(emlAC).not.toContain("#0A2240");
    expect(emlCP).not.toContain("#C41230");
  });

  it("escapes HTML entities in body text", () => {
    const input = {
      ...baseInput,
      bodyText: "We deliver 75-250 CFM & more <power> for \"your\" builds.",
    };
    const eml = buildEmlFile(input);
    expect(eml).toContain("&amp;");
    expect(eml).toContain("&lt;power&gt;");
    expect(eml).toContain("&quot;your&quot;");
  });

  it("handles non-ASCII characters in sender name via RFC 2047 encoding", () => {
    const input = {
      ...baseInput,
      fromName: "Léo Müller",
    };
    const eml = buildEmlFile(input);
    expect(eml).toContain("=?UTF-8?B?");
  });
});

describe("EML Generator — detectBrand", () => {
  it("detects Chicago Pneumatic brand from collateral name", () => {
    expect(detectBrand("CP Truck Air (2)")).toBe("chicagoPneumatic");
  });

  it("detects Chicago Pneumatic from 'chicago pneumatic' in name", () => {
    expect(detectBrand("Chicago Pneumatic Compressors")).toBe("chicagoPneumatic");
  });

  it("defaults to Atlas Copco for XAVS1800", () => {
    expect(detectBrand("XAVS1800 Compressor")).toBe("atlasCopco");
  });

  it("defaults to Atlas Copco for CDR dryers", () => {
    expect(detectBrand("CDR 850 Desiccant Dryer")).toBe("atlasCopco");
  });

  it("defaults to Atlas Copco when no collateral name", () => {
    expect(detectBrand()).toBe("atlasCopco");
    expect(detectBrand("")).toBe("atlasCopco");
    expect(detectBrand(undefined)).toBe("atlasCopco");
  });
});
