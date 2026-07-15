import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { fullPotentialAccounts } from "../drizzle/schema";
import type { FullPotentialAccount } from "../drizzle/schema";
import type {
  FullPotentialActor,
  RecordStatus,
  RelationshipType,
} from "./fullPotentialCommercialModel.shared";

export interface FullPotentialRelationshipInput {
  accountId: number;
  parentAccountId?: number | null;
  mergedIntoAccountId?: number | null;
  relationshipType: RelationshipType;
  recordStatus: RecordStatus;
  countsTowardPotential: boolean;
}

export async function updateFullPotentialAccountRelationship(
  input: FullPotentialRelationshipInput,
  actor: FullPotentialActor,
) {
  if (actor.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only an admin can change Full Potential account relationships",
    });
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }

  return db.transaction(async tx => {
    const [account] = await tx
      .select()
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.id, input.accountId))
      .limit(1);
    if (!account) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Full Potential account not found" });
    }

    if (input.parentAccountId === input.accountId || input.mergedIntoAccountId === input.accountId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "An account cannot point to itself" });
    }

    const referencedIds = [...new Set(
      [input.parentAccountId, input.mergedIntoAccountId]
        .filter((id): id is number => id !== null && id !== undefined),
    )];

    if (referencedIds.length > 0) {
      const referenced = await tx
        .select()
        .from(fullPotentialAccounts)
        .where(inArray(fullPotentialAccounts.id, referencedIds));
      if (referenced.length !== referencedIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A referenced parent or merge target does not exist",
        });
      }
      if (
        referenced.some((row: FullPotentialAccount) =>
          row.parentAccountId === input.accountId || row.mergedIntoAccountId === input.accountId,
        )
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Relationship would create a direct cycle" });
      }
    }

    if (input.recordStatus === "merged" && !input.mergedIntoAccountId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Merged records require mergedIntoAccountId" });
    }
    if (input.relationshipType === "duplicate" && !input.mergedIntoAccountId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Duplicate records require a merge target" });
    }

    const countsTowardPotential =
      input.recordStatus === "merged" ||
      input.recordStatus === "excluded" ||
      input.mergedIntoAccountId
        ? false
        : input.countsTowardPotential;

    await tx
      .update(fullPotentialAccounts)
      .set({
        parentAccountId: input.parentAccountId ?? null,
        mergedIntoAccountId: input.mergedIntoAccountId ?? null,
        relationshipType: input.relationshipType,
        recordStatus: input.recordStatus,
        countsTowardPotential,
      })
      .where(eq(fullPotentialAccounts.id, input.accountId));

    const [updated] = await tx
      .select()
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.id, input.accountId))
      .limit(1);

    return updated;
  });
}
