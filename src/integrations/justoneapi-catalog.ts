const VERSION_PATTERN = /^v\d+$/i;
const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g;
const ACRONYM_BOUNDARY = /([A-Z]+)([A-Z][a-z])/g;

export function justOneApiEndpointIdentity(apiPath: string): {
  apiPath: string;
  endpointId: string;
  platformId: string;
  version: string;
} {
  const normalizedPath = apiPath.trim();
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts.length < 3 || !parts.every(isSafePathSegment)) {
    throw new Error(`Invalid JustOneAPI path: ${apiPath}`);
  }
  const versionFromPath = parts.at(-1) ?? "";
  const hasPathVersion = VERSION_PATTERN.test(versionFromPath);
  const platformId = toSnakeCase(parts[1] ?? "");
  const actionSegments = parts.slice(2, hasPathVersion ? -1 : undefined).map(toSnakeCase);
  if (actionSegments.some((segment) => !segment)) {
    throw new Error(`Invalid JustOneAPI action path: ${apiPath}`);
  }
  const action = actionSegments.length ? actionSegments.join("_") : platformId;
  const version = hasPathVersion ? versionFromPath.toLowerCase() : "v1";
  const endpointId = `${platformId}.${`${action}_${version}`.replace(/_+/g, "_")}`;
  if (!/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/.test(endpointId)) {
    throw new Error(`Unable to derive a safe endpoint id from ${apiPath}`);
  }
  return { apiPath: normalizedPath, endpointId, platformId, version };
}

function toSnakeCase(value: string): string {
  return value
    .replace(ACRONYM_BOUNDARY, "$1_$2")
    .replace(CAMEL_BOUNDARY, "$1_$2")
    .replace(/[\s\-./]+/g, "_")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isSafePathSegment(value: string): boolean {
  return value !== "." && value !== ".." && /^[A-Za-z0-9._-]+$/.test(value);
}
