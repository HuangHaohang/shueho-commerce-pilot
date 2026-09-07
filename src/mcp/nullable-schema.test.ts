import assert from "node:assert/strict";
import test from "node:test";
import { preserveNullablePrimitiveSchemas } from "./nullable-schema.js";

test("nullable prices preserve null and explicit zero without changing constraints", () => {
  const input = { type: "object", required: ["price"], properties: { price: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }], description: "No bound when null" } } };
  const before = structuredClone(input);
  const output = preserveNullablePrimitiveSchemas(input);
  assert.deepEqual(output.properties.price, { type: ["number", "null"], minimum: 0, description: "No bound when null" });
  assert.deepEqual(output.required, input.required);
  assert.deepEqual(input, before);
});

test("primitive nullable schemas are normalized in either order and nested arrays", () => {
  const input = { type: "array", items: { type: "object", properties: {
    enabled: { anyOf: [{ type: "null" }, { type: "boolean" }] },
    label: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }], default: null },
  } } };
  const output = preserveNullablePrimitiveSchemas(input);
  assert.deepEqual(output.items.properties.enabled, { type: ["boolean", "null"] });
  assert.deepEqual(output.items.properties.label, { type: ["string", "null"], minLength: 1, default: null });
});

test("complex unions, enums and sibling restrictions retain their original semantics", () => {
  for (const schema of [
    { anyOf: [{ type: "number", enum: [0, 1] }, { type: "null" }] },
    { anyOf: [{ type: "number" }, { type: "null" }], minimum: 5 },
    { anyOf: [{ type: "number", allOf: [{ minimum: 2 }] }, { type: "null" }] },
    { anyOf: [{ type: "object", properties: {} }, { type: "null" }] },
    { oneOf: [{ type: "number" }, { type: "null" }] },
    { type: ["number", "null"], minimum: 0 },
  ]) assert.deepEqual(preserveNullablePrimitiveSchemas(schema), schema);
});

test("example and default data are never rewritten as schemas", () => {
  const literal = { anyOf: [{ type: "number" }, { type: "null" }] };
  const input = { type: "object", default: literal, examples: [literal], properties: { data: { type: "object", default: literal } } };
  assert.deepEqual(preserveNullablePrimitiveSchemas(input), input);
});
