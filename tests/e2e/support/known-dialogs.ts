import type { Dialog } from '@playwright/test';

/**
 * Browser pop-ups the app raises on its own, unrelated to what a test is checking.
 *
 * common/MicInput.js calls `alert("Microphone not available in this browser")` on mount whenever the
 * browser has no SpeechRecognition — about ten times per screen in Firefox and Playwright's WebKit
 * (#1360). A test that treats "any dialog fired" as evidence (an XSS payload executing, a confirm box
 * to accept) must skip these, or it reports a false XSS hit or accepts the wrong pop-up.
 */
export function isKnownAppAlert(dialog: Dialog): boolean {
  return (
    dialog.type() === 'alert' &&
    /^(Microphone not available in this browser|Speech Recognition API not supported in this browser\.?)$/.test(
      dialog.message().trim(),
    )
  );
}
