/**
 * Test script: simulate the exact writeProgressCheckpoint Drizzle call
 * to see if it throws an error on the production database.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import { pipelineRuns } from "./drizzle/schema.ts";

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

const runId = 870001;
const steps = []; // empty array like at pipeline start
const errors = [];

console.log("Testing writeProgressCheckpoint simulation on run #870001...");

// Test 1: markStepStarted equivalent (empty partial, just currentStep)
try {
  await db.update(pipelineRuns)
    .set({
      steps,
      errors: errors.length > 0 ? errors : null,
      lastProgressAt: new Date(),
      currentStep: "Test Step",
    })
    .where(eq(pipelineRuns.id, runId));
  console.log("✓ Test 1 (markStepStarted) PASSED");
} catch (err) {
  console.error("✗ Test 1 (markStepStarted) FAILED:", err.message);
}

// Test 2: full checkpoint write with counts
try {
  await db.update(pipelineRuns)
    .set({
      feedsFetched: 20,
      articlesIngested: 265,
      articlesExtracted: 54,
      projectsCreated: 58,
      steps,
      errors: null,
      lastProgressAt: new Date(),
      currentStep: null,
      lastActivityNote: "Harvest: 265 new articles from 20 sources. Extraction: 54 projects.",
    })
    .where(eq(pipelineRuns.id, runId));
  console.log("✓ Test 2 (full checkpoint) PASSED");
} catch (err) {
  console.error("✗ Test 2 (full checkpoint) FAILED:", err.message);
}

// Check result
const [result] = await db.select({
  id: pipelineRuns.id,
  currentStep: pipelineRuns.currentStep,
  lastProgressAt: pipelineRuns.lastProgressAt,
  lastActivityNote: pipelineRuns.lastActivityNote,
  feedsFetched: pipelineRuns.feedsFetched,
  articlesIngested: pipelineRuns.articlesIngested,
}).from(pipelineRuns).where(eq(pipelineRuns.id, runId));

console.log("\nRun #870001 after tests:", result);

await connection.end();
