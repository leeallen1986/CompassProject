/**
 * QTOL NT Subprocess Wrapper
 * ==========================
 * Runs the QTOL NT scraper in an isolated child_process.fork() with a hard
 * wall-clock kill timer. If the scraper hangs (stalled TCP, infinite loop),
 * the parent kills the child unconditionally via SIGKILL — the event loop
 * block cannot escape the subprocess boundary.
 *
 * Feature flags (env vars):
 *   QTOL_NT_SUBPROCESS_ENABLED   = "true" (default) | "false"
 *     When "false", falls back to in-process call (legacy behaviour).
 *
 *   QTOL_NT_SUBPROCESS_TIMEOUT_MS = number (default: 300000 = 5 minutes)
 *     Hard wall-clock timeout for the child process. If exceeded, child is
 *     killed with SIGKILL and the step is marked timed_out.
 *
 * Return value:
 *   QtolSubprocessResult — always resolves (never throws), so the caller can
 *   treat any non-success outcome as a step failure and continue the pipeline.
 */

import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { QtolNTResult } from "./qtolNTScraper";
import { runQtolNTScraper } from "./qtolNTScraper";

// ── Constants ──

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── Result type ──

export type QtolSubprocessStatus = "success" | "failed" | "timed_out";

export interface QtolSubprocessResult {
  status: QtolSubprocessStatus;
  durationMs: number;
  data?: QtolNTResult;
  errorSummary?: string;
}

// ── Feature flag helpers ──

export function isSubprocessEnabled(): boolean {
  const flag = process.env.QTOL_NT_SUBPROCESS_ENABLED;
  // Default ON unless explicitly set to "false"
  return flag !== "false";
}

export function getSubprocessTimeoutMs(): number {
  const raw = process.env.QTOL_NT_SUBPROCESS_TIMEOUT_MS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TIMEOUT_MS;
}

// ── Subprocess runner ──

/**
 * Run the QTOL NT scraper in a child process with a hard wall-clock timeout.
 * Always resolves — never throws.
 */
export async function runQtolNTInSubprocess(reportId: number): Promise<QtolSubprocessResult> {
  const timeoutMs = getSubprocessTimeoutMs();
  const startedAt = Date.now();

  console.log(
    `[QTOL NT Subprocess] Spawning child process (reportId=${reportId}, ` +
    `timeout=${Math.round(timeoutMs / 1000)}s, QTOL_NT_SUBPROCESS_ENABLED=${process.env.QTOL_NT_SUBPROCESS_ENABLED ?? "default:true"})`
  );

  return new Promise<QtolSubprocessResult>((resolve) => {
    // Resolve the worker script path — works for both ts-node/tsx and compiled JS
    const workerPath = (() => {
      try {
        // ESM: use import.meta.url
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        // In dev (tsx), the worker is a .ts file next to this file
        // In prod (compiled), it is a .js file in dist/
        const ext = __filename.endsWith(".ts") ? ".ts" : ".js";
        return path.join(__dirname, `qtolNTWorker${ext}`);
      } catch {
        // CJS fallback
        return path.join(__dirname, "qtolNTWorker.js");
      }
    })();

    console.log(`[QTOL NT Subprocess] Worker path: ${workerPath}`);

    // tsx/ts-node needs --import tsx or --loader tsx to run .ts files
    // We detect if we're running under tsx by checking the execArgv
    const isTsx = process.execArgv.some(a => a.includes("tsx") || a.includes("ts-node"));
    const execArgv = isTsx ? process.execArgv : [];

    const child = fork(workerPath, [], {
      execArgv,
      silent: false, // inherit stdout/stderr so logs appear in parent
    });

    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    function settle(result: QtolSubprocessResult) {
      if (settled) return;
      settled = true;
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      resolve(result);
    }

    // Hard wall-clock kill timer
    killTimer = setTimeout(() => {
      if (settled) return;
      const elapsed = Date.now() - startedAt;
      console.error(
        `[QTOL NT Subprocess] TIMEOUT after ${Math.round(elapsed / 1000)}s — ` +
        `killing child process (PID ${child.pid}) with SIGKILL`
      );
      try {
        child.kill("SIGKILL");
      } catch {
        // child may already be dead
      }
      settle({
        status: "timed_out",
        durationMs: elapsed,
        errorSummary: `Hard timeout after ${Math.round(elapsed / 1000)}s — child process killed`,
      });
    }, timeoutMs);

    // Receive structured result from child
    child.on("message", (msg: unknown) => {
      const m = msg as { type: string; data?: QtolNTResult; message?: string };
      if (m.type === "ready") {
        // Worker is ready — send the run command
        console.log(`[QTOL NT Subprocess] Child process ready (PID ${child.pid}), sending run command`);
        child.send({ type: "run", reportId });
        return;
      }
      if (m.type === "result" && m.data) {
        const elapsed = Date.now() - startedAt;
        console.log(
          `[QTOL NT Subprocess] Child returned result in ${Math.round(elapsed / 1000)}s: ` +
          `tendersFound=${m.data.tendersFound}, projectsCreated=${m.data.projectsCreated}, ` +
          `degraded=${m.data.degraded}`
        );
        settle({ status: "success", durationMs: elapsed, data: m.data });
        return;
      }
      if (m.type === "error") {
        const elapsed = Date.now() - startedAt;
        console.error(`[QTOL NT Subprocess] Child reported error: ${m.message}`);
        settle({ status: "failed", durationMs: elapsed, errorSummary: m.message });
        return;
      }
    });

    // Child exited without sending a result (crash, SIGKILL, etc.)
    child.on("exit", (code, signal) => {
      if (settled) return;
      const elapsed = Date.now() - startedAt;
      const summary = signal
        ? `Child killed by signal ${signal} after ${Math.round(elapsed / 1000)}s`
        : `Child exited with code ${code} after ${Math.round(elapsed / 1000)}s`;
      console.error(`[QTOL NT Subprocess] Unexpected exit — ${summary}`);
      settle({ status: "failed", durationMs: elapsed, errorSummary: summary });
    });

    child.on("error", (err) => {
      if (settled) return;
      const elapsed = Date.now() - startedAt;
      console.error(`[QTOL NT Subprocess] Child process error: ${err.message}`);
      settle({ status: "failed", durationMs: elapsed, errorSummary: err.message });
    });
  });
}

// ── Public API: subprocess or in-process fallback ──

/**
 * Run QTOL NT with subprocess isolation (if enabled) or fall back to
 * in-process call. Always resolves — never throws.
 */
export async function runQtolNTIsolated(reportId: number): Promise<QtolSubprocessResult> {
  if (!isSubprocessEnabled()) {
    console.log("[QTOL NT Subprocess] Subprocess disabled (QTOL_NT_SUBPROCESS_ENABLED=false). Running in-process.");
    const startedAt = Date.now();
    try {
      const data = await runQtolNTScraper(reportId);
      return { status: "success", durationMs: Date.now() - startedAt, data };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "failed", durationMs: Date.now() - startedAt, errorSummary: msg };
    }
  }

  return runQtolNTInSubprocess(reportId);
}
