import { expect, test } from '@fixtures';
import { checkSideEffect, summariseSideEffects } from '../../src/side-effects/index';

/**
 * Guards for side-effect verification (master plan §11).
 *
 * The layer's whole value is that it compares a DELTA. A QA account's inbox is shared and never
 * empty, so an absolute assertion ("unread is 1") is false in practice and gets repaired by
 * loosening it — which is how a count check decays into `toBeGreaterThan(0)` and stops meaning
 * anything. These pin the delta rule, and the INDETERMINATE boundary that keeps an unmeasured value
 * from being reported as an unchanged one.
 *
 * Pure: nothing here sends a request or touches an account.
 */

test.describe('side effects: a delta, not an absolute value @framework', () => {
  test('a count that moved by exactly the expected amount is OBSERVED', () => {
    const check = checkSideEffect({ name: 'unread', before: 21, after: 22 }, { delta: 1 });
    expect(check.outcome).toBe('OBSERVED');
    expect(check.reason, 'the evidence is both endpoints of the move').toContain('21 → 22');
  });

  test('the same delta holds at any baseline — which is why the account need not be empty', () => {
    /*
     * The property the layer exists for. A shared QA account carries whatever other tests left
     * behind, so only the CHANGE is a statement about this action.
     */
    for (const baseline of [0, 21, 4_097]) {
      const check = checkSideEffect(
        { name: 'unread', before: baseline, after: baseline + 1 },
        { delta: 1 },
      );
      expect(check.outcome, `baseline ${String(baseline)}`).toBe('OBSERVED');
    }
  });

  test('a count that did not move is NOT_OBSERVED, and the reason names both numbers', () => {
    const check = checkSideEffect({ name: 'unread', before: 21, after: 21 }, { delta: 1 });
    expect(check.outcome).toBe('NOT_OBSERVED');
    expect(check.reason, 'the observed move, which is none').toContain('21 → 21 (0)');
    expect(check.reason, 'and what was required').toContain('+1');
  });

  test('a decrease is expressed as a negative delta, not as a second vocabulary', () => {
    expect(checkSideEffect({ name: 'members', before: 3, after: 2 }, { delta: -1 }).outcome).toBe(
      'OBSERVED',
    );
    expect(checkSideEffect({ name: 'members', before: 3, after: 2 }, { delta: 1 }).outcome).toBe(
      'NOT_OBSERVED',
    );
  });

  test('a count that moved by the WRONG amount fails — a change is not the assertion', () => {
    // Two messages arriving when one was sent is a real defect, and `toBeGreaterThan(0)` misses it.
    const check = checkSideEffect({ name: 'unread', before: 21, after: 23 }, { delta: 1 });
    expect(check.outcome).toBe('NOT_OBSERVED');
    expect(check.reason).toContain('+2');
  });
});

test.describe('side effects: unmeasured is never unchanged @framework', () => {
  test('a missing BEFORE is INDETERMINATE, and says so', () => {
    const check = checkSideEffect({ name: 'unread', before: undefined, after: 22 }, { delta: 1 });
    expect(check.outcome).toBe('INDETERMINATE');
    expect(check.reason).toContain('BEFORE');
    expect(check.reason, 'the rule stated in the output itself').toContain(
      'Unmeasured is not unchanged',
    );
  });

  test('a missing AFTER is INDETERMINATE', () => {
    const check = checkSideEffect({ name: 'unread', before: 21, after: undefined }, { delta: 1 });
    expect(check.outcome).toBe('INDETERMINATE');
    expect(check.reason).toContain('AFTER');
  });

  test('a delta over a non-number is INDETERMINATE, never coerced', () => {
    /*
     * `"21" - "20"` is 1 in JavaScript, and an API that starts returning its counts as strings would
     * silently keep passing. Worse, `null - null` is 0, so a delta of 0 would "hold" over two
     * unmeasured values. Refusing to subtract is the only honest answer.
     */
    const check = checkSideEffect({ name: 'unread', before: '21', after: '22' }, { delta: 1 });
    expect(check.outcome).toBe('INDETERMINATE');
    expect(check.reason).toContain('not both numbers');
  });

  test('a non-finite count is INDETERMINATE rather than arithmetic', () => {
    const check = checkSideEffect({ name: 'unread', before: Number.NaN, after: 22 }, { delta: 1 });
    expect(check.outcome).toBe('INDETERMINATE');
  });
});

test.describe('side effects: flags and unspecified changes @framework', () => {
  test('a flag that reached the required value is OBSERVED', () => {
    expect(
      checkSideEffect({ name: 'important', before: false, after: true }, { becomes: true }),
    ).toMatchObject({ outcome: 'OBSERVED' });
  });

  test('a flag that did not reach it is NOT_OBSERVED, and the reason shows what it holds', () => {
    const check = checkSideEffect(
      { name: 'important', before: false, after: false },
      { becomes: true },
    );
    expect(check.outcome).toBe('NOT_OBSERVED');
    expect(check.reason).toContain('false');
  });

  test('`changes: true` asserts movement only — for a value the expectation cannot name', () => {
    // A server-assigned timestamp, for instance: we know it must move, not what to.
    expect(
      checkSideEffect({ name: 'updatedAt', before: 1, after: 2 }, { changes: true }).outcome,
    ).toBe('OBSERVED');
    expect(
      checkSideEffect({ name: 'updatedAt', before: 1, after: 1 }, { changes: true }).outcome,
    ).toBe('NOT_OBSERVED');
  });
});

test.describe('side effects: what the layer deliberately does not do @framework', () => {
  test('it returns no pass, no severity and no confidence', () => {
    /*
     * The same boundary Phase 7 keeps. A side effect that could not be measured has not failed, and
     * deciding severity here would put a verdict in a pure comparator where a spec — and later the
     * confidence gate — belongs.
     */
    const check = checkSideEffect({ name: 'unread', before: 21, after: 21 }, { delta: 1 });
    expect(Object.keys(check).sort()).toEqual(
      ['after', 'before', 'correlationIds', 'name', 'outcome', 'reason'].sort(),
    );
  });

  test('the evidence stays reachable through correlation ids', () => {
    const check = checkSideEffect(
      { name: 'unread', before: 21, after: 22, correlationIds: ['tb-a', 'tb-b'] },
      { delta: 1 },
    );
    expect(check.correlationIds, 'both reads, so either can be pulled from the journal').toEqual([
      'tb-a',
      'tb-b',
    ]);
  });

  test('a summary line carries values and never a credential', () => {
    const lines = summariseSideEffects([
      checkSideEffect({ name: 'unread', before: 21, after: 22 }, { delta: 1 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('OBSERVED');
    expect(lines[0]).not.toMatch(/password|token|authorization|bearer|api[_-]?key/i);
  });
});
