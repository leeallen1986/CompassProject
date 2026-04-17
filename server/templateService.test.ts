import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  renderFullEmail,
  buildMergeContext,
  getSampleContext,
  getDefaultTemplate,
  MERGE_FIELDS,
  type MergeFieldContext,
} from "./templateService";

// ── renderTemplate ──

describe("renderTemplate", () => {
  const ctx: MergeFieldContext = {
    firstName: "James",
    lastName: "Wilson",
    fullName: "James Wilson",
    company: "BHP Group",
    title: "Operations Manager",
    email: "james.wilson@bhp.com",
    projectName: "Olympic Dam Expansion",
    projectLocation: "South Australia",
    sector: "Mining",
    collateralName: "XAVS1800 Compressor",
    senderName: "Michael Chen",
    senderTitle: "Business Development Manager",
    senderEmail: "michael.chen@atlascopco.com",
  };

  it("replaces all known merge fields", () => {
    const template = "Hi {{firstName}} {{lastName}} from {{company}}";
    const result = renderTemplate(template, ctx);
    expect(result).toBe("Hi James Wilson from BHP Group");
  });

  it("replaces multiple occurrences of the same token", () => {
    const template = "{{company}} is great. We love {{company}}.";
    const result = renderTemplate(template, ctx);
    expect(result).toBe("BHP Group is great. We love BHP Group.");
  });

  it("leaves unknown tokens as-is", () => {
    const template = "Hello {{firstName}}, your {{unknownField}} is ready.";
    const result = renderTemplate(template, ctx);
    expect(result).toBe("Hello James, your {{unknownField}} is ready.");
  });

  it("handles empty template string", () => {
    expect(renderTemplate("", ctx)).toBe("");
  });

  it("handles template with no tokens", () => {
    const template = "No tokens here.";
    expect(renderTemplate(template, ctx)).toBe("No tokens here.");
  });

  it("replaces all 13 merge fields correctly", () => {
    for (const field of MERGE_FIELDS) {
      const key = field.token.replace(/\{\{|\}\}/g, "");
      const result = renderTemplate(field.token, ctx);
      expect(result).toBe((ctx as Record<string, string>)[key]);
    }
  });
});

// ── renderFullEmail ──

describe("renderFullEmail", () => {
  const ctx: MergeFieldContext = {
    firstName: "Sarah",
    lastName: "Jones",
    fullName: "Sarah Jones",
    company: "Rio Tinto",
    title: "Procurement Lead",
    email: "sarah.jones@riotinto.com",
    projectName: "Pilbara Iron Ore Phase 2",
    projectLocation: "Western Australia",
    sector: "Mining",
    collateralName: "XAS900 Compressor",
    senderName: "Michael Chen",
    senderTitle: "BDM",
    senderEmail: "michael.chen@atlascopco.com",
  };

  it("assembles greeting + body + sign-off + signature", () => {
    const template = {
      subjectTemplate: "{{company}} — {{collateralName}}",
      bodyTemplate: "I'm reaching out about {{projectName}}.",
      greetingStyle: "Hi {{firstName}},",
      signOffStyle: "Kind regards,",
      senderSignature: "{{senderName}}\n{{senderEmail}}",
    };

    const { subject, body } = renderFullEmail(template, ctx);

    expect(subject).toBe("Rio Tinto — XAS900 Compressor");
    expect(body).toContain("Hi Sarah,");
    expect(body).toContain("I'm reaching out about Pilbara Iron Ore Phase 2.");
    expect(body).toContain("Kind regards,");
    expect(body).toContain("Michael Chen");
    expect(body).toContain("michael.chen@atlascopco.com");
  });

  it("uses default signature when senderSignature is null", () => {
    const template = {
      subjectTemplate: "Test",
      bodyTemplate: "Body content.",
      greetingStyle: "Dear {{fullName}},",
      signOffStyle: "Regards,",
      senderSignature: null,
    };

    const { body } = renderFullEmail(template, ctx);

    expect(body).toContain("Dear Sarah Jones,");
    expect(body).toContain("Regards,");
    expect(body).toContain("Michael Chen");
    expect(body).toContain("BDM");
    expect(body).toContain("Atlas Copco Australia - Power Technique");
    expect(body).toContain("michael.chen@atlascopco.com");
  });
});

// ── buildMergeContext ──

