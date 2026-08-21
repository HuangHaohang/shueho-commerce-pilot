export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonRpcId = string | number;

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse = {
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
};

export type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

export type JsonRpcRequest = JsonRpcNotification & {
  id: JsonRpcId;
};

export type AppServerEvent =
  | {
      type: "process";
      event: "started" | "stderr" | "exit";
      data: unknown;
      at: string;
    }
  | {
      type: "notification";
      method: string;
      params?: unknown;
      at: string;
    }
  | {
      type: "server_request";
      id: JsonRpcId;
      method: string;
      params?: unknown;
      at: string;
    }
  | {
      type: "server_request_resolved";
      id: JsonRpcId;
      at: string;
    }
  | {
      type: "client_response";
      id: JsonRpcId;
      result?: unknown;
      error?: JsonRpcError;
      at: string;
    };

export type AppServerClientOptions = {
  codexBin: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
};

export type ThreadStartInput = {
  model?: string;
};

export type TurnStartInput = {
  threadId: string;
  message?: string;
  model?: string;
  effort?: string;
};
