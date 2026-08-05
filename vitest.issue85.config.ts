import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Focused Issue #85 suite. The application Vite config sets `root: client`,
 * which otherwise makes server-side security tests invisible to `vitest`.
 */
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
      "server/contactSelector.issue85.test.ts",
      "server/contactSlateTrustPolicy.test.ts",
      "server/contactSlateTrustPolicy.issue85.test.ts",
      "server/contactValidationState.test.ts",
      "server/projectOutreachGuard.test.ts",
      "server/outreachTrustBoundary.static.test.ts",
      "server/outreachContactProjection.test.ts",
      "server/projectOutreachExecution.test.ts",
      "server/_core/llmErrors.test.ts",
      "server/_core/llm.behavior.test.ts",
      "server/outreachEmailFallback.test.ts",
      "server/outreachEmail.quotaFallback.test.ts",
      "server/outreachEmail.test.ts",
      "server/outreachTemplates.quotaFallback.test.ts",
      "server/pumpFlowLane.test.ts",
      "server/report.test.ts",
      "client/src/lib/projectOutreachEligibility.test.ts",
      "client/src/lib/homeOutreachIdentity.test.ts",
      "client/src/components/outreachClientTrustBoundary.static.test.ts",
    ],
  },
});
