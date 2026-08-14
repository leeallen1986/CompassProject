import { fork } from "child_process";
import type { EngineRunResult } from "./contractorEngine";

export const CONTRACTOR_ENGINE_TIMEOUT_MS = 50 * 60 * 1000;

export type ContractorEngineSubprocessResult =
  | { status: "success"; durationMs: number; data: EngineRunResult }
  | { status: "failed" | "timed_out"; durationMs: number; errorSummary: string };

/**
 * Execute the contractor engine in a separate Node process. The child runs the
 * same application entry file with COMPASS_SUBPROCESS_MODE set, so this works
 * in both tsx development and the bundled production entry point. If the stage
 * exceeds 50 minutes it is SIGKILLed, preventing an unbounded contractor pass
 * from continuing to mutate after the parent has moved on or retried.
 */
export function runContractorEngineIsolated(): Promise<ContractorEngineSubprocessResult> {
  const startedAt = Date.now();
  const entry = process.argv[1];

  if (!entry) {
    return Promise.resolve({
      status: "failed",
      durationMs: 0,
      errorSummary: "Cannot resolve current Node entry point for contractor-engine subprocess",
    });
  }

  return new Promise(resolve => {
    const child = fork(entry, [], {
      execArgv: process.execArgv,
      env: {
        ...process.env,
        COMPASS_SUBPROCESS_MODE: "contractor-engine",
      },
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
