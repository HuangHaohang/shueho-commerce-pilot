type JsonSchema = Record<string, unknown>;

const annotations = new Set(["title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly"]);
const constraints: Record<string, Set<string>> = {
  number: new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]),
  integer: new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]),
  string: new Set(["minLength", "maxLength", "pattern", "format", "contentEncoding", "contentMediaType"]),
  boolean: new Set(),
};

/** Preserve nullable primitive values in clients that coerce anyOf branch-first. */
export function preserveNullablePrimitiveSchemas<T>(schema: T): T {
  if (!isObject(schema)) return schema;
  const result: JsonSchema = { ...schema };
  for (const key of ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]) {
    if (isObject(result[key])) result[key] = Object.fromEntries(Object.entries(result[key]).map(([name, child]) => [name, preserveNullablePrimitiveSchemas(child)]));
  }
  for (const key of ["items", "additionalProperties", "contains", "propertyNames", "not", "if", "then", "else"]) {
    const child = result[key];
    if (child !== undefined) result[key] = Array.isArray(child)
      ? child.map(preserveNullablePrimitiveSchemas) : preserveNullablePrimitiveSchemas(child);
  }
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    if (Array.isArray(result[key])) result[key] = result[key].map(preserveNullablePrimitiveSchemas);
  }
  if (!Array.isArray(result.anyOf) || result.anyOf.length !== 2) return result as T;
  const nullBranch = result.anyOf.find((branch) => isObject(branch) && branch.type === "null" && Object.keys(branch).length === 1);
  const typedBranch = result.anyOf.find((branch) => isObject(branch) && typeof branch.type === "string" && Object.hasOwn(constraints, branch.type));
  if (!nullBranch || !isObject(typedBranch) || typeof typedBranch.type !== "string") return result as T;
  if (Object.keys(result).some((key) => key !== "anyOf" && !annotations.has(key))) return result as T;
  const allowed = constraints[typedBranch.type]!;
  if (Object.keys(typedBranch).some((key) => key !== "type" && !annotations.has(key) && !allowed.has(key))) return result as T;
  const { anyOf: _anyOf, ...outer } = result;
  return { ...typedBranch, ...outer, type: [typedBranch.type, "null"] } as T;
}

function isObject(value: unknown): value is JsonSchema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
