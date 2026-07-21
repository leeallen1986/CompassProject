import { describe, expect, it } from "vitest";
import {
  APOLLO_DAILY_CREDIT_CAP,
  hasCredibleBuyingRoute,
  selectLinkedInPersonMatch,
  shouldPromoteHunterResult,
  toPersistedContractorHypothesis,
  unverifiedContactEmail,
} from "./intelligenceTrustPolicy";

describe("intelligence and contact trust policy", () => {
  it("never promotes an LLM-only contractor hypothesis to confirmed", () => {
    const result = toPersistedContractorHypothesis({
      name: "Example Civil",
      role: "contractor",
      confidence: "high",
      detail: "Has won similar work in the state",
    });
    expect(result.status).toBe("Predicted");
    expect(result.confidence).toBeLessThan(85);
    expect(result.detail).toContain("LLM hypothesis; unverified");
  });

  it("selects an exact LinkedIn name match", () => {
    const people = [{ fullName: "Alex Morgan", id: 1 }, { fullName: "Taylor Lee", id: 2 }];
    expect(selectLinkedInPersonMatch("Alex Morgan", people)?.id).toBe(1);
  });

  it("allows one unambiguous first-and-last-name match", () => {
    const people = [{ fullName: "Alex J Morgan", id: 1 }, { fullName: "Taylor Lee", id: 2 }];
    expect(selectLinkedInPersonMatch("Alex Morgan", people)?.id).toBe(1);
  });

  it("does not fall back to the first LinkedIn search result", () => {
    const people = [{ fullName: "Wrong Person", id: 1 }, { fullName: "Another Result", id: 2 }];
    expect(selectLinkedInPersonMatch("Alex Morgan", people)).toBeNull();
  });

  it("does not persist guessed email patterns", () => {
    expect(unverifiedContactEmail()).toBeNull();
  });

  it("promotes only valid Hunter mailbox evidence", () => {
    expect(shouldPromoteHunterResult({ status: "valid", score: 85 })).toBe(true);
    expect(shouldPromoteHunterResult({ status: "accept_all", score: 99 })).toBe(false);
    expect(shouldPromoteHunterResult({ status: "valid", score: 69 })).toBe(false);
    expect(shouldPromoteHunterResult({ status: "valid", score: 90, disposable: true })).toBe(false);
  });

  it("requires confirmed relationship evidence or explicit direct CAPEX", () => {
    expect(hasCredibleBuyingRoute({
      owner: "Mine Owner Pty Ltd",
      opportunityRoute: "Direct CAPEX",
      contractors: [],
    })).toBe(true);
    expect(hasCredibleBuyingRoute({
      owner: "Government Department",
      opportunityRoute: "Fleet CAPEX",
      contractors: [{ name: "Confirmed Civil", status: "Confirmed" }],
    })).toBe(true);
    expect(hasCredibleBuyingRoute({
      owner: "Government Department",
      opportunityRoute: "Fleet CAPEX",
      contractors: [{ name: "Likely Civil", status: "Predicted" }],
    })).toBe(false);
  });

  it("uses one shared conservative automatic Apollo daily cap", () => {
    expect(APOLLO_DAILY_CREDIT_CAP).toBe(200);
  });
});
