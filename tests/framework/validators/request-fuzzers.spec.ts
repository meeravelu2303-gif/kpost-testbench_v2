import { ENVIRONMENTAL_UI_OR_API_FAILURE } from '../../../src/bug-tracker/validity-gate';
import { expect, test } from '@fixtures';
import { dataTypeValidator } from '@validators/request/data-type.validator';
import { emptyValueValidator } from '@validators/request/empty-value.validator';
import { nullValueValidator } from '@validators/request/null-value.validator';
import { SEND_SCHEMA, SEND_SCHEMA_UNCONSTRAINED, VALID_SEND } from './support/fixtures';
import {
  acceptsEverything,
  always,
  crashesOnEverything,
  fakeContext,
  fixtureEndpoint,
  probeBody,
  rejectsEverything,
  rejectsExcept,
  throttlesEverything,
  unreachable,
  verdict,
  type FakeServer,
} from './support/validator-harness';

/**
 * The schema-driven request fuzzers (`request-mutation.ts`), offline: refusing bad input passes,
 * accepting or crashing fails with the exact request, and no contract means no verdict.
 */

const VALID_BODY = VALID_SEND.body as Record<string, unknown>;

const sendEndpoint = (schema = SEND_SCHEMA) =>
  fixtureEndpoint({ method: 'POST', requestSchema: schema });

const contextFor = (server: FakeServer, schema = SEND_SCHEMA) =>
  fakeContext({ endpoint: sendEndpoint(schema), request: VALID_SEND, server });

/** The fields a probe changed relative to the valid body. */
function changedFields(body: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(VALID_BODY), ...Object.keys(body)]);
  return [...keys].filter((k) => JSON.stringify(body[k]) !== JSON.stringify(VALID_BODY[k]));
}

test.describe('validator unit · request.data-type', { tag: '@framework' }, () => {
  test.describe('known-good → PASSED', () => {
    test('a server that rejects every wrong-typed field with 400 passes', async () => {
      const context = contextFor(rejectsEverything);
      const result = await verdict(dataTypeValidator, context);
      expect(result.status).toBe('PASSED');
      expect(result.message).toBe('6 negative request cases passed');
    });

    test('422 is an accepted rejection too', async () => {
      const result = await verdict(
        dataTypeValidator,
        contextFor(always({ status: 422, body: { message: 'Unprocessable' } })),
      );
      expect(result.status).toBe('PASSED');
    });

    test('each probe mutates exactly one field to the wrong JSON type', async () => {
      const context = contextFor(rejectsEverything);
      await verdict(dataTypeValidator, context);
      const mutations = context.sent.map((_, i) => {
        const body = probeBody(context, i);
        const [field] = changedFields(body);
        expect(changedFields(body), `probe ${i} changes one field`).toHaveLength(1);
        return [field, typeof body[field!]];
      });
      expect(Object.fromEntries(mutations)).toEqual({
        subject: 'number',
        actualMessage: 'number',
        priority: 'string',
        secret: 'string',
        tags: 'string',
        note: 'number',
      });
    });

    test('the valid base request is never mutated by the probes', async () => {
      const before = JSON.stringify(VALID_SEND);
      await verdict(dataTypeValidator, contextFor(rejectsEverything));
      expect(JSON.stringify(VALID_SEND)).toBe(before);
    });
  });

  test.describe('known-bad → FAILED', () => {
    test('a server that accepts wrong types fails every case', async () => {
      const result = await verdict(dataTypeValidator, contextFor(acceptsEverything));
      expect(result.status).toBe('FAILED');
      expect(result.message).toMatch(/^6\/6 negative request cases failed/);
    });

    test('a single lax field fails exactly that case and carries its request for the ticket', async () => {
      const laxOnPriority = rejectsExcept(
        (spec) => typeof (spec.body as Record<string, unknown>).priority === 'string',
      );
      const result = await verdict(dataTypeValidator, contextFor(laxOnPriority));
      expect(result.status).toBe('FAILED');
      expect(result.message).toMatch(
        /^1\/6 negative request cases failed: body\.priority: string instead of integer/,
      );

      const failed = result.details?.filter((d) => d.status === 'FAILED') ?? [];
      expect(failed).toHaveLength(1);
      expect(failed[0]?.request?.body).toEqual({ ...VALID_BODY, priority: 'not-a-number' });
      // Passing cases stay small: no request recorded on them.
      expect(result.details?.filter((d) => d.status === 'PASSED' && d.request)).toEqual([]);
    });

    test('a 5xx crash on bad input fails', async () => {
      const result = await verdict(dataTypeValidator, contextFor(crashesOnEverything));
      expect(result.status).toBe('FAILED');
      expect(result.details?.every((d) => d.actual === 500)).toBe(true);
    });

    test('a 404 is not an acceptable rejection of a bad body', async () => {
      const result = await verdict(
        dataTypeValidator,
        contextFor(always({ status: 404, body: { message: 'Not Found' } })),
      );
      expect(result.status).toBe('FAILED');
    });
  });

  test.describe('no response / nothing to judge → SKIPPED', () => {
    test('an endpoint with no request contract is skipped with the reason', async () => {
      const result = await verdict(
        dataTypeValidator,
        fakeContext({ endpoint: fixtureEndpoint({ method: 'POST' }), request: VALID_SEND }),
      );
      expect(result.status).toBe('SKIPPED');
      expect(result.message).toBe(
        'no fuzzable body/query/path schema (a GET carries no request body)',
      );
    });

    test('a GET is never body-fuzzed, even when a body schema is documented', async () => {
      const context = fakeContext({
        endpoint: fixtureEndpoint({ method: 'GET', requestSchema: SEND_SCHEMA }),
        request: VALID_SEND,
      });
      const result = await verdict(dataTypeValidator, context);
      expect(result.status).toBe('SKIPPED');
      expect(context.sent).toHaveLength(0);
    });

    test('a probe throttled with 429 is inconclusive, never a pass or a fail', async () => {
      const result = await verdict(dataTypeValidator, contextFor(throttlesEverything));
      expect(result.status).toBe('SKIPPED');
      expect(result.message).toMatch(/rate limited \(HTTP 429\) - inconclusive/);
    });

    // Pinned: a probe with NO response counts FAILED (status 0); only the validity gate keeps it
    // out of Bugzilla. If this becomes SKIPPED ("no response ≠ failed check"), update this test.
    test('a probe with no response fails with a transport message the validity gate rejects', async () => {
      const result = await verdict(dataTypeValidator, contextFor(unreachable));
      expect(result.status).toBe('FAILED');
      for (const detail of result.details ?? []) {
        expect(detail.actual).toBe(0);
        expect(detail.message).toMatch(ENVIRONMENTAL_UI_OR_API_FAILURE);
      }
    });
  });
});

