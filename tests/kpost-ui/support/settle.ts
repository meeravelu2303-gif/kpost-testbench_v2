import type { Page } from '@playwright/test';

/**
 * Condition-based waits that replace fixed sleeps: `settleFrames` (two animation frames, for in-page
 * effects) and `settleNetwork` (the response to the request an action fires; start it before the click).
 */
export async function settleFrames(page: Page, frames = 2): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const tick = (left: number): void => {
          if (left <= 0) return resolve();
          requestAnimationFrame(() => tick(left - 1));
        };
        tick(n);
      }),
    frames,
  );
}

export function settleNetwork(
  page: Page,
  match: RegExp | ((url: string, method: string) => boolean),
  timeout = 15_000,
): Promise<number> {
  const test = typeof match === 'function' ? match : (url: string) => match.test(url);
  return page
    .waitForResponse((r) => test(r.url(), r.request().method()), { timeout })
    .then((r) => r.status())
    .catch(() => 0);
}
