import type { Dialog } from '@playwright/test';

/**
 * Pop-ups the app raises on its own (known defect #1360: the "Microphone not available" alert in
 * Firefox/WebKit). Dialog-based checks (XSS, confirm boxes) must skip these.
 */
export function isKnownAppAlert(dialog: Dialog): boolean {
  return (
    dialog.type() === 'alert' &&
    /^(Microphone not available in this browser|Speech Recognition API not supported in this browser\.?)$/.test(
      dialog.message().trim(),
    )
  );
}
