import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

const TEMPLATE_PATH = resolve(
  process.cwd(),
  "client/public/templates/portable-air-signals-template.csv",
);

const EXPECTED_HEADERS = [
  "signalTitle",
  "signalSummary",
  "signalType",
  "sourceName",
  "sourceUrl",
  "state",
  "signalDate",
  "confidenceLevel",
  "urgency",
  "suggestedAction",
  "status",
  "accountId",
  "stableKey",
  "accountName",
  "canonicalName",
  "displayName",
  "aliasName",
];

function createAdminContext(): TrpcContext {
  const user: User = {
    id: 999943,
    openId: "pr43-signal-template-user",
    name: "PR43 Signal Template User",
    email: "pr43-template@example.com",
    loginMethod: "manus",
    passwordHash: null,
    authMethod: "oauth",
    role: "admin",
    campaignAccess: false,
    invitedBy: null,
    inviteToken: null,
    inviteExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function buildUniqueDryRunCsv(): string {
  const template = readFileSync(TEMPLATE_PATH, "utf8").trim();
  const [header, ...rows] = template.split(/\r?\n/);
  const runToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const uniqueRows = rows.map((row, index) => {
    const cells = row.split(",");
    cells[0] = `${cells[0]} ${runToken}-${index + 1}`;
    if (cells[4]) {
      cells[4] = `${cells[4]}?templateTest=${runToken}-${index + 1}`;
    }
    return cells.join(",");
  });

  return [header, ...uniqueRows].join("\n");
}

describe("Portable Air signal import template", () => {
  it("keeps the supported signal import headers in the expected order", () => {
    const csv = readFileSync(TEMPLATE_PATH, "utf8");
    const [headerLine] = csv.trim().split(/\r?\n/);

    expect(headerLine.split(",")).toEqual(EXPECTED_HEADERS);
  });

  it("passes the live importSignals dry-run without writing signals", async () => {
    const csv = buildUniqueDryRunCsv();
    const caller = appRouter.createCaller(createAdminContext());

    const result = await caller.fullPotential.importSignals({
      fileName: "portable-air-signals-template.csv",
      fileBase64: Buffer.from(csv, "utf8").toString("base64"),
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.rowsParsed).toBe(3);
    expect(result.rowsValid).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(result.createdSignals).toBe(0);
    expect(result.preview).toHaveLength(3);
  });
});
