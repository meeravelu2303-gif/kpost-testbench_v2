import { z } from 'zod';

/**
 * Builds a **types-only, open** request schema from a representative payload, for KPost endpoints the
 * workbook documents no schema for (so the generic request validators would otherwise all skip).
 *
 * ## What it is for, and what it deliberately does NOT assert
 *
 * The point is to let the schema-driven probes run on endpoints that had none: `security.injection`
 * and `security.xss` attack the string fields, and `request.data-type` sends a wrong JSON type into a
 * typed field. Those are the test types that were entirely absent on these endpoints, and the first
 * two fail only on a 5xx or a leaked internal — pure signal.
 *
 * It intentionally encodes **no required-ness and no nullability constraint**: every field is
 * `.optional()` and `.nullable()`. That is a safety choice, not laziness. `request.required-fields`
 * fires only on a field the schema marks required, and `request.null-value` only on a non-nullable
 * one; asserting either without evidence from the backend DTO would make the probe expect a 4xx the
 * endpoint never promised and file a false bug on a field the server legitimately treats as optional.
 * Where a field's required-ness IS known from the service source, declare that endpoint's schema by
 * hand instead of using this — this helper is the safe floor, not a substitute for a real contract.
 *
 * It also encodes no formats, ranges or lengths (so `request.format`/`request.boundary-value` stay
 * quiet) and keeps the object **open** (z.object, not strictObject), so `request.unknown-fields` does
 * not fire on a payload the server accepts extra keys on. Types come from the sample's own values; a
 * `null`/`undefined` sample value carries no type, so that field becomes `z.unknown()` and is not
 * fuzzed (there is nothing to be wrong about).
 */
export function typesOnlySchema(sample: Record<string, unknown>): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(sample)) shape[key] = zodForValue(value);
  // Open object: extra keys allowed, so unknown-field probing does not fire against a lenient server.
  return z.object(shape);
}

function zodForValue(value: unknown): z.ZodType {
  // No value, no inferable type — leave it unconstrained so no probe mutates it into a false finding.
  if (value === null || value === undefined) return z.unknown().nullable().optional();
  if (Array.isArray(value)) return z.array(z.unknown()).nullable().optional();
  switch (typeof value) {
    case 'string':
      return z.string().nullable().optional();
    case 'number':
      return z.number().nullable().optional();
    case 'boolean':
      return z.boolean().nullable().optional();
    case 'object':
      // A nested object: keep it open and untyped inside; the top-level string fields are what the
      // injection/XSS probes target, and nested-shape assertions are exactly the false-bug risk above.
      return z.object({}).nullable().optional();
    default:
      return z.unknown().nullable().optional();
  }
}

/**
 * A types-only schema for path parameters. Path segments always travel as strings, so a bare
 * `{ id: z.string() }` is what lets `request.data-type` (coerced) and the path-param handling run on
 * a `/{uuid}` or `/{companyID}` endpoint that had no path schema at all. Every param is required —
 * a path template cannot resolve without its segment, so this is a fact, not a guess.
 */
export function pathParamSchema(...names: string[]): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const name of names) shape[name] = z.string();
  return z.object(shape);
}
