import { z } from 'zod';
import type { HttpMethod } from '@api/client/request-builder';
import { apiConfig, errorEnvelopeSchema, successEnvelopeSchema } from './api.config';

/**
 * The shape an API's responses take, declared once per API rather than per endpoint.
 *
 * ## Why this exists
 *
 * The central validators used to assert one hard-coded envelope — `{ success, data, metadata }`
 * with `correlationId`, a POST answering 201, and an `x-correlation-id` header. That is a sound
 * design, but **it is not what KPost returns**. KPost answers
 *
 *     { "status": "SUCCESS", "statusCode": 200, "urlPath": "sendOTP", "message": "...", "data": … }
 *
 * with 200 on a POST, no metadata block and no correlation header. Validating KPost against the
 * other contract fails every endpoint for a reason that says nothing about the API — the worst
 * kind of test result, because it buries real defects under noise.
 *
 * So the envelope becomes data: an endpoint names the contract it follows, and the validators read
 * it from here. Adding an API means adding a profile, not editing validators.
 *
 * ## Where the KPost profile comes from
 *
 * Measured, not assumed — every documented success sample in the workbook (119 of them):
 *
 *     status      108/119     always the string "SUCCESS"
 *     urlPath     104/119     the endpoint's own name
 *     statusCode   99/119     mirrors the HTTP status
 *     data         67/119     the payload, when there is one
 *     message      50/119     human-readable text
 *
 * Some responses add domain fields alongside those (`mobileNumber`, `eventID`), so the envelope is
 * **open**: unknown top-level keys are allowed. All 11 samples without `status` are KDiary
 * (`/dairySchedule/*`) and one KMail dashboard route — none in the modules using this profile; when
 * KDiary is tested it gets its own profile rather than a weakened shared one.
 *
 * ## What is deliberately absent
 *
 * `error` is **undefined** for KPost: the workbook documents no error response at all — no 400,
 * 401, 404 or 409 sample anywhere (see `contracts/excel-gaps.md`, "not per-row"). A validator that
 * cannot know the contract must say so, so error-format validation SKIPS with that reason instead
 * of inventing a shape and passing. Status codes on error responses are still asserted; only their
 * body shape is unknown.
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
   * What an endpoint's `responseSchema` describes: the whole body, or just the payload under
   * `dataKey`. KPost's schemas are generated from full documented samples, envelope included.
   */
  schemaTarget: 'body' | 'data';
  /** True when the envelope carries a metadata block with correlationId + timestamp. */
  metadata: boolean;
  /** True when an error body repeats the HTTP status numerically. */
  errorStatusInBody: boolean;
  /** Field carrying that number (`status` in the reference contract, `statusCode` in KPost). */
  errorStatusField: string;
  /** Headers every response of this API must carry. */
  requiredHeaders: readonly string[];
  /** Status a successful call returns, per method. */
  expectedStatus: Record<HttpMethod, readonly number[]>;
  /** Whether the correlation header sent is expected to be echoed back. */
  echoesCorrelationId: boolean;
  /**
   * What an identifier looks like in this API. KPost uses auto-increment integers
   * (`countryID: 1`, `id: 790`); the bench's reference contract uses UUIDs. Holding KPost ids to
   * a UUID shape produced 243 failures on a single states lookup and said nothing true.
   */
  idFormat: { pattern: RegExp; description: string };
}

export type ResponseContractId = 'standard' | 'kpost';

/**
 * KPost's live envelope. `looseObject` keeps it open — a response may carry its own top-level
 * fields, and flagging those as structural violations would be wrong.
 */
const kpostSuccessEnvelope = z.looseObject({
  status: z.string().regex(/^success$/i, 'status must be SUCCESS'),
  statusCode: z.number().int().optional(),
  urlPath: z.string().optional(),
  message: z.string().optional(),
});

/**
 * KPost's error envelope, **observed on the live API rather than documented**.
 *
 * The workbook contains no error sample at all, so this was derived by probing 192.168.0.66 with
 * a bad type, an unknown path, a wrong OTP and malformed JSON. Every one answered in this shape:
 *
 *     { "status": "FAILURE", "statusCode": 409, "message": "…",
 *       "urlPath": "/v2/common/getTotalCountByDate",
 *       "timestamp": "2026-09-12T12:59:20.705+05:30", "traceId": "038788be-…" }
 *
 * Two deliberate loosenings, both forced by what the API actually does:
 *
 *  - `status` is matched case-insensitively. The framework layer answers `"FAILURE"` while a
 *    handler answers `"Failure"` - the same inconsistency the success envelope shows between
 *    `"SUCCESS"` and `"Success"`. Reported once as its own finding, not 300 times as noise.
 *  - `timestamp` and `traceId` are optional: a routing 404 omits them, a handled error includes
 *    them. Requiring a traceId would fail the 404s, and losing the traceId on a 500 is itself
 *    worth knowing, so it is reported rather than asserted.
 *
 * Because it is inferred, it stays open (`looseObject`). If the API team documents the contract,
 * replace this with the documented shape - the comment is the audit trail for why it looks like
 * this.
 */
const kpostErrorEnvelope = z.looseObject({
  status: z.string().regex(/^(failure|error)$/i, 'error status must be FAILURE'),
  statusCode: z.number().int().min(400).max(599),
  message: z.string().min(1),
  urlPath: z.string().optional(),
  timestamp: z.string().optional(),
  traceId: z.string().optional(),
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
};

export const DEFAULT_RESPONSE_CONTRACT: ResponseContractId = 'standard';

export function responseContract(id: ResponseContractId | undefined): ResponseContract {
  return RESPONSE_CONTRACTS[id ?? DEFAULT_RESPONSE_CONTRACT];
}
