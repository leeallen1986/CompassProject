import { describe, expect, it } from "vitest";
import {
  normaliseContractorStatus,
  selectExactProjectContacts,
} from "@/lib/projectBuyerRouteView";

describe("ProjectCard exact contact projection", () => {
  const contacts = [
    {
      id: 1,
      name: "Exact contact",
      company: "Unrelated display company",
      project: "Unrelated legacy project text",
      linkedProjectIds: [3_780_038],
    },
    {
      id: 2,
      name: "Fuzzy-only owner match",
      company: "Water Corporation",
      project: "GAWSS Upgrade",
      linkedProjectIds: [],
    },
    {
      id: 3,
      name: "Different exact project",
      company: "Georgiou Group",
      project: "GAWSS Upgrade",
      linkedProjectIds: [999],
    },
  ];

  it("selects only the exact persisted project ID", () => {
    expect(selectExactProjectContacts(3_780_038, contacts)).toEqual([contacts[0]]);
  });

  it("does not infer association from matching project or company text", () => {
    expect(selectExactProjectContacts(3_780_038, contacts).map(row => row.id))
      .not.toContain(2);
    expect(selectExactProjectContacts(3_780_038, contacts).map(row => row.id))
      .not.toContain(3);
  });

  it("fails closed when the link projection is absent or malformed", () => {
    expect(selectExactProjectContacts(3_780_038, [{ id: 4 }])).toEqual([]);
    expect(selectExactProjectContacts(3_780_038, [{ id: 4, linkedProjectIds: [0, -1, Number.NaN] }]))
      .toEqual([]);
  });

  it("fails closed for non-persisted project IDs", () => {
    expect(selectExactProjectContacts(0, contacts)).toEqual([]);
    expect(selectExactProjectContacts(Number.MAX_SAFE_INTEGER + 1, contacts)).toEqual([]);
  });

  it("deduplicates by persisted contact ID and observes the display limit", () => {
    const rows = [
      { id: 1, linkedProjectIds: [3_780_038], version: "first" },
      { id: 1, linkedProjectIds: [3_780_038], version: "duplicate" },
      { id: 2, linkedProjectIds: [3_780_038], version: "second" },
    ];
    expect(selectExactProjectContacts(3_780_038, rows, 1)).toEqual([rows[0]]);
  });
});

describe("ProjectCard contractor evidence labels", () => {
  it.each(["confirmed", "Confirmed", "awarded", "winning-contractor"])(
    "normalises %s as a stored confirmed status",
    status => expect(normaliseContractorStatus(status).kind).toBe("confirmed"),
  );

  it.each(["predicted", "likely", "inferred"])(
    "normalises %s as a stored predicted status",
    status => expect(normaliseContractorStatus(status).kind).toBe("predicted"),
  );

  it("does not convert an unknown stored status into a claim", () => {
    expect(normaliseContractorStatus("TBC")).toEqual({
      kind: "unknown",
      label: "Status unknown",
    });
  });
});
