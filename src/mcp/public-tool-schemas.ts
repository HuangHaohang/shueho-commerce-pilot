import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { preserveNullablePrimitiveSchemas } from './nullable-schema.js';

/** Publish portable JSON Schema at the server boundary, including to generic clients. */
export function usePortablePublicToolSchemas(transport: Transport): void {
  const send = transport.send.bind(transport);
  transport.send = async (message, options) => {
    if ('result' in message && Array.isArray(message.result.tools)) {
      const list = ListToolsResultSchema.safeParse(message.result);
      if (list.success) {
        return send({ ...message, result: {
          ...message.result,
          tools: list.data.tools.map(tool => ({
            ...tool,
            inputSchema: preserveNullablePrimitiveSchemas(tool.inputSchema),
            ...(tool.outputSchema ? { outputSchema: preserveNullablePrimitiveSchemas(tool.outputSchema) } : {}),
          })),
        } }, options);
      }
    }
    return send(message, options);
  };
}
