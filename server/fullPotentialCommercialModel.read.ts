import { TRPCError } from "@trpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  fullPotentialAccountAliases,
  fullPotentialAccounts,
  fullPotentialEvidence,
  fullPotentialModelEvidenceLinks,
  fullPotentialModelLines,
  fullPotentialModelReviews,
  fullPotentialModels,
} from "../drizzle/schema";

export async function getFullPotentialCommercialWorkspace(accountId: number) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }

  const [account] = await db
    .select()
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.id, accountId))
    .limit(1);
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Full Potential account not found" });
  }

  const [aliases, children, models, evidence] = await Promise.all([
    db
      .select()
      .from(fullPotentialAccountAliases)
      .where(eq(fullPotentialAccountAliases.accountId, accountId))
      .orderBy(desc(fullPotentialAccountAliases.createdAt)),
    db
      .select()
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.parentAccountId, accountId))
      .orderBy(fullPotentialAccounts.canonicalName),
    db
      .select()
      .from(fullPotentialModels)
      .where(eq(fullPotentialModels.accountId, accountId))
      .orderBy(desc(fullPotentialModels.versionNumber)),
    db
      .select()
      .from(fullPotentialEvidence)
      .where(eq(fullPotentialEvidence.accountId, accountId))
      .orderBy(desc(fullPotentialEvidence.createdAt)),
  ]);

  const modelIds = models.map(model => model.id);
  const [lines, evidenceLinks, reviews] = modelIds.length > 0
    ? await Promise.all([
        db
          .select()
          .from(fullPotentialModelLines)
          .where(inArray(fullPotentialModelLines.modelId, modelIds))
          .orderBy(fullPotentialModelLines.productFamily, fullPotentialModelLines.application),
        db
          .select()
          .from(fullPotentialModelEvidenceLinks)
          .where(inArray(fullPotentialModelEvidenceLinks.modelId, modelIds))
          .orderBy(fullPotentialModelEvidenceLinks.id),
        db
          .select()
          .from(fullPotentialModelReviews)
          .where(inArray(fullPotentialModelReviews.modelId, modelIds))
          .orderBy(desc(fullPotentialModelReviews.createdAt)),
      ])
    : [[], [], []];

  return {
    account,
    aliases,
    children,
    models,
    latestModel: models[0] ?? null,
    approvedModel: models.find(model => model.status === "approved") ?? null,
    lines,
    evidence,
    evidenceLinks,
    reviews,
  };
}
