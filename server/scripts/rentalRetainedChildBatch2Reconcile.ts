const message = [
  "PR #79 retained-child batch-2 reconciliation v3 is permanently retired.",
  "",
  "Reason:",
  "  account 272 is United Rentals, not Kennards Hire;",
  "  the proposed 332 -> 272 relationship is commercially false.",
  "",
  "The rejected v3 draft must not be generated, sealed or applied.",
  "Use the controller-reviewed corrected v4 CLI instead:",
  "  server/scripts/rentalRetainedChildBatch2CorrectionReconcile.ts",
].join("\n");

console.error(message);
process.exit(1);
