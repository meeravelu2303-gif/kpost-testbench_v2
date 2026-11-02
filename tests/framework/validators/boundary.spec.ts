import type { JsonSchema } from '@api/schema/contract-schema';
import { expect, test } from '@fixtures';
import { boundaryAcceptValidator } from '@validators/request/boundary-accept.validator';
import { boundaryValueValidator } from '@validators/request/boundary-value.validator';
import { SEND_SCHEMA_UNCONSTRAINED, VALID_SEND } from './support/fixtures';
import {
  acceptsEverything,
  crashesOnEverything,
  fakeContext,
  fixtureEndpoint,
  probeBody,
  rejectsEverything,
  verdict,
  type FakeServer,
} from './support/validator-harness';

/**
 * The boundary validators (`request.boundary-value`, `request.boundary-accept`), offline: a value
 * one past a limit must be refused, a value exactly at it must never crash the server, array bodies
 * and array items are reached, and a valid edge value that landed is put back afterwards.
 */

/** A profile-contact-like body: limits as `source-limits.ts` writes them into the schema. */
const CONTACT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    city: { type: 'string', maxLength: 25 },
    pinCode: { type: 'string', minLength: 3, maxLength: 12 },
    members: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
  },
};
const VALID_CONTACT = { body: { city: 'Chennai', pinCode: '600001', members: ['qatest2'] } };

/** An Admin-save-like body: a JSON array whose items carry the limit. */
const ARRAY_SCHEMA: JsonSchema = {
  type: 'array',
  items: { type: 'object', properties: { attributeName: { type: 'string', minLength: 3 } } },
};
const VALID_ARRAY = { body: [{ attributeName: 'QA Tier' }] };

const contactContext = (server: FakeServer, overrides = {}) =>
  fakeContext({
    endpoint: fixtureEndpoint({ method: 'POST', requestSchema: CONTACT_SCHEMA, ...overrides }),
    request: VALID_CONTACT,
    server,
  });

const caseNames = (context: ReturnType<typeof contactContext>) =>
  context.sent.map((p) => p.options.label);

test.describe('validator unit · request.boundary-value', { tag: '@framework' }, () => {
  test('known-good: every value one past a limit is refused → PASSED', async () => {
    const context = contactContext(rejectsEverything);
    const result = await verdict(boundaryValueValidator, context);
    expect(result.status).toBe('PASSED');
    expect(caseNames(context)).toEqual([
      'request.boundary-value:body.city: length 26 (maxLength 25)',
      'request.boundary-value:body.pinCode: length 2 (minLength 3)',
      'request.boundary-value:body.pinCode: length 13 (maxLength 12)',
      'request.boundary-value:body.members: 0 items (minItems 1)',
      'request.boundary-value:body.members: 4 items (maxItems 3)',
    ]);
  });

  test('a digits-only field is filled with digits, so only its length is wrong', async () => {
    const context = contactContext(rejectsEverything);
    await verdict(boundaryValueValidator, context);
    expect(probeBody(context, 1).pinCode).toBe('99');
    expect(probeBody(context, 2).pinCode).toBe('9'.repeat(13));
    // Text gets the distinctive filler the maintenance cleanup removes.
    expect(probeBody(context, 0).city).toBe('qaboundaryqaboundaryqaboun');
    expect(String(probeBody(context, 0).city)).toHaveLength(26);
  });

  test('an id never gets an edge value above its maximum (it could name a real record)', async () => {
    const context = fakeContext({
      endpoint: fixtureEndpoint({
        method: 'POST',
        requestSchema: {
          type: 'object',
          properties: { kallID: { type: 'integer', minimum: 1, maximum: 99 } },
        },
      }),
      request: { body: { kallID: 50 } },
      server: rejectsEverything,
    });
    await verdict(boundaryValueValidator, context);
    expect(caseNames(context)).toEqual(['request.boundary-value:body.kallID: 0 (minimum 1)']);
  });

  test('a JSON-array body is reached through its items', async () => {
    const context = fakeContext({
      endpoint: fixtureEndpoint({ method: 'POST', requestSchema: ARRAY_SCHEMA }),
      request: VALID_ARRAY,
      server: rejectsEverything,
    });
    const result = await verdict(boundaryValueValidator, context);
    expect(result.status).toBe('PASSED');
    expect(context.sent).toHaveLength(1);
    expect(context.sent[0]!.spec.body).toEqual([{ attributeName: 'qa' }]);
  });

  test('known-bad: a crash on an over-long value → FAILED, naming the field', async () => {
    const crashOnLongCity: FakeServer = (spec, options) =>
      String((spec.body as Record<string, unknown>).city).length > 25
        ? crashesOnEverything(spec, options)
        : rejectsEverything(spec, options);
    const result = await verdict(boundaryValueValidator, contactContext(crashOnLongCity));
    expect(result.status).toBe('FAILED');
    expect(result.message).toContain('body.city: length 26 (maxLength 25)');
  });

  // Pinned: without limits (the workbook's types-only bodies) there is nothing to send.
  test('SKIPPED: a types-only contract gives it nothing to send', async () => {
    const context = fakeContext({
      endpoint: fixtureEndpoint({ method: 'POST', requestSchema: SEND_SCHEMA_UNCONSTRAINED }),
      request: VALID_SEND,
      server: acceptsEverything,
    });
    const result = await verdict(boundaryValueValidator, context);
    expect(result.status).toBe('SKIPPED');
    expect(context.sent).toHaveLength(0);
  });
});

