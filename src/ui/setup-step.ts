/**
 * Marks an assertion as a setup step (navigation to the starting state). A failure there never
 * reached the real check, so the validity gate never files it. Not for steps whose failure is
 * itself a defect.
 */
export const SETUP_STEP_MARKER = '[setup step]';

/** `expect(locator, setupStep('the conversation is found')).toBeVisible()` */
export function setupStep(message: string): string {
  return `${SETUP_STEP_MARKER} ${message}`;
}
