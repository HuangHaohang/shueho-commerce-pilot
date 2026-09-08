import assert from "node:assert/strict";
import test from "node:test";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import { preserveNullablePrimitiveSchemas } from "./nullable-schema.js";

test("nullable prices preserve null and explicit zero without changing constraints", () => {
  const input = { type: "object", required: ["price"], properties: { price: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }], description: "No bound when null" } } };
  const before = structuredClone(input);
  const output = preserveNullablePrimitiveSchemas(input);
  assert.deepEqual(output.properties.price, { anyOf: [{ enum: [null] }, { type: "number", minimum: 0 }], description: "No bound when null" });
  assert.deepEqual(output.required, input.required);
  assert.deepEqual(input, before);
});

test("primitive nullable schemas are normalized in either order and nested arrays", () => {
  const input = { type: "array", items: { type: "object", properties: {
    enabled: { anyOf: [{ type: "null" }, { type: "boolean" }] },
    label: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }], default: null },
  } } };
  const output = preserveNullablePrimitiveSchemas(input);
  assert.deepEqual(output.items.properties.enabled, { anyOf: [{ enum: [null] }, { type: "boolean" }] });
  assert.deepEqual(output.items.properties.label, { anyOf: [{ enum: [null] }, { type: "string", minLength: 1 }], default: null });
});

test("complex unions, enums and sibling restrictions retain their original semantics", () => {
  for (const schema of [
    { anyOf: [{ type: "number", enum: [0, 1] }, { type: "null" }] },
    { anyOf: [{ type: "number" }, { type: "null" }], minimum: 5 },
    { anyOf: [{ type: "number", allOf: [{ minimum: 2 }] }, { type: "null" }] },
    { anyOf: [{ type: "object", properties: {} }, { type: "null" }] },
    { oneOf: [{ type: "number" }, { type: "null" }] },
    { type: ["number", "string", "null"] },
    { type: ["number", "null"], enum: [0, null] },
  ]) assert.deepEqual(preserveNullablePrimitiveSchemas(schema), schema);
});

test("nullable schemas preserve acceptance and use only scalar type declarations", () => {
  const validator = new AjvJsonSchemaValidator();
  const cases: JsonSchemaType[] = [
    { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
    { anyOf: [{ type: "null" }, { type: "integer", minimum: 1, maximum: 10 }], default: null },
    { anyOf: [{ type: "boolean" }, { type: "null" }] },
    { anyOf: [{ type: "string", minLength: 0, maxLength: 4 }, { type: "null" }] },
    { type: ["number", "null"], minimum: 0 },
    { type: ["null", "integer"], minimum: 1, maximum: 10, default: null },
  ];
  for (const input of cases) {
    const output = preserveNullablePrimitiveSchemas(input);
    const before = validator.getValidator(input);
    const after = validator.getValidator(output);
    const values = [null, 0, 1, 2.5, 10, 11, -1, false, true, "", "0", "test", "too long", {}, []];
    for (const value of values) {
      assert.equal(after(value).valid, before(value).valid, JSON.stringify({ input, value }));
    }
    JSON.parse(JSON.stringify(output), (key, value) => {
      if (key === "type") assert.equal(typeof value, "string");
      return value;
    });
    assert.deepEqual(preserveNullablePrimitiveSchemas(output), output);
  }
});

test("null branch cannot coerce zero, false or empty string into null", () => {
  const validator = new AjvJsonSchemaValidator();
  for (const type of ["number", "integer", "boolean", "string"] as const) {
    const output = preserveNullablePrimitiveSchemas<JsonSchemaType>({ anyOf: [{ type }, { type: "null" }] });
    const first = output.anyOf![0];
    assert.ok(typeof first === "object" && first !== null);
    const nullBranch = validator.getValidator(first);
    assert.equal(nullBranch(null).valid, true);
    for (const value of [0, false, ""]) assert.equal(nullBranch(value).valid, false);
    assert.equal(Object.hasOwn(first, "type"), false);
  }
});

test("example and default data are never rewritten as schemas", () => {
  const literal = { anyOf: [{ type: "number" }, { type: "null" }] };
  const input = { type: "object", default: literal, examples: [literal], properties: { data: { type: "object", default: literal } } };
  assert.deepEqual(preserveNullablePrimitiveSchemas(input), input);
});
