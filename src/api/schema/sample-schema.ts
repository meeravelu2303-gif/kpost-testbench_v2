import { z } from 'zod';

/**
 * Builds a types-only, open request schema from a sample payload, so injection, XSS and data-type
 * probes can run. Every field is optional and nullable, with no formats: nothing is asserted
 * without evidence.
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
      // Nested objects stay open and untyped; the probes target top-level strings.
      return z.object({}).nullable().optional();
    default:
      return z.unknown().nullable().optional();
  }
}

/**
 * What a path parameter really carries, read from the backend (KPOST_V5.0 @PathVariable types and
 * the values they hold), so the negative fuzzers have something to break: until 2026-11-05 every
 * path parameter was a bare string, so `request.data-type`/`request.format` never produced a case
 * and no path-keyed endpoint got a single negative probe. Names not listed stay plain strings.
 */
const PATH_PARAM_TYPES: Readonly<Record<string, () => z.ZodType>> = {
  // `long`/`Long` path variables (CommonControllerV2 getCompanyLogo, KatchupControllerV2
  // getSharedMessageDetails / getDeletedKatchupMsgIds, AdminController userManagementDetails).
  companyID: () => z.number().int(),
  msgID: () => z.number().int(),
  lastMsgID: () => z.number().int(),
  // An attachment's S3 key is a UUID (PresignedURLController mints it).
  uuid: () => z.uuid(),
  // KPost IDs are e-mail-form ("qatest1@kpostindia.com"); a group's id is one too.
  kpostID: () => z.email(),
  kpostId: () => z.email(),
  groupKpostID: () => z.email(),
};

/** A schema for path parameters, all required (a path cannot resolve without them). */
export function pathParamSchema(...names: string[]): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const name of names) shape[name] = PATH_PARAM_TYPES[name]?.() ?? z.string();
  return z.object(shape);
}
