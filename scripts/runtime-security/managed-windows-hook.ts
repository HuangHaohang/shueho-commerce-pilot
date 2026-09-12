/** Verify the exact application-authored Windows event binding and wrapper. */
export function assertManagedWindowsHook(input: {
  generatedConfig: string;
  eventName: string;
  commandPath: string;
  wrapperSource: string;
  expectedWrapperSource: string;
}): void {
  if (!/^[A-Za-z]+$/.test(input.eventName)) throw new Error("Invalid managed Hook event name.");
  const sections = [...input.generatedConfig.matchAll(new RegExp(
    `^\\[\\[hooks\\.${input.eventName}\\.hooks\\]\\]\\r?\\n([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, "gm",
  ))];
  if (sections.length !== 1) {
    throw new Error(`Generated Windows Codex config must bind exactly one managed ${input.eventName} Hook.`);
  }
  const commands = [...sections[0]![1]!.matchAll(/^commandWindows\s*=\s*(.+)$/gm)];
  let command: unknown;
  try {
    command = commands.length === 1 ? JSON.parse(commands[0]![1]!) : null;
  } catch {
    command = null;
  }
  if (command !== input.commandPath) {
    throw new Error(`Generated Windows Codex config must use the owned ${input.eventName} Hook wrapper.`);
  }
  if (input.wrapperSource !== input.expectedWrapperSource) {
    throw new Error(`Managed Windows ${input.eventName} Hook wrapper differs from its application-owned command.`);
  }
}
