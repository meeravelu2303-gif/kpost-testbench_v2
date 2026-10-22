import { expect, test } from '@fixtures';

/**
 * Home — the header "Start voice command" mic (button.header-voice-mic) (reported manually
 * 2026-10-13: "works the first time, then shows an error toast after 3-4 clicks").
 *
 * The voice command uses the Web Speech API, whose real `webkitSpeechRecognition.start()` THROWS an
 * InvalidStateError if called while a recognition is already running. The reported symptom is the
 * classic unguarded double-start: click 1 starts recognition; click 2+ calls start() again without
 * stopping first, which throws, and the app surfaces an error toast. A real microphone is not
 * available headless, so this injects a FAITHFUL fake of the Speech Recognition API (same
 * start()-throws-if-already-started contract as the browser's own) before the page loads, so the
 * app's own handling of a repeat click is exercised deterministically.
 *
 * Correct behaviour: the app guards the repeat click (stops/ignores while already listening) — no
 * error toast, no uncaught error. The bug would be an error toast appearing on the repeat click.
 */
test.describe(
  'KPost Home · voice-command mic survives repeated clicks',
  { tag: ['@ui', '@home', '@regression'] },
  () => {
    test('repeated clicks on the voice-command mic must not raise an error @ui', async ({
      homePage,
      page,
    }) => {
      test.setTimeout(120_000);
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));

      await page.addInitScript(() => {
        const fakeStream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
        if (!navigator.mediaDevices) {
          Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
        }
        (navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = () =>
          Promise.resolve(fakeStream);
        // Faithful Web Speech API fake: start() throws if already started (as real webkitSpeechRecognition does).
        class FakeSpeechRecognition {
          private started = false;
          lang = '';
          continuous = false;
          interimResults = false;
          onstart: ((e: Event) => void) | null = null;
          onend: ((e: Event) => void) | null = null;
          onerror: ((e: Event) => void) | null = null;
          onresult: ((e: Event) => void) | null = null;
          start(): void {
            if (this.started)
              throw new DOMException('recognition has already started', 'InvalidStateError');
            this.started = true;
            this.onstart?.(new Event('start'));
          }
          stop(): void {
            this.started = false;
            this.onend?.(new Event('end'));
          }
          abort(): void {
            this.started = false;
          }
          addEventListener(): void {}
          removeEventListener(): void {}
        }
        (window as unknown as Record<string, unknown>).SpeechRecognition = FakeSpeechRecognition;
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition =
          FakeSpeechRecognition;
      });

      await homePage.goto();
      await homePage.expectLoaded();

      const voice = page.locator('button.header-voice-mic, .header-voice-mic').first();
      await expect(voice, 'the voice-command mic is present in the header').toBeVisible({
        timeout: 15_000,
      });

      // Click it several times in a row (mimics a user clicking repeatedly without stopping between).
      for (let i = 0; i < 6; i++) {
        await voice.click({ timeout: 5_000, force: true }).catch(() => undefined);
        await page.waitForTimeout(400);
      }

      // Page still alive?
      const alive = await page
        .evaluate(() => document.readyState)
        .then(() => true)
        .catch(() => false);
      expect(alive, 'the page is still alive after repeated voice-command clicks').toBe(true);

      // Reported symptom: an error toast after a few clicks. Correct behaviour: none.
      const errorToast = page.locator(
        '.Toastify__toast--error, [role="alert"].error, .toast-error',
      );
      const toastText = await errorToast
        .first()
        .textContent({ timeout: 2_000 })
        .catch(() => null);
      expect(
        await errorToast
          .first()
          .isVisible()
          .catch(() => false),
        `repeated voice-command clicks must not raise an error toast (saw: "${(toastText || '').trim()}")`,
      ).toBe(false);
      expect(
        pageErrors,
        `no uncaught page error from repeated voice-command clicks; saw: ${pageErrors.join(' | ')}`,
      ).toEqual([]);
    });
  },
);
