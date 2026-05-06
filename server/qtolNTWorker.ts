/**
 * QTOL NT Worker — runs in a child_process.fork() subprocess.
 *
 * The parent (dailyPipeline.ts) spawns this script with a hard wall-clock
 * kill timer. If the scraper hangs (e.g. a stalled fetch() TCP connection),
 * the parent kills the process unconditionally — the event loop block cannot
 * escape the subprocess boundary.
 *
 * IPC protocol:
 *   Parent → child:  { type: "run", reportId: number }
 *   Child  → parent: { type: "result", data: QtolNTResult }
 *                 or { type: "error",  message: string }
 *
 * The child exits with code 0 on success, code 1 on unhandled error.
 * The parent kills the child with SIGKILL on timeout — no graceful shutdown.
 */

import { runQtolNTScraper, type QtolNTResult } from "./qtolNTScraper";

// ── IPC message types ──

interface RunMessage {
  type: "run";
  reportId: number;
}

interface ResultMessage {
  type: "result";
  data: QtolNTResult;
}

interface ErrorMessage {
  type: "error";
  message: string;
}

type InboundMessage = RunMessage;
export type OutboundMessage = ResultMessage | ErrorMessage;

// ── Worker entry point ──

process.on("message", async (msg: InboundMessage) => {
  if (msg.type !== "run") return;

  const { reportId } = msg;
  console.log(`[QTOL NT Worker] Starting scraper for reportId=${reportId}`);

  try {
    const result = await runQtolNTScraper(reportId);
    console.log(
      `[QTOL NT Worker] Scraper complete: tendersFound=${result.tendersFound}, ` +
      `projectsCreated=${result.projectsCreated}, degraded=${result.degraded}`
    );
    const reply: ResultMessage = { type: "result", data: result };
    process.send!(reply);
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[QTOL NT Worker] Unhandled error: ${message}`);
    const reply: ErrorMessage = { type: "error", message };
    process.send!(reply);
    process.exit(1);
  }
});

// Notify parent that the worker is ready to receive messages
process.send!({ type: "ready" });
