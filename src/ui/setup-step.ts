/**
 * Marks an assertion as a SETUP step: it only gets the test to the state its real check starts from
 * (open Katchup, find the conversation). When a setup step fails, the test never reached the check its
 * title names, so the failure is not evidence of that defect. The validity gate rejects any UI failure
 * carrying this marker; it is not filed and does not count as "still broken" for an open bug.
 *
 * Added 2026-10-21: a run hit by a network outage turned four Katchup tests that stopped at "find the
 * conversation" into would-file duplicates of #1327, #1328 and #1330.
 *
 * Use it only for navigation to a starting state. A step whose failure is a product defect in its own
 * right (a sent message that never appears) stays a plain assertion.
 */
export const SETUP_STEP_MARKER = '[setup step]';

/** `expect(locator, setupStep('the conversation is found')).toBeVisible()` */
export function setupStep(message: string): string {
  return `${SETUP_STEP_MARKER} ${message}`;
}
