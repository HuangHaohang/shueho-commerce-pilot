export type ManagedMcpStatus = {
  available: boolean;
  serverName: string;
  tools: string[];
  authStatus: string | null;
};

export function readManagedMcpStatus(result: unknown, serverName: string): ManagedMcpStatus {
  const empty = { available: false, serverName, tools: [], authStatus: null };
  if (!isRecord(result) || !Array.isArray(result.data)) {
    return empty;
  }
  const server = result.data.find(
    (item): item is Record<string, unknown> => isRecord(item) && item.name === serverName,
  );
  if (!server) {
    return empty;
  }
  const tools = Array.isArray(server.tools)
    ? server.tools
        .filter(isRecord)
        .map((tool) => tool.name)
        .filter((name): name is string => typeof name === "string")
    : isRecord(server.tools)
      ? Object.keys(server.tools)
      : [];
  return {
    available: tools.length > 0,
    serverName,
    tools,
    authStatus: typeof server.authStatus === "string" ? server.authStatus : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
