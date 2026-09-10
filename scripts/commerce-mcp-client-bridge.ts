import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createCommerceClientBridge} from '../src/mcp/commerce-client-bridge.js';
const authorization=process.env.COMMERCE_MCP_AUTH_HEADER;
if(!authorization||!/^Bearer cp_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{32,}$/.test(authorization))throw new Error('A Commerce Pilot MCP authorization header is required.');
const bridge=await createCommerceClientBridge(new URL('https://commerce-mcp.shueho.com/mcp'),authorization);
let closing=false;async function close(){if(closing)return;closing=true;await bridge.close();}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());bridge.server.onclose=()=>void close();
await bridge.server.connect(new StdioServerTransport());
