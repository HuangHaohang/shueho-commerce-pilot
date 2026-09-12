import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadOnlyCatalogServer } from './catalog-stub.mjs';
import { READ_FIXTURE_PROVIDER_KEY, validateScaleDatabase, validateScaleWeb } from './read-fixture-policy.mjs';

test('fixture guards reject daily, remote and query-overridden databases before connecting', () => {
  for (const url of [undefined, 'postgres://localhost:55432/commerce_pilot', 'postgres://remote.invalid/commerce_pilot_scale_1', 'postgres://localhost/commerce_pilot_scale_1?host=remote.invalid']) {
    assert.throws(() => validateScaleDatabase(url));
  }
  assert.equal(validateScaleDatabase('postgres://127.0.0.1:55432/commerce_pilot_scale_1').name, 'commerce_pilot_scale_1');
  assert.throws(() => validateScaleWeb('http://127.0.0.1:3000'));
  assert.throws(() => validateScaleWeb('https://remote.invalid'));
  assert.equal(validateScaleWeb(), 'http://127.0.0.1:3100');
});

test('catalog stub supports model discovery while refusing and counting every model execution', async () => {
  const { server, counts } = createReadOnlyCatalogServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${READ_FIXTURE_PROVIDER_KEY}` };
  try {
    assert.equal((await fetch(`${base}/v1/models`)).status, 401);
    const catalog = await fetch(`${base}/v1/models`, { headers });
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).data.length, 3);
    for (const route of ['/v1/responses', '/v1/responses/compact', '/v1/images/generations']) {
      assert.equal((await fetch(`${base}${route}`, { method: 'POST', headers, body: '{}' })).status, 503);
    }
    assert.equal(counts.catalogReads, 1);
    assert.equal(counts.rejectedExecutions, 3);
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.modelExecutionAvailable, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
