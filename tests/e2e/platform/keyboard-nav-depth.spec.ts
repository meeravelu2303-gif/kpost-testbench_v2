import { AUTHENTICATED_SCREENS, NAV_LINKS } from '@ui/screens';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { skipIfSignedOut } from '../support/session';

/**
 * **Keyboard navigation — depth.** `keyboard-nav.spec.ts` already proves Tab reaches SOME control on
 * every screen without a crash. This file asks the two questions that one does not:
 *   1. Can a keyboard user reach the MAIN NAVIGATION? Every side-menu entry (`NAV_LINKS`) must be a
 *      native control or carry a `tabindex` — a `div` with only an `onClick` is unreachable without
 *      a mouse (WCAG 2.1.1).
 *   2. Is every tab stop something the user can SEE? A stop on an off-screen or hidden element is a
 *      focus trap; and Escape with nothing open must not navigate away.
 * The first 25 stops of each screen are recorded as an annotation. Paced 4 s between screens.
 */
type Stop = { tag: string; role: string | null; name: string; visible: boolean };

async function tabStops(page: Page, max: number): Promise<Stop[]> {
  const stops: Stop[] = [];
  await page
    .locator('body')
    .click({ position: { x: 1, y: 1 } })
    .catch(() => undefined);
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const visible =
        r.width > 0 &&
        r.height > 0 &&
        cs.visibility !== 'hidden' &&
        cs.display !== 'none' &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < window.innerHeight &&
        r.left < window.innerWidth;
      const name =
        el.getAttribute('aria-label') ??
        el.getAttribute('title') ??
        (el.textContent ?? '').trim().slice(0, 40);
      return { tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), name, visible };
    });
    if (!stop) break;
    stops.push(stop);
  }
  return stops;
}

test.describe(
  'KPost keyboard navigation — depth',
  {
    tag: ['@ui', '@platform', '@regression'],
    annotation: [{ type: 'non-functional', description: 'accessibility' }],
  },
  () => {
    test.describe.configure({ timeout: 600_000 });

    test('the main navigation (side menu) is reachable without a mouse @ui', async ({ page }) => {
      await skipIfSignedOut(page);
      await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);
      const unreachable: string[] = [];
      for (const link of NAV_LINKS) {
        const el = page.locator(link.icon).first();
        if (!(await el.isVisible().catch(() => false))) continue;
        const focusable = await el.evaluate((node) => {
          const target = (node.closest('a, button, [tabindex]') ?? node) as HTMLElement;
          const native = /^(a|button|input|select|textarea)$/i.test(target.tagName);
          const ti = target.getAttribute('tabindex');
          return native || (ti !== null && Number(ti) >= 0);
        });
        if (!focusable) unreachable.push(`${link.name} (${link.icon})`);
      }
      test.info().annotations.push({
        type: 'observed',
        description: `nav entries not focusable: ${unreachable.length ? unreachable.join(', ') : 'none'}`,
      });
      expect(
        unreachable,
        'every side-menu entry must be focusable (native control or tabindex) — WCAG 2.1.1',
      ).toEqual([]);
    });

    const personal = AUTHENTICATED_SCREENS.filter((s) => (s.session ?? 'personal') === 'personal');
    for (const [i, screen] of personal.entries()) {
      test(`${screen.name} — every tab stop is visible, Escape stays put @ui`, async ({ page }) => {
        if (i === 0) await skipIfSignedOut(page);
        // eslint-disable-next-line playwright/no-wait-for-timeout -- request-rate pacing between screens (rate-limiter, 2026-10-07)
        if (i > 0) await page.waitForTimeout(4_000);
        await page.goto(screen.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);
        await expect(
          page.locator(screen.ready.join(', ')).first(),
          'the screen mounts',
        ).toBeVisible({
          timeout: 20_000,
        });
        const stops = await tabStops(page, 25);
        test.info().annotations.push({
          type: 'observed',
          description: stops
            .map(
              (s, n) =>
                `${n + 1}. <${s.tag}${s.role ? ` role=${s.role}` : ''}> "${s.name}"${s.visible ? '' : ' [NOT VISIBLE]'}`,
            )
            .join('\n'),
        });
        expect(stops.length, 'Tab moves focus off the body').toBeGreaterThan(0);
        const hidden = stops.filter((s) => !s.visible).map((s) => `<${s.tag}> "${s.name}"`);
        expect(hidden, 'no tab stop lands on an element the user cannot see (focus trap)').toEqual(
          [],
        );
        const before = page.url();
        await page.keyboard.press('Escape');
        await expect(page, 'Escape with nothing open does not navigate away').toHaveURL(before);
      });
    }
  },
);
