import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  fullPotentialAccounts,
  fullPotentialEvidence,
  fullPotentialModelEvidenceLinks,
  fullPotentialModelLines,
  fullPotentialModelReviews,
  fullPotentialModels,
} from "../drizzle/schema";
import {
  addFullPotentialEvidence,
  createFullPotentialModelDraft,
  reviewFullPotentialEvidence,
} from "./fullPotentialCommercialModel.model";
import { upsertFullPotentialModelLine } from "./fullPotentialCommercialModel.lines";
import {
  reviewFullPotentialModel,
  submitFullPotentialModel,
} from "./fullPotentialCommercialModel.workflow";
import { updateFullPotentialAccountRelationship } from "./fullPotentialCommercialModel.relationships";

const MAIN_KEY = "test-fp-commercial-model-main-v1";
const TARGET_KEY = "test-fp-commercial-model-target-v1";
const DUPLICATE_KEY = "test-fp-commercial-model-duplicate-v1";

const owner = {
  id: 9931,
  name: "FP Model Owner",
  email: "fp-model-owner@example.com",
  role: "user" as const,
};
const otherUser = {
  id: 9932,
  name: "Other FP User",
  email: "other-fp@example.com",
  role: "user" as const,
};
const admin = {
  id: 9933,
  name: "FP Model Admin",
  email: "fp-admin@example.com",
  role: "admin" as const,
};

let mainAccountId = 0;
let targetAccountId = 0;
let duplicateAccountId = 0;
let modelId = 0;
let evidenceId = 0;

async function cleanup() {
  const db = await getDb();
  if (!db) return;

  const accountIds = [mainAccountId, targetAccountId, duplicateAccountId].filter(Boolean);
  if (accountIds.length > 0) {
    const models = await db
      .select({ id: fullPotentialModels.id })
      .from(fullPotentialModels)
      .where(inArray(fullPotentialModels.accountId, accountIds));
    const modelIds = models.map(model => model.id);
    if (modelIds.length > 0) {
      await db
        .delete(fullPotentialModelEvidenceLinks)
        .where(inArray(fullPotentialModelEvidenceLinks.modelId, modelIds));
      await db
        .delete(fullPotentialModelLines)
        .where(inArray(fullPotentialModelLines.modelId, modelIds));
      await db
        .delete(fullPotentialModelReviews)
        .where(inArray(fullPotentialModelReviews.modelId, modelIds));
      await db
        .delete(fullPotentialModels)
        .where(inArray(fullPotentialModels.id, modelIds));
    }
    await db
      .delete(fullPotentialEvidence)
      .where(inArray(fullPotentialEvidence.accountId, accountIds));
  }

  await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.stableKey, MAIN_KEY));
  await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.stableKey, TARGET_KEY));
  await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.stableKey, DUPLICATE_KEY));
}

beforeAll(async () => {
  await cleanup();
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  await db.insert(fullPotentialAccounts).values([
    {
      stableKey: MAIN_KEY,
      canonicalName: "FP Commercial Model Test Account",
      rowClass: "account",
      routeToMarket: "direct_ape",
      fpStatus: "active_target",
      priorityTier: "tier_a",
      platformPushDecision: "push_now",
      currentRevenueAud: "100000.00",
      installedBaseStatus: "partial",
    },
    {
      stableKey: TARGET_KEY,
      canonicalName: "FP Commercial Model Parent Target",
      rowClass: "account",
      routeToMarket: "direct_ape",
      fpStatus: "develop",
      priorityTier: "tier_b",
      platformPushDecision: "qualify_first",
    },
    {
      stableKey: DUPLICATE_KEY,
      canonicalName: "FP Commercial Model Duplicate",
      rowClass: "account",
      routeToMarket: "manual_review",
      fpStatus: "qualify",
      priorityTier: "tier_c",
      platformPushDecision: "qualify_first",
    },
  ]);

  const [main] = await db
    .select({ id: fullPotentialAccounts.id })
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, MAIN_KEY))
    .limit(1);
  const [target] = await db
    .select({ id: fullPotentialAccounts.id })
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, TARGET_KEY))
    .limit(1);
  const [duplicate] = await db
    .select({ id: fullPotentialAccounts.id })
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, DUPLICATE_KEY))
    .limit(1);

  mainAccountId = main.id;
  targetAccountId = target.id;
  duplicateAccountId = duplicate.id;
});

afterAll(cleanup);

