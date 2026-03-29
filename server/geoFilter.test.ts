import { describe, it, expect } from "vitest";
import {
  classifyTitleRegion,
  classifyLocationRegion,
  classifyContactRegion,
  isAustralianRelevant,
  filterAustralianContacts,
  isLinkedInResultAustralianRelevant,
} from "./geoFilter";

// ── classifyTitleRegion ──

describe("classifyTitleRegion", () => {
  it("returns unknown for null/empty title", () => {
    expect(classifyTitleRegion(null).classification).toBe("unknown");
    expect(classifyTitleRegion("").classification).toBe("unknown");
    expect(classifyTitleRegion(undefined).classification).toBe("unknown");
  });

  it("detects LATAM region signals", () => {
    const r = classifyTitleRegion("Business Development Manager - LATAM");
    expect(r.classification).toBe("non_australia");
    expect(r.detectedSignal?.toLowerCase()).toContain("latam");
  });

  it("detects Latin America region signals", () => {
    const r = classifyTitleRegion("Regional Director, Latin America");
    expect(r.classification).toBe("non_australia");
  });

  it("detects South America region signals", () => {
    const r = classifyTitleRegion("VP Operations South America");
    expect(r.classification).toBe("non_australia");
  });

  it("detects Brazil in title", () => {
    const r = classifyTitleRegion("Country Manager Brazil");
    expect(r.classification).toBe("non_australia");
  });

  it("detects Chile in title", () => {
    const r = classifyTitleRegion("Mining Operations Manager Chile");
    expect(r.classification).toBe("non_australia");
  });

  it("detects Peru in title", () => {
    const r = classifyTitleRegion("Site Manager Peru Operations");
    expect(r.classification).toBe("non_australia");
  });

  it("detects EMEA region signals", () => {
    const r = classifyTitleRegion("Sales Director EMEA");
    expect(r.classification).toBe("non_australia");
  });

  it("detects Europe region signals", () => {
    const r = classifyTitleRegion("Head of Operations Europe");
    expect(r.classification).toBe("non_australia");
  });

  it("detects Americas region signals", () => {
    const r = classifyTitleRegion("VP Sales Americas");
    expect(r.classification).toBe("non_australia");
  });

  it("detects North America region signals", () => {
    const r = classifyTitleRegion("Regional Manager North America");
    expect(r.classification).toBe("non_australia");
  });

  it("detects USA in title", () => {
    const r = classifyTitleRegion("Operations Manager USA");
    expect(r.classification).toBe("non_australia");
  });

  it("detects Canada in title", () => {
    const r = classifyTitleRegion("Business Line Manager - Canada");
    expect(r.classification).toBe("non_australia");
  });

  it("detects India in title", () => {
    const r = classifyTitleRegion("Plant Manager at Veedol Corporation, India Ltd.");
    expect(r.classification).toBe("non_australia");
  });

  it("detects China in title", () => {
    const r = classifyTitleRegion("General Manager China Operations");
    expect(r.classification).toBe("non_australia");
  });

  it("detects Africa in title", () => {
    const r = classifyTitleRegion("Regional Director Africa");
    expect(r.classification).toBe("non_australia");
  });

  it("detects Middle East in title", () => {
    const r = classifyTitleRegion("Operations Manager Middle East");
    expect(r.classification).toBe("non_australia");
  });

  it("allows generic titles without region signals", () => {
    const r = classifyTitleRegion("Project Manager");
    expect(r.classification).toBe("unknown");
  });

  it("allows generic senior titles", () => {
    const r = classifyTitleRegion("General Manager Mining Operations");
    expect(r.classification).toBe("unknown");
  });

  it("detects Australia signal in title", () => {
    const r = classifyTitleRegion("Operations Manager Australia");
    expect(r.classification).toBe("australia");
  });

  it("detects APAC signal in title", () => {
    const r = classifyTitleRegion("VP Sales APAC");
    expect(r.classification).toBe("australia");
  });

  it("detects Asia Pacific signal in title", () => {
    const r = classifyTitleRegion("Regional Director Asia Pacific");
    expect(r.classification).toBe("australia");
  });

  it("detects ANZ signal in title", () => {
    const r = classifyTitleRegion("Managing Director ANZ");
    expect(r.classification).toBe("australia");
  });

  it("AU signal overrides non-AU signal in same title", () => {
    const r = classifyTitleRegion("Director LATAM & APAC");
    expect(r.classification).toBe("australia");
    expect(r.reason).toContain("override");
  });

  it("AU city in title overrides non-AU signal", () => {
    const r = classifyTitleRegion("Regional Manager Americas & Perth");
    expect(r.classification).toBe("australia");
  });

  it("detects Perth in title as AU", () => {
    const r = classifyTitleRegion("Site Manager based in Perth");
    expect(r.classification).toBe("australia");
  });

  it("detects Pilbara in title as AU", () => {
    const r = classifyTitleRegion("Operations Manager Pilbara Region");
    expect(r.classification).toBe("australia");
  });

  it("detects Western Australia in title as AU", () => {
    const r = classifyTitleRegion("Mining Manager Western Australia");
    expect(r.classification).toBe("australia");
  });
});

