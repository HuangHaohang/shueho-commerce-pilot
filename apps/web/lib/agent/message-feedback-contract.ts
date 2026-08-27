export type AgentMessageFeedbackRating = "positive" | "negative";

export function isAgentMessageFeedbackRating(
  value: unknown,
): value is AgentMessageFeedbackRating {
  return value === "positive" || value === "negative";
}

export function toggleAgentMessageFeedback(
  current: AgentMessageFeedbackRating | null | undefined,
  selected: AgentMessageFeedbackRating,
): AgentMessageFeedbackRating | null {
  return current === selected ? null : selected;
}
