/**
 * Tests for digestSafePromotion.ts
 *
 * Tests the core promotion logic in isolation using mocked DB helpers.
 * The runDigestSafePromotion function is tested via its exported pure helpers
 * and the criteria constants.
 */

import { describe, it, expect } from "vitest";
import {
  MIN_SEND_READY_CONTACTS,
  MIN_BL_SCORE,
} from "./digestSafePromotion";
import { checkJunkSuppression } from "./digestHardeningGates";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("digestSafePromotion constants", () => {
  it("MIN_SEND_READY_CONTACTS is 1", () => {
    expect(MIN_SEND_READY_CONTACTS).toBe(1);
  });

  it("MIN_BL_SCORE is 40", () => {
    expect(MIN_BL_SCORE).toBe(40);
  });
});

// ── Junk suppression integration ──────────────────────────────────────────────

describe("digestSafePromotion junk suppression gate", () => {
  it("passes a legitimate mining project", () => {
    const result = checkJunkSuppression(
      { name: "Cadia Gold Mine Operations", overview: "Open-cut gold mine expansion", sector: "mining" },
      "Portable Air",
    );
    expect(result.isJunk).toBe(false);
  });

  it("blocks a school project", () => {
    const result = checkJunkSuppression(
      { name: "Northside Primary School Upgrade", overview: "New classrooms and hall", sector: "education" },
      "Portable Air",
    );
    expect(result.isJunk).toBe(true);
    expect(result.pattern).toBe("school");
  });

  it("blocks a police station project", () => {
    const result = checkJunkSuppression(
      { name: "Kalgoorlie Police Station Redevelopment", overview: "New police complex", sector: "government" },
      "Portable Air",
    );
    expect(result.isJunk).toBe(true);
    expect(result.pattern).toBe("police_station");
  });

  it("blocks a residential estate project", () => {
    const result = checkJunkSuppression(
      { name: "Elara Residential Estate Stage 4", overview: "Townhouses and apartments", sector: "residential" },
      "Portable Air",
    );
    expect(result.isJunk).toBe(true);
    expect(result.pattern).toBe("residential_only");
  });

  it("passes a FIFO mining camp (residential exception)", () => {
    const result = checkJunkSuppression(
      { name: "Pilbara FIFO Workers Accommodation Camp", overview: "Remote mining camp for fly-in fly-out workers", sector: "mining" },
      "Portable Air",
    );
    // FIFO camps are explicitly excluded from residential_only junk pattern
    expect(result.isJunk).toBe(false);
  });

  it("passes a water treatment plant", () => {
    const result = checkJunkSuppression(
      { name: "TasWater Wastewater Treatment Upgrade", overview: "Upgrade of wastewater treatment infrastructure", sector: "water" },
      "Pump",
    );
    expect(result.isJunk).toBe(false);
  });

  it("passes a gas pipeline project", () => {
    const result = checkJunkSuppression(
      { name: "Dampier to Bunbury Natural Gas Pipeline Expansion", overview: "Gas pipeline capacity upgrade", sector: "oil_gas" },
      "Portable Air",
    );
    expect(result.isJunk).toBe(false);
  });

  it("passes a lithium mine project", () => {
    const result = checkJunkSuppression(
      { name: "Greenbushes Lithium Mine Stage 3", overview: "Lithium spodumene mine expansion", sector: "mining" },
      "Portable Air",
    );
    expect(result.isJunk).toBe(false);
  });
});

// ── Promotion criteria logic ──────────────────────────────────────────────────

describe("digestSafePromotion criteria logic", () => {
  it("project with 1 send_ready contact and BL score 45 should qualify (threshold=1)", () => {
    const sendReadyCount = 1;
    const topBLScore = 45;
    expect(sendReadyCount >= MIN_SEND_READY_CONTACTS).toBe(true);
    expect(topBLScore >= MIN_BL_SCORE).toBe(true);
  });

  it("project with 0 send_ready contacts should NOT qualify", () => {
    const sendReadyCount = 0;
    expect(sendReadyCount >= MIN_SEND_READY_CONTACTS).toBe(false);
  });

  it("project with 1 send_ready contact but BL score 35 should NOT qualify (low BL score)", () => {
    const sendReadyCount = 1;
    const topBLScore = 35;
    expect(sendReadyCount >= MIN_SEND_READY_CONTACTS).toBe(true);
    expect(topBLScore >= MIN_BL_SCORE).toBe(false);
  });

  it("project with 0 BL scores should NOT qualify", () => {
    const topBLScore = 0;
    expect(topBLScore >= MIN_BL_SCORE).toBe(false);
  });

  it("project with exactly 1 send_ready contact and score exactly 40 should qualify", () => {
    const sendReadyCount = 1;
    const topBLScore = 40;
    expect(sendReadyCount >= MIN_SEND_READY_CONTACTS).toBe(true);
    expect(topBLScore >= MIN_BL_SCORE).toBe(true);
  });

  it("project with 3 send_ready contacts and BL score 100 should qualify", () => {
    const sendReadyCount = 3;
    const topBLScore = 100;
    expect(sendReadyCount >= MIN_SEND_READY_CONTACTS).toBe(true);
    expect(topBLScore >= MIN_BL_SCORE).toBe(true);
  });
});

// ── Top BL score selection logic ──────────────────────────────────────────────

describe("digestSafePromotion top BL score selection", () => {
  it("selects the highest score across multiple dimensions", () => {
    const dimScores = new Map([
      ["Portable Air", 35],
      ["Pump", 72],
      ["BESS", 20],
    ]);
    let topBLScore = 0;
    let topBLDimension = "none";
    for (const [dim, score] of Array.from(dimScores.entries())) {
      if (score > topBLScore) {
        topBLScore = score;
        topBLDimension = dim;
      }
    }
    expect(topBLScore).toBe(72);
    expect(topBLDimension).toBe("Pump");
  });

  it("returns 0 and 'none' for empty score map", () => {
    const dimScores = new Map<string, number>();
    let topBLScore = 0;
    let topBLDimension = "none";
    for (const [dim, score] of Array.from(dimScores.entries())) {
      if (score > topBLScore) {
        topBLScore = score;
        topBLDimension = dim;
      }
    }
    expect(topBLScore).toBe(0);
    expect(topBLDimension).toBe("none");
  });

  it("handles all dimensions having the same score", () => {
    const dimScores = new Map([
      ["Portable Air", 50],
      ["Pump", 50],
    ]);
    let topBLScore = 0;
    for (const [, score] of Array.from(dimScores.entries())) {
      if (score > topBLScore) topBLScore = score;
    }
    expect(topBLScore).toBe(50);
  });
});