describe.sequential("Full Potential V1 commercial model workflow", () => {
  it("creates one active draft per account and returns it idempotently", async () => {
    const first = await createFullPotentialModelDraft(mainAccountId, owner);
    const second = await createFullPotentialModelDraft(mainAccountId, owner);

    expect(first.alreadyExists).toBe(false);
    expect(second.alreadyExists).toBe(true);
    expect(second.model.id).toBe(first.model.id);
    expect(first.model.versionNumber).toBe(1);
    modelId = first.model.id;
  });

  it("prevents another rep from editing the owner's draft", async () => {
    await expect(
      upsertFullPotentialModelLine(
        {
          modelId,
          productFamily: "portable_air_large",
          application: "Rental fleet",
          routeToMarket: "direct_ape",
          knownAtlasFleetUnits: 2,
          estimatedTotalFleetUnits: 20,
          replacementCycleYears: "5",
          averageSellingPriceAud: "150000",
          addressableSharePct: "25",
          confidenceLevel: "medium",
          evidenceIds: [],
        },
        otherUser,
      ),
    ).rejects.toThrow(/model owner/i);
  });

  it("requires linked evidence, calculates potential and requires verification before approval", async () => {
    const evidence = await addFullPotentialEvidence(
      {
        accountId: mainAccountId,
        productFamily: "portable_air_large",
        evidenceType: "customer_discovery",
        title: "Fleet replacement discussion",
        summary: "Customer indicated an estimated 20-unit large-air fleet with a five-year replacement cycle.",
        sourceName: "Customer discovery",
        sourceReference: "Discovery note 2026-07-14",
        confidenceLevel: "medium",
      },
      owner,
    );
    evidenceId = evidence.id;

    const saved = await upsertFullPotentialModelLine(
      {
        modelId,
        productFamily: "portable_air_large",
        application: "Large portable air rental fleet",
        routeToMarket: "direct_ape",
        currentSupplier: "Competitor incumbent",
        knownAtlasFleetUnits: 2,
        estimatedTotalFleetUnits: 20,
        replacementCycleYears: "5",
        averageSellingPriceAud: "150000",
        addressableSharePct: "25",
        specialtyPotentialAud: "50000",
        replacementCycleSource: "Customer discovery",
        assumptions: { fleetEstimate: "customer supplied", priceBasis: "indicative" },
        confidenceLevel: "medium",
        evidenceIds: [evidenceId],
      },
      owner,
    );

    expect(saved.line.equipmentPotentialAud).toBe("150000.00");
    expect(saved.line.linePotentialAud).toBe("200000.00");
    expect(saved.model.totalPotentialAud).toBe("200000.00");
    expect(saved.model.remainingPotentialAud).toBe("100000.00");

    const submitted = await submitFullPotentialModel(
      modelId,
      "Fleet size and replacement cycle are customer-derived; selling price remains indicative pending configuration.",
      owner,
    );
    expect(submitted.status).toBe("submitted");

    await expect(
      reviewFullPotentialModel(modelId, "approve", "Approve the evidence-backed model.", admin),
    ).rejects.toThrow(/verified evidence/i);

    await reviewFullPotentialEvidence(
      evidenceId,
      "verified",
      "Evidence is sufficient for the pilot model.",
      admin,
    );

    const approved = await reviewFullPotentialModel(
      modelId,
      "approve",
      "Approved for the Portable Air Full Potential pilot.",
      admin,
    );
    expect(approved.status).toBe("approved");
    expect(approved.totalPotentialAud).toBe("200000.00");

    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [account] = await db
      .select()
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.id, mainAccountId))
      .limit(1);
    expect(account.fullPotentialAud).toBe("200000.00");
    expect(account.remainingPotentialAud).toBe("100000.00");
    expect(account.evidenceSources).toContain("Customer discovery");
  });

  it("allows a new version only after the prior model is approved", async () => {
    const next = await createFullPotentialModelDraft(mainAccountId, owner);
    expect(next.alreadyExists).toBe(false);
    expect(next.model.versionNumber).toBe(2);
  });

  it("marks duplicate records as non-counting and preserves the record", async () => {
    const updated = await updateFullPotentialAccountRelationship(
      {
        accountId: duplicateAccountId,
        mergedIntoAccountId: targetAccountId,
        parentAccountId: null,
        relationshipType: "duplicate",
        recordStatus: "merged",
        countsTowardPotential: true,
      },
      admin,
    );

    expect(updated.recordStatus).toBe("merged");
    expect(updated.mergedIntoAccountId).toBe(targetAccountId);
    expect(updated.countsTowardPotential).toBe(false);
  });

  it("rejects self-referential account relationships", async () => {
    await expect(
      updateFullPotentialAccountRelationship(
        {
          accountId: targetAccountId,
          parentAccountId: targetAccountId,
          mergedIntoAccountId: null,
          relationshipType: "branch",
          recordStatus: "active",
          countsTowardPotential: true,
        },
        admin,
      ),
    ).rejects.toThrow(/cannot point to itself/i);
  });
});
