import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PIPELINE_DIR = process.env.PIPELINE_DIR || "/home/ubuntu/atlas-pipeline";
const LAUNCH_LOG = process.env.PIPELINE_LAUNCH_LOG || resolve(PIPELINE_DIR, "logs/pipeline-launcher.log");
const executionStartedAt = new Date();

function boundedField(value: unknown, max = 160): string {
  return String(value ?? "unknown").replace(/[\r\n\t]+/g, " ").slice(0, max);
}

function launcherLog(event: string, fields: Record<string, unknown> = {}): void {
  try {
    mkdirSync(dirname(LAUNCH_LOG), { recursive: true });
    const payload = {
      ts: new Date().toISOString(),
      event,
      pid: process.pid,
      ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, boundedField(value)])),
    };
    appendFileSync(LAUNCH_LOG, `${JSON.stringify(payload)}\n`, { encoding: "utf8" });
  } catch {
    // Launcher logging must never create a second execution path or expose env.
  }
}

function releaseMarker(): string {
  try {
    return readFileSync(resolve(PIPELINE_DIR, "DEPLOYED_GIT_SHA"), "utf8").trim().slice(0, 64) || "unset";
  } catch {
    return "unset";
  }
}

function safeFailureCategory(error: unknown): string {
  if (error && typeof error === "object") {
    const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return "module_not_found";
    if (name === "SyntaxError") return "syntax_error";
    if (name === "AbortError") return "aborted";
    if (name === "Error") return "execution_error";
    if (name) return `error_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`.slice(0, 80);
  }
  return "unknown_error";
}

const mode = process.argv[2] === "recover" ? "recover" : "cron";
const trigger = mode === "recover" ? "self-healing-retry" : "cron";
launcherLog("runner_boot", { mode, trigger, releaseSha: releaseMarker() });

async function main(): Promise<void> {
  const {
    APOLLO_GAP_FILL_WALL_CLOCK_LIMIT_MS,
    PIPELINE_SUPERVISOR_HEARTBEAT_MS,
    finalizeOwnedPipelineRun,
    heartbeatOwnedPipelineRun,
    loadAnyRunningPipelineRun,
    loadLatestOwnedPipelineRun,
    observeOwnedRun,
  } = await import("./server/pipelineExecutionSupervisor");

  const existing = await loadAnyRunningPipelineRun();
  if (existing) {
    launcherLog("duplicate_writer_blocked", {
      existingRunId: existing.id,
      existingTrigger: existing.triggeredBy,
      currentStep: existing.currentStep,
    });
    process.exit(75);
  }

  let stopping = false;
  let supervisorBusy = false;
  let observation = { currentStep: null as string | null, currentStepObservedAtMs: null as number | null };

  const stopOwnedExecution = async (reason: string, exitCode: number): Promise<never> => {
    if (stopping) process.exit(exitCode);
    stopping = true;
    launcherLog("owned_execution_stopping", { trigger, reason });
    const finalised = await finalizeOwnedPipelineRun(trigger, executionStartedAt, reason);
    launcherLog("owned_execution_finalised", {
      trigger,
      finalised: finalised.finalized,
      runId: finalised.runId,
      exitCode,
    });
    process.exit(exitCode);
  };

  process.once("SIGTERM", () => {
    void stopOwnedExecution(
      "Dedicated worker supervisor terminated this owned execution at its process runtime boundary.",
      124,
    );
  });
  process.once("SIGINT", () => {
    void stopOwnedExecution(
      "Dedicated worker supervisor received an interrupt and finalised its owned execution.",
      130,
    );
  });

  const watchdog = setInterval(() => {
    if (supervisorBusy || stopping) return;
    supervisorBusy = true;
    void (async () => {
      try {
        const snapshot = await heartbeatOwnedPipelineRun(trigger, executionStartedAt);
        if (!snapshot || snapshot.status !== "running") return;

        const decision = observeOwnedRun(snapshot, observation, Date.now(), APOLLO_GAP_FILL_WALL_CLOCK_LIMIT_MS);
        observation = decision.nextState;
        launcherLog("owned_execution_heartbeat", {
          trigger,
          runId: snapshot.id,
          currentStep: snapshot.currentStep,
        });

        if (decision.action === "terminate_apollo_timeout") {
          await stopOwnedExecution(
            "Dedicated worker supervisor stopped the owned run because Apollo Gap-Fill exceeded its 15-minute wall-clock boundary.",
            124,
          );
        }
      } catch (error) {
        launcherLog("supervisor_observation_failed", { category: safeFailureCategory(error) });
      } finally {
        supervisorBusy = false;
      }
    })();
  }, PIPELINE_SUPERVISOR_HEARTBEAT_MS);

  try {
    if (mode === "recover") {
      launcherLog("recovery_guard_start");
      const { attemptWorkerRecovery } = await import("./server/workerRecoveryGuard");
      const outcome = await attemptWorkerRecovery(new Date());
      launcherLog("recovery_guard_result", { outcome });
      if (outcome === "recovery_failed") process.exitCode = 1;
      if (outcome === "recovery_blocked_running") process.exitCode = 75;
      return;
    }

    launcherLog("daily_pipeline_import_start");
    const { runDailyPipeline } = await import("./server/dailyPipeline");
    launcherLog("daily_pipeline_import_ok");
    await runDailyPipeline("cron");

    const final = await loadLatestOwnedPipelineRun("cron", executionStartedAt);
    if (!final) {
      launcherLog("pipeline_resolved_without_row");
      process.exitCode = 1;
      return;
    }
    if (final.status === "running") {
      await stopOwnedExecution(
        "Dedicated worker pipeline resolved without a final persisted status; supervisor failed the owned row closed.",
        1,
      );
    }
    launcherLog("pipeline_finished", { runId: final.id, status: final.status });
    if (final.status !== "completed") process.exitCode = 1;
  } catch (error) {
    const category = safeFailureCategory(error);
    launcherLog("pipeline_execution_failed", { mode, trigger, category });
    const finalised = await finalizeOwnedPipelineRun(
      trigger,
      executionStartedAt,
      `Dedicated worker execution failed under supervisor control (${category}).`,
    );
    launcherLog("pipeline_failure_finalisation", {
      runId: finalised.runId,
      finalised: finalised.finalized,
    });
    process.exitCode = 1;
  } finally {
    clearInterval(watchdog);
  }
}

main()
  .then(() => {
    const exitCode = process.exitCode ?? 0;
    launcherLog("runner_exit", { exitCode });
    process.exit(exitCode);
  })
  .catch((error) => {
    launcherLog("runner_unhandled_failure", { category: safeFailureCategory(error) });
    process.exit(1);
  });
