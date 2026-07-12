/**
 * Sprint 2A pipeline attribution and conversion controls.
 *
 * These tests call the real tRPC procedures and persist to the configured
 * non-production test database. They must never be run against production.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { appRouter } from "./routers";
import { getDb } from "./db";
import {
  outreachEmails,
  pipelineActivity,
  pipelineClaims,
  userActivity,
} from "../drizzle/schema";
import {
  fullPotentialAccounts,
} from "../drizzle/fullPotentialSchema";
import type {
  TrpcContext,
} from "./_core/context";
import type { User } from "../drizzle/schema";
import type {
  FpProductFamily,
} from "@shared/const";

const USER_A = 9901;
const MAIN_KEY =
  "test-pipeline-attribution-v3";
const INELIGIBLE_KEY =
  "test-pipeline-attribution-ineligible-v3";

let mainAccountId = 0;
let ineligibleAccountId = 0;
let sequence = 0;

function makeUser(
  overrides: Partial<User> = {},
): User {
  return {
    id: USER_A,
    openId: "pipeline-test-user",
    email: "pipeline-test@example.com",
    name: "Pipeline Test User",
    loginMethod: "manus",
    role: "user",
    campaignAccess: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  } as User;
}

function makeCtx(
  user: User | null,
): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function futureDate(days = 7): Date {
  return new Date(
    Date.now() +
      days * 24 * 60 * 60 * 1000,
  );
}

function fpInput(
  scope: string,
  productFamily:
    FpProductFamily =
      "portable_air_large",
  overrides:
    Record<string, unknown> = {},
) {
  sequence += 1;

  return {
    sourceAccountId: mainAccountId,
    productFamily,
    application:
      `Rental application ` +
      `${scope}-${sequence}`,
    commercialHypothesis:
      "The account has an addressable " +
      "replacement or expansion need that " +
      "requires customer validation.",
    nextAction:
      "Contact the fleet decision maker " +
      "and validate the requirement.",
    nextActionDate: futureDate(),
    ...overrides,
  } as any;
}

async function seedAccounts(): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("DB unavailable");
  }

  await db
    .delete(fullPotentialAccounts)
    .where(eq(
      fullPotentialAccounts.stableKey,
      MAIN_KEY,
    ));
  await db
    .delete(fullPotentialAccounts)
    .where(eq(
      fullPotentialAccounts.stableKey,
      INELIGIBLE_KEY,
    ));

  await db
    .insert(fullPotentialAccounts)
    .values([
      {
        stableKey: MAIN_KEY,
        canonicalName:
          "Pipeline Attribution Test Account",
        rowClass: "account",
        routeToMarket: "direct_ape",
        fpStatus: "develop",
        priorityTier: "tier_a",
        platformPushDecision: "push_now",
        installedBaseStatus: "unknown",
      },
      {
        stableKey: INELIGIBLE_KEY,
        canonicalName:
          "Pipeline Attribution Competitor Shadow",
        rowClass: "competitor_watch",
        routeToMarket: "manual_review",
        fpStatus: "watch",
        priorityTier: "tier_c",
        platformPushDecision:
          "park_do_not_push",
        installedBaseStatus:
          "not_applicable",
      },
    ] as any);

  const [main] = await db
    .select({
      id: fullPotentialAccounts.id,
    })
    .from(fullPotentialAccounts)
    .where(eq(
      fullPotentialAccounts.stableKey,
      MAIN_KEY,
    ))
    .limit(1);

  const [ineligible] = await db
    .select({
      id: fullPotentialAccounts.id,
    })
    .from(fullPotentialAccounts)
    .where(eq(
      fullPotentialAccounts.stableKey,
      INELIGIBLE_KEY,
    ))
    .limit(1);

  mainAccountId = main.id;
  ineligibleAccountId = ineligible.id;
}

async function cleanup(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const accountIds = [
    mainAccountId,
    ineligibleAccountId,
  ].filter(Boolean);

  for (const accountId of accountIds) {
    const claims = await db
      .select({
        id: pipelineClaims.id,
      })
      .from(pipelineClaims)
      .where(eq(
        pipelineClaims.sourceAccountId,
        accountId,
      ));

    for (const claim of claims) {
      await db
        .delete(outreachEmails)
        .where(eq(
          outreachEmails.claimId,
          claim.id,
        ));
      await db
        .delete(pipelineActivity)
        .where(eq(
          pipelineActivity.claimId,
          claim.id,
        ));
      await db
        .delete(userActivity)
        .where(eq(
          userActivity.claimId,
          claim.id,
        ));
    }

    await db
      .delete(pipelineClaims)
      .where(eq(
        pipelineClaims.sourceAccountId,
        accountId,
      ));
  }

  await db
    .delete(fullPotentialAccounts)
    .where(eq(
      fullPotentialAccounts.stableKey,
      MAIN_KEY,
    ));
  await db
    .delete(fullPotentialAccounts)
    .where(eq(
      fullPotentialAccounts.stableKey,
      INELIGIBLE_KEY,
    ));
}

describe(
  "Sprint 2A pipeline attribution",
  () => {
    beforeAll(seedAccounts);
    afterAll(cleanup);

    it(
      "creates an evidence-backed FP opportunity " +
        "with initial audit rows",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const result =
          await caller.pipeline.claimFromFP(
            fpInput(
              "create",
              "portable_air_large",
            ),
          );

        expect(result.alreadyExists)
          .toBe(false);
        expect(result.claimId)
          .toBeGreaterThan(0);

        const db = await getDb();
        if (!db) {
          throw new Error("DB unavailable");
        }

        const [claim] = await db
          .select()
          .from(pipelineClaims)
          .where(eq(
            pipelineClaims.id,
            result.claimId,
          ))
          .limit(1);

        expect(claim.sourceType)
          .toBe("full_potential");
        expect(claim.projectId).toBeNull();
        expect(claim.reportId).toBeNull();
        expect(claim.openDedupeKey)
          .toBeTruthy();

        const activities = await db
          .select()
          .from(pipelineActivity)
          .where(eq(
            pipelineActivity.claimId,
            result.claimId,
          ));

        const userActivities = await db
          .select()
          .from(userActivity)
          .where(eq(
            userActivity.claimId,
            result.claimId,
          ));

        expect(
          activities.some(
            row =>
              row.eventType ===
              "claim_created",
          ),
        ).toBe(true);
        expect(
          userActivities.some(
            row =>
              row.actionType ===
              "pipeline_claimed",
          ),
        ).toBe(true);
      },
    );

    it(
      "rejects missing required " +
        "identified-stage evidence",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const valid =
          fpInput("missing-evidence");

        await expect(
          caller.pipeline.claimFromFP({
            ...valid,
            application: "",
          }),
        ).rejects.toThrow();
        await expect(
          caller.pipeline.claimFromFP({
            ...valid,
            commercialHypothesis: "",
          }),
        ).rejects.toThrow();
        await expect(
          caller.pipeline.claimFromFP({
            ...valid,
            nextAction: "",
          }),
        ).rejects.toThrow();
        await expect(
          caller.pipeline.claimFromFP({
            ...valid,
            nextActionDate: undefined,
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects an unknown or ineligible " +
        "Full Potential record",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );

        await expect(
          caller.pipeline.claimFromFP({
            ...fpInput("missing-account"),
            sourceAccountId: 2_147_000_000,
          }),
        ).rejects.toThrow(/not found/i);

        await expect(
          caller.pipeline.claimFromFP({
            ...fpInput("ineligible-account"),
            sourceAccountId:
              ineligibleAccountId,
          }),
        ).rejects.toThrow(/not eligible/i);
      },
    );

    it(
      "rejects invalid product family " +
        "and non-positive AUD values",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );

        await expect(
          caller.pipeline.claimFromFP({
            ...fpInput("bad-family"),
            productFamily:
              "portable_air" as any,
          }),
        ).rejects.toThrow();

        await expect(
          caller.pipeline.claimFromFP({
            ...fpInput("bad-value"),
            estimatedValueAud: "$100,000",
          }),
        ).rejects.toThrow();

        await expect(
          caller.pipeline.claimFromFP({
            ...fpInput("zero-value"),
            estimatedValueAud: "0",
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "blocks distributors from FP creation " +
        "and account visibility",
      async () => {
        const distributor =
          appRouter.createCaller(
            makeCtx(makeUser({
              id: 9903,
              role: "distributor",
            })),
          );

        await expect(
          distributor.pipeline.claimFromFP(
            fpInput("distributor"),
          ),
        ).rejects.toThrow(/distributor/i);

        await expect(
          distributor.pipeline.byAccount({
            sourceAccountId:
              mainAccountId,
          }),
        ).rejects.toThrow(/distributor/i);
      },
    );

    it(
      "deduplicates concurrent creation " +
        "safely and returns one claim ID",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const input = fpInput(
          "concurrent",
          "specialty_air_boosters",
        );

        const [first, second] =
          await Promise.all([
            caller.pipeline.claimFromFP(
              input,
            ),
            caller.pipeline.claimFromFP(
              input,
            ),
          ]);

        expect(first.claimId)
          .toBe(second.claimId);
        expect(
          [
            first.alreadyExists,
            second.alreadyExists,
          ].sort(),
        ).toEqual([false, true]);
      },
    );

    it(
      "allows separate open applications " +
        "for one account and family",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );

        const first =
          await caller.pipeline.claimFromFP(
            fpInput(
              "application-a",
              "e_air",
            ),
          );
        const second =
          await caller.pipeline.claimFromFP(
            fpInput(
              "application-b",
              "e_air",
            ),
          );

        expect(first.claimId)
          .not.toBe(second.claimId);
      },
    );

    it(
      "enforces legal transitions and " +
        "prevents the legacy bypass",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const { claimId } =
          await caller.pipeline.claimFromFP(
            fpInput(
              "transition-matrix",
              "dryers",
            ),
          );

        await expect(
          caller.pipeline.advanceStage({
            claimId,
            toStatus: "won",
            note: "Illegal jump",
          }),
        ).rejects.toThrow(/not allowed/i);

        await expect(
          caller.pipeline.updateStatus({
            claimId,
            status: "contacted",
            notes: "Called switchboard",
          }),
        ).rejects.toThrow(
          /contactName or contactRole/i,
        );
      },
    );

    it(
      "requires a contact or role and " +
        "activity evidence for contacted",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const { claimId } =
          await caller.pipeline.claimFromFP(
            fpInput(
              "contacted",
              "nitrogen",
            ),
          );

        await expect(
          caller.pipeline.advanceStage({
            claimId,
            toStatus: "contacted",
            contactRole: "Fleet Manager",
          }),
        ).rejects.toThrow(
          /activity evidence/i,
        );

        await expect(
          caller.pipeline.advanceStage({
            claimId,
            toStatus: "contacted",
            contactRole: "Fleet Manager",
            note:
              "Spoke to reception and " +
              "confirmed the target role.",
          }),
        ).resolves.toEqual({
          success: true,
        });
      },
    );

    it(
      "requires meeting date and " +
        "objective for meeting_booked",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const { claimId } =
          await caller.pipeline.claimFromFP(
            fpInput(
              "meeting",
              "portable_air_small_medium",
            ),
          );

        await caller.pipeline.advanceStage({
          claimId,
          toStatus: "contacted",
          contactName: "Jamie Fleet",
          note: "Customer returned the call.",
        });

        await expect(
          caller.pipeline.advanceStage({
            claimId,
            toStatus: "meeting_booked",
            nextActionDate: futureDate(5),
          }),
        ).rejects.toThrow(
          /meetingObjective/i,
        );

        await expect(
          caller.pipeline.advanceStage({
            claimId,
            toStatus: "meeting_booked",
            nextActionDate: futureDate(5),
            meetingObjective:
              "Validate fleet size, supplier " +
              "mix, and replacement timing.",
          }),
        ).resolves.toEqual({
          success: true,
        });
      },
    );

    it(
      "requires the complete commercial " +
        "qualification set",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const { claimId } =
          await caller.pipeline.claimFromFP(
            fpInput(
              "qualified",
              "portable_air_large",
            ),
          );

        await caller.pipeline.advanceStage({
          claimId,
          toStatus: "contacted",
          contactName: "Taylor Buyer",
          note: "Discovery call completed.",
        });

        const base = {
          claimId,
          toStatus: "qualified" as const,
          estimatedValueAud: "250000",
          customerNeed:
            "Replace ageing large-air " +
            "fleet used on shutdown projects.",
          decisionTiming:
            "Capital review in Q4 2026.",
          competitivePosition:
            "Incumbent is Sullair; fuel " +
            "efficiency is the opening.",
          nextAction:
            "Schedule technical fleet review.",
          nextActionDate: futureDate(10),
        };

        await expect(
          caller.pipeline.advanceStage({
            ...base,
            customerNeed: "",
          }),
        ).rejects.toThrow();

        await expect(
          caller.pipeline.advanceStage(base),
        ).resolves.toEqual({
          success: true,
        });
      },
    );

    it(
      "requires quote value, decision date, " +
        "and follow-up",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const { claimId } =
          await caller.pipeline.claimFromFP(
            fpInput(
              "quoted",
              "generators",
            ),
          );

        await caller.pipeline.advanceStage({
          claimId,
          toStatus: "contacted",
          contactName: "Alex Procurement",
          note:
            "Qualified stakeholder confirmed.",
        });

        await caller.pipeline.advanceStage({
          claimId,
          toStatus: "qualified",
          estimatedValueAud: "180000",
          customerNeed:
            "Temporary power fleet replacement.",
          decisionTiming:
            "Tender closes next month.",
          competitivePosition:
            "Atlas is shortlisted with " +
            "two competitors.",
          nextAction:
            "Prepare commercial proposal.",
          nextActionDate: futureDate(4),
        });

        await expect(
          caller.pipeline.advanceStage({
            claimId,
            toStatus: "quoted",
            closeDate: futureDate(30),
            nextAction:
              "Follow up proposal.",
            nextActionDate: futureDate(7),
          }),
        ).rejects.toThrow(/quoteValueAud/i);

        await expect(
          caller.pipeline.advanceStage({
            claimId,
            toStatus: "quoted",
            quoteValueAud: "175000",
            closeDate: futureDate(30),
            nextAction:
              "Follow up proposal.",
            nextActionDate: futureDate(7),
          }),
        ).resolves.toEqual({
          success: true,
        });
      },
    );

    it(
      "requires outcome reasons and a " +
        "re-engagement date for deferred",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );

        const deferred =
          await caller.pipeline.claimFromFP(
            fpInput(
              "deferred",
              "lighting",
            ),
          );

        await expect(
          caller.pipeline.advanceStage({
            claimId: deferred.claimId,
            toStatus: "deferred",
            note:
              "Budget moved to next year.",
          }),
        ).rejects.toThrow(
          /re-engagement date/i,
        );

        await caller.pipeline.advanceStage({
          claimId: deferred.claimId,
          toStatus: "deferred",
          note:
            "Budget moved to next year.",
          nextActionDate: futureDate(90),
        });

        await expect(
          caller.pipeline.advanceStage({
            claimId: deferred.claimId,
            toStatus: "identified",
          }),
        ).resolves.toEqual({
          success: true,
        });

        const notRelevant =
          await caller.pipeline.claimFromFP(
            fpInput(
              "not-relevant",
              "other",
            ),
          );

        await expect(
          caller.pipeline.advanceStage({
            claimId:
              notRelevant.claimId,
            toStatus: "not_relevant",
          }),
        ).rejects.toThrow(
          /outcome reason/i,
        );
      },
    );

    it(
      "clears terminal dedupe and allows " +
        "a later legitimate cycle",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const input = fpInput(
          "new-cycle",
          "bess",
        );
        const first =
          await caller.pipeline.claimFromFP(
            input,
          );

        await caller.pipeline.advanceStage({
          claimId: first.claimId,
          toStatus: "contacted",
          contactName: "Morgan Energy",
          note: "Discovery call completed.",
        });
        await caller.pipeline.advanceStage({
          claimId: first.claimId,
          toStatus: "qualified",
          estimatedValueAud: "500000",
          customerNeed:
            "Battery-backed temporary " +
            "power requirement.",
          decisionTiming:
            "Award expected this quarter.",
          competitivePosition:
            "Open specification.",
          nextAction:
            "Prepare solution concept.",
          nextActionDate: futureDate(3),
        });
        await caller.pipeline.advanceStage({
          claimId: first.claimId,
          toStatus: "lost",
          note: "Project scope cancelled.",
        });

        const second =
          await caller.pipeline.claimFromFP(
            input,
          );

        expect(second.alreadyExists)
          .toBe(false);
        expect(second.claimId)
          .not.toBe(first.claimId);
      },
    );

    it(
      "does not partially update or audit " +
        "an illegal transition",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const { claimId } =
          await caller.pipeline.claimFromFP(
            fpInput(
              "atomicity",
              "dryers",
            ),
          );

        const db = await getDb();
        if (!db) {
          throw new Error("DB unavailable");
        }

        const beforeActivities = await db
          .select({
            id: pipelineActivity.id,
          })
          .from(pipelineActivity)
          .where(eq(
            pipelineActivity.claimId,
            claimId,
          ));

        await expect(
          caller.pipeline.advanceStage({
            claimId,
            toStatus: "quoted",
            quoteValueAud: "100000",
            closeDate: futureDate(30),
            nextAction: "Follow up.",
            nextActionDate: futureDate(),
          }),
        ).rejects.toThrow(/not allowed/i);

        const [claim] = await db
          .select({
            status: pipelineClaims.status,
          })
          .from(pipelineClaims)
          .where(eq(
            pipelineClaims.id,
            claimId,
          ))
          .limit(1);

        const afterActivities = await db
          .select({
            id: pipelineActivity.id,
          })
          .from(pipelineActivity)
          .where(eq(
            pipelineActivity.claimId,
            claimId,
          ));

        expect(claim.status)
          .toBe("identified");
        expect(afterActivities)
          .toHaveLength(
            beforeActivities.length,
          );
      },
    );

    it(
      "preserves legacy project claims " +
        "through the transition service",
      async () => {
        const db = await getDb();
        if (!db) {
          throw new Error("DB unavailable");
        }

        const result = await db
          .insert(pipelineClaims)
          .values({
            userId: USER_A,
            projectId: 1,
            reportId: 1,
            sourceType: "project",
            status: "identified",
            estimatedValue: "$100k",
          } as any);

        const claimId = Number(
          result[0].insertId,
        );

        try {
          const caller =
            appRouter.createCaller(
              makeCtx(makeUser()),
            );

          await expect(
            caller.pipeline.updateStatus({
              claimId,
              status: "contacted",
              contactRole:
                "Project Manager",
              notes:
                "Confirmed the project " +
                "stakeholder role.",
              estimatedValue: "$100k",
            }),
          ).resolves.toEqual({
            success: true,
          });
        } finally {
          await db
            .delete(pipelineActivity)
            .where(eq(
              pipelineActivity.claimId,
              claimId,
            ));
          await db
            .delete(userActivity)
            .where(eq(
              userActivity.claimId,
              claimId,
            ));
          await db
            .delete(pipelineClaims)
            .where(eq(
              pipelineClaims.id,
              claimId,
            ));
        }
      },
    );

    it(
      "returns account claims internally but " +
        "not in project-only accountAttack queries",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const { claimId } =
          await caller.pipeline.claimFromFP(
            fpInput(
              "visibility",
              "portable_air_large",
            ),
          );

        const claims =
          await caller.pipeline.byAccount({
            sourceAccountId:
              mainAccountId,
          });
        expect(
          claims.some(
            row => row.id === claimId,
          ),
        ).toBe(true);

        const db = await getDb();
        if (!db) {
          throw new Error("DB unavailable");
        }

        const projectOnly = await db
          .select({
            id: pipelineClaims.id,
          })
          .from(pipelineClaims)
          .where(and(
            eq(
              pipelineClaims.id,
              claimId,
            ),
            isNotNull(
              pipelineClaims.projectId,
            ),
          ));

        expect(projectOnly).toHaveLength(0);
      },
    );

    it(
      "persists attribution and outreach " +
        "timestamps through the real router",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const { claimId } =
          await caller.pipeline.claimFromFP(
            fpInput(
              "outreach",
              "specialty_air_boosters",
            ),
          );

        const saved =
          await caller.outreach.save({
            contactName: "Casey Fleet",
            contactEmail:
              "casey@example.com",
            subject: "Fleet discussion",
            body:
              "A concise test email.",
            tone: "consultative",
            status: "sent",
            claimId,
            sourceAccountId:
              mainAccountId,
          });

        const db = await getDb();
        if (!db) {
          throw new Error("DB unavailable");
        }

        const [row] = await db
          .select()
          .from(outreachEmails)
          .where(eq(
            outreachEmails.id,
            saved.id,
          ))
          .limit(1);

        expect(row.claimId).toBe(claimId);
        expect(row.sourceAccountId)
          .toBe(mainAccountId);
        expect(row.sentAt)
          .toBeInstanceOf(Date);

        await db
          .delete(outreachEmails)
          .where(eq(
            outreachEmails.id,
            saved.id,
          ));
      },
    );

    it(
      "rejects outreach attribution that " +
        "does not match the claim",
      async () => {
        const caller = appRouter.createCaller(
          makeCtx(makeUser()),
        );
        const { claimId } =
          await caller.pipeline.claimFromFP(
            fpInput(
              "bad-outreach",
              "nitrogen",
            ),
          );

        await expect(
          caller.outreach.save({
            contactName: "Wrong Account",
            subject: "Mismatch",
            body: "Test",
            tone: "direct",
            status: "drafted",
            claimId,
            sourceAccountId:
              ineligibleAccountId,
          }),
        ).rejects.toThrow(
          /does not match/i,
        );
      },
    );
  },
);
