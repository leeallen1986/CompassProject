#!/usr/bin/env tsx
/**
 * Read-only Australian Rental Hire coverage census.
 *
 * The implementation lives outside server/scripts so tests can import the
 * parser and runner without executing the command.
 */

export {
  parseRentalCoverageArgs,
  runRentalCoverageCensusCli,
  type RentalCoverageCliOptions,
} from "../fullPotentialRentalCoverageCensusCli";

import { runRentalCoverageCensusCli } from "../fullPotentialRentalCoverageCensusCli";

if (import.meta.url === `file://${process.argv[1]}`) {
  runRentalCoverageCensusCli().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
