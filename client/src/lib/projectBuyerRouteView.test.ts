import { describe, expect, it } from "vitest";
import {
  buyerFunctionLabel,
  evidenceStateLabel,
  laneLabel,
  lastCheckedLabel,
  normaliseContractorStatus,
  safeExternalUrl,
  safeLinkedInUrl,
  selectExactProjectContacts,
  sourceTypeLabel,
} from "./projectBuyerRouteView";

describe("normaliseContractorStatus", () => {
  it.each(["confirmed", "Confirmed", " CONFIRMED ", "awarded", "winning-contractor"])(
    "normalises %s as confirmed",
    status => expect(normaliseContractorStatus(status)).toEqual({ kind: "confirmed", label: "Confirmed" }),
  );

  it.each(["predicted", "Predicted", "LIKELY", "inferred"])(
    "normalises %s as predicted",
    status => expect(normaliseContractorStatus(status)).toEqual({ kind: "predicted", label: "Predicted" }),
  );

  it("does not turn an unknown status into a claim", () => {
    expect(normaliseContractorStatus("TBC")).toEqual({ kind: "unknown", label: "Status unknown" });
  });
});

describe("selectExactProjectContacts", () => {
  const contacts = [
    { id: 1, name: "Exact", company: "Elsewhere", linkedProjectIds: [3780038] },
    { id: 2, name: "Fuzzy project name", company: "Water Corporation", linkedProjectIds: [] },
    { id: 3, name: "Other project", company: "Georgiou", linkedProjectIds: [123] },
  ];

  it("uses only exact persisted project IDs", () => {
    expect(selectExactProjectContacts(3780038, contacts).map(contact => contact.id)).toEqual([1]);
  });

  it("fails closed for an invalid project ID or absent projection", () => {
    expect(selectExactProjectContacts(0, contacts)).toEqual([]);
    expect(selectExactProjectContacts(3780038, [{ id: 4, name: "No projection" }])).toEqual([]);
  });

  it("deduplicates persisted contact IDs and respects the display limit", () => {
    const duplicates = [
      { id: 1, linkedProjectIds: [3780038] },
      { id: 1, linkedProjectIds: [3780038] },
      { id: 2, linkedProjectIds: [3780038] },
    ];
    expect(selectExactProjectContacts(3780038, duplicates, 1)).toEqual([duplicates[0]]);
  });
});

describe("buyer-route evidence labels", () => {
  it("uses explicit non-claiming labels", () => {
    expect(evidenceStateLabel("recorded_unverified")).toBe("Recorded, unverified");
    expect(evidenceStateLabel("inferred")).toBe("Inferred");
    expect(evidenceStateLabel("not_recorded")).toBe("Not recorded");
  });

  it("formats lane and function labels", () => {
    expect(laneLabel("contractor")).toBe("Contractor");
    expect(laneLabel("unknown")).toBe("Lane not established");
    expect(buyerFunctionLabel("plant_equipment_fleet")).toBe("Plant, equipment or fleet");
  });

  it("formats contact source and timestamp without inventing evidence", () => {
    expect(sourceTypeLabel("web_search")).toBe("Web search");
    expect(sourceTypeLabel(null)).toBe("Source not recorded");
    expect(lastCheckedLabel(new Date("2026-08-05T12:00:00Z"), "contact_verified_at"))
      .toBe("05 Aug 2026 UTC (verified)");
    expect(lastCheckedLabel(null, "not_recorded")).toBe("Not recorded");
  });
});

describe("safe evidence links", () => {
  it("allows credential-free HTTP(S) links and rejects active or ambiguous schemes", () => {
    expect(safeExternalUrl(" https://example.com/evidence?id=1 ")).toBe("https://example.com/evidence?id=1");
    expect(safeExternalUrl("http://example.com/evidence")).toBe("http://example.com/evidence");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,unsafe")).toBeNull();
    expect(safeExternalUrl("https://user:secret@example.com/file")).toBeNull();
    expect(safeExternalUrl("/relative/file")).toBeNull();
  });

  it("allows only LinkedIn hosts for LinkedIn actions", () => {
    expect(safeLinkedInUrl("https://www.linkedin.com/in/example")).toBe("https://www.linkedin.com/in/example");
    expect(safeLinkedInUrl("https://linkedin.com/search/results/people/?keywords=test"))
      .toBe("https://linkedin.com/search/results/people/?keywords=test");
    expect(safeLinkedInUrl("https://linkedin.com.example.test/in/fake")).toBeNull();
    expect(safeLinkedInUrl("https://user:secret@linkedin.com/in/example")).toBeNull();
  });
});
