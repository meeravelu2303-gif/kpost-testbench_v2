import { z } from 'zod';
import type { HttpMethod } from '@api/client/request-builder';
import { apiConfig, errorEnvelopeSchema, successEnvelopeSchema } from './api.config';

/**
 * The shape an API's responses take, declared once per API; endpoints name the contract they follow
 * and the validators read it from here. Envelopes are open: extra top-level keys are allowed.
 */
export interface ResponseContract {
  id: ResponseContractId;
  description: string;
  /** Envelope of a successful response. */
  success: z.ZodType;
  /** Envelope of an error response — `undefined` when the API does not document one. */
  error?: z.ZodType;
  /** Key holding the payload, if the envelope wraps one. */
  dataKey?: string;
  /**
   * Whether an endpoint's `responseSchema` describes the whole body or just the payload under
   * `dataKey`.
   */
  schemaTarget: 'body' | 'data';
  /** True when the envelope carries a metadata block with correlationId + timestamp. */
  metadata: boolean;
  /** True when an error body repeats the HTTP status numerically. */
  errorStatusInBody: boolean;
  /** Field carrying that number (`status` in the reference contract, `statusCode` in KPost). */
  errorStatusField: string;
  /** Field holding a machine-readable error code, when the API has one (KPost does not). */
  errorCodeField?: string;
  /** Headers every response of this API must carry. */
  requiredHeaders: readonly string[];
  /** Status a successful call returns, per method. */
  expectedStatus: Record<HttpMethod, readonly number[]>;
  /** Whether the correlation header sent is expected to be echoed back. */
  echoesCorrelationId: boolean;
  /** What an identifier looks like in this API (KPost: integers; reference contract: UUIDs). */
  idFormat: { pattern: RegExp; description: string };
}

export type ResponseContractId = 'standard' | 'kpost' | 'kmail' | 'admin';

/** KPost's success envelope; open, since responses may carry their own top-level fields. */
const kpostSuccessEnvelope = z.looseObject({
  status: z.string().regex(/^success$/i, 'status must be SUCCESS'),
  statusCode: z.number().int().optional(),
  urlPath: z.string().optional(),
  message: z.string().optional(),
});

/**
 * KPost's error envelope, observed live (the workbook documents none). `status` is case-insensitive
 * (FAILURE vs Failure); `timestamp`/`traceId` are optional because routing 404s omit them.
 */
const kpostErrorEnvelope = z.looseObject({
  status: z.string().regex(/^(failure|error)$/i, 'error status must be FAILURE'),
  statusCode: z.number().int().min(400).max(599),
  message: z.string().min(1),
  urlPath: z.string().optional(),
  timestamp: z.string().optional(),
  traceId: z.string().optional(),
});

/**
 * KMail's envelope: payload under `value`, no `statusCode`. Its error shape is unknown, so
 * error-format checks skip.
 */
const kmailSuccessEnvelope = z.looseObject({
  status: z.string().regex(/^success$/i, 'status must be SUCCESS'),
  urlPath: z.string().optional(),
});

/**
 * The Admin module envelope, from the backend source: payload under `value`, any handled failure is
 * HTTP 500 with `status: FAILURE`. Ids are 24-hex MongoDB ObjectIds.
 */
const adminSuccessEnvelope = z.looseObject({
  status: z.string().regex(/^success$/i, 'status must be SUCCESS'),
  statusCode: z.number().int().optional(),
  urlPath: z.string().optional(),
});

const adminErrorEnvelope = z.looseObject({
  status: z.string().regex(/^(failure|error)$/i, 'error status must be FAILURE'),
  statusCode: z.number().int().min(400).max(599),
  urlPath: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

export const RESPONSE_CONTRACTS: Record<ResponseContractId, ResponseContract> = {
  /** The bench's own reference contract, used by the mock-backed framework self-tests. */
  standard: {
    id: 'standard',
    description: 'success/data/metadata envelope with a correlation ID',
    success: successEnvelopeSchema,
    error: errorEnvelopeSchema,
    dataKey: 'data',
    schemaTarget: 'data',
    metadata: true,
    errorStatusInBody: true,
    errorStatusField: 'status',
    errorCodeField: 'code',
    requiredHeaders: apiConfig.requiredResponseHeaders,
    expectedStatus: apiConfig.defaultExpectedStatus,
    echoesCorrelationId: true,
    idFormat: { pattern: apiConfig.dataConventions.id.value, description: 'a UUID' },
  },

  /** The real KPost API, derived from the workbook's documented samples. */
  kpost: {
    id: 'kpost',
    description: 'KPost envelope: status/statusCode/urlPath/message with an optional data payload',
    success: kpostSuccessEnvelope,
    error: kpostErrorEnvelope,
    dataKey: 'data',
    schemaTarget: 'body',
    metadata: false,
    errorStatusInBody: true,
    errorStatusField: 'statusCode',
    requiredHeaders: [],
    // KPost answers 200 on a create, not 201: every documented POST sample shows statusCode 200.
    expectedStatus: {
      GET: [200],
      POST: [200],
      PUT: [200],
      PATCH: [200],
      DELETE: [200],
    },
    echoesCorrelationId: false,
    // Integers, in a string or a number: `{"countryID": 1}` and `{"fieldCount": "6"}` both occur.
    idFormat: { pattern: /^\d+$/, description: 'a positive integer' },
  },

  /** The Admin module, measured from the backend source (`ApiResponseEnvelope.java`). */
  admin: {
    id: 'admin',
    description: 'Admin envelope: status/statusCode/urlPath with the payload under `value`',
    success: adminSuccessEnvelope,
    error: adminErrorEnvelope,
    dataKey: 'value',
    schemaTarget: 'body',
    metadata: false,
    errorStatusInBody: true,
    errorStatusField: 'statusCode',
    requiredHeaders: [],
    expectedStatus: { GET: [200], POST: [200], PUT: [200], PATCH: [200], DELETE: [200] },
    echoesCorrelationId: false,
    // MongoDB ObjectIds: 24 hex characters.
    idFormat: { pattern: /^[0-9a-fA-F]{24}$/, description: 'a 24-character hex ObjectId' },
  },

  /** The KMail module, measured from its own documented samples. */
  kmail: {
    id: 'kmail',
    description: 'KMail envelope: status/urlPath with the payload under `value`',
    success: kmailSuccessEnvelope,
    error: undefined,
    dataKey: 'value',
    schemaTarget: 'body',
    metadata: false,
    errorStatusInBody: false,
    errorStatusField: 'statusCode',
    requiredHeaders: [],
    expectedStatus: { GET: [200], POST: [200], PUT: [200], PATCH: [200], DELETE: [200] },
    echoesCorrelationId: false,
    idFormat: { pattern: /^\d+$/, description: 'a positive integer' },
  },
};

export const DEFAULT_RESPONSE_CONTRACT: ResponseContractId = 'standard';

export function responseContract(id: ResponseContractId | undefined): ResponseContract {
  return RESPONSE_CONTRACTS[id ?? DEFAULT_RESPONSE_CONTRACT];
}
