import kmailSource from './source/kmail-api.source.json' with { type: 'json' };
import kpostSource from './source/kpost-api.source.json' with { type: 'json' };
import { env } from '@config/env';
import type { SuiteId } from '@config/ownership.config';
import { isPlainObject } from '@utils/json';
import type { JsonSchema } from '../schema/contract-schema';

/**
 * Response contracts read from the backend source, for the endpoints the workbook documents no
 * response for. The workbook still wins: these fill in only where it is silent. Each entry names
 * the controller method it was read from, and none is adopted until a live QA response matched it
 * (`liveCheck`), so "never invent a contract" holds: the code and the live server both say so.
 *
 * Data: `src/api/contract/source/<suite>.source.json` (bench-maintained, not generated).
 */
export interface SourceEndpointContract {
  /** Controller file, line and method, e.g. `ProfileController.java:212 getProfileDetails`. */
  handler: string;
  /** Envelope key carrying the payload; null when the payload is spread over top-level keys. */
  payloadKey: string | null;
  /** Keys the success map always gets. */
  envelopeKeys: string[];
  /** JSON Schema of the payload under `payloadKey` (or of the whole body when that is "body"). */
  dataSchema?: JsonSchema;
  /** JSON Schema of the extra top-level keys, when `payloadKey` is null. */
  topLevel?: JsonSchema;
  /** HTTP status of a success (KPost and KMail mostly 200; a few answer 202, 204 or 303). */
  successStatus?: number;
  /** The failure answers the code can give, for the negative tests (null: the body has no such key). */
  failures?: {
    httpStatus?: number | null;
    statusCode?: number | null;
    status?: string | null;
    when: string;
    keys?: string[];
  }[];
  confidence: 'high' | 'medium' | 'low';
  /**
   * What a live QA response said: `matched YYYY-MM-DD`, `adjusted YYYY-MM-DD: <what>` (the code
   * copy was older than the server), or `not-run: <why>` (the entry is then not used).
   */
  liveCheck: string;
  evidence: string[];
  notes?: string;
}

interface SourceDocument {
  suite: string;
  derivedFrom: string;
  derivedOn: string;
  endpoints: Record<string, SourceEndpointContract>;
}

const DOCUMENTS: Partial<Record<SuiteId, SourceDocument>> = {
  'kpost-api': kpostSource as SourceDocument,
  'kmail-api': kmailSource as SourceDocument,
};

/** The raw source entry for an endpoint id, adopted or not (coverage self-tests read all of them). */
export function sourceContractEntry(
  suite: SuiteId,
  id: string,
): SourceEndpointContract | undefined {
  return DOCUMENTS[suite]?.endpoints[id];
}

/** Every endpoint id a suite's source file describes. */
export function sourceContractIds(suite: SuiteId): string[] {
  return Object.keys(DOCUMENTS[suite]?.endpoints ?? {});
}

/** An entry is used only once a live response agreed with it (or while trialling them all). */
export function isAdopted(entry: SourceEndpointContract): boolean {
  return env.SOURCE_CONTRACT_TRIAL || /^(matched|adjusted)\b/.test(entry.liveCheck);
}

/**
 * The whole-body response schema for an endpoint (KPost and KMail schemas describe the body), plus
 * a citation for the failure message. Envelope fields are left to `response.structure`; this only
 * types the payload.
 */
export function sourceResponseSchema(
  suite: SuiteId,
  id: string,
): { schema: JsonSchema; source: string } | undefined {
  const entry = sourceContractEntry(suite, id);
  if (!entry || !isAdopted(entry)) return undefined;
  const source = `backend source ${entry.handler} (${entry.liveCheck})`;

  if (entry.payloadKey === 'body') {
    return entry.dataSchema ? { schema: entry.dataSchema, source } : undefined;
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (entry.payloadKey && entry.dataSchema) {
    properties[entry.payloadKey] = entry.dataSchema;
    if (entry.envelopeKeys.includes(entry.payloadKey)) required.push(entry.payloadKey);
  }
  if (entry.topLevel && isPlainObject(entry.topLevel.properties)) {
    Object.assign(properties, entry.topLevel.properties);
    if (Array.isArray(entry.topLevel.required))
      required.push(
        ...entry.topLevel.required.filter((key): key is string => typeof key === 'string'),
      );
  }
  if (Object.keys(properties).length === 0) return undefined;
  return {
    schema: unlessFailure({ properties, ...(required.length ? { required } : {}) }),
    source,
  };
}

/**
 * The code's schema describes its success answer. Many endpoints may also legitimately answer a
 * FAILURE (a missing record: 404), and that body belongs to `response.error-format`, so a body that
 * says FAILURE or error (any case) is not checked here. A body with no `status` at all (KNews, AI)
 * is a success and is checked.
 */
function unlessFailure(schema: JsonSchema): JsonSchema {
  return {
    type: 'object',
    if: {
      properties: { status: { pattern: '^([Ff][Aa][Ii][Ll][Uu][Rr][Ee]|[Ee][Rr][Rr][Oo][Rr])$' } },
      required: ['status'],
    },
    else: schema,
  };
}