// ── classifyLocationRegion ──

describe("classifyLocationRegion", () => {
  it("returns unknown for null/empty location", () => {
    expect(classifyLocationRegion(null).classification).toBe("unknown");
    expect(classifyLocationRegion("").classification).toBe("unknown");
  });

  it("detects Australian locations", () => {
    expect(classifyLocationRegion("Perth, Western Australia").classification).toBe("australia");
    expect(classifyLocationRegion("Sydney, New South Wales").classification).toBe("australia");
    expect(classifyLocationRegion("Melbourne, Victoria, Australia").classification).toBe("australia");
    expect(classifyLocationRegion("Brisbane, Queensland").classification).toBe("australia");
    expect(classifyLocationRegion("Karratha, Western Australia").classification).toBe("australia");
    expect(classifyLocationRegion("Kalgoorlie, WA, Australia").classification).toBe("australia");
  });

  it("detects South American locations", () => {
    expect(classifyLocationRegion("Santiago, Chile").classification).toBe("non_australia");
    expect(classifyLocationRegion("Lima, Peru").classification).toBe("non_australia");
    expect(classifyLocationRegion("Sao Paulo, Brazil").classification).toBe("non_australia");
    expect(classifyLocationRegion("Buenos Aires, Argentina").classification).toBe("non_australia");
    expect(classifyLocationRegion("Bogota, Colombia").classification).toBe("non_australia");
  });

  it("detects North American locations", () => {
    expect(classifyLocationRegion("Houston, Texas, United States").classification).toBe("non_australia");
    expect(classifyLocationRegion("Denver, Colorado, United States").classification).toBe("non_australia");
    expect(classifyLocationRegion("Toronto, Ontario, Canada").classification).toBe("non_australia");
    expect(classifyLocationRegion("Calgary, Alberta, Canada").classification).toBe("non_australia");
  });

  it("detects European locations", () => {
    expect(classifyLocationRegion("London, United Kingdom").classification).toBe("non_australia");
    expect(classifyLocationRegion("Stockholm, Sweden").classification).toBe("non_australia");
    expect(classifyLocationRegion("Munich, Germany").classification).toBe("non_australia");
  });

  it("detects African locations", () => {
    expect(classifyLocationRegion("Johannesburg, South Africa").classification).toBe("non_australia");
    expect(classifyLocationRegion("Cape Town, South Africa").classification).toBe("non_australia");
  });

  it("detects Asian locations", () => {
    expect(classifyLocationRegion("Mumbai, India").classification).toBe("non_australia");
    expect(classifyLocationRegion("Beijing, China").classification).toBe("non_australia");
    expect(classifyLocationRegion("Shanghai, China").classification).toBe("non_australia");
  });

  it("returns unknown for ambiguous locations", () => {
    expect(classifyLocationRegion("Greater Area").classification).toBe("unknown");
    expect(classifyLocationRegion("Remote").classification).toBe("unknown");
  });
});

// ── classifyContactRegion ──

