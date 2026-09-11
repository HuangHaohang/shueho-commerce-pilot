import { InitializeRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** A recent protocol version alone does not mean a client can handle native tasks. */
export function supportsNativeResearchTasks(body: unknown): boolean {
  const request = InitializeRequestSchema.safeParse(body);
  return request.success && request.data.params.protocolVersion === '2025-11-25' &&
    request.data.params.capabilities.tasks !== undefined;
}
