/**
 * emlGenerator.test.ts — Tests for the .eml file generator
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

describe("EML Generator — buildEmlFile", () => {
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

  it("includes HTML content with brand styling", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).toContain("<html");
    expect(eml).toContain("</html>");
  });

  it("converts body text line breaks to HTML paragraphs", () => {
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

  it("uses table-based layout for Outlook compatibility", () => {
    const eml = buildEmlFile(baseInput);
    expect(eml).toContain("<table");
    expect(eml).toContain("</table>");
  });

  it("includes Atlas Copco branding when brand is atlasCopco", () => {
    const eml = buildEmlFile({ ...baseInput, brand: "atlasCopco" });
    // Should contain the Atlas Copco navy color
    expect(eml).toContain("#0A2240");
  });

  it("includes Chicago Pneumatic branding when brand is chicagoPneumatic", () => {
    const eml = buildEmlFile({ ...baseInput, brand: "chicagoPneumatic" });
    // Should contain the CP red color
    expect(eml).toContain("#C41230");
  });

  it("includes CTA text when provided", () => {
    const eml = buildEmlFile({ ...baseInput, ctaText: "Schedule a 15-minute call" });
    expect(eml).toContain("Schedule a 15-minute call");
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
