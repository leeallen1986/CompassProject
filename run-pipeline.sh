#!/bin/bash
set -u -o pipefail

PIPELINE_DIR="${PIPELINE_DIR:-/home/ubuntu/atlas-pipeline}"
LOG_DIR="$PIPELINE_DIR/logs"
LAUNCH_LOG="$LOG_DIR/pipeline-launcher.log"
MODE="${1:-cron}"

mkdir -p "$LOG_DIR"

log_event() {
  local event="$1"
  local detail="${2:-}"
  printf '{"ts":"%s","event":"%s","mode":"%s","detail":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$event" "$MODE" "$detail" >> "$LAUNCH_LOG"
}

log_event "shell_invoked" "cron wrapper entered"

if [[ "$MODE" != "cron" && "$MODE" != "recover" ]]; then
  log_event "invalid_mode" "expected cron or recover"
  exit 64
fi

if ! cd "$PIPELINE_DIR"; then
  log_event "working_directory_failure" "worker root unavailable"
  exit 72
fi

if [[ ! -f "$PIPELINE_DIR/.env" ]]; then
  log_event "environment_file_missing" "protected env file absent"
  exit 78
fi

if [[ ! -f "$PIPELINE_DIR/pipeline-runner.ts" ]]; then
  log_event "entrypoint_missing" "pipeline-runner.ts absent"
  exit 66
fi

if [[ ! -x /usr/bin/tsx ]]; then
  log_event "tsx_missing" "/usr/bin/tsx not executable"
  exit 69
fi

if [[ "$MODE" == "recover" ]]; then
  PROCESS_LIMIT="75m"
else
  # The application budget is 180 minutes. The OS boundary is slightly wider
  # so the owned runner gets first opportunity to finalise its row cleanly.
  PROCESS_LIMIT="185m"
fi

log_event "runner_start" "process_limit=$PROCESS_LIMIT"
/usr/bin/timeout --signal=TERM --kill-after=120s "$PROCESS_LIMIT" \
  /usr/bin/tsx --env-file="$PIPELINE_DIR/.env" "$PIPELINE_DIR/pipeline-runner.ts" "$MODE"
EXIT_CODE=$?

log_event "runner_exit" "exit_code=$EXIT_CODE"
exit "$EXIT_CODE"
