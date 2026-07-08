import { relations } from "drizzle-orm";
import {
  fullPotentialAccounts,
  fullPotentialAccountAliases,
  fullPotentialSignals,
  fullPotentialActions,
  fullPotentialImports,
} from "./schema";
import { users, projects } from "./schema";

// ─── Full Potential relations ─────────────────────────────────────────────────

export const fullPotentialAccountsRelations = relations(
  fullPotentialAccounts,
  ({ many }) => ({
    aliases: many(fullPotentialAccountAliases),
    signals: many(fullPotentialSignals),
    actions: many(fullPotentialActions),
  })
);

export const fullPotentialAccountAliasesRelations = relations(
  fullPotentialAccountAliases,
  ({ one }) => ({
    account: one(fullPotentialAccounts, {
      fields: [fullPotentialAccountAliases.accountId],
      references: [fullPotentialAccounts.id],
    }),
  })
);

export const fullPotentialSignalsRelations = relations(
  fullPotentialSignals,
  ({ one }) => ({
    account: one(fullPotentialAccounts, {
      fields: [fullPotentialSignals.accountId],
      references: [fullPotentialAccounts.id],
    }),
    project: one(projects, {
      fields: [fullPotentialSignals.projectId],
      references: [projects.id],
    }),
  })
);

export const fullPotentialActionsRelations = relations(
  fullPotentialActions,
  ({ one }) => ({
    account: one(fullPotentialAccounts, {
      fields: [fullPotentialActions.accountId],
      references: [fullPotentialAccounts.id],
    }),
    signal: one(fullPotentialSignals, {
      fields: [fullPotentialActions.signalId],
      references: [fullPotentialSignals.id],
    }),
    user: one(users, {
      fields: [fullPotentialActions.userId],
      references: [users.id],
    }),
  })
);

export const fullPotentialImportsRelations = relations(
  fullPotentialImports,
  ({ one }) => ({
    importedByUser: one(users, {
      fields: [fullPotentialImports.importedBy],
      references: [users.id],
    }),
  })
);