test.describe('validator unit · request.boundary-accept', { tag: '@framework' }, () => {
  test('known-good: values exactly at each limit are taken → PASSED, then the record is put back', async () => {
    const context = contactContext(acceptsEverything);
    const result = await verdict(boundaryAcceptValidator, context);
    expect(result.status).toBe('PASSED');
    expect(caseNames(context)).toEqual([
      'request.boundary-accept:body.city: length 25 (maxLength)',
      'request.boundary-accept:body.pinCode: length 12 (maxLength)',
      'request.boundary-accept:body.pinCode: length 3 (minLength)',
      'request.boundary-accept:body.members: 3 items (maxItems)',
      'request.boundary-accept:restore',
    ]);
    // The minItems edge (1 item) equals the valid request, so it is not sent twice.
    expect(context.sent.at(-1)!.spec).toEqual(VALID_CONTACT);
  });

  test('a 4xx at the edge is not judged (a business rule may refuse it), only a crash is', async () => {
    const result = await verdict(boundaryAcceptValidator, contactContext(rejectsEverything));
    expect(result.status).toBe('PASSED');
  });

  test('known-bad: the column is narrower than the API allows → a 5xx at the edge FAILS', async () => {
    const crashAtEdge: FakeServer = (spec, options) =>
      String((spec.body as Record<string, unknown>).city).length === 25
        ? crashesOnEverything(spec, options)
        : acceptsEverything(spec, options);
    const result = await verdict(boundaryAcceptValidator, contactContext(crashAtEdge));
    expect(result.status).toBe('FAILED');
    expect(result.message).toContain('body.city: length 25 (maxLength)');
  });

  test('SKIPPED: an account-wide or OTP endpoint never gets a valid edge value', async () => {
    for (const overrides of [
      { sideEffect: 'global' as const },
      { otpDependent: 'requires' as const },
    ]) {
      const context = contactContext(acceptsEverything, overrides);
      const result = await verdict(boundaryAcceptValidator, context);
      expect(result.status).toBe('SKIPPED');
      expect(context.sent).toHaveLength(0);
    }
  });

  // Found live on 2026-11-01: kallID 1 (the "minimum") went to endKoolKall and modifyKallMembers.
  test('an id never gets an edge value: kallID 1 is someone else’s call', async () => {
    const context = fakeContext({
      endpoint: fixtureEndpoint({
        method: 'POST',
        requestSchema: {
          type: 'object',
          properties: { kallID: { type: 'integer', minimum: 1 }, group_id: { minimum: 1 } },
        },
      }),
      request: { body: { kallID: 50, group_id: 7 } },
      server: acceptsEverything,
    });
    const result = await verdict(boundaryAcceptValidator, context);
    expect(context.sent).toHaveLength(0);
    expect(result.status).toBe('SKIPPED');
  });

  test('a read is not "restored": nothing changed', async () => {
    const context = contactContext(acceptsEverything, { destructive: false });
    await verdict(boundaryAcceptValidator, context);
    expect(caseNames(context)).not.toContain('request.boundary-accept:restore');
  });
});
