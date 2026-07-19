import { describe, expect, it } from "vitest";
import {
  activationWeekLabel,
  buildDailyRecommendation,
  buildDeterministicAiBrief,
  mergeGroundedAiBrief,
  inferProductFamilyHypothesis,
  ownerMatchesActivationUser,
  sortDailyRecommendations,
  type DailyActivationAccount,
  type DailyActivationAction,
  type DailyActivationModel,
  type DailyActivationModelLine,
  type DailyActivationSignal,
  type DailyActivationUser,
  type DailyRecommendationContext,
} from "./fullPotentialDailyActivation.shared";

const NOW = new Date("2026-07-20T09:00:00.000Z");

function user(overrides: Partial<DailyActivationUser> = {}): DailyActivationUser {
  return {
    id: 42,
    name: "Ryan Pemberton",
    email: "ryan@example.com",
    role: "user",
    ...overrides,
  };
}

function account(overrides: Partial<DailyActivationAccount> = {}): DailyActivationAccount {
  return {
    id: 269,
    canonicalName: "Coates Hire",
    displayName: "Coates Hire",
    ownerName: "Ryan Pemberton",
    channelOwner: null,
    state: "National",
    segment: "Rental Hire",
    subsegment: "National hire fleet",
    rowClass: "account",
    routeToMarket: "direct_ape",
    fpStatus: "active_target",
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    currentSupplier: null,
    installedBaseStatus: "unknown",
    nextAction: null,
    nextActionDate: null,
    applicationPlays: ["large air rental fleet"],
    confidenceLevel: "medium",
    recordStatus: "active",
    countsTowardPotential: true,
    ...overrides,
  };
}

function context(overrides: Partial<DailyRecommendationContext> = {}): DailyRecommendationContext {
  return {
    account: account(),
    actions: [],
    signals: [],
    evidence: [],
    models: [],
    lines: [],
    claims: [],
    user: user(),
    weekLabel: activationWeekLabel(NOW),
    now: NOW,
    ...overrides,
  };
}

