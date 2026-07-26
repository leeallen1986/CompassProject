import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseRentalRelationshipArgs,
  runRentalRelationshipCli,
} from "./scripts/fullPotentialRentalRelationshipReconcile";

describe("Rental relationship reconciliation CLI", () => {
  it("parses generate, seal and exact-hash apply modes", () => {
    expect(parseRentalRelationshipArgs(["--output-dir", "artifacts/run"])).toMatchObject({
      outputDir: "artifacts/run",
      seal: false,
      apply: false,
    });
    expect(parseRentalRelationshipArgs(["--seal", "--manifest", "draft.json", "--output-dir", "sealed"])).toMatchObject({
      seal: true,
      apply: false,
      manifest: "draft.json",
    });
    expect(parseRentalRelationshipArgs(["--apply", "--manifest", "sealed.json", "--confirm-hash", "abc", "--output-dir", "apply"])).toMatchObject({
      apply: true,
      seal: false,
      confirmHash: "abc",
    });
    expect(() => parseRentalRelationshipArgs(["--seal", "--apply"])).toThrow(/mutually exclusive/);
    expect(() => parseRentalRelationshipArgs(["--account-id", "999"])).toThrow(/Unknown argument/);
  });

  it("documents the read-only generate, seal and exact-hash apply sequence", async () => {
    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await runRentalRelationshipCli(["--help"]);
    } finally {
      process.stdout.write = original;
    }
    const output = chunks.join("");
    expect(output).toContain("Generate read-only draft");
    expect(output).toContain("--seal");
    expect(output).toContain("--confirm-hash");
  });

  it("contains no provider, discovery, pipeline-trigger or migration operation", () => {
    const source = readFileSync("server/scripts/fullPotentialRentalRelationshipReconcile.ts", "utf8");
    expect(source).not.toMatch(/Apollo|Hunter|Lusha|Projectory|LinkedIn|invokeLLM/);
    expect(source).not.toMatch(/runDailyPipeline|triggerPipeline|db:push|migration/i);
    expect(source).not.toMatch(/sendEmail|outreach/);
  });

  it("limits writes to two fixed Full Potential account updates", () => {
    const source = readFileSync("server/scripts/fullPotentialRentalRelationshipReconcile.ts", "utf8");
    expect((source.match(/tx\.update\(fullPotentialAccounts\)/g) || [])).toHaveLength(2);
    expect(source).toContain("eq(fullPotentialAccounts.id, 328)");
    expect(source).toContain("eq(fullPotentialAccounts.id, 334)");
    expect(source).not.toMatch(/\.delete\s*\(/);
    expect(source).not.toMatch(/\.insert\s*\(/);
  });
});
