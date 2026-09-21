import { thresholds } from '@config/thresholds.config';
import { apiFingerprint, normalizeForFingerprint } from '../../src/bug-tracker/bug-fingerprint';
import type { ValidationContext } from '@engine/validation-context';
import { backoffMs, confirmFailure, isRetryable } from '@engine/reproduction-gate';
import type { ValidationResult } from '@engine/validation-result';
import type { Validator } from '@engine/validator';
import { expect, test } from '@fixtures';

/**
 * The gate that stands between "a check failed" and "a developer gets a ticket".
 *
 * Filing is irreversible — Bugzilla has no delete, only resolve — so an unreproducible ticket costs
 * a human's attention permanently. These pin the two rules that prevent it: a failure must happen
 * again to count, and a failure that has already been filed must be recognised as the same one.
 */

/** A validator stub carrying only the fields the gate reads. */
const validator = (stage: Validator['stage'], name = 'probe.example'): Validator =>
  ({ name, stage }) as Validator;

/** A context stub; the gate only logs and reads the endpoint label. */
const context = (): ValidationContext =>
  ({
    log: { debug: () => undefined, info: () => undefined },
    endpoint: { label: 'GET /v2/example' },
  }) as unknown as ValidationContext;

const result = (status: ValidationResult['status'], message = 'boom'): ValidationResult =>
  ({ status, message, validatorName: 'probe.example' }) as ValidationResult;

/** Returns the given statuses in order, one per call, so a flake can be scripted exactly. */
function scripted(...statuses: ValidationResult['status'][]): () => Promise<ValidationResult> {
  let call = 0;
  return () => {
    const status = statuses[Math.min(call, statuses.length - 1)] ?? 'PASSED';
    call += 1;
    return Promise.resolve(result(status, `attempt ${call}`));
  };
}

test.describe('reproduction gate @framework', () => {
  test('a passing check runs exactly once', async () => {
    let calls = 0;
    const outcome = await confirmFailure(validator('probe'), context(), () => {
      calls += 1;
      return Promise.resolve(result('PASSED'));
    });

    expect(calls, 'a pass must not be retried — that would be pure cost').toBe(1);
    expect(outcome.result.status).toBe('PASSED');
    expect(outcome.reproduced).toBe(false);
  });

  test('a consistent failure is retried to the configured limit and stays FAILED', async () => {
    let calls = 0;
    const outcome = await confirmFailure(validator('probe'), context(), () => {
      calls += 1;
      return Promise.resolve(result('FAILED'));
    });

    expect(calls, 'every configured pass runs').toBe(thresholds.reproduction.attempts);
    expect(outcome.result.status, 'a reproducible failure stays a failure').toBe('FAILED');
    expect(outcome.reproduced, 'and is fileable').toBe(true);
    expect(outcome.failures).toBe(thresholds.reproduction.attempts);
    expect(outcome.result.message, 'the ticket records how many passes reproduced it').toContain(
      `${thresholds.reproduction.attempts}/${thresholds.reproduction.attempts}`,
    );
  });

  test('a failure that recovers becomes a WARNING and is never filed', async () => {
    /*
     * The case the whole gate exists for: a slow first response, a read racing a write, a session
     * refreshing mid-probe. Evidence indistinguishable from a real defect, and a developer who
     * cannot reproduce it.
     */
    const outcome = await confirmFailure(
      validator('probe'),
      context(),
      scripted('FAILED', 'PASSED'),
    );

    expect(outcome.result.status, 'an intermittent failure must not stay FAILED').toBe('WARNING');
    expect(outcome.reproduced, 'and must not be fileable').toBe(false);
    expect(outcome.result.message).toContain('intermittent');
    expect(
      outcome.result.message,
      'the original failure is preserved so the flake is still visible in the report',
    ).toContain('attempt 1');
  });

  test('it stops at the first clean pass rather than spending the remaining attempts', async () => {
    let calls = 0;
    await confirmFailure(validator('probe'), context(), () => {
      calls += 1;
      return Promise.resolve(result(calls === 1 ? 'FAILED' : 'PASSED'));
    });

    // Continuing would only gather more evidence for a conclusion already reached.
    expect(calls, 'one recovery settles it').toBe(2);
  });

  test('a deterministic check is not retried, but still counts as reproduced', async () => {
    let calls = 0;
    const outcome = await confirmFailure(validator('primary'), context(), () => {
      calls += 1;
      return Promise.resolve(result('FAILED'));
    });

    /*
     * Re-reading an exchange already in hand cannot disagree with itself, so a retry is wasted
     * traffic — but the failure is still real and must remain fileable.
     */
    expect(calls, 'a primary-stage check re-reads the same response').toBe(1);
    expect(outcome.reproduced, 'determinism is its own confirmation').toBe(true);
    expect(outcome.result.status).toBe('FAILED');
  });

  test('a non-idempotent probe is never retried', async () => {
    let calls = 0;
    await confirmFailure(validator('probe', 'concurrency.duplicate-write'), context(), () => {
      calls += 1;
      return Promise.resolve(result('FAILED'));
    });

    /*
     * Its first pass creates a row, so a second pass races that row instead of a clean slate —
     * retrying would manufacture the very failure it is looking for.
     */
    expect(calls, 'duplicate-write must run once or not at all').toBe(1);
  });

  test('eligibility is decided by stage, with the non-idempotent exception', () => {
    expect(isRetryable({ stage: 'probe', name: 'security.injection' })).toBe(true);
    expect(isRetryable({ stage: 'database', name: 'database.kpost-user-active' })).toBe(true);
    expect(isRetryable({ stage: 'primary', name: 'response.status-code' })).toBe(false);
    expect(isRetryable({ stage: 'aggregate', name: 'security.sensitive-data' })).toBe(false);
    expect(isRetryable({ stage: 'probe', name: 'concurrency.duplicate-write' })).toBe(false);
  });

  test('backoff grows exponentially and is capped', () => {
    const { baseDelayMs, maxDelayMs } = thresholds.reproduction;

    expect(backoffMs(1)).toBe(baseDelayMs);
    expect(backoffMs(2)).toBe(baseDelayMs * 2);
    expect(backoffMs(3)).toBe(baseDelayMs * 4);
    // Capped, so one slow endpoint cannot stall the whole run on a single check.
    expect(backoffMs(20)).toBe(maxDelayMs);
  });
});

