export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export const reasoningEffortOptions: Array<{
  value: ReasoningEffort;
  label: string;
  color: string;
  gradientEnd: string;
}> = [
  { value: "low", label: "轻度", color: "#8f8f8f", gradientEnd: "#8f8f8f" },
  { value: "medium", label: "中", color: "#10a37f", gradientEnd: "#10a37f" },
  { value: "high", label: "高", color: "#1687e8", gradientEnd: "#1687e8" },
  { value: "xhigh", label: "极高", color: "#4f66d8", gradientEnd: "#5c55d8" },
  { value: "max", label: "最高", color: "#6f4bd8", gradientEnd: "#8c4cdb" },
  { value: "ultra", label: "超高", color: "#4f46c8", gradientEnd: "#c64dde" },
];

export function formatModelName(modelId: string): string {
  const friendlyNames: Record<string, string> = {
    "gpt-5.6-luna": "5.6 Luna",
    "gpt-6-astra": "GPT-6 Astra",
    "gemini-3.8-flash-high": "Gemini 3.8 Flash High",
    "gpt-5.5": "GPT-5.5",
    "gpt-5.4": "GPT-5.4",
    "gpt-5.4-mini": "GPT-5.4 mini",
    "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
    "gemini-3.7-flash-high": "Gemini 3.7 Flash",
    "claude-sonnet-4-6": "Claude 4.6 Sonnet",
    "claude-opus-4-6-thinking": "Claude 4.6 Opus Thinking",
  };
  return friendlyNames[modelId] ?? modelId;
}

export function supportsReasoningControl(modelId: string): boolean {
  return /^gpt-5\.(5|6)(?:-|$)/i.test(modelId) || modelId === "gpt-6-astra";
}
