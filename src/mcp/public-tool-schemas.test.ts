import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { z } from 'zod';
import { McpSessionPool } from './mcp-session-pool.js';

test('generic HTTP clients discover portable schemas and preserve null, zero and constraints without a bridge', async () => {
  const pool = new McpSessionPool();
  const seen: unknown[] = [];
  const http = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== 'Bearer fixture') {
        response.writeHead(401); response.end(); return;
      }
      let body = ''; for await (const chunk of request) body += chunk;
      await pool.handle(request, response, body ? JSON.parse(body) : undefined, 'fixture-owner', () => {
        const server = new McpServer({ name: 'portable-fixture', version: '1' });
        const inputSchema = {
          price: z.number().min(0).nullable(),
          enabled: z.boolean().nullable(),
          label: z.string().nullable(),
        };
        server.registerTool('echo', { title: 'Echo', inputSchema, outputSchema: inputSchema,
          annotations: { readOnlyHint: true } }, async args => {
          seen.push(args);
          return { content: [{ type: 'text', text: JSON.stringify(args) }], structuredContent: args };
        });
        return server;
      });
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address(); assert.ok(address && typeof address !== 'string');
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client = new Client({ name: 'generic-client', version: '1' });
  try {
    assert.equal((await fetch(url)).status, 401);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer fixture' } } }));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0]!.title, 'Echo');
    assert.equal(tools[0]!.annotations?.readOnlyHint, true);
    for (const schema of [tools[0]!.inputSchema, tools[0]!.outputSchema!]) {
      assert.deepEqual((schema.properties!.price as { anyOf: unknown[] }).anyOf[0], { enum: [null] });
      JSON.parse(JSON.stringify(schema), (key, value) => {
        if (key === 'type') assert.equal(typeof value, 'string');
        return value;
      });
      const validate = new AjvJsonSchemaValidator().getValidator(schema);
      assert.equal(validate({ price: -1, enabled: true, label: '' }).valid, false);
      assert.equal(validate({ price: null, enabled: null, label: null }).valid, true);
    }
    for (const args of [
      { price: null, enabled: null, label: null },
      { price: 0, enabled: false, label: '' },
      { price: 8.5, enabled: true, label: '商品' },
    ]) {
      const result = await client.callTool({ name: 'echo', arguments: args });
      assert.deepEqual(result.structuredContent, args);
    }
    assert.deepEqual(seen[1], { price: 0, enabled: false, label: '' });
    const invalid = await client.callTool({ name: 'echo', arguments: { price: -1, enabled: false, label: '' } });
    assert.equal(invalid.isError, true);
    assert.equal(seen.length, 3);
  } finally {
    await client.close(); await pool.close(); http.closeAllConnections();
    await new Promise<void>(resolve => http.close(() => resolve()));
  }
});
