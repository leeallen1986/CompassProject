import { describe, it, expect } from "vitest";
import { normaliseLocation } from "./aiExtractor";

describe("normaliseLocation", () => {
  describe("rejects overseas locations", () => {
    it("rejects USA", () => {
      expect(normaliseLocation("Houston, USA")).toBeNull();
    });
    it("rejects United States", () => {
      expect(normaliseLocation("New York, United States")).toBeNull();
    });
    it("rejects Canada", () => {
      expect(normaliseLocation("Toronto, Canada")).toBeNull();
    });
    it("rejects UK", () => {
      expect(normaliseLocation("London, UK")).toBeNull();
    });
    it("rejects South Africa", () => {
      expect(normaliseLocation("Johannesburg, South Africa")).toBeNull();
    });
    it("rejects Papua New Guinea", () => {
      expect(normaliseLocation("Port Moresby, Papua New Guinea")).toBeNull();
    });
    it("rejects New Zealand", () => {
      expect(normaliseLocation("Auckland, New Zealand")).toBeNull();
    });
    it("rejects Indonesia", () => {
      expect(normaliseLocation("Jakarta, Indonesia")).toBeNull();
    });
  });

  describe("handles empty/unknown values", () => {
    it("returns National for empty string", () => {
      expect(normaliseLocation("")).toBe("National");
    });
    it("returns National for Unknown", () => {
      expect(normaliseLocation("Unknown")).toBe("National");
    });
    it("returns National for 'Australia'", () => {
      expect(normaliseLocation("Australia")).toBe("National");
    });
    it("returns National for 'Nationwide'", () => {
      expect(normaliseLocation("Nationwide")).toBe("National");
    });
  });

  describe("normalises state abbreviations", () => {
    it("keeps WA as-is", () => {
      expect(normaliseLocation("WA")).toBe("WA");
    });
    it("converts Western Australia to WA", () => {
      expect(normaliseLocation("Western Australia")).toBe("WA");
    });
    it("converts New South Wales to NSW", () => {
      expect(normaliseLocation("New South Wales")).toBe("NSW");
    });
    it("converts Queensland to QLD", () => {
      expect(normaliseLocation("Queensland")).toBe("QLD");
    });
    it("converts Northern Territory to NT", () => {
      expect(normaliseLocation("Northern Territory")).toBe("NT");
    });
  });

  describe("normalises city + state combinations", () => {
    it("converts 'Perth, Western Australia' to 'Perth, WA'", () => {
      expect(normaliseLocation("Perth, Western Australia")).toBe("Perth, WA");
    });
    it("converts 'Sydney, New South Wales' to 'Sydney, NSW'", () => {
      expect(normaliseLocation("Sydney, New South Wales")).toBe("Sydney, NSW");
    });
    it("converts 'Brisbane, Queensland' to 'Brisbane, QLD'", () => {
      expect(normaliseLocation("Brisbane, Queensland")).toBe("Brisbane, QLD");
    });
    it("converts 'Melbourne, Victoria' to 'Melbourne, VIC'", () => {
      expect(normaliseLocation("Melbourne, Victoria")).toBe("Melbourne, VIC");
    });
    it("converts 'Adelaide, South Australia' to 'Adelaide, SA'", () => {
      expect(normaliseLocation("Adelaide, South Australia")).toBe("Adelaide, SA");
    });
    it("converts 'Darwin, Northern Territory' to 'Darwin, NT'", () => {
      expect(normaliseLocation("Darwin, Northern Territory")).toBe("Darwin, NT");
    });
  });

  describe("removes trailing Australia", () => {
    it("removes ', Australia' suffix", () => {
      expect(normaliseLocation("Perth, WA, Australia")).toBe("Perth, WA");
    });
    it("removes 'Australia' from state-level", () => {
      expect(normaliseLocation("NSW, Australia")).toBe("NSW");
    });
    it("removes 'Australia' from full state name", () => {
      expect(normaliseLocation("Queensland, Australia")).toBe("QLD");
    });
  });

  describe("infers state from city names", () => {
    it("adds WA for Perth", () => {
      expect(normaliseLocation("Perth")).toBe("Perth, WA");
    });
    it("adds NSW for Sydney", () => {
      expect(normaliseLocation("Sydney")).toBe("Sydney, NSW");
    });
    it("adds QLD for Brisbane", () => {
      expect(normaliseLocation("Brisbane")).toBe("Brisbane, QLD");
    });
    it("adds VIC for Melbourne", () => {
      expect(normaliseLocation("Melbourne")).toBe("Melbourne, VIC");
    });
    it("adds WA for Karratha", () => {
      expect(normaliseLocation("Karratha")).toBe("Karratha, WA");
    });
    it("adds QLD for Mount Isa", () => {
      expect(normaliseLocation("Mount Isa")).toBe("Mount Isa, QLD");
    });
  });

  describe("infers state from region names", () => {
    it("adds WA for Pilbara", () => {
      expect(normaliseLocation("Pilbara")).toBe("Pilbara, WA");
    });
    it("adds QLD for Bowen Basin", () => {
      expect(normaliseLocation("Bowen Basin")).toBe("Bowen Basin, QLD");
    });
    it("adds VIC for Gippsland", () => {
      expect(normaliseLocation("Gippsland")).toBe("Gippsland, VIC");
    });
    it("adds SA for Cooper Basin", () => {
      expect(normaliseLocation("Cooper Basin")).toBe("Cooper Basin, SA");
    });
    it("adds NSW for Hunter Valley", () => {
      expect(normaliseLocation("Hunter Valley")).toBe("Hunter Valley, NSW");
    });
  });

  describe("preserves already-clean locations", () => {
    it("keeps 'Pilbara, WA' unchanged", () => {
      expect(normaliseLocation("Pilbara, WA")).toBe("Pilbara, WA");
    });
    it("keeps 'Sydney CBD, NSW' unchanged", () => {
      expect(normaliseLocation("Sydney CBD, NSW")).toBe("Sydney CBD, NSW");
    });
    it("keeps 'National' unchanged", () => {
      expect(normaliseLocation("National")).toBe("National");
    });
  });

  describe("handles complex multi-part locations", () => {
    it("normalises 'Kalgoorlie, Western Australia, Australia'", () => {
      expect(normaliseLocation("Kalgoorlie, Western Australia, Australia")).toBe("Kalgoorlie, WA");
    });
    it("normalises 'Melbourne, Victoria, Australia'", () => {
      expect(normaliseLocation("Melbourne, Victoria, Australia")).toBe("Melbourne, VIC");
    });
    it("normalises 'Pilbara region, Western Australia'", () => {
      expect(normaliseLocation("Pilbara region, Western Australia")).toBe("Pilbara region, WA");
    });
  });
});
