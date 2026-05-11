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
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // File upload endpoint for campaign CSV/Excel imports
  app.post("/api/upload-campaign-file", express.raw({ type: "*/*", limit: "20mb" }), async (req, res) => {
    try {
      const filename = (req.headers["x-filename"] as string) || "upload.csv";
      const buffer = req.body as Buffer;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: "No file data received" });
      }
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

  // Image upload endpoint for email template editor
  app.post("/api/upload-template-image", express.raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
    try {
      const filename = (req.headers["x-filename"] as string) || "image.png";
      const buffer = req.body as Buffer;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: "No file data received" });
      }
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

  // Lightweight health ping — used by pipeline keepalive to prevent CloudRun container recycling
  app.get("/api/ping", (_req, res) => res.json({ ok: true, ts: Date.now() }));
  // Warm-up endpoint — called by scheduled task 2-3 min before pipeline trigger
  // Wakes the container from hibernation and returns readiness state
  app.get("/api/warmup", handleWarmup);

  // External scheduled pipeline trigger — called by Manus scheduled task daily at 20:00 UTC
  // Auth: app_session_id cookie (Manus scheduled-task JWT) + X-Scheduled-Task header
  // Idempotent: returns 200 already_ran if completed within 4h, 409 if currently running
  app.post("/api/scheduled/pipeline", handleScheduledPipelineTrigger);

  // Nightly discovery queue run — called by Manus scheduled task after midnight UTC
  // Runs one batch of 10 projects through the contact discovery waterfall
  // Returns NDJSON stream with before/after stats and batch summary
  // Auth: scheduled-task cookie (role=user) OR admin session
  app.post("/api/scheduled/queue-run", handleScheduledQueueRun);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Start the daily pipeline scheduler (runs at 20:00 UTC — 3h before Monday digest)
    startDailyScheduler();
    // Register SIGTERM handler so in-flight pipeline runs are marked failed
    // when CloudRun shuts down the container. Must be called after server starts.
    registerSigtermHandler();
    // Start the persistent email digest scheduler (recovers from restarts)
    // Must start AFTER startDailyScheduler so pipeline is always wired first.
    startPersistentScheduler();
    // Start operations reliability systems (self-healing retry, missed-run alerts)
    startOperationsReliability();
  });
}

startServer().catch(console.error);