describe("classifyContactRegion", () => {
  it("non-AU title + AU location = australia (trusts location)", () => {
    const r = classifyContactRegion({
      title: "LATAM Business Development Manager",
      linkedinLocation: "Perth, Western Australia",
    });
    expect(r.classification).toBe("australia");
  });

  it("non-AU location + AU title = australia (trusts title)", () => {
    const r = classifyContactRegion({
      title: "APAC Regional Director",
      linkedinLocation: "Houston, Texas, United States",
    });
    expect(r.classification).toBe("australia");
  });

  it("non-AU title + non-AU location = non_australia", () => {
    const r = classifyContactRegion({
      title: "LATAM Operations Manager",
      linkedinLocation: "Santiago, Chile",
    });
    expect(r.classification).toBe("non_australia");
  });

  it("non-AU title + unknown location = non_australia", () => {
    const r = classifyContactRegion({
      title: "Regional Director EMEA",
      linkedinLocation: null,
    });
    expect(r.classification).toBe("non_australia");
  });

  it("unknown title + non-AU location = non_australia", () => {
    const r = classifyContactRegion({
      title: "Project Manager",
      linkedinLocation: "Johannesburg, South Africa",
    });
    expect(r.classification).toBe("non_australia");
  });

  it("AU title + unknown location = australia", () => {
    const r = classifyContactRegion({
      title: "Operations Manager Australia",
      linkedinLocation: null,
    });
    expect(r.classification).toBe("australia");
  });

  it("unknown title + AU location = australia", () => {
    const r = classifyContactRegion({
      title: "Project Manager",
      linkedinLocation: "Perth, Western Australia",
    });
    expect(r.classification).toBe("australia");
  });

  it("unknown title + unknown location = unknown", () => {
    const r = classifyContactRegion({
      title: "Project Manager",
      linkedinLocation: null,
    });
    expect(r.classification).toBe("unknown");
  });

  it("prefers linkedinHeadline over title", () => {
    const r = classifyContactRegion({
      title: "Project Manager",
      linkedinHeadline: "LATAM Business Development Manager",
      linkedinLocation: null,
    });
    expect(r.classification).toBe("non_australia");
  });
});

// ── isAustralianRelevant ──

describe("isAustralianRelevant", () => {
  it("returns true for Australian contacts", () => {
    expect(isAustralianRelevant({
      title: "Operations Manager",
      linkedinLocation: "Perth, Western Australia",
    })).toBe(true);
  });

  it("returns true for contacts with no region signals (unknown)", () => {
    expect(isAustralianRelevant({
      title: "Project Manager",
      linkedinLocation: null,
    })).toBe(true);
  });

  it("returns false for non-Australian contacts", () => {
    expect(isAustralianRelevant({
      title: "LATAM Business Development Manager",
      linkedinLocation: "Santiago, Chile",
    })).toBe(false);
  });

  it("returns false for contacts with non-AU location only", () => {
    expect(isAustralianRelevant({
      title: "Procurement Manager",
      linkedinLocation: "Houston, TX",
    })).toBe(false);
  });

  it("returns false for contacts with non-AU title only", () => {
    expect(isAustralianRelevant({
      title: "Regional Director EMEA",
    })).toBe(false);
  });
});

// ── filterAustralianContacts ──

describe("filterAustralianContacts", () => {
  const contacts = [
    { title: "Project Manager", linkedinHeadline: null, linkedinLocation: "Perth, WA", location: null },
    { title: "LATAM BD Manager", linkedinHeadline: null, linkedinLocation: "Santiago, Chile", location: null },
    { title: "Site Manager", linkedinHeadline: null, linkedinLocation: null, location: null },
    { title: "VP Sales EMEA", linkedinHeadline: null, linkedinLocation: "London, UK", location: null },
    { title: "Mining Manager Pilbara", linkedinHeadline: null, linkedinLocation: null, location: null },
  ];

  it("filters out non-Australian contacts", () => {
    const result = filterAustralianContacts(contacts);
    expect(result).toHaveLength(3);
    expect(result.map(c => c.title)).toEqual([
      "Project Manager",
      "Site Manager",
      "Mining Manager Pilbara",
    ]);
  });

  it("returns empty array for all non-AU contacts", () => {
    const nonAu = [
      { title: "LATAM Manager", linkedinHeadline: null, linkedinLocation: "Brazil", location: null },
      { title: "EMEA Director", linkedinHeadline: null, linkedinLocation: "London", location: null },
    ];
    expect(filterAustralianContacts(nonAu)).toHaveLength(0);
  });

  it("returns all contacts when none have non-AU signals", () => {
    const auContacts = [
      { title: "Project Manager", linkedinHeadline: null, linkedinLocation: null, location: null },
      { title: "Site Manager", linkedinHeadline: null, linkedinLocation: "Perth", location: null },
    ];
    expect(filterAustralianContacts(auContacts)).toHaveLength(2);
  });
});

