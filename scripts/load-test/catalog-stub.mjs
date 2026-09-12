import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { READ_FIXTURE_PROVIDER_KEY } from './read-fixture-policy.mjs';

export function createReadOnlyCatalogServer() {
  const counts = { catalogReads: 0, rejectedExecutions: 0, rejectedRoutes: 0, rejectedAuthentication: 0 };
  const server = createServer((request, response) => {
    const reply = (status, body) => {
      request.resume();
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    if (request.method === 'GET' && request.url === '/health') {
      reply(200, { fixture: 'read-only-catalog', modelExecutionAvailable: false, ...counts });
      return;
    }
    if (request.headers.authorization !== `Bearer ${READ_FIXTURE_PROVIDER_KEY}`) {
      counts.rejectedAuthentication += 1;
      reply(401, { error: 'A local catalog fixture credential is required.' });
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/models') {
      counts.catalogReads += 1;
      reply(200, { object: 'list', data: ['gpt-5.6-luna', 'gpt-6-astra', 'gpt-image-2'].map(id => ({ id, object: 'model', owned_by: 'local-read-fixture' })) });
      return;
    }
    if (/^\/v1\/(responses|images)(\/|\?|$)/.test(request.url ?? '')) {
      counts.rejectedExecutions += 1;
      reply(503, { error: 'Read-only capacity fixture: model execution is disabled.' });
      return;
    }
    counts.rejectedRoutes += 1;
    reply(404, { error: 'This fixture serves only GET /v1/models.' });
  });
  return { server, counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SCALE_CATALOG_PORT ?? 8888);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 8787].includes(port)) throw new Error('Choose an isolated local fixture port.');
  const { server } = createReadOnlyCatalogServer();
  server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ fixture: 'read-only-catalog', port, modelExecutionAvailable: false })));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
