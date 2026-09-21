import { expect, test } from '@fixtures';
import {
  IDENTIFYING_DIMENSIONS,
  canonicalKey,
  equivalence,
  groupDefects,
  summariseDefects,
  type DefectIdentity,
} from '../../src/canonical-defect/index';

/**
 * Guards for Phase 12 — canonical defects (master plan §14).
 *
 * ## The asymmetry every rule here rests on
 *
 *     a wrong SPLIT   two tickets for one fault — noisy, visible, cheap to fix
 *     a wrong MERGE   a real fault hidden inside a ticket somebody already closed — invisible
 *
 * They are not equally bad, so the rules are not symmetric, and these guards check that asymmetry
 * rather than checking that grouping "works". The master plan's own prohibition — *do not merge
 * merely because status codes or titles match* — is the same idea stated as a rule.
 *
 * Pure: nothing here sends a request or touches an account.
 */

const identity = (over: Partial<DefectIdentity> = {}): DefectIdentity => ({
  module: 'katchup',
  feature: 'recall',
  action: 'katchup-recall-message',
  resourceKind: 'katchup-message',
  actorRelationship: 'sender-to-recipient',
  failureCategory: 'DATA_CONSISTENCY',
  observableBehaviour: 'count-not-decremented-on-recall',
  variant: 'API',
  ...over,
});

test.describe('canonical defects · a merge must be earned @framework', () => {
  test('the same fault seen on the API and in the UI is ONE defect', () => {
    /*
     * The case grouping exists for. These two differ in the only dimension a defect is allowed to
     * differ in — the surface it was seen on — so the bug fingerprint would call them different
     * (different endpoint, different message) and be right for dedup and wrong for counting faults.
     */
    const result = equivalence(identity({ variant: 'API' }), identity({ variant: 'UI' }));
    expect(result.verdict).toBe('SAME');
    expect(canonicalKey(identity({ variant: 'API' }))).toBe(
      canonicalKey(identity({ variant: 'UI' })),
    );
  });

  test('a DIFFERENT observable behaviour is a different defect, however much else agrees', () => {
    // Same module, same feature, same endpoint, same category — and a different thing going wrong.
    const result = equivalence(
      identity(),
      identity({ observableBehaviour: 'message-not-removed-from-recipient-list' }),
    );
    expect(result.verdict).toBe('DIFFERENT');
    expect(result.differOn).toEqual(['observableBehaviour']);
  });

  test('two findings agreeing on nothing but a failure category never merge', () => {
    /*
     * The literal shape of the prohibition. \`DATA_CONSISTENCY\` on both sides is the kind of
     * resemblance a careless rule would merge on, and it says nothing about whether the two faults
     * are one.
     */
    const result = equivalence(
      identity(),
      identity({
        module: 'kmail',
        feature: 'draft',
        action: 'kmail-save-draft',
        resourceKind: 'kmail-draft',
        actorRelationship: 'self',
        observableBehaviour: 'draft-count-not-incremented',
      }),
    );
    expect(result.verdict).toBe('DIFFERENT');
  });

  test('a different ACTOR RELATIONSHIP is a different defect', () => {
    // "the sender cannot see it" and "the recipient cannot see it" are different faults.
    expect(
      equivalence(identity(), identity({ actorRelationship: 'admin-to-member' })).verdict,
    ).toBe('DIFFERENT');
  });
});

