export type AgentEventPipelineHealthInput = {
  deliveryEnabled: boolean;
  pendingEvents: number;
  oldestPendingAgeMs: number;
  deadLetterEvents: number;
  sinkError: string | null;
};

export function isAgentEventPipelineHealthy(input: AgentEventPipelineHealthInput): boolean {
  if (!input.deliveryEnabled) {
    return true;
  }
  return (
    input.deadLetterEvents === 0 &&
    input.sinkError === null &&
    input.pendingEvents < 1_000 &&
    input.oldestPendingAgeMs < 60_000
  );
}

export function isAgentEventPipelineWritable(input: AgentEventPipelineHealthInput): boolean {
  if (!input.deliveryEnabled) {
    return true;
  }
  return input.deadLetterEvents === 0 && input.pendingEvents < 1_000 && input.sinkError === null;
}
