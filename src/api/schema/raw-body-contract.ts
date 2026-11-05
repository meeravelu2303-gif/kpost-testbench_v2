import type { ApiResponseWrapper } from '../client/response-wrapper';
import { formatIssues, toJsonSchema, validateSchema, type ContractSchema } from './contract-schema';

/**
 * Contracts for answers that are not JSON: raw file bytes (an image, an attachment, a signature) and
 * bare text (the public key). A JSON Schema cannot type raw bytes, so the backend-source entries say it
 * with `contentEncoding: "binary"` (and `contentMediaType`, `a|b` when either is allowed), or with a
 * `description` naming the bytes; a text answer is `type: "string"` with its pattern and length.
 * Used by `response.schema` (the engine) and by the flow check in endpoint-executor.ts, so both read a
 * non-JSON contract the same way.
 */
export type RawBodyVerdict =
  { applies: false; reason: string } | { applies: true; issues: string[]; what: string };

const mediaType = (value: string | undefined): string | undefined =>
  value?.split(';')[0]?.trim().toLowerCase();

function kind(schema: ContractSchema): 'binary' | 'text' | undefined {
  const json = toJsonSchema(schema);
  if (json.contentEncoding === 'binary') return 'binary';
  if (
    json.type === undefined &&
    /\b(bytes?|binary)\b/i.test(typeof json.description === 'string' ? json.description : '')
  )
    return 'binary';
  if (json.type === 'string') return 'text';
  return undefined;
}

/** True when the endpoint's contract describes a non-JSON body. */
export function isRawBodyContract(schema: ContractSchema | undefined): boolean {
  return schema !== undefined && kind(schema) !== undefined;
}

/** A successful answer checked against a non-JSON contract. */
export function rawBodyVerdict(
  schema: ContractSchema | undefined,
  exchange: ApiResponseWrapper,
): RawBodyVerdict {
  const type = schema ? kind(schema) : undefined;
  if (!schema || !type) return { applies: false, reason: 'not a non-JSON contract' };
  if (
    exchange.status < 200 ||
    exchange.status >= 300 ||
    exchange.status === 204 ||
    !exchange.hasBody
  )
    return { applies: false, reason: `no content to compare (HTTP ${exchange.status})` };

  if (type === 'text') {
    const issues = validateSchema(schema, exchange.bodyText);
    return {
      applies: true,
      what: 'text body',
      issues: issues.length ? [formatIssues(issues)] : [],
    };
  }

  const json = toJsonSchema(schema);
  const declared = mediaType(exchange.contentType);
  const actual = exchange.magicType;
  const allowed =
    typeof json.contentMediaType === 'string'
      ? json.contentMediaType.split('|').map((m) => m.trim().toLowerCase())
      : undefined;
  const issues: string[] = [];
  if (exchange.json().ok) issues.push('a JSON body where the source code says raw bytes');
  if (actual && declared && declared !== actual && declared !== 'application/octet-stream')
    issues.push(`Content-Type is ${declared} but the bytes are ${actual}`);
  // As response.binary-content does: a body labelled as an image must be one.
  if (!actual && declared?.startsWith('image/'))
    issues.push(`Content-Type is ${declared} but the bytes are not an image`);
  const served = actual ?? declared;
  if (allowed && served && !allowed.includes(served))
    issues.push(`${served}, where the source code says ${allowed.join(' or ')}`);
  return { applies: true, what: `binary body (${served ?? 'untyped'})`, issues };
}
