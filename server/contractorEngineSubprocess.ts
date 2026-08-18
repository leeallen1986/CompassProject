import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { IncrementalContractorEngineResult } from "./contractorEngineIncremental";
import {
  buildHardTimeoutSummary,
  type ContractorEngineProgressSnapshot,
} from "./contractorEngineIncrementalPolicy";

export const CONTRACTOR_ENGINE_TIMEOUT_MS = 50 * 60 * 1000;

export type ContractorEngineSubprocessResult =
  | {
      status: "success";
      durationMs: number;
      data: IncrementalContractorEngineResult;
      progress?: ContractorEngineProgressSnapshot;
    }
  | {
      status: "failed" | "timed_out";
      durationMs: number;
      errorSummary: string;
      progress?: ContractorEngineProgressSnapshot;
    };

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
 * Execute Contractor Engine behind the existing 50-minute hard process boundary.
 * Issue #116 adds an internal 35-minute soft budget and persisted checkpoints,
 * but the SIGKILL boundary remains unchanged as the final safety backstop.
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
    let lastProgress: ContractorEngineProgressSnapshot | undefined;

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
        errorSummary: buildHardTimeoutSummary(durationMs, lastProgress?.phase),
        progress: lastProgress,
      });
    }, CONTRACTOR_ENGINE_TIMEOUT_MS);

    child.on("message", (message: unknown) => {
      const msg = message as {
        type?: string;
        data?: IncrementalContractorEngineResult;
        message?: string;
        phase?: string;
        counts?: ContractorEngineProgressSnapshot["counts"];
      };
      if (msg.type === "contractor-engine-progress" && msg.phase && msg.counts) {
        lastProgress = { phase: msg.phase, counts: msg.counts };
        return;
      }
      if (msg.type === "contractor-engine-result" && msg.data) {
        settle({
          status: "success",
          durationMs: Date.now() - startedAt,
          data: msg.data,
          progress: msg.data.progress || lastProgress,
        });
      } else if (msg.type === "contractor-engine-error") {
        settle({
          status: "failed",
          durationMs: Date.now() - startedAt,
          errorSummary: msg.message || "Contractor Engine child reported an unknown error",
          progress: lastProgress,
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
        progress: lastProgress,
      });
    });

    child.on("error", error => {
      settle({
        status: "failed",
        durationMs: Date.now() - startedAt,
        errorSummary: error.message,
        progress: lastProgress,
      });
    });
  });
}
