import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRentalCoverageArgs } from "./scripts/fullPotentialRentalCoverageCensus";

describe("Rental Hire coverage census CLI", () => {
  it("parses output and optional candidate paths", () => {
    expect(parseRentalCoverageArgs([
      "--output-dir", "artifacts/run-1",
      "--candidate-file=research/candidates.csv",
    ])).toEqual({
      outputDir: "artifacts/run-1",
      candidateFile: "research/candidates.csv",
      help: false,
    });
  });

  it("rejects every write-style mode", () => {
    for (const flag of ["--apply", "--commit", "--seal", "--write-db", "--migrate"]) {
      expect(() => parseRentalCoverageArgs([flag])).toThrow(/read-only/);
    }
  });

  it("rejects unknown arguments instead of silently widening scope", () => {
    expect(() => parseRentalCoverageArgs(["--provider", "apollo"])).toThrow(/Unknown argument/);
  });

  it("contains SELECT-only database usage and no provider or outreach invocation", () => {
    const source = readFileSync("server/scripts/fullPotentialRentalCoverageCensus.ts", "utf8");
    expect(source).toContain("db.select().from(fullPotentialAccounts)");
    expect(source).toContain("db.select().from(fullPotentialAccountAliases)");
    expect(source).not.toMatch(/\.insert\s*\(/);
    expect(source).not.toMatch(/\.update\s*\(/);
    expect(source).not.toMatch(/\.delete\s*\(/);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/apollo|hunter|lusha|projectory/i);
    expect(source).not.toMatch(/sendEmail|outreach|runPipeline|generateCandidateSlate/);
  });
});
