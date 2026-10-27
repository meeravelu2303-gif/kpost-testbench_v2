import { test } from '@fixtures';

/**
 * A live condition left the test nothing to check: a random value collided, a list had not refreshed,
 * the OTP gateway said no. A skip is never retried, so it is retried as a failure first and the check
 * still runs in this run; only the last attempt skips, with the reason. A retry that passes is
 * "flaky", which is never filed as a bug.
 */
export function retryOrSkip(condition: boolean, reason: string): void {
  if (!condition) return;
  const info = test.info();
  if (info.retry < info.project.retries) throw new Error(`LIVE CONDITION, retrying: ${reason}`);
  test.skip(true, reason);
}
