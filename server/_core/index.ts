import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startPersistentScheduler } from "../persistentScheduler";
import { startDailyScheduler, registerSigtermHandler } from "../dailyPipeline";
import { storagePut } from "../storage";
import { handleScheduledPipelineTrigger } from "../scheduledPipeline";
import { handleScheduledQueueRun } from "../scheduledQueueRun";
import { handleWarmup, startOperationsReliability } from "../operationsReliability";
import { handleFullPotentialDataQuality } from "../fullPotentialDataQuality";
import { handleFullPotentialRentalHire, handleFullPotentialRentalRemediation } from "../fullPotentialRentalHire";
import {
  handleAddFullPotentialEvidence,
  handleCreateFullPotentialModelDraft,
  handleGetFullPotentialCommercialWorkspace,
  handleRemoveFullPotentialModelLine,
  handleReviewFullPotentialEvidence,
  handleReviewFullPotentialModel,
  handleSubmitFullPotentialModel,
  handleUpdateFullPotentialRelationship,
  handleUpsertFullPotentialModelLine,
} from "../fullPotentialCommercialModel.http";
import {
  handleFullPotentialAccountNameMatch,
  handleFullPotentialAwardedProjectMatches,
  handleFullPotentialProjectMatch,
  handleFullPotentialProjectMatches,
} from "../fullPotentialAccountMatching.http";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);

  app.post("/api/upload-campaign-file", express.raw({ type: "*/*", limit: "20mb" }), async (req, res) => {
    try {
      const filename = (req.headers["x-filename"] as string) || "upload.csv";
      const buffer = req.body as Buffer;
      if (!buffer || buffer.length === 0) return res.status(400).json({ error: "No file data received" });
      const suffix = Math.random().toString(36).slice(2, 10);
      const key = `campaign-imports/${Date.now()}-${suffix}-${filename}`;
      const contentType = (req.headers["content-type"] as string) || "application/octet-stream";
      const { url } = await storagePut(key, buffer, contentType);
      res.json({ url, key, size: buffer.length });
    } catch (err) {
      console.error("[Upload] Campaign file upload failed:", err);
      res.status(500).json({ error: "File upload failed" });
    }
  });

  app.post("/api/upload-template-image", express.raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
    try {
      const filename = (req.headers["x-filename"] as string) || "image.png";
      const buffer = req.body as Buffer;
      if (!buffer || buffer.length === 0) return res.status(400).json({ error: "No file data received" });
      const suffix = Math.random().toString(36).slice(2, 10);
      const ext = filename.split(".").pop() || "png";
      const key = `template-images/${Date.now()}-${suffix}.${ext}`;
      const contentType = (req.headers["content-type"] as string) || "image/png";
      const { url } = await storagePut(key, buffer, contentType);
      res.json({ url, key, size: buffer.length });
    } catch (err) {
      console.error("[Upload] Template image upload failed:", err);
      res.status(500).json({ error: "Image upload failed" });
    }
  });

  app.get("/api/ping", (_req, res) => res.json({ ok: true, ts: Date.now() }));
  app.get("/api/full-potential/data-quality", handleFullPotentialDataQuality);
  app.get("/api/full-potential/rental-hire", handleFullPotentialRentalHire);
  app.post("/api/full-potential/rental-hire/remediation", handleFullPotentialRentalRemediation);

  app.get("/api/full-potential/commercial-model/:accountId", handleGetFullPotentialCommercialWorkspace);
  app.post("/api/full-potential/commercial-model/:accountId/draft", handleCreateFullPotentialModelDraft);
  app.post("/api/full-potential/commercial-model/evidence", handleAddFullPotentialEvidence);
  app.post("/api/full-potential/commercial-model/evidence/:evidenceId/review", handleReviewFullPotentialEvidence);
  app.put("/api/full-potential/commercial-model/line", handleUpsertFullPotentialModelLine);
  app.delete("/api/full-potential/commercial-model/line/:lineId", handleRemoveFullPotentialModelLine);
  app.post("/api/full-potential/commercial-model/:modelId/submit", handleSubmitFullPotentialModel);
  app.post("/api/full-potential/commercial-model/:modelId/review", handleReviewFullPotentialModel);
  app.put("/api/full-potential/commercial-model/account/:accountId/relationship", handleUpdateFullPotentialRelationship);

  // Read-only bridge between project/contractor intelligence and the canonical Full Potential account universe.
  app.get("/api/full-potential/project-match/:projectId", handleFullPotentialProjectMatch);
  app.get("/api/full-potential/project-matches", handleFullPotentialProjectMatches);
  app.get("/api/full-potential/awarded-project-matches", handleFullPotentialAwardedProjectMatches);
  app.get("/api/full-potential/account-match", handleFullPotentialAccountNameMatch);

  app.get("/api/warmup", handleWarmup);
  app.post("/api/pipeline/trigger", handleScheduledPipelineTrigger);
  app.post("/api/scheduled/pipeline", handleScheduledPipelineTrigger);
  app.post("/api/scheduled/queue-run", handleScheduledQueueRun);
  app.post("/api/pipeline/queue-run", handleScheduledQueueRun);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) console.log(`Port ${preferredPort} is busy, using port ${port} instead`);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    startDailyScheduler();
    registerSigtermHandler();
    startPersistentScheduler();
    startOperationsReliability();
  });
}

startServer().catch(console.error);