function approvedModel(overrides: Partial<DailyActivationModel> = {}): DailyActivationModel {
  return {
    id: 5,
    accountId: 269,
    versionNumber: 1,
    status: "approved",
    confidenceLevel: "medium",
    totalPotentialAud: "750000.00",
    remainingPotentialAud: "500000.00",
    createdBy: 42,
    approvedAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

function approvedLine(overrides: Partial<DailyActivationModelLine> = {}): DailyActivationModelLine {
  return {
    id: 11,
    modelId: 5,
    accountId: 269,
    productFamily: "portable_air_large",
    application: "Large-air rental fleet",
    linePotentialAud: "750000.00",
    confidenceLevel: "medium",
    ...overrides,
  };
}

describe("Full Potential daily activation", () => {
  it("matches assigned ownership without requiring an exact case-sensitive string", () => {
    expect(ownerMatchesActivationUser(account({ ownerName: "Ryan Pemberton / Dan Day by site" }), user()))
      .toBe(true);
    expect(ownerMatchesActivationUser(account({ ownerName: "Paul Lueth" }), user()))
      .toBe(false);
    expect(ownerMatchesActivationUser(account({ ownerName: "Paul Lueth" }), user({ role: "admin" })))
      .toBe(true);
  });

  it("recommends evidence capture before unsupported modelling", () => {
    const recommendation = buildDailyRecommendation(context());

    expect(recommendation?.kind).toBe("capture_evidence");
    expect(recommendation?.recommendedAction).toMatch(/fleet or annual spend/i);
    expect(recommendation?.uncertainties).toContain("No verified commercial evidence");
  });

  it("prioritises a grounded hot signal over generic account gaps", () => {
    const signal: DailyActivationSignal = {
      sourceType: "fp_signal",
      sourceId: 17,
      accountId: 269,
      title: "National fleet change-out confirmed",
      summary: "Customer planning team confirmed a fleet replacement review.",
      sourceName: "Customer discovery",
      sourceUrl: "https://example.com/source",
      signalDate: "2026-07-19T00:00:00.000Z",
      urgency: "hot",
      confidence: "high",
      matchReason: "Directly linked Full Potential signal",
      suggestedAction: "Confirm fleet composition and replacement timing with the national fleet manager.",
      productHints: ["large air rental fleet"],
      actionState: { hasOpenAction: false },
    } as DailyActivationSignal;

    const recommendation = buildDailyRecommendation(context({ signals: [signal] }));

    expect(recommendation?.kind).toBe("fresh_signal");
    expect(recommendation?.score).toBeGreaterThan(100);
    expect(recommendation?.sourceType).toBe("fp_signal");
    expect(recommendation?.sourceId).toBe(17);
    expect(recommendation?.sources[0].title).toBe(signal.title);
  });

  it("uses the strongest positive approved model line for the product hypothesis", () => {
    const model = approvedModel();
    const lines = [
      approvedLine({ id: 11, productFamily: "portable_air_large", linePotentialAud: "750000" }),
      approvedLine({ id: 12, productFamily: "generators", application: "Temporary power", linePotentialAud: "120000" }),
    ];

    const hypothesis = inferProductFamilyHypothesis(context({ models: [model], lines }));
    const recommendation = buildDailyRecommendation(context({ models: [model], lines }));

    expect(hypothesis.productFamily).toBe("portable_air_large");
    expect(hypothesis.basis).toBe("approved_model");
    expect(recommendation?.kind).toBe("activate_approved_model");
  });

  it("does not invent a product family when account and signal context are silent", () => {
    const hypothesis = inferProductFamilyHypothesis(context({
      account: account({ segment: "Strategic account", subsegment: null, applicationPlays: [] }),
    }));

    expect(hypothesis.productFamily).toBeNull();
    expect(hypothesis.confidence).toBe("unknown");
    expect(hypothesis.rationale).toMatch(/no evidence-backed/i);
  });

  it("prioritises a returned model over new activity creation", () => {
    const returned = approvedModel({
      status: "returned",
      reviewNotes: "Replacement cycle source needs confirmation.",
      approvedAt: null,
    });
    const recommendation = buildDailyRecommendation(context({ models: [returned] }));

    expect(recommendation?.kind).toBe("returned_model");
    expect(recommendation?.recommendedAction).toMatch(/revise returned model/i);
    expect(recommendation?.score).toBeGreaterThan(110);
  });

  it("surfaces an overdue existing commitment before creating another generic action", () => {
    const overdue: DailyActivationAction = {
      id: 88,
      accountId: 269,
      userId: 42,
      ownerName: "Ryan Pemberton",
      actionType: "customer_call",
      recommendedAction: "Confirm replacement timing with the customer.",
      dueDate: "2026-07-10T00:00:00.000Z",
      status: "not_started",
      createdAt: "2026-07-01T00:00:00.000Z",
    };

    const recommendation = buildDailyRecommendation(context({ actions: [overdue] }));

    expect(recommendation?.kind).toBe("overdue_action");
    expect(recommendation?.existingActionId).toBe(88);
    expect(recommendation?.recommendedAction).toBe(overdue.recommendedAction);
  });

  it("recognises a prior recommendation disposition from the action audit marker", () => {
    const base = buildDailyRecommendation(context());
    expect(base).not.toBeNull();
    const action: DailyActivationAction = {
      id: 101,
      accountId: 269,
      userId: 42,
      ownerName: "Ryan Pemberton",
      actionType: "customer_call",
      recommendedAction: base!.recommendedAction,
      dueDate: "2026-07-25T00:00:00.000Z",
      status: "not_started",
      notes: `[fp_daily:${base!.recommendationKey}]\nFP daily decision: edited`,
      createdAt: "2026-07-20T00:00:00.000Z",
    };

    const recommendation = buildDailyRecommendation(context({ actions: [action] }));

    expect(recommendation?.disposition).toBe("edited");
    expect(recommendation?.existingActionId).toBe(101);
  });

  it("creates a safe grounded brief with questions and explicit warnings", () => {
    const recommendation = buildDailyRecommendation(context());
    expect(recommendation).not.toBeNull();

    const brief = buildDeterministicAiBrief(recommendation!);

    expect(brief.generatedBy).toBe("deterministic_fallback");
    expect(brief.questionsToAsk.length).toBeGreaterThan(0);
    expect(brief.evidenceGaps).toContain("Installed base is unknown");
    expect(brief.warnings.join(" ")).toMatch(/do not infer/i);
    expect(brief.warnings.join(" ")).toMatch(/C4C/i);
  });

  it("sorts pending commercial priorities ahead of already dispositioned items", () => {
    const first = buildDailyRecommendation(context({ account: account({ id: 1, canonicalName: "Alpha" }) }))!;
    const second = {
      ...buildDailyRecommendation(context({ account: account({ id: 2, canonicalName: "Beta" }) }))!,
      score: first.score + 50,
      disposition: "accepted" as const,
    };

    const sorted = sortDailyRecommendations([second, first]);

    expect(sorted[0].disposition).toBe("pending");
    expect(sorted[0].accountId).toBe(1);
  });

  it("does not create a second generic recommendation while an open FP commitment exists", () => {
    const openAction: DailyActivationAction = {
      id: 202,
      accountId: 269,
      userId: 42,
      ownerName: "Ryan Pemberton",
      actionType: "customer_call",
      recommendedAction: "Confirm supplier and fleet age.",
      dueDate: "2026-07-25T00:00:00.000Z",
      status: "not_started",
      createdAt: "2026-07-19T00:00:00.000Z",
    };

    expect(buildDailyRecommendation(context({ actions: [openAction] }))).toBeNull();
  });

  it("suppresses a recently rejected generic recommendation across week boundaries", () => {
    const rejected: DailyActivationAction = {
      id: 203,
      accountId: 269,
      userId: 42,
      ownerName: "Ryan Pemberton",
      actionType: "account_review",
      recommendedAction: "Capture evidence.",
      dueDate: null,
      status: "not_relevant",
      notes: "[fp_daily:fp-2026-07-13-269-capture_evidence-account-0]\nFP daily decision: rejected",
      createdAt: "2026-07-15T00:00:00.000Z",
    };

    const recommendation = buildDailyRecommendation(context({ actions: [rejected] }));
    expect(recommendation?.kind).toBe("capture_evidence");
    expect(recommendation?.disposition).toBe("rejected");
  });


  it("does not create a generic rep recommendation while a submitted model awaits a manager", () => {
    const submitted = approvedModel({ status: "submitted", approvedAt: null });
    expect(buildDailyRecommendation(context({ models: [submitted] }))).toBeNull();
  });

  it("does not add another pursuit action while an existing FP commitment is open", () => {
    const openAction: DailyActivationAction = {
      id: 204,
      accountId: 269,
      userId: 42,
      ownerName: "Ryan Pemberton",
      actionType: "customer_call",
      recommendedAction: "Validate the current pursuit with procurement.",
      dueDate: "2026-07-25T00:00:00.000Z",
      status: "not_started",
      createdAt: "2026-07-19T00:00:00.000Z",
    };
    const claim = {
      id: 301,
      accountId: 269,
      userId: 42,
      status: "identified",
      nextAction: "Confirm the decision process.",
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    };

    expect(buildDailyRecommendation(context({ actions: [openAction], claims: [claim] }))).toBeNull();
  });

  it("keeps AI narrative from changing deterministic commercial facts", () => {
    const recommendation = buildDailyRecommendation(context())!;
    const brief = mergeGroundedAiBrief(recommendation, {
      accountBrief: "Ask the customer to validate the unknown evidence.",
      questionsToAsk: ["What equipment is in the fleet?"],
    });

    expect(brief.generatedBy).toBe("ai");
    expect(brief.accountBrief).toMatch(/validate the unknown evidence/i);
    expect(brief.whyNow).toBe(recommendation.whyNow);
    expect(brief.evidenceGaps).toEqual(recommendation.uncertainties);
    expect(brief.productFamilyHypothesis).toEqual(recommendation.productHypothesis);
    expect(brief.recommendedAction).toBe(recommendation.recommendedAction);
    expect(brief.expectedOutcome).toBe(recommendation.expectedOutcome);
    expect(brief.sources).toEqual(recommendation.sources);
  });

});
