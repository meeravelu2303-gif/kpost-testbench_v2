export type JsonObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a dot-separated path (`data.items.0.id`). */
export function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (Array.isArray(current)) return current[Number(key)];
    return isPlainObject(current) ? current[key] : undefined;
  }, value);
}

/** Returns a copy of `target` with `value` written at a dot-separated path. */
export function setPath<T>(target: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  if (head === undefined) return target;
  const source: JsonObject = isPlainObject(target) ? target : {};
  return {
    ...source,
    [head]: rest.length ? setPath(source[head], rest.join('.'), value) : value,
  } as T;
}

/** Returns a copy of `target` without the property at a dot-separated path. */
export function deletePath<T>(target: T, path: string): T {
  const [head, ...rest] = path.split('.');
  if (head === undefined || !isPlainObject(target)) return target;
  if (!rest.length) {
    const { [head]: _removed, ...remaining } = target;
    return remaining as T;
  }
  return { ...target, [head]: deletePath(target[head], rest.join('.')) };
}

/** Recursively merges plain objects; arrays and primitives in `override` replace `base`. */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override ?? base) as T;
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) merged[key] = deepMerge(base[key], value);
  return merged as T;
}

export interface JsonVisit {
  path: string;
  key: string;
  value: unknown;
}

/** Depth-first walk over every property of a JSON value. */
export function walkJson(value: unknown, path = ''): JsonVisit[] {
  const visits: JsonVisit[] = [];
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : isPlainObject(value)
      ? Object.entries(value)
      : [];
  for (const [key, child] of entries) {
    const childPath = path ? `${path}.${key}` : key;
    visits.push({ path: childPath, key, value: child }, ...walkJson(child, childPath));
  }
  return visits;
}
