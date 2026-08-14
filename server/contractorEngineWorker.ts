import { runContractorEngine } from "./contractorEngine";

function sendAndExit(message: Record<string, unknown>, code: number): void {
  if (typeof process.send === "function" && process.connected) {
    process.send(message, () => process.exit(code));
    return;
  }
  process.exit(code);
}

async function main(): Promise<void> {
  try {
    const data = await runContractorEngine();
    sendAndExit({ type: "contractor-engine-result", data }, 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendAndExit({ type: "contractor-engine-error", message }, 1);
  }
}

void main();
