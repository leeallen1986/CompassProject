const RETIRED_MESSAGE = [
  "PR #76 Rental relationship manifest v1 is retired.",
  "Do not generate, seal or apply the non-counting safe_attach_context draft.",
  "Use server/scripts/rentalRetainedChildReconcile.ts for the controller-approved v2 retained-child relationship flow.",
].join(" ");

function usage(): string {
  return `Retired command\n\n${RETIRED_MESSAGE}\n`;
}

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(usage());
  process.exit(0);
}

console.error(RETIRED_MESSAGE);
process.exit(1);