describe("buildMergeContext", () => {
  it("builds context from contact and campaign data", () => {
    const contact = {
      firstName: "Tom",
      lastName: "Brown",
      title: "Site Manager",
      company: "Downer EDI",
      email: "tom@downer.com",
      enrichedEmail: "tom.brown@downer.com.au",
      enrichedTitle: "Senior Site Manager",
      reviewedCompanyName: "Downer Group",
      matchedProjectIds: [1, 2],
    };

    const campaign = {
      senderName: "Michael Chen",
      senderEmail: "michael@atlascopco.com",
      senderTitle: "BDM",
      collateralName: "XAS900",
    };

    const project = {
      name: "Snowy 2.0",
      location: "NSW",
      sector: "infrastructure",
    };

    const ctx = buildMergeContext(contact, campaign, project);

    expect(ctx.firstName).toBe("Tom");
    expect(ctx.lastName).toBe("Brown");
    expect(ctx.fullName).toBe("Tom Brown");
    expect(ctx.company).toBe("Downer Group"); // uses reviewedCompanyName
    expect(ctx.title).toBe("Senior Site Manager"); // uses enrichedTitle
    expect(ctx.email).toBe("tom.brown@downer.com.au"); // uses enrichedEmail
    expect(ctx.projectName).toBe("Snowy 2.0");
    expect(ctx.projectLocation).toBe("NSW");
    expect(ctx.sector).toBe("infrastructure");
    expect(ctx.collateralName).toBe("XAS900");
    expect(ctx.senderName).toBe("Michael Chen");
    expect(ctx.senderTitle).toBe("BDM");
    expect(ctx.senderEmail).toBe("michael@atlascopco.com");
  });

  it("falls back gracefully when contact data is sparse", () => {
    const contact = {
      firstName: null,
      lastName: null,
      title: null,
      company: "Unknown Corp",
      email: null,
      enrichedEmail: null,
      enrichedTitle: null,
      reviewedCompanyName: null,
      matchedProjectIds: null,
    };

    const campaign = {
      senderName: "Test Sender",
      senderEmail: "test@test.com",
      senderTitle: null,
      collateralName: null,
    };

    const ctx = buildMergeContext(contact, campaign, null);

    expect(ctx.firstName).toBe("there");
    expect(ctx.fullName).toBe("there");
    expect(ctx.company).toBe("Unknown Corp");
    expect(ctx.title).toBe("");
    expect(ctx.email).toBe("");
    expect(ctx.projectName).toBe("Unknown Corp"); // falls back to company
    expect(ctx.projectLocation).toBe("Australia");
    expect(ctx.sector).toBe("resources");
    expect(ctx.collateralName).toBe("our solutions");
    expect(ctx.senderTitle).toBe("Business Development Manager");
  });
});

// ── getSampleContext ──

describe("getSampleContext", () => {
  it("returns a complete context with all fields populated", () => {
    const ctx = getSampleContext();
    expect(ctx.firstName).toBeTruthy();
    expect(ctx.lastName).toBeTruthy();
    expect(ctx.company).toBeTruthy();
    expect(ctx.projectName).toBeTruthy();
    expect(ctx.senderName).toBeTruthy();
  });

  it("uses campaign data when provided", () => {
    const ctx = getSampleContext({
      senderName: "Custom Sender",
      senderEmail: "custom@test.com",
      collateralName: "Custom Product",
    });
    expect(ctx.senderName).toBe("Custom Sender");
    expect(ctx.senderEmail).toBe("custom@test.com");
    expect(ctx.collateralName).toBe("Custom Product");
  });
});

// ── getDefaultTemplate ──

describe("getDefaultTemplate", () => {
  it("returns a complete template with all required fields", () => {
    const tpl = getDefaultTemplate();
    expect(tpl.subjectTemplate).toBeTruthy();
    expect(tpl.bodyTemplate).toBeTruthy();
    expect(tpl.greetingStyle).toBeTruthy();
    expect(tpl.signOffStyle).toBeTruthy();
    expect(tpl.senderSignature).toBeTruthy();
  });

  it("includes collateral name when provided", () => {
    const tpl = getDefaultTemplate("XAVS1800 Compressor");
    expect(tpl.subjectTemplate).toContain("XAVS1800 Compressor");
    expect(tpl.bodyTemplate).toContain("XAVS1800 Compressor");
  });

  it("uses generic fallback when no collateral provided", () => {
    const tpl = getDefaultTemplate();
    expect(tpl.subjectTemplate).toContain("our portable air solutions");
  });
});

// ── MERGE_FIELDS ──

