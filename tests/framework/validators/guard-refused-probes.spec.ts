import { ProductionSafetyError } from '@engine/production-guard';
import { GUARD_REFUSED } from '@engine/probe';
import { expect, test } from '@fixtures';
import { classifySkip } from '../../../src/reporting/run-summary';
import { injectionValidator } from '@validators/security/injection.validator';
import { SEND_SCHEMA, VALID_SEND } from './support/fixtures';
import {
  fakeContext,
  fixtureEndpoint,
  rejectsEverything,
  verdict,
  type FakeServer,
} from './support/validator-harness';

/**
 * A probe the bench's own safety guard refuses (attack text in an identifier field on live) was
 * never sent: it is SKIPPED with that reason, and it must not take the endpoint's other probes down
 * with it (it used to fail the whole check as "validator error").
 */

const VALID_BODY = VALID_SEND.body as Record<string, unknown>;

/** Refuses, as the guard would, every probe whose `subject` differs from the valid request's. */
const guardsSubject: FakeServer = (spec, options) => {
  const body = spec.body as Record<string, unknown>;
  if (body.subject !== VALID_BODY.subject) {
    throw new ProductionSafetyError(`${options.label}: refusing to send a request to the LIVE app`);
  }
  return rejectsEverything(spec, options);
};

const refusesAll: FakeServer = (_spec, options) => {
  throw new ProductionSafetyError(`${options.label}: refusing to send a request to the LIVE app`);
};

const context = (server: FakeServer) =>
  fakeContext({
    endpoint: fixtureEndpoint({ method: 'POST', requestSchema: SEND_SCHEMA }),
    request: VALID_SEND,
    server,
  });

test.describe('validator unit · probes the safety guard refuses', { tag: '@framework' }, () => {
  test('a refused probe is SKIPPED and the other fields are still attacked', async () => {
    const result = await verdict(injectionValidator, context(guardsSubject));
    expect(result.status, 'the check is judged on the probes that ran').toBe('PASSED');
    expect(result.message).toBe('10 injection cases passed'); // 2 of 3 fields × 5 payloads
    const skipped = (result.details ?? []).filter((d) => d.status === 'SKIPPED');
    expect(skipped, 'the five subject payloads are recorded as not sent').toHaveLength(5);
    for (const d of skipped) expect(d.message).toBe(GUARD_REFUSED);
  });

  test('when every probe is refused the check is SKIPPED with the reason, never FAILED', async () => {
    const result = await verdict(injectionValidator, context(refusesAll));
    expect(result.status).toBe('SKIPPED');
    expect(result.message).toBe(GUARD_REFUSED);
    expect(result.message).not.toMatch(/validator error/);
  });

  test('the run summary counts it as a deliberate skip, not a coverage hole', () => {
    expect(classifySkip(GUARD_REFUSED)).toBe('deliberate');
  });
});
