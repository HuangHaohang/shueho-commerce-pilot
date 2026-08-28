import type { RequestId } from "./generated/RequestId.js";
import type { ServerRequest } from "./generated/ServerRequest.js";

export type JsonRpcId = RequestId;

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

export type JsonRpcRequest = ServerRequest;

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
  workflow?: "commerce-copywriting" | "commerce-market-research";
  skillName?: string;
  attachmentIds?: string[];
  externalDataApprovalMode?: "always_ask" | "task" | "policy";
};
