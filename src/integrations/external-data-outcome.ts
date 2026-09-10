import {researchResultPending} from './research-lifecycle.js';
export function classifyExternalDataServiceOutcome(
  payload: Record<string, unknown>,
  isError: boolean,
): {
  upstreamCode: number | null;
  providerCompleted: boolean;
  businessUsable: boolean;
    settlementState: "succeeded" | "business_failed" | "unknown" | null;
} {
  const upstreamCode = typeof payload.code === "number" ? payload.code : null;
  const providerCompleted = payload.provider_completed === true;
  const businessUsable = !researchResultPending(payload) && providerCompleted && payload.success === true && !isError;
  return {
    upstreamCode,
    providerCompleted,
    businessUsable,
    settlementState: researchResultPending(payload) ? null : providerCompleted ? "succeeded" : payload.processing_state==='unknown' ||
      ['DATA_EXECUTION_UNCERTAIN','DATA_RESULT_UNKNOWN','UPSTREAM_RESULT_UNKNOWN','RESULT_UNKNOWN'].includes(String((payload.error as {code?:string}|undefined)?.code ?? payload.code)) ? 'unknown' : 'business_failed',
  };
}
