import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { observeBody, type StateObservation } from '../../src/state-observation/index';
import { transition } from '../../src/states/index';
import { checkTransition, summariseChecks } from '../../src/state-transition/index';

/**
 * Guards for State Transition Validation (master plan §9).
 *
 * The observations are produced by the REAL Phase 4C extractor from realistic conversation bodies,
 * so these exercise the actual chain — declaration, observation, comparison — rather than a mock of
 * it. Nothing here sends a request.
 *
 * Most of what is pinned concerns `INDETERMINATE`. It is the member that makes the layer honest: a
 * transition whose before-state was never observed did not fail, and a bench that cannot say so
 * manufactures defects out of missing evidence.
 */

const READ = transition('katchup.message.read')!;

/** A conversation body as the application returns one, with the fields the model observes. */
function conversation(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { data: rows };
}

function observe(
  body: Record<string, unknown>,
  correlationId: string,
): readonly StateObservation[] {
  return observeBody(body, {
    observationId: 'katchup.message.lifecycle-via-conversation',
    correlationId,
  });
}

const row = (msgID: number, status: number): Record<string, unknown> => ({
  msgID,
  status,
  readTime: status === 2 ? '2026-09-21T06:44:38.000+00:00' : null,
});

test.describe('state transition: the declared change occurred @framework', () => {
  test('sent → read is OCCURRED when the observed status moves 0 → 2', () => {
    /*
     * The real values from a live flow run: a message reads back `status: 0` immediately after the
     * send, and `status: 2` after the recipient's conversation read. The model declares
     * `katchup.message.read` as rawValue '2' on the field `status`.
     */
    const check = checkTransition(transition('katchup.message.read')!, {
      resourceId: '811473',
      before: observe(conversation([row(811_473, 0)]), 'tb-before'),
      after: observe(conversation([row(811_473, 2)]), 'tb-after'),
    });

    expect(check.outcome).toBe('OCCURRED');
    expect(check.observedBefore).toBe(0);
    expect(check.observedAfter).toBe(2);
    expect(check.matchedAfter, 'the model recognises the value it reached').toContain(
      'katchup.message.read',
    );
    expect(check.correlationIds, 'both exchanges stay traceable').toEqual([
      'tb-before',
      'tb-after',
    ]);
  });

  test('the check names the right resource when several are in the same response', () => {
    // A conversation carries every message. Attributing the wrong row's status would be the easiest
    // possible way to report a transition that never happened.
    const before = conversation([row(811_473, 0), row(811_474, 0)]);
    const after = conversation([row(811_473, 2), row(811_474, 0)]);

    expect(
      checkTransition(READ, {
        resourceId: '811474',
        before: observe(before, 'b'),
        after: observe(after, 'a'),
      }).outcome,
      'the untouched message did not transition',
    ).toBe('NOT_OCCURRED');
    expect(
      checkTransition(READ, {
        resourceId: '811473',
        before: observe(before, 'b'),
        after: observe(after, 'a'),
      }).outcome,
    ).toBe('OCCURRED');
  });
});

test.describe('state transition: the declared change did not occur @framework', () => {
  test('an unchanged value is NOT_OCCURRED, and says what it is still holding', () => {
    const check = checkTransition(READ, {
      resourceId: '811474',
      before: observe(conversation([row(811_474, 0)]), 'b'),
      after: observe(conversation([row(811_474, 0)]), 'a'),
    });
    expect(check.outcome).toBe('NOT_OCCURRED');
    expect(check.reason).toContain('unchanged at 0');
  });

  test('a move to some THIRD value is NOT_OCCURRED, and says where it went', () => {
    // Not "it failed" — the resource went somewhere the transition does not describe, which is a
    // different and more useful thing to report.
    const check = checkTransition(READ, {
      resourceId: '811474',
      before: observe(conversation([row(811_474, 0)]), 'b'),
      after: observe(conversation([{ msgID: 811_474, status: 4, readTime: null }]), 'a'),
    });
    expect(check.outcome).toBe('NOT_OCCURRED');
    expect(check.reason).toContain('neither the declared');
    expect(check.observedAfter).toBe(4);
  });
});

