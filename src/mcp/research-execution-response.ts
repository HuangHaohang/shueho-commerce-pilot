import {isTaskExecution} from "./research-task-runtime.js";
/** Release short-lived clients while the one admitted server operation continues. */
export async function researchExecutionResponse<T>(
  operation: Promise<T>,
  pending: () => T,
  foregroundWaitMs = 15_000,
): Promise<T> {
  if(isTaskExecution())return operation;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(pending()), foregroundWaitMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
