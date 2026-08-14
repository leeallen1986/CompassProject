import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { EngineRunResult } from "./contractorEngine";

export const CONTRACTOR_ENGINE_TIMEOUT_MS = 50 * 60 * 1000;

export type ContractorEngineSubprocessResult =
  | { status: "success"; durationMs: number; data: EngineRunResult }
  | { status: "failed" | "timed_out"; durationMs: number; errorSummary: string };

function resolveChildLaunch(): { entry: string; env: NodeJS.ProcessEnv } | null {
  const selfPath = fileURLToPath(import.meta.url);

  // Dedicated cloud worker currently executes TypeScript source through tsx.
  // In that execution plane, always fork the explicit worker file rather than
  // recursively forking whichever pipeline-runner happened to launch us.
  if (selfPath.endsWith(".ts")) {
    return {
      entry: path.join(path.dirname(selfPath), "contractorEngineWorker.ts"),
      env: { ...process.env },
    };
  }

  // The Manus web build bundles this module into dist/index.js. There is no
  // separate worker artifact in that bundle, so fork the same index entry with
  // an explicit child-only mode handled before the HTTP server starts.
  const entry = process.argv[1];
  if (!entry) return null;
  return {
    entry,
    env: { ...process.env, COMPASS_SUBPROCESS_MODE: "contractor-engine" },
  };
}

/**
 * Execute Contractor Engine behind a hard process boundary. Source runners use
 * a dedicated worker file; the bundled web build uses its child-only entry
 * mode. Either way, a 50-minute overrun is killed with SIGKILL so work cannot
 * continue mutating after the parent proceeds or later retries.
 */
export function runContractorEngineIsolated(): Promise<ContractorEngineSubprocessResult> {
  const startedAt = Date.now();
  const launch = resolveChildLaunch();

  if (!launch) {
    return Promise.resolve({
      status: "failed",
      durationMs: 0,
      errorSummary: "Cannot resolve contractor-engine subprocess entry point",
    });
  }

  return new Promise(resolve => {
    const child = fork(launch.entry, [], {
      execArgv: process.execArgv,
      env: launch.env,
      silent: false,
    });

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (result: ContractorEngineSubprocessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    timer = setTimeout(() => {
      if (settled) return;
      const durationMs = Date.now() - startedAt;
      try {
        child.kill("SIGKILL");
      } catch {
        // Child may already have exited between the timer firing and kill().
      }
      settle({
        status: "timed_out",
        durationMs,
        errorSummary: `Contractor Engine hard timeout after ${Math.round(durationMs / 1000)}s; child process killed`,
      });
    }, CONTRACTOR_ENGINE_TIMEOUT_MS);

    child.on("message", (message: unknown) => {
      const msg = message as { type?: string; data?: EngineRunResult; message?: string };
      if (msg.type === "contractor-engine-result" && msg.data) {
        settle({ status: "success", durationMs: Date.now() - startedAt, data: msg.data });
      } else if (msg.type === "contractor-engine-error") {
        settle({
          status: "failed",
          durationMs: Date.now() - startedAt,
          errorSummary: msg.message || "Contractor Engine child reported an unknown error",
        });
      }
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      const durationMs = Date.now() - startedAt;
      settle({
        status: "failed",
        durationMs,
        errorSummary: signal
          ? `Contractor Engine child exited via ${signal}`
          : `Contractor Engine child exited with code ${code}`,
      });
    });

    child.on("error", error => {
      settle({
        status: "failed",
        durationMs: Date.now() - startedAt,
        errorSummary: error.message,
      });
    });
  });
}
