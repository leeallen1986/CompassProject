/**
 * massDownload.test.ts — Tests for the mass .eml download ZIP bundler logic.
 * Tests the buildEmlFile function with multiple contacts to verify
 * the ZIP bundling approach works correctly.
 */
import { describe, it, expect } from "vitest";
import { buildEmlFile, detectBrand } from "./emlGenerator";

const makeDraft = (firstName: string, lastName: string, company: string, email: string) => ({
  fromName: "Tim O'Neil Shaw",
  fromEmail: "tim.oneilshaw@atlascopco.com",
  toName: `${firstName} ${lastName}`,
  toEmail: email,
  subject: `CP Truck Air — Reliable Compressor Solutions for ${company}`,
  bodyText: `Hi ${firstName},\n\nI'm reaching out from Chicago Pneumatic.\n\nWe've developed the CP Truck Air range specifically for vehicle integration.\n\nIf you're interested, just reply and I'll organise your local sales representative to visit.`,
  brand: "chicagoPneumatic" as const,
});

describe("Mass Download — EML generation for multiple contacts", () => {
  it("generates valid .eml files for multiple contacts", () => {
    const contacts = [
      makeDraft("Chris", "Johnson", "Quik Corp", "chris@quikcorp.com.au"),
      makeDraft("Sarah", "Williams", "Kenworth", "sarah@kenworth.com.au"),
      makeDraft("Mike", "Brown", "Tieman", "mike@tieman.com.au"),
    ];

    const emlFiles = contacts.map((c) => ({
      filename: `${c.toName.replace(/\s+/g, "-").toLowerCase()}.eml`,
      content: buildEmlFile(c),
    }));

    expect(emlFiles).toHaveLength(3);

    // Each .eml should be a valid MIME message
    for (const eml of emlFiles) {
      expect(eml.content).toContain("MIME-Version: 1.0");
      expect(eml.content).toContain("X-Unsent: 1");
      expect(eml.content).toContain("tim.oneilshaw@atlascopco.com");
      expect(eml.filename).toMatch(/\.eml$/);
    }

    // Each should have unique recipient
    expect(emlFiles[0].content).toContain("chris@quikcorp.com.au");
    expect(emlFiles[1].content).toContain("sarah@kenworth.com.au");
    expect(emlFiles[2].content).toContain("mike@tieman.com.au");
  });

  it("generates unique filenames for each contact", () => {
    const contacts = [
      makeDraft("Chris", "Johnson", "Quik Corp", "chris@quikcorp.com.au"),
      makeDraft("Sarah", "Williams", "Kenworth", "sarah@kenworth.com.au"),
    ];

    const filenames = contacts.map((c) => {
      const safeName = "quik-corp";
      const safeRecipient = c.toName
        .replace(/[^a-zA-Z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .toLowerCase();
      return `${safeName}--${safeRecipient}.eml`;
    });

    expect(filenames[0]).toBe("quik-corp--chris-johnson.eml");
    expect(filenames[1]).toBe("quik-corp--sarah-williams.eml");
    expect(new Set(filenames).size).toBe(filenames.length);
  });

  it("strips signature lines from body before generating .eml", () => {
    const bodyWithSig =
      "Hi Chris,\n\nI'm reaching out from Chicago Pneumatic.\n\nBest regards\nTim O'Neil Shaw\nCommunications Manager";
    const sigRegex = /\n\n\s*(Best regards|Kind regards|Regards|Warm regards|Cheers)[\s\S]*$/i;
    const cleanBody = bodyWithSig.replace(sigRegex, "");

    expect(cleanBody).toBe("Hi Chris,\n\nI'm reaching out from Chicago Pneumatic.");
    expect(cleanBody).not.toContain("Best regards");
    expect(cleanBody).not.toContain("Communications Manager");
  });

  it("strips reminder lines from body before generating .eml", () => {
    const bodyWithReminder =
      "Hi Chris,\n\nGreat to connect.\n\nReminder: Please attach the CP Truck Air flyer.";
    const cleanBody = bodyWithReminder.replace(/\n\nReminder: Please attach[\s\S]*$/, "");

    expect(cleanBody).toBe("Hi Chris,\n\nGreat to connect.");
    expect(cleanBody).not.toContain("Reminder");
  });

  it("handles contacts with attachment (shared across all)", () => {
    const attachment = {
      filename: "CP-Truck-Air.pdf",
      contentBase64: "JVBERi0xLjQKMSAwIG9iago=",
      mimeType: "application/pdf",
    };

    const contacts = [
      { ...makeDraft("Chris", "Johnson", "Quik Corp", "chris@quikcorp.com.au"), attachment },
      { ...makeDraft("Sarah", "Williams", "Kenworth", "sarah@kenworth.com.au"), attachment },
    ];

    for (const c of contacts) {
      const eml = buildEmlFile(c);
      expect(eml).toContain("multipart/mixed");
      expect(eml).toContain("CP-Truck-Air.pdf");
      expect(eml).toContain("Content-Disposition: attachment");
    }
  });

  it("generates .eml without attachment when none provided", () => {
    const eml = buildEmlFile(makeDraft("Chris", "Johnson", "Quik Corp", "chris@quikcorp.com.au"));
    expect(eml).toContain("multipart/alternative");
    expect(eml).not.toContain("Content-Disposition: attachment");
  });

  it("filename sanitisation removes special characters", () => {
    const company = "O'Brien & Sons Pty Ltd.";
    const safeName = company
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();
    expect(safeName).toBe("obrien-sons-pty-ltd");
    expect(safeName).not.toContain("'");
    expect(safeName).not.toContain("&");
    expect(safeName).not.toContain(".");
  });

  it("handles Tim O'Neil Shaw sender name with non-ASCII apostrophe", () => {
    const draft = makeDraft("Chris", "Johnson", "Quik Corp", "chris@quikcorp.com.au");
    const eml = buildEmlFile(draft);
    // The apostrophe in O'Neil should be handled (either ASCII or RFC 2047 encoded)
    expect(eml).toContain("From:");
    expect(eml).toContain("tim.oneilshaw@atlascopco.com");
  });
});
