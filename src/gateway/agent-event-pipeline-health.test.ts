import assert from "node:assert/strict";
import test from "node:test";

import {
  isAgentEventPipelineHealthy,
  isAgentEventPipelineWritable,
} from "./agent-event-pipeline-health.js";

test("an unconfigured development sink cannot make the Gateway unhealthy", () => {
  const input = {
    deliveryEnabled: false,
    pendingEvents: 1,
    oldestPendingAgeMs: 10 * 60_000,
    deadLetterEvents: 0,
    sinkError: null,
  };

  assert.equal(isAgentEventPipelineHealthy(input), true);
  assert.equal(isAgentEventPipelineWritable(input), true);
});

test("an enabled sink remains fail-closed for stale, dead-lettered, or failed delivery", () => {
  const baseline = {
    deliveryEnabled: true,
    pendingEvents: 1,
    oldestPendingAgeMs: 1_000,
    deadLetterEvents: 0,
    sinkError: null,
  };

  assert.equal(isAgentEventPipelineHealthy(baseline), true);
  assert.equal(isAgentEventPipelineHealthy({ ...baseline, oldestPendingAgeMs: 60_000 }), false);
  assert.equal(isAgentEventPipelineHealthy({ ...baseline, deadLetterEvents: 1 }), false);
  assert.equal(isAgentEventPipelineHealthy({ ...baseline, sinkError: "unavailable" }), false);
  assert.equal(isAgentEventPipelineWritable({ ...baseline, pendingEvents: 1_000 }), false);
});
