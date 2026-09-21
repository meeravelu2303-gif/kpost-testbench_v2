import { expect, test } from '@fixtures';
import {
  assessIndependence,
  confirm,
  independenceStrength,
  summariseConfirmations,
  type ObservationChannel,
} from '../../src/confirmation/index';

/**
 * Guards for Phase 11 — independent confirmation (master plan §13).
 *
 * The rule they protect is the one sentence the master plan spends on this stage: *do not simply
 * repeat the same assertion.* Re-running a failing check repeats the same request through the same
 * client, reads it with the same parser and applies the same expectation — so it reproduces every
 * mistake the first run could have made and returns the same answer with more confidence attached.
 *
 * Pure: nothing here sends a request or touches an account.
 */

const api = (actorKey: string, via: string): ObservationChannel => ({
  surface: 'API',
  actorKey,
  via,
});
const ui = (actorKey: string, via: string): ObservationChannel => ({
  surface: 'UI',
  actorKey,
  via,
});

const request = (
  detectedVia: ObservationChannel,
  channel: ObservationChannel,
  showsSameBehaviour: boolean | undefined,
) => ({
  resourceKind: 'katchup-message',
  resourceId: '811492',
  detectedVia,
  confirming: { channel, showsSameBehaviour, evidence: "the recipient's own conversation read" },
});

test.describe('confirmation · the same assertion twice is not a confirmation @framework', () => {
  test('an identical channel is INDETERMINATE, however emphatically it agrees', () => {
    /*
     * The case the whole stage exists for. `showsSameBehaviour: true` is as strong an agreement as
     * the input can express, and it still must not reach CONFIRMED — because it is the same request,
     * the same parser and the same expectation, so it agrees with its own mistakes too.
     */
    const same = api('personal', 'katchup-conversation');
    const record = confirm(request(same, same, true));
    expect(record.outcome).toBe('INDETERMINATE');
    expect(record.reason).toContain('same assertion run twice');
    expect(record.independenceStrength).toBe('NONE');
  });

  test('independence is decided BEFORE the observation is read', () => {
    // Order matters: if agreement were read first, a same-path "yes" could short-circuit to CONFIRMED.
    const same = ui('personal', '/katchup');
    for (const shows of [true, false, undefined]) {
      expect(
        confirm(request(same, same, shows)).outcome,
        `showsSameBehaviour=${String(shows)}`,
      ).toBe('INDETERMINATE');
    }
  });
});

test.describe('confirmation · what counts as an independent path @framework', () => {
  test('a different SURFACE is the strongest separation', () => {
    /*
     * A UI observation shares neither the bench's request builder nor its response parser nor the
     * API session. It is the only kind of confirmation that can rule out a bench-side mistake in
     * all three at once.
     */
    const verdict = assessIndependence(api('personal', 'katchup-send'), ui('victim', '/katchup'));
    expect(verdict.independent).toBe(true);
    expect(independenceStrength(verdict)).toBe('STRONGEST');
  });

  test('a different ACTOR breaks the session and the permissions', () => {
    const verdict = assessIndependence(
      api('personal', 'katchup-conversation'),
      api('victim', 'katchup-conversation'),
    );
    expect(verdict.independent).toBe(true);
    expect(verdict.differsBy).toEqual(['actor']);
    expect(independenceStrength(verdict), 'less than a surface change, more than an endpoint').toBe(
      'STRONG',
    );
  });

  test('a different ENDPOINT alone is independent, but only weakly', () => {
    /*
     * Honest ranking rather than a flattering one: a second endpoint in the same service, read by
     * the same actor over the same client, rules out one handler and nothing else. It is still worth
     * having — the count-versus-list contradiction is exactly this shape — so it is WEAK, not NONE.
     */
    const verdict = assessIndependence(
      api('victim', 'katchup-message-count'),
      api('victim', 'katchup-conversation'),
    );
    expect(verdict.independent).toBe(true);
    expect(independenceStrength(verdict)).toBe('WEAK');
  });

  test('the verdict always names which assumption was broken', () => {
    const verdict = assessIndependence(api('personal', 'group-create'), api('victim', 'my-groups'));
    expect(verdict.reason).toContain('actor');
    expect(verdict.reason).toContain('endpoint');
  });
});

test.describe('confirmation · the three outcomes @framework', () => {
  test('an independent path that sees the same behaviour CONFIRMS it', () => {
    const record = confirm(
      request(api('personal', 'katchup-send'), ui('victim', '/katchup'), true),
    );
    expect(record.outcome).toBe('CONFIRMED');
    expect(record.reason, 'and says which resource').toContain('811492');
  });

  test('an independent path that does NOT see it puts the detection in doubt', () => {
    /*
     * The outcome that protects a developer's queue. A finding an independent observer cannot
     * reproduce is a finding about the bench until proven otherwise, and the record says so in as
     * many words rather than leaving the reader to infer it.
     */
    const record = confirm(
      request(api('personal', 'katchup-send'), ui('victim', '/katchup'), false),
    );
    expect(record.outcome).toBe('NOT_REPRODUCED');
    expect(record.reason).toContain('must not be reported as a defect');
  });

  test('an observation that could not be read is INDETERMINATE, never NOT_REPRODUCED', () => {
    /*
     * The same rule the side-effect layer keeps. "We could not look" and "we looked and it was
     * fine" are different facts, and collapsing them would discard a real finding whenever the
     * confirming path happened to be unavailable.
     */
    const record = confirm(
      request(api('personal', 'katchup-send'), ui('victim', '/katchup'), undefined),
    );
    expect(record.outcome).toBe('INDETERMINATE');
    expect(record.reason).toContain('could not be read');
  });
});

test.describe('confirmation · what the layer deliberately does not do @framework', () => {
  test('it produces no severity, no score and no filing decision', () => {
    const record = confirm(
      request(api('personal', 'katchup-send'), ui('victim', '/katchup'), true),
    );
    expect(Object.keys(record).sort()).toEqual(
      [
        'correlationIds',
        'evidence',
        'independence',
        'independenceStrength',
        'outcome',
        'reason',
        'resourceId',
        'resourceKind',
      ].sort(),
    );
  });

  test('a record names actors by pool key and carries no credential', () => {
    const lines = summariseConfirmations([
      confirm(request(api('personal', 'katchup-send'), ui('victim', '/katchup'), true)),
    ]);
    expect(lines[0]).toContain('victim');
    expect(lines[0]).not.toMatch(/password|bearer|authorization|@kpost|api[_-]?key/i);
  });

  test('the module cannot observe anything — it takes what a spec saw', () => {
    /*
     * A structural guard on the safety boundary. If this layer could send a request it could repeat
     * a write, and every gate the executor enforces would have a second door. It has no such door
     * because it has no client: the surface is pure functions over data.
     */
    const source = Object.keys(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../src/confirmation/index') as Record<string, unknown>,
    );
    expect(source.sort()).toEqual(
      [
        'CONFIRMATION_OUTCOMES',
        'OBSERVATION_SURFACES',
        'assessIndependence',
        'confirm',
        'describeChannel',
        'independenceStrength',
        'summariseConfirmations',
      ].sort(),
    );
  });
});
