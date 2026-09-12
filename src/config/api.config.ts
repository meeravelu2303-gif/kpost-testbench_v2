import { z } from 'zod';
import type { HttpMethod } from '@api/client/request-builder';

/**
 * The API contract shared by every KPost endpoint. Validators read it from here, so a contract
 * change (e.g. a new envelope field or security header) is a one-line change for all endpoints.
 */

const paginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

const metadataSchema = z.object({
  correlationId: z.string().min(1),
  timestamp: z.iso.datetime({ offset: true }),
  pagination: paginationSchema.optional(),
});

export const successEnvelopeSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  data: z.unknown(),
  metadata: metadataSchema,
});

export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  status: z.number().int().min(400).max(599),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'error code must be UPPER_SNAKE_CASE'),
  message: z.string().min(1),
  errors: z
    .array(z.object({ field: z.string().optional(), message: z.string().min(1) }))
    .optional(),
  metadata: metadataSchema,
});

export type Pagination = z.infer<typeof paginationSchema>;

export const apiConfig = {
  defaultContentType: 'application/json',
  correlationHeader: 'x-correlation-id',

  defaultExpectedStatus: {
    GET: [200],
    POST: [201],
    PUT: [200],
    PATCH: [200],
    DELETE: [204],
  } as Record<HttpMethod, readonly number[]>,

  /** Status codes accepted when the framework sends a deliberately invalid request. */
  invalidRequestStatus: [400, 422] as readonly number[],
  invalidPathParamStatus: [400, 404] as readonly number[],
  malformedJsonStatus: [400] as readonly number[],
  rateLimitStatus: 429,

  requiredResponseHeaders: ['x-correlation-id'] as readonly string[],

  securityHeaders: {
    'x-content-type-options': /^nosniff$/i,
    'x-frame-options': /^(deny|sameorigin)$/i,
    'content-security-policy': /\S/,
    'referrer-policy': /\S/,
    'cache-control': /no-store/i,
  } as Record<string, RegExp>,
  /** HSTS is only meaningful (and only required) over HTTPS. */
  hstsHeader: 'strict-transport-security',
  /** Headers that reveal the technology stack. */
  disclosureHeaders: [
    'x-powered-by',
    'x-aspnet-version',
    'x-aspnetmvc-version',
  ] as readonly string[],

  /** Expected machine-readable error code per HTTP status (others only need a valid format). */
  errorCodeByStatus: {
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
  } as Record<number, string>,

  pagination: { maxPageSize: 100 },

  /** Naming conventions used by the common data validators to find typed fields in responses. */
  dataConventions: {
    id: {
      field: /^(id|[a-z][a-zA-Z0-9]*Id)$/,
      value: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    },
    email: { field: /^(email|[a-z][a-zA-Z0-9]*Email)$/ },
    date: { field: /^[a-z][a-zA-Z0-9]*(At|Date)$/ },
    url: { field: /^(url|website|[a-z][a-zA-Z0-9]*Url)$/ },
    boolean: { field: /^((is|has|can)[A-Z][a-zA-Z0-9]*|enabled|active|deleted)$/ },
  },

  unknownFieldName: '__unexpectedField',
} as const;
