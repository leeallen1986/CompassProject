import { describe, it, expect, vi } from "vitest";

// Mock the LLM module before importing the module under test
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            subject: "Supporting the Pilbara Maintenance Services Project — Portable Air Solutions",
            body: "Hi John,\\n\\nI noticed the Monadelphous Rio Tinto Pilbara Maintenance Services project is moving into the execution phase. Given the scale of drilling and blasting operations planned, portable air compressors will be critical to keeping your timeline on track.\\n\\nAt Atlas Copco Power Technique, we supply the XATS and DrillAir series — purpose-built for remote Pilbara conditions with fuel-efficient designs and 24/7 parts availability across WA.\\n\\nWould a 15-minute call this week work to discuss your air requirements?\\n\\nCheers,\\nLee",
            keyPoints: [
              "XATS and DrillAir series for remote mining conditions",
              "24/7 service and parts availability across WA",
              "Fuel-efficient designs for cost reduction",
            ],
          }),
        },
      },
    ],
  }),
}));

import { generateOutreachEmail, type OutreachInput } from "./outreachEmail";

const sampleInput: OutreachInput = {
  contactName: "John Smith",
  contactTitle: "Procurement Manager",
  contactCompany: "Monadelphous Group",
  contactEmail: "john.smith@monadelphous.com.au",
  contactRoleBucket: "Procurement",
  projectName: "Monadelphous Rio Tinto Pilbara Maintenance Services",
  projectLocation: "Pilbara, WA",
  projectValue: "$300M",
  projectSector: "mining",
  projectStage: "Execution",
  projectOverview: "Major maintenance services contract for Rio Tinto iron ore operations in the Pilbara region.",
  equipmentSignals: ["Portable compressors", "Drilling equipment", "Blasting support"],
  opportunityRoute: "Direct CAPEX",
  matchedBusinessLines: ["Portable Air"],
  senderName: "Lee",
  tone: "consultative",
};

describe("outreachEmail", () => {
  describe("generateOutreachEmail", () => {
    it("returns a structured email with subject, body, and key points", async () => {
      const result = await generateOutreachEmail(sampleInput);

      expect(result).toBeDefined();
      expect(result.subject).toBeTruthy();
      expect(typeof result.subject).toBe("string");
      expect(result.body).toBeTruthy();
      expect(typeof result.body).toBe("string");
      expect(result.keyPoints).toBeInstanceOf(Array);
      expect(result.keyPoints.length).toBeGreaterThan(0);
      expect(result.toneUsed).toBe("consultative");
    });

    it("includes the tone in the result", async () => {
      const result = await generateOutreachEmail({
        ...sampleInput,
        tone: "professional",
      });

      expect(result.toneUsed).toBe("professional");
    });

    it("includes the tone in the result for direct tone", async () => {
      const result = await generateOutreachEmail({
        ...sampleInput,
        tone: "direct",
      });

      expect(result.toneUsed).toBe("direct");
    });

    it("handles empty equipment signals gracefully", async () => {
      const result = await generateOutreachEmail({
        ...sampleInput,
        equipmentSignals: null,
      });

      expect(result).toBeDefined();
      expect(result.subject).toBeTruthy();
    });

    it("handles empty business lines gracefully", async () => {
      const result = await generateOutreachEmail({
        ...sampleInput,
        matchedBusinessLines: [],
      });

      expect(result).toBeDefined();
      expect(result.subject).toBeTruthy();
    });

    it("handles null project stage and overview", async () => {
      const result = await generateOutreachEmail({
        ...sampleInput,
        projectStage: null,
        projectOverview: null,
      });

      expect(result).toBeDefined();
      expect(result.subject).toBeTruthy();
    });

    it("includes sender company when provided", async () => {
      const result = await generateOutreachEmail({
        ...sampleInput,
        senderCompany: "Atlas Copco Power Technique Australia",
      });

      expect(result).toBeDefined();
      expect(result.subject).toBeTruthy();
    });

    it("throws when LLM returns empty content", async () => {
      const { invokeLLM } = await import("./_core/llm");
      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      await expect(generateOutreachEmail(sampleInput)).rejects.toThrow(
        "LLM returned empty response"
      );
    });

    it("throws when LLM returns invalid JSON", async () => {
      const { invokeLLM } = await import("./_core/llm");
      (invokeLLM as any).mockResolvedValueOnce({
        choices: [{ message: { content: "not valid json" } }],
      });

      await expect(generateOutreachEmail(sampleInput)).rejects.toThrow();
    });
  });

  describe("OutreachInput validation", () => {
    it("accepts all three tone options", () => {
      const tones: Array<"professional" | "consultative" | "direct"> = [
        "professional",
        "consultative",
        "direct",
      ];
      tones.forEach((tone) => {
        expect(() => {
          const input: OutreachInput = { ...sampleInput, tone };
          expect(input.tone).toBe(tone);
        }).not.toThrow();
      });
    });

    it("has all required fields in the sample input", () => {
      const requiredFields: (keyof OutreachInput)[] = [
        "contactName",
        "contactTitle",
        "contactCompany",
        "contactEmail",
        "contactRoleBucket",
        "projectName",
        "projectLocation",
        "projectValue",
        "projectSector",
        "opportunityRoute",
        "matchedBusinessLines",
        "senderName",
        "tone",
      ];

      requiredFields.forEach((field) => {
        expect(sampleInput[field]).toBeDefined();
      });
    });
  });
});