test.describe('canonical defects · the two real Phase 9 findings @framework', () => {
  /*
   * These are not invented examples. Both were measured on live in Phase 9, in different modules,
   * and they share a striking SHAPE: a derived view grows on an add and never shrinks on a
   * withdrawal. The temptation to call that one root cause is exactly what this phase must resist
   * until evidence supports it — the Phase 9 record says so in as many words, and these guards are
   * what make that a rule rather than an intention.
   */
  const staleCount = identity({
    module: 'katchup',
    feature: 'recall',
    action: 'katchup-message-count',
    resourceKind: 'katchup-message',
    observableBehaviour: 'derived-count-not-decremented-on-withdrawal',
  });
  const staleMembership = identity({
    module: 'group',
    feature: 'membership',
    action: 'contacts-my-groups',
    resourceKind: 'katchup-group',
    actorRelationship: 'admin-to-member',
    observableBehaviour: 'derived-count-not-decremented-on-withdrawal',
  });

  test('a shared SHAPE across two modules is not a shared defect', () => {
    const result = equivalence(staleCount, staleMembership);
    expect(result.verdict).toBe('DIFFERENT');
    expect(
      result.differOn,
      'they differ in where the fault lives, not in what it looks like',
    ).toEqual(expect.arrayContaining(['module', 'action', 'resourceKind']));
    expect(
      result.agreeOn,
      'and the resemblance that tempted a merge is real, just not decisive',
    ).toContain('observableBehaviour');
  });

  test('they stay two canonical defects, so both reach a developer', () => {
    const defects = groupDefects([staleCount, staleMembership]);
    expect(defects).toHaveLength(2);
    expect(summariseDefects(defects).join('\n')).toContain('katchup');
  });
});

test.describe('canonical defects · refusing to guess costs something @framework', () => {
  test('a missing observable behaviour is UNDECIDED, not SAME', () => {
    /*
     * Without it the comparison is "two findings in the same module", which is resemblance, not
     * identity. UNDECIDED files separately — the refusal has a consequence rather than being a
     * comment in the code.
     */
    const result = equivalence(identity(), identity({ observableBehaviour: '' }));
    expect(result.verdict).toBe('UNDECIDED');
    expect(result.reason).toContain('not established');
  });

  test('an UNDECIDED pair is NOT grouped', () => {
    const defects = groupDefects([identity(), identity({ observableBehaviour: '' })]);
    expect(defects, 'the refusal has to cost a merge, or it is only a comment').toHaveLength(2);
  });

  test('the reason always names which dimension is missing', () => {
    expect(equivalence(identity(), identity({ action: '' })).reason).toContain('action');
  });
});

test.describe('canonical defects · properties of the comparison @framework', () => {
  test('it is symmetric — order cannot change a verdict', () => {
    const a = identity();
    const b = identity({ module: 'kmail' });
    expect(equivalence(a, b).verdict).toBe(equivalence(b, a).verdict);
  });

  test('grouping is deterministic under input order', () => {
    const a = identity({ variant: 'API' });
    const b = identity({ variant: 'UI' });
    const c = identity({ module: 'kall', observableBehaviour: 'log-entry-missing' });
    expect(
      groupDefects([a, b, c])
        .map((d) => d.key)
        .sort(),
    ).toEqual(
      groupDefects([c, b, a])
        .map((d) => d.key)
        .sort(),
    );
  });

  test('a defect records every surface it was seen on', () => {
    const defects = groupDefects([identity({ variant: 'API' }), identity({ variant: 'UI' })]);
    expect(defects).toHaveLength(1);
    expect(defects[0]?.variants).toEqual(['API', 'UI']);
    expect(defects[0]?.sightings).toHaveLength(2);
  });

  test('neither a status code nor a message is a dimension of identity', () => {
    // The prohibition, enforced on the type rather than trusted to reviewers.
    expect([...IDENTIFYING_DIMENSIONS]).not.toContain('status');
    expect([...IDENTIFYING_DIMENSIONS]).not.toContain('message');
    expect([...IDENTIFYING_DIMENSIONS]).not.toContain('title');
  });

  test('a canonical key is readable, so a grouping decision can be audited', () => {
    /*
     * A hash would be shorter and would make a wrong merge impossible to review — which matters
     * here more than anywhere, because a wrong merge is the failure that never surfaces again.
     */
    const key = canonicalKey(identity());
    expect(key).toContain('katchup');
    expect(key).toContain('count-not-decremented-on-recall');
  });

  test('a summary carries dimensions and never a credential or a message', () => {
    const lines = summariseDefects(groupDefects([identity()]));
    expect(lines[0]).toContain('katchup/recall');
    expect(lines[0]).not.toMatch(/password|bearer|authorization|@kpost|api[_-]?key/i);
  });
});