test.describe('fingerprint deduplication @framework', () => {
  /*
   * The fingerprint is what a re-run searches Bugzilla for, so it must be stable across runs and
   * distinct between real defects. Both halves matter: an unstable fingerprint files a duplicate
   * every run, and an over-broad one hides a second defect behind the first.
   */
  const base = {
    prefix: 'KPV2',
    endpointId: 'profile-user-profile-by-kpostid',
    validatorName: 'response.schema',
    message: 'expected data.kpostID to be a string',
  };

  test('the same defect fingerprints identically across runs', () => {
    /*
     * Run-to-run noise — correlation ids, generated e-mails, durations — is collapsed before
     * hashing, so the second run recognises the first run's ticket instead of filing another.
     */
    const run1 = apiFingerprint({
      ...base,
      message: `${base.message} (correlationId tb-1f0e4c2a-1111-2222-3333-444455556666, 214 ms)`,
    });
    const run2 = apiFingerprint({
      ...base,
      message: `${base.message} (correlationId tb-9a8b7c6d-9999-8888-7777-666655554444, 998 ms)`,
    });

    expect(run1, 'the same defect must produce the same tag').toBe(run2);
  });

  test('the fingerprint combines endpoint, assertion and location', () => {
    const other = apiFingerprint({ ...base, endpointId: 'profile-digital-card' });
    const differentCheck = apiFingerprint({ ...base, validatorName: 'response.status-code' });
    const differentMessage = apiFingerprint({ ...base, message: 'expected 200, got 500' });

    const all = new Set([apiFingerprint(base), other, differentCheck, differentMessage]);
    expect(all.size, 'each distinct defect gets its own tag').toBe(4);
  });

  test('volatile values are normalised away, real differences are not', () => {
    expect(normalizeForFingerprint('failed after 1234 ms for tb-aaaaaaaa-1111')).toBe(
      normalizeForFingerprint('failed after 9876 ms for tb-bbbbbbbb-2222'),
    );
    expect(normalizeForFingerprint('expected 200, got 500')).not.toBe(
      normalizeForFingerprint('expected 200, got 403'),
    );
  });

  test('the tag is short enough to live in a Bugzilla summary', () => {
    const tag = apiFingerprint(base);

    // It is prepended to every summary as `[KPV2-XXXXXX]`, and searched for verbatim.
    expect(tag).toMatch(/^KPV2-[0-9A-F]{6}$/);
  });
});
