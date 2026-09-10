import {researchResultPending} from './research-lifecycle.js';
export const researchTaskNeedsRecovery=(payload:Record<string,any>)=>payload.error?.code!=='APPROVAL_REQUIRED'&&researchResultPending(payload);
export type ResearchTaskState = 'completed' | 'partial' | 'failed' | 'reconciliation_required' | 'waiting_approval' | 'cancelled';
export function researchTaskOutcome(payload: Record<string, any>): ResearchTaskState {
  const code = payload.error?.code ?? payload.code;
  if (code === 'APPROVAL_REQUIRED') return 'waiting_approval';
  if (code === 'TASK_CANCELLED') return 'cancelled';
  if (['DATA_EXECUTION_UNCERTAIN','DATA_RESULT_UNKNOWN','UPSTREAM_RESULT_UNKNOWN','RESULT_UNKNOWN','TASK_RECONCILIATION_REQUIRED'].includes(code) ||
      payload.processing_state === 'unknown' || payload.uncertain === true || payload.error?.details?.uncertain === true ||
      payload.coverage?.execution?.phase === 'reconciliation_required') return 'reconciliation_required';
  if (researchTaskNeedsRecovery(payload)) return 'reconciliation_required';
  if (payload.state === 'blocked') return 'failed';
  if (payload.success === true) return 'completed';
  const partial = payload.partial_results?.length || payload.products?.length || payload.evidence?.length || payload.error?.details?.products?.length || payload.error?.details?.evidence?.length;
  return partial ? 'partial' : 'failed';
}