test.describe('state transition: missing evidence is never a failure @framework', () => {
  test('an unobserved AFTER is INDETERMINATE, and says so in those words', () => {
    const check = checkTransition(READ, {
      resourceId: '811474',
      before: observe(conversation([row(811_474, 0)]), 'b'),
      after: [],
    });
    expect(check.outcome).toBe('INDETERMINATE');
    expect(check.reason).toContain('not the same as it not happening');
  });

  test('an unobserved BEFORE is INDETERMINATE: the change cannot be attributed to the action', () => {
    const check = checkTransition(READ, {
      resourceId: '811474',
      before: [],
      after: observe(conversation([row(811_474, 2)]), 'a'),
    });
    expect(check.outcome).toBe('INDETERMINATE');
    expect(check.reason).toContain('cannot be attributed');
    // The after value is still reported — the evidence exists, only the conclusion does not.
    expect(check.observedAfter).toBe(2);
  });

  test('a resource not in the FROM state is INDETERMINATE, not a failed transition', () => {
    /*
     * A message that was ALREADY read cannot undergo sent → read. Reporting NOT_OCCURRED would
     * accuse the application of failing a transition it was never eligible to perform.
     */
    const check = checkTransition(READ, {
      resourceId: '811474',
      before: observe(conversation([row(811_474, 2)]), 'b'),
      after: observe(conversation([row(811_474, 2)]), 'a'),
    });
    expect(check.outcome).toBe('INDETERMINATE');
    expect(check.reason).toContain('never eligible to occur');
  });

  test('an observation for a different resource does not count as evidence', () => {
    // Identity is required. Phase 4C records an unattributed observation rather than guessing, and
    // borrowing a neighbouring row's value here would undo exactly that care.
    const check = checkTransition(READ, {
      resourceId: '811474',
      before: observe(conversation([row(811_473, 0)]), 'b'),
      after: observe(conversation([row(811_473, 2)]), 'a'),
    });
    expect(check.outcome).toBe('INDETERMINATE');
  });

  test('a transition naming an undefined state is a MODEL gap, reported as such', () => {
    const check = checkTransition(
      { ...READ, to: 'katchup.message.nonexistent' },
      {
        resourceId: '811474',
        before: observe(conversation([row(811_474, 0)]), 'b'),
        after: observe(conversation([row(811_474, 2)]), 'a'),
      },
    );
    expect(check.outcome).toBe('INDETERMINATE');
    expect(check.reason).toContain('model gap, not an application result');
  });
});

test.describe('state transition: the layer stays narrow @framework', () => {
  test('the outcome carries no verdict, severity, defect or confidence', () => {
    const check = checkTransition(READ, {
      resourceId: '811474',
      before: observe(conversation([row(811_474, 0)]), 'b'),
      after: observe(conversation([row(811_474, 2)]), 'a'),
    });
    for (const forbidden of ['passed', 'failed', 'severity', 'defect', 'confidence', 'bugId']) {
      expect(Object.keys(check), `a transition check must not carry "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });

  test('it imports no engine, validator, failure-analysis or Bugzilla module', () => {
    // Comparing observations must not depend on the machinery that judges or files anything.
    const dir = path.join(ROOT_DIR, 'src', 'state-transition');
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) =>
        /@engine\/|@validators\/|bug-tracker|failure-analysis|@reporting\//.test(
          readFileSync(path.join(dir, name), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1'),
        ),
      );
    expect(offenders).toEqual([]);
  });

  test('the same inputs give the same answer, and the summary is report-safe', () => {
    const evidence = {
      resourceId: '811474',
      before: observe(conversation([row(811_474, 0)]), 'b'),
      after: observe(conversation([row(811_474, 2)]), 'a'),
    };
    const first = checkTransition(READ, evidence);
    const second = checkTransition(READ, evidence);
    expect(first).toEqual(second);

    const lines = summariseChecks([first]).join('\n');
    expect(lines).toContain('OCCURRED');
    expect(lines).not.toMatch(/password|token|authorization|api[_-]?key/i);
  });
});
