import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';
import { runSimultaneously } from '@utils/concurrency';
import { burstSize, describeResponses, inconclusiveIfSerialized } from './support';

/**
 * Two identical writes dispatched at the same instant must produce exactly one record.
 *
 * ## The bug this exists for
 *
 * The overwhelmingly common way to enforce uniqueness in application code is check-then-write:
 *
 * ```
 * const existing = await repo.findByName(name);   // ← both requests reach here and see nothing
 * if (existing) throw new ConflictError();
 * await repo.insert(name);                        // ← both insert
 * ```
 *
 * Sequentially this is correct and every ordinary test passes. Concurrently both callers pass the
 * check before either writes, and two rows appear — a duplicate company, a double-charged payment,
 * two users holding the same seat. The only fix is a database unique constraint or a lock, and the
 * only way to find out whether one exists is to send the two writes together.
 *
 * ## Opt-in, and why it must be
 *
 * The probe cannot infer that a second identical write is wrong. Sending the same message twice is
 * two messages, legitimately; creating the same company twice is a defect. Only the endpoint knows
 * which it is, so this runs solely where a definition sets `concurrency.singleWriteWins`.
 *
 * ## Safety
 *
 * It writes, twice, so every existing control applies unchanged: the production guard blocks it on
 * the live application, the QA-identifier guard refuses any payload naming a record we do not own,
 * and it reaches a real host only under `WRITE_FUZZ` + `TEST_DB_MODE` on a disposable database.
 * It deliberately uses the SAME payload for both requests — a fresh one per request would create
 * two legitimately different records and prove nothing.
 */
export const duplicateWriteValidator = defineValidator({
  name: 'concurrency.duplicate-write',
  category: 'CONCURRENCY',
  severity: 'CRITICAL',
  description:
    'The same write dispatched twice at once creates one record, not two (check-then-write race)',
  toggle: 'concurrency',
  profiles: PROFILE_SETS.DEEP,
  stage: 'probe',
  appliesTo: ({ endpoint }) => {
    if (!endpoint.concurrency.singleWriteWins) {
      return 'the endpoint does not declare concurrency.singleWriteWins, so a second identical write may be legitimate';
    }
    if (!endpoint.destructive) return 'a read creates nothing to duplicate';
    return true;
  },
  check: async (context) => {
    const { endpoint } = context;
    /*
     * Two is the right number, not `burstSize`. The race needs exactly two writers to be proven,
     * and every extra writer that wins leaves another row to clean up on a shared test database.
     */
    const writers = Math.min(2, burstSize(endpoint));
    /*
     * ONE payload, built once and reused. `nextRequest()` per writer would mint fresh data for a
     * mutating endpoint (that is its whole purpose), producing two records that SHOULD both exist —
     * and the probe would pass while the race it was written to find stayed untested.
     */
    const spec = await context.nextRequest();

    const burst = await runSimultaneously(writers, (index) =>
      context.send(spec, { label: `concurrency.duplicate-write:#${index + 1}` }),
    );

    const responses = burst.outcomes.flatMap((o) => (o.value ? [o.value] : []));
    if (responses.length < writers) {
      return outcome.skipped(
        `inconclusive: only ${responses.length} of ${writers} writes completed, so "exactly one succeeded" cannot be judged`,
        { expected: `${writers} responses`, actual: `${responses.length} responses` },
      );
    }

    const inconclusive = inconclusiveIfSerialized(burst, 'write pair');
    if (inconclusive) return inconclusive;

    const succeeded = responses.filter((r) => !r.isErrorStatus);
    const serverErrors = responses.filter((r) => r.status >= 500);

    const checks: CheckDetail[] = [
      {
        name: 'exactly one of two simultaneous identical writes succeeded',
        status: succeeded.length === 1 ? 'PASSED' : 'FAILED',
        expected: '1 success, 1 rejection',
        actual: `${succeeded.length} success(es) out of ${responses.length}`,
        message:
          succeeded.length === 1
            ? undefined
            : succeeded.length > 1
              ? 'both writes were accepted — uniqueness is enforced by a check-then-write in application code, not by a constraint or a lock, so duplicates can be created at will'
              : 'neither write was accepted — the pair deadlocked or both were rejected, so a legitimate single write may also fail under contention',
        correlationId: responses[0]?.correlationId,
        request: succeeded.length === 1 ? undefined : spec,
      },
      {
        name: 'the losing write was rejected cleanly, not with a server error',
        status: serverErrors.length === 0 ? 'PASSED' : 'FAILED',
        expected: 'a 4xx conflict for the loser',
        actual:
          serverErrors.length === 0
            ? 'no 5xx'
            : serverErrors.map((r) => ({ status: r.status, correlationId: r.correlationId })),
        message:
          serverErrors.length === 0
            ? undefined
            : 'the constraint is enforced by the database but never handled, so the caller sees a crash instead of a conflict',
        correlationId: serverErrors[0]?.correlationId,
      },
      {
        name: 'the writes overlapped',
        status: 'PASSED',
        expected: `${writers} writes dispatched together`,
        actual: {
          dispatchSkewMs: burst.dispatchSkewMs,
          totalMs: burst.totalMs,
          responses: describeResponses(responses),
        },
      },
    ];

    return fromChecks(checks, 'duplicate-write checks');
  },
});
