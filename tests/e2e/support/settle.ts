import type { Page } from '@playwright/test';

/**
 * Deterministic "let the page react" waits that replace fixed sleeps.
 *
 *   - `settleFrames(page)` — two animation frames: React has committed and any handler an input
 *     could have triggered (including an injected payload's) has had its turn. Use after a fill/click
 *     whose only effect is in-page (fuzz checks, state toggles with no network round-trip).
 *   - `settleNetwork(page, match)` — the answer to the request an action fires, when the action has
 *     a backend round-trip; pairs with the click (`const done = settleNetwork(...); await click;
 *     await done;`).
 *
 * Neither is a timer: both resolve as soon as the condition holds and fail loudly when it never does.
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