test.describe('validator unit · request.null-value', { tag: '@framework' }, () => {
  test('known-good: null in each non-nullable field is rejected → PASSED', async () => {
    const context = contextFor(rejectsEverything);
    const result = await verdict(nullValueValidator, context);
    expect(result.status).toBe('PASSED');
    const nulled = context.sent.map((_, i) => changedFields(probeBody(context, i))[0]);
    expect(nulled).toEqual(['subject', 'actualMessage', 'priority', 'secret', 'tags']);
  });

  test('a nullable field is never sent null as an attack', async () => {
    const context = contextFor(rejectsEverything);
    await verdict(nullValueValidator, context);
    expect(context.sent.map((s) => s.options.label).join('\n')).not.toContain('body.note');
  });

  test('known-bad: a server that stores null in a required field → FAILED', async () => {
    const laxOnSubject = rejectsExcept(
      (spec) => (spec.body as Record<string, unknown>).subject === null,
    );
    const result = await verdict(nullValueValidator, contextFor(laxOnSubject));
    expect(result.status).toBe('FAILED');
    expect(result.message).toMatch(
      /^1\/5 negative request cases failed: body\.subject: null value/,
    );
  });

  test('known-bad: a crash on null → FAILED', async () => {
    const result = await verdict(nullValueValidator, contextFor(crashesOnEverything));
    expect(result.status).toBe('FAILED');
  });

  test('SKIPPED: no request contract', async () => {
    const result = await verdict(
      nullValueValidator,
      fakeContext({ endpoint: fixtureEndpoint({ method: 'POST' }), request: VALID_SEND }),
    );
    expect(result.status).toBe('SKIPPED');
  });

  test('SKIPPED: a contract whose every field is nullable leaves no case to send', async () => {
    const allNullable = {
      type: 'object',
      properties: { note: { type: ['string', 'null'] }, ref: { type: ['integer', 'null'] } },
    };
    const context = fakeContext({
      endpoint: sendEndpoint(allNullable),
      request: { body: { note: 'x', ref: 1 } },
    });
    const result = await verdict(nullValueValidator, context);
    expect(result.status).toBe('SKIPPED');
    expect(result.message).toBe('no applicable negative request cases');
    expect(context.sent).toHaveLength(0);
  });
});

test.describe('validator unit · request.empty-value', { tag: '@framework' }, () => {
  test('known-good: empties the contract forbids are rejected → PASSED', async () => {
    const context = contextFor(rejectsEverything);
    const result = await verdict(emptyValueValidator, context);
    expect(result.status).toBe('PASSED');
    // Only `subject` (minLength 1) and `tags` (minItems 1) forbid an empty value.
    expect(context.sent.map((_, i) => probeBody(context, i))).toEqual([
      { ...VALID_BODY, subject: '' },
      { ...VALID_BODY, tags: [] },
    ]);
  });

  test('known-bad: an empty subject accepted → FAILED, naming the field', async () => {
    const laxOnSubject = rejectsExcept(
      (spec) => (spec.body as Record<string, unknown>).subject === '',
    );
    const result = await verdict(emptyValueValidator, contextFor(laxOnSubject));
    expect(result.status).toBe('FAILED');
    expect(result.message).toMatch(
      /^1\/2 negative request cases failed: body\.subject: empty string/,
    );
  });

  test('known-bad: a crash on an empty array → FAILED', async () => {
    const crashOnEmptyTags: FakeServer = (spec, options) =>
      Array.isArray((spec.body as Record<string, unknown>).tags) &&
      ((spec.body as Record<string, unknown>).tags as unknown[]).length === 0
        ? crashesOnEverything(spec, options)
        : rejectsEverything(spec, options);
    const result = await verdict(emptyValueValidator, contextFor(crashOnEmptyTags));
    expect(result.status).toBe('FAILED');
    expect(result.message).toContain('body.tags: empty array');
  });

  test('SKIPPED: no request contract', async () => {
    const result = await verdict(
      emptyValueValidator,
      fakeContext({ endpoint: fixtureEndpoint({ method: 'POST' }), request: VALID_SEND }),
    );
    expect(result.status).toBe('SKIPPED');
  });

  // Pinned blind spot: workbook contracts carry no minLength/minItems, so this check can only skip.
  test('SKIPPED: a types-only contract (how KPost documents bodies) gives it nothing to send', async () => {
    const context = contextFor(acceptsEverything, SEND_SCHEMA_UNCONSTRAINED);
    const result = await verdict(emptyValueValidator, context);
    expect(result.status).toBe('SKIPPED');
    expect(context.sent).toHaveLength(0);
  });
});
