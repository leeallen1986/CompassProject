import path from "node:path";
import { defineConfig } from "vitest/config";

/** Provider- and database-free focused suite for Issue #86. */
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    include: [
      "client/src/components/ProjectCard.issue86.static.test.ts",
      "client/src/components/ProjectCard.test.ts",
      "client/src/components/outreachQuotaUx.static.test.ts",
      "client/src/lib/outreachComposerState.test.ts",
      "client/src/lib/projectBuyerRouteView.test.ts",
      "server/_core/llm.behavior.test.ts",
      "server/_core/llmErrors.test.ts",
      "server/emailDigestContactProjection.issue86.test.ts",
      "server/issue86Regression.static.test.ts",
      "server/outreachDraftTelemetry.test.ts",
      "server/outreachEmail.quotaFallback.test.ts",
      "server/outreachEmailFallback.test.ts",
      "server/outreachTemplates.quotaFallback.test.ts",
      "server/projectBuyerRoute.db.static.test.ts",
      "server/projectBuyerRoute.router.test.ts",
      "server/projectBuyerRoute.test.ts",
      "server/projectEvidenceMigration.issue86.test.ts",
      "server/ryanPortfolioAudit.shared.test.ts",
      "server/thisWeekContactSelection.issue86.test.ts",
    ],
  },
});
