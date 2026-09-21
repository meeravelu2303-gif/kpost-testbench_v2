/**
 * Field-path resolution — the smallest capability the Phase 4B catalogue actually needs.
 *
 * ## Deliberately not a query language
 *
 * The repository has no path/query convention to follow, so nothing general was invented. Exactly
 * four shapes appear in the Phase 4B observation definitions, and exactly those four are supported:
 *
 *     data[].status                                          array of rows, one field
 *     value.kmailTransactionList[].readStatus                object, then a nested array
 *     data[].kallDetails[].receiverKallStatus                array inside an array
 *     data[].{deletedBy,importantBy,isVanished}              a brace group: several fields of one row
 *
 * No filters, no wildcards, no predicates, no indexing. Anything outside these shapes is a parse
 * error rather than a best guess, so an unsupported path fails loudly at the point it is declared
 * instead of silently observing nothing.
 *
 * ## Why every match carries its container
 *
 * A resolved value on its own is useless — `2` means nothing without knowing which message it came
 * from. Every match therefore reports the **row** (the nearest enclosing object) and, for a nested
 * array, the **parent row** too. That is what lets the extractor attach the correct resource id to
 * the correct value, which §5 of the brief makes mandatory.
 */

export class FieldPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldPathError';
  }
}

/** One segment of a parsed path. */
export type PathSegment =
  /** A plain property step: `value`. */
  | { kind: 'property'; name: string }
  /** A property that is an array, walked element by element: `data[]`. */
  | { kind: 'array'; name: string }
  /** The terminal step, naming one or more fields of the row: `status` or `{a,b,c}`. */
  | { kind: 'fields'; names: readonly string[] };

export interface ParsedFieldPath {
  readonly raw: string;
  readonly segments: readonly PathSegment[];
  /** The field names the path ends in — one, or several for a brace group. */
  readonly fields: readonly string[];
}

const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BRACE_GROUP = /^\{([^{}]+)\}$/;

/**
 * Parses a Phase 4B field path.
 *
 * @throws FieldPathError when the path uses a shape this extractor does not implement.
 */
export function parseFieldPath(raw: string): ParsedFieldPath {
  const trimmed = raw.trim();
  if (!trimmed) throw new FieldPathError('field path must not be empty');

  const parts = trimmed.split('.');
  const segments: PathSegment[] = [];

  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;

    const braced = BRACE_GROUP.exec(part);
    if (braced) {
      if (!isLast) {
        throw new FieldPathError(
          `"${raw}": a brace group may only be the final segment — it names fields of one row, ` +
            'so nothing can follow it',
        );
      }
      const names = (braced[1] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      if (names.length === 0) throw new FieldPathError(`"${raw}": empty brace group`);
      for (const name of names) {
        if (!SEGMENT.test(name)) {
          throw new FieldPathError(`"${raw}": "${name}" is not a valid field name`);
        }
      }
      segments.push({ kind: 'fields', names });
      return;
    }

    if (part.endsWith('[]')) {
      const name = part.slice(0, -2);
      if (!SEGMENT.test(name)) {
        throw new FieldPathError(`"${raw}": "${part}" is not a valid array segment`);
      }
      if (isLast) {
        throw new FieldPathError(
          `"${raw}": a path may not end in an array segment — name the field to read from each row`,
        );
      }
      segments.push({ kind: 'array', name });
      return;
    }

    if (!SEGMENT.test(part)) {
      throw new FieldPathError(
        `"${raw}": "${part}" is not a supported segment. Only plain properties, "name[]" arrays ` +
          'and a final "{a,b}" group are implemented — see the header of src/state-observation/path.ts',
      );
    }
    segments.push(isLast ? { kind: 'fields', names: [part] } : { kind: 'property', name: part });
  });

  const terminal = segments[segments.length - 1];
  if (!terminal || terminal.kind !== 'fields') {
    throw new FieldPathError(`"${raw}": path does not end in a field`);
  }
  return { raw: trimmed, segments, fields: terminal.names };
}

/** How a field was found — the distinction §7 of the brief requires be kept. */
export type ValuePresence =
  /** The key exists and its value is not null. */
  | 'PRESENT'
  /** The key exists and its value is explicitly null. An observation in its own right. */
  | 'NULL'
  /** The key is not on the row at all. NOT the same as null. */
  | 'ABSENT';

export interface FieldMatch {
  /** The field name read. */
  readonly field: string;
  readonly presence: ValuePresence;
  /** The value exactly as it came back. `undefined` when ABSENT. Never coerced. */
  readonly value: unknown;
  /** The nearest enclosing object — the row the value belongs to. */
  readonly row: Readonly<Record<string, unknown>>;
  /** The enclosing row one level up, for a nested array. */
  readonly parentRow?: Readonly<Record<string, unknown>>;
  /** Concrete location, with indices filled in: `data[0].kallDetails[1].joinStatus`. */
  readonly location: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFields(
  row: Record<string, unknown>,
  fields: readonly string[],
  location: string,
  parentRow: Record<string, unknown> | undefined,
): FieldMatch[] {
  return fields.map((field) => {
    const present = Object.prototype.hasOwnProperty.call(row, field);
    const value = present ? row[field] : undefined;
    const presence: ValuePresence = !present ? 'ABSENT' : value === null ? 'NULL' : 'PRESENT';
    return {
      field,
      presence,
      value,
      row,
      ...(parentRow ? { parentRow } : {}),
      location: `${location}.${field}`,
    };
  });
}

/**
 * Resolves a parsed path against a response body.
 *
 * Returns one `FieldMatch` per (row × field). A path that reaches no row returns an empty array —
 * "the response contained no such rows" is a legitimate outcome, not an error. A row that lacks the
 * field still produces a match, with `presence: 'ABSENT'`; that distinction is the whole point.
 */
export function resolveFieldPath(body: unknown, path: ParsedFieldPath): FieldMatch[] {
  type Cursor = {
    node: unknown;
    location: string;
    row: Record<string, unknown> | undefined;
    parentRow: Record<string, unknown> | undefined;
  };

  let cursors: Cursor[] = [{ node: body, location: '$', row: undefined, parentRow: undefined }];

  for (const segment of path.segments) {
    if (segment.kind === 'fields') break;
    const next: Cursor[] = [];

    for (const cursor of cursors) {
      if (!isRecord(cursor.node)) continue;
      const child = cursor.node[segment.name];

      if (segment.kind === 'property') {
        next.push({
          node: child,
          location: `${cursor.location}.${segment.name}`,
          // Stepping through a plain property does not change which row we are inside.
          row: isRecord(child) ? child : cursor.row,
          parentRow: cursor.parentRow,
        });
        continue;
      }

      if (!Array.isArray(child)) continue;
      child.forEach((element, index) => {
        next.push({
          node: element,
          location: `${cursor.location}.${segment.name}[${index}]`,
          row: isRecord(element) ? element : undefined,
          // Entering a nested array demotes the previous row to the parent.
          parentRow: cursor.row,
        });
      });
    }
    cursors = next;
  }

  const matches: FieldMatch[] = [];
  for (const cursor of cursors) {
    if (!isRecord(cursor.node)) continue;
    matches.push(...readFields(cursor.node, path.fields, cursor.location, cursor.parentRow));
  }
  return matches;
}
