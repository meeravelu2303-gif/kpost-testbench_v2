import type { Locator, Page } from '@playwright/test';

/**
 * Shared steps for the `-validation` specs: an invalid input must be refused with a message the user
 * can read, and the refused input must never reach the server.
 */

/** Counts, from now on, the requests the page sends whose URL contains `path`. */
export function countRequests(page: Page, path: string): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.url().includes(path)) count += 1;
  });
  return () => count;
}

/**
 * Whether the page sends a request whose URL contains `path` within `ms`. Start it before the click:
 * `const sent = sendsWithin(page, path); await save.click(); expect(await sent).toBe(false)`.
 */
export function sendsWithin(page: Page, path: string, ms = 5_000): Promise<boolean> {
  return page
    .waitForRequest((request) => request.url().includes(path), { timeout: ms })
    .then(
      () => true,
      () => false,
    );
}

/** A toast (react-toastify) whose text matches; components with their own container can show two. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('.Toastify__toast').filter({ hasText: text }).first();
}
