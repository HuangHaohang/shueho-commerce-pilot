import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supportsNativeResearchTasks } from './public-client-capabilities.js';

test('ordinary clients keep ordinary tools even when they use the newest protocol', () => {
  const initialize = (capabilities: unknown, protocolVersion = '2025-11-25') => ({
    method: 'initialize', params: { protocolVersion, capabilities, clientInfo: { name: 'generic', version: '1' } },
  });
  assert.equal(supportsNativeResearchTasks(initialize({})), false);
  assert.equal(supportsNativeResearchTasks(initialize({ elicitation: { form: {} } })), false);
  assert.equal(supportsNativeResearchTasks(initialize({ tasks: {} })), true);
  assert.equal(supportsNativeResearchTasks(initialize({ tasks: {} }, '2025-03-26')), false);
  assert.equal(supportsNativeResearchTasks(initialize({ tasks: null })), false);
  assert.equal(supportsNativeResearchTasks({ method: 'tools/list' }), false);
});