// ── isLinkedInResultAustralianRelevant ──

describe("isLinkedInResultAustralianRelevant", () => {
  it("returns true for AU-located LinkedIn result", () => {
    expect(isLinkedInResultAustralianRelevant({
      fullName: "John Smith",
      headline: "Project Manager at BHP",
      location: "Perth, Western Australia",
    })).toBe(true);
  });

  it("returns false for LATAM LinkedIn result", () => {
    expect(isLinkedInResultAustralianRelevant({
      fullName: "Carlos Rodriguez",
      headline: "LATAM Business Development Manager at Atlas Copco",
      location: "Santiago, Chile",
    })).toBe(false);
  });

  it("returns false for US LinkedIn result", () => {
    expect(isLinkedInResultAustralianRelevant({
      fullName: "Mike Johnson",
      headline: "Procurement Manager",
      location: "Houston, TX",
    })).toBe(false);
  });

  it("returns true for result with no location signals", () => {
    expect(isLinkedInResultAustralianRelevant({
      fullName: "Jane Doe",
      headline: "Engineering Manager",
      location: null,
    })).toBe(true);
  });

  it("returns false for India-based result", () => {
    expect(isLinkedInResultAustralianRelevant({
      fullName: "Raj Patel",
      headline: "MBA plus Electrical Engineer, India",
      location: "Doha, Qatar",
    })).toBe(false);
  });

  it("returns false for South Africa result", () => {
    expect(isLinkedInResultAustralianRelevant({
      fullName: "David Nkosi",
      headline: "Fleet Manager",
      location: "City of Johannesburg",
    })).toBe(false);
  });
});

// ── Real-world edge cases from backfill ──

describe("real-world edge cases", () => {
  it("K-water Korea Construction Manager is non-AU", () => {
    expect(isAustralianRelevant({
      title: "K-water (Korea Water Resources Corporation) Construction Manager",
      linkedinLocation: "Seoul, South Korea",
    })).toBe(false);
  });

  it("Chevron Procurement Manager in Houston is non-AU", () => {
    expect(isAustralianRelevant({
      title: "Procurement Manager",
      linkedinLocation: "Houston, TX",
    })).toBe(false);
  });

  it("Santos Deputy Project Director in Alaska is non-AU", () => {
    expect(isAustralianRelevant({
      title: "Senior Commissioning Manager & Deputy Project Director at Santos Ltd",
      linkedinLocation: "Anchorage, Alaska, United States",
    })).toBe(false);
  });

  it("Sandvik Canada Business Line Manager is non-AU", () => {
    expect(isAustralianRelevant({
      title: "Business Line Manager - Mechanical cutting - Canada at Sandvik Mining",
      linkedinLocation: null,
    })).toBe(false);
  });

  it("Bilfinger UK Project Manager is non-AU", () => {
    expect(isAustralianRelevant({
      title: "Project Manager @ Bilfinger UK GSK Capital Projects",
      linkedinLocation: "Morpeth, England, United Kingdom",
    })).toBe(false);
  });

  it("Operations Manager in Santos Brazil is non-AU", () => {
    expect(isAustralianRelevant({
      title: "Operations Planning & Execution Manager",
      linkedinLocation: "Santos, State of Sao Paulo, Brazil",
    })).toBe(false);
  });

  it("COO in South Africa is non-AU", () => {
    expect(isAustralianRelevant({
      title: "Chief Operating Officer",
      linkedinLocation: "KwaZulu-Natal, South Africa",
    })).toBe(false);
  });

  it("generic Project Manager with no location is allowed (unknown)", () => {
    expect(isAustralianRelevant({
      title: "Project Manager",
      linkedinLocation: null,
    })).toBe(true);
  });

  it("BHP Site Manager in Perth is AU", () => {
    expect(isAustralianRelevant({
      title: "Site Manager at BHP",
      linkedinLocation: "Perth, Western Australia, Australia",
    })).toBe(true);
  });

  it("Fortescue Operations Manager in Pilbara is AU", () => {
    expect(isAustralianRelevant({
      title: "Operations Manager Pilbara",
      linkedinLocation: "Karratha, Western Australia",
    })).toBe(true);
  });
});