describe("MERGE_FIELDS", () => {
  it("has 13 merge fields defined", () => {
    expect(MERGE_FIELDS.length).toBe(13);
  });

  it("all fields have token, label, description, and example", () => {
    for (const field of MERGE_FIELDS) {
      expect(field.token).toMatch(/^\{\{.+\}\}$/);
      expect(field.label).toBeTruthy();
      expect(field.description).toBeTruthy();
      expect(field.example).toBeTruthy();
    }
  });

  it("all tokens are unique", () => {
    const tokens = MERGE_FIELDS.map(f => f.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

// ── HTML Template Mode ──

describe("renderFullEmail — HTML mode", () => {
  const ctx: MergeFieldContext = {
    firstName: "Lee",
    lastName: "Thompson",
    fullName: "Lee Thompson",
    company: "Boart Longyear",
    title: "Fleet Manager",
    email: "lee.thompson@boartlongyear.com",
    projectName: "Kalgoorlie Gold Mine",
    projectLocation: "Western Australia",
    sector: "Mining",
    collateralName: "DrillAir X1350",
    senderName: "Michael Chen",
    senderTitle: "BDM",
    senderEmail: "michael.chen@atlascopco.com",
  };

  it("returns htmlBody when templateMode is html and htmlTemplate is provided", () => {
    const template = {
      subjectTemplate: "{{company}} — {{collateralName}}",
      bodyTemplate: "Fallback plain text body.",
      greetingStyle: "Hi {{firstName}},",
      signOffStyle: "Kind regards,",
      senderSignature: null,
      templateMode: "html" as const,
      htmlTemplate: "<html><body><h1>Hi {{firstName}}</h1><p>Welcome to {{company}}</p></body></html>",
    };

    const result = renderFullEmail(template, ctx);

    expect(result.subject).toBe("Boart Longyear — DrillAir X1350");
    expect(result.htmlBody).toBeDefined();
    expect(result.htmlBody).toContain("Hi Lee");
    expect(result.htmlBody).toContain("Welcome to Boart Longyear");
    expect(result.htmlBody).not.toContain("{{firstName}}");
    expect(result.htmlBody).not.toContain("{{company}}");
  });

  it("renders merge fields inside HTML attributes and content", () => {
    const template = {
      subjectTemplate: "Test",
      bodyTemplate: "Fallback",
      greetingStyle: "Hi {{firstName}},",
      signOffStyle: "Regards,",
      senderSignature: null,
      templateMode: "html" as const,
      htmlTemplate: '<a href="mailto:{{email}}">Email {{fullName}}</a><p>Re: {{projectName}} in {{projectLocation}}</p>',
    };

    const result = renderFullEmail(template, ctx);

    expect(result.htmlBody).toContain('href="mailto:lee.thompson@boartlongyear.com"');
    expect(result.htmlBody).toContain("Email Lee Thompson");
    expect(result.htmlBody).toContain("Kalgoorlie Gold Mine");
    expect(result.htmlBody).toContain("Western Australia");
  });

  it("still returns plain text body alongside htmlBody for fallback", () => {
    const template = {
      subjectTemplate: "Test",
      bodyTemplate: "This is the plain text version for {{firstName}}.",
      greetingStyle: "Hi {{firstName}},",
      signOffStyle: "Regards,",
      senderSignature: "{{senderName}}",
      templateMode: "html" as const,
      htmlTemplate: "<p>HTML version for {{firstName}}</p>",
    };

    const result = renderFullEmail(template, ctx);

    // Both should exist
    expect(result.htmlBody).toContain("HTML version for Lee");
    expect(result.body).toContain("Hi Lee,");
    expect(result.body).toContain("This is the plain text version for Lee.");
  });

  it("falls back to plain text when templateMode is plaintext", () => {
    const template = {
      subjectTemplate: "Test",
      bodyTemplate: "Plain text for {{firstName}}.",
      greetingStyle: "Hi {{firstName}},",
      signOffStyle: "Regards,",
      senderSignature: null,
      templateMode: "plaintext" as const,
      htmlTemplate: null,
    };

    const result = renderFullEmail(template, ctx);

    expect(result.htmlBody).toBeUndefined();
    expect(result.body).toContain("Hi Lee,");
    expect(result.body).toContain("Plain text for Lee.");
  });

  it("falls back to plain text when htmlTemplate is null even in html mode", () => {
    const template = {
      subjectTemplate: "Test",
      bodyTemplate: "Fallback body.",
      greetingStyle: "Hi {{firstName}},",
      signOffStyle: "Regards,",
      senderSignature: null,
      templateMode: "html" as const,
      htmlTemplate: null,
    };

    const result = renderFullEmail(template, ctx);

    expect(result.htmlBody).toBeUndefined();
    expect(result.body).toContain("Hi Lee,");
    expect(result.body).toContain("Fallback body.");
  });

  it("handles complex HTML with all 13 merge fields", () => {
    const allTokens = MERGE_FIELDS.map(f => `<span>${f.token}</span>`).join("");
    const template = {
      subjectTemplate: "Test",
      bodyTemplate: "Fallback",
      greetingStyle: "Hi {{firstName}},",
      signOffStyle: "Regards,",
      senderSignature: null,
      templateMode: "html" as const,
      htmlTemplate: `<div>${allTokens}</div>`,
    };

    const result = renderFullEmail(template, ctx);

    expect(result.htmlBody).toBeDefined();
    // No merge field tokens should remain
    expect(result.htmlBody).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
    // All values should be present
    expect(result.htmlBody).toContain("Lee");
    expect(result.htmlBody).toContain("Thompson");
    expect(result.htmlBody).toContain("Boart Longyear");
    expect(result.htmlBody).toContain("michael.chen@atlascopco.com");
  });
});
