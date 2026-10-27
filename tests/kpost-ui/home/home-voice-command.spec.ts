import { expect, test } from '@fixtures';

/**
 * Home header voice-command mic: repeated clicks must not show an error toast. Headless has no mic,
 * so a fake Web Speech API is injected whose start() throws if already started, like the real one.
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

      // No error toast may appear.
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
