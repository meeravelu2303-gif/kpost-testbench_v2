import type { RequestSpec } from '@api/client/request-builder';
import type { JsonSchema } from '@api/schema/contract-schema';
import type { FakeResponse } from './validator-harness';

/**
 * Fixtures for the validator unit tests, shaped like the real KPost API envelope
 * (`status` / `statusCode` / `message` / `data`) and a Katchup-like message send.
 */

// ---------------------------------------------------------------- request contract

/**
 * A send-message body with one field of every type a request validator mutates. `subject` and
 * `tags` carry `minLength`/`minItems` so the empty-value validator has something to enforce.
 */
export const SEND_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['subject', 'actualMessage', 'priority', 'secret', 'tags'],
  properties: {
    subject: { type: 'string', minLength: 1 },
    actualMessage: { type: 'string' },
    priority: { type: 'integer' },
    secret: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
    note: { type: ['string', 'null'] },
  },
};

/** The same body as KPost's workbook contracts describe it: types only, no constraints. */
export const SEND_SCHEMA_UNCONSTRAINED: JsonSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    actualMessage: { type: 'string' },
    priority: { type: 'integer' },
    secret: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    note: { type: ['string', 'null'] },
  },
};

/** A body with no string field at all: nothing for injection/XSS to attack. */
export const NUMERIC_ONLY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { companyID: { type: 'integer' }, page: { type: 'integer' } },
};

/** A valid request against SEND_SCHEMA. */
export const VALID_SEND: RequestSpec = {
  body: {
    subject: 'QA bench subject',
    actualMessage: 'hello from the validator harness',
    priority: 1,
    secret: false,
    tags: ['qa'],
    note: null,
  },
};

export const VALID_NUMERIC: RequestSpec = { body: { companyID: 242, page: 1 } };

// ---------------------------------------------------------------- response contract

/** A fetchUserDetails-like success body. */
export const USER_SCHEMA_STRICT: JsonSchema = {
  type: 'object',
  required: ['status', 'statusCode', 'data'],
  additionalProperties: false,
  properties: {
    status: { type: 'string' },
    statusCode: { type: 'integer' },
    urlPath: { type: 'string' },
    data: {
      type: 'object',
      required: ['firstName', 'kpostID', 'countryID'],
      additionalProperties: false,
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        kpostID: { type: 'string' },
        countryID: { type: 'integer' },
      },
    },
  },
};

/** The same shape with open objects and no `required` — how most real contracts are written. */
export const USER_SCHEMA_OPEN: JsonSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    statusCode: { type: 'integer' },
    data: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        kpostID: { type: 'string' },
        countryID: { type: 'integer' },
      },
    },
  },
};

const USER = {
  firstName: 'Qa',
  lastName: 'Bench',
  kpostID: 'qatest1@kpost.in',
  countryID: 1,
};

/** Captured responses, one per scenario the validators must judge. */
export const RESPONSES = {
  clean: {
    status: 200,
    body: { status: 'SUCCESS', statusCode: 200, urlPath: 'fetchUserDetails', data: USER },
  },
  /** `countryID` came back as a string: type drift. */
  typeDrift: {
    status: 200,
    body: { status: 'SUCCESS', statusCode: 200, data: { ...USER, countryID: '1' } },
  },
  /** `kpostID` is missing from the payload. */
  missingField: {
    status: 200,
    body: {
      status: 'SUCCESS',
      statusCode: 200,
      data: { firstName: 'Qa', countryID: 1 },
    },
  },
  /** An undocumented field leaked into the payload. */
  unexpectedField: {
    status: 200,
    body: { status: 'SUCCESS', statusCode: 200, data: { ...USER, passwordHash: 'x' } },
  },
  /** Every field dropped: only the envelope is left. */
  hollow: { status: 200, body: { status: 'SUCCESS', statusCode: 200, data: {} } },
  /** Body claims JSON but is truncated. */
  malformedJson: {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{"status":"SUCCESS","data":{"firstName":"Qa"',
  },
  /** 204 with no body. */
  noContent: { status: 204, headers: {}, body: '' },
  /** No HTTP response at all. */
  noResponse: {
    status: 0,
    transportError: { kind: 'network', message: 'read ECONNRESET' },
  },
  serverError: {
    status: 500,
    body: { status: 'FAILURE', statusCode: 500, message: 'Internal Server Error' },
  },
  notFound: { status: 404, body: { status: 'FAILURE', statusCode: 404, message: 'Not Found' } },
  created: { status: 201, body: { status: 'SUCCESS', statusCode: 201, data: USER } },
} satisfies Record<string, FakeResponse>;

/** Error bodies a misbehaving server leaks when an attack payload reaches the database. */
export const LEAKY_ERRORS = {
  mysql: {
    status: 400,
    body: {
      status: 'FAILURE',
      message: "You have an error in your SQL syntax; check the manual near ''1'='1' --' at line 1",
    },
  },
  stackTrace: {
    status: 400,
    body: {
      status: 'FAILURE',
      message:
        'java.lang.NullPointerException at com.kpost.katchup.SendService.send(SendService.java:88)',
    },
  },
} satisfies Record<string, FakeResponse>;
