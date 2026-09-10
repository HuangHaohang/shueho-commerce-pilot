/** A durable task must resume its checkpoint; this is not a provider business failure. */
export class ResearchRecoveryRequiredError extends Error {
 readonly code='TASK_RECOVERY_REQUIRED';
 constructor(reason='TASK_OPERATION_REQUIRES_RECONCILIATION'){super(`${reason}: resume the original durable checkpoint.`);}
}
export function rethrowResearchRecovery(error:unknown):void {
 if(error instanceof ResearchRecoveryRequiredError)throw error;
}

/** Normal asynchronous processing waits separately from infrastructure failure retries. */
export class ResearchProcessingPendingError extends ResearchRecoveryRequiredError {}
