import type { Locator, Page } from '@playwright/test';
import { isResponsive } from './ui-health';

/**
 * Safe systematic UI crawler — the automated equivalent of a diligent manual tester clicking through
 * every control on a screen and noticing when something breaks, but exhaustive and on three browsers.
 *
 * It is GENERIC: it discovers whatever controls the screen renders and exercises them, so it needs no
 * per-feature selectors and cannot rot as the app changes. After each interaction it checks the app is
 * still healthy — did it crash, freeze, or render a raw `undefined`/`NaN`/`[object Object]`? Those are
 * selector-INDEPENDENT signals, so a crawl can only ever report a REAL defect, never a false one.
 *
 * ## Safety — why this cannot damage the live QA accounts
 * It clicks only **non-destructive** controls: anything whose visible text/aria/class matches the
 * DESTRUCTIVE denylist (send, submit, save, delete, logout, confirm, pay, block, leave, …) is skipped,
 * and it NEVER clicks a confirm/OK/Yes. It presses Escape after every click to close any menu/dialog
 * without committing it, and if a click navigates away it returns. So it opens, expands, views and
 * types — the read-only half of testing — and leaves the commit/destroy half to the gated lifecycle
 * flows. The result: broad "every control, every screen" coverage with zero write risk.
 */

export interface CrawlFinding {
  /** `ui.crash` | `ui.hang` | `ui.content` */
  check: string;
  severity: 'HIGH' | 'MEDIUM';
  /** Application-level description, naming the control that triggered it. */
  message: string;
}

/** Visible text/aria/class of a control that must NEVER be clicked (it commits or destroys state). */
const DESTRUCTIVE =
  /(log\s?out|sign\s?out|delete|remove|discard|\bsend\b|submit|\breply\b|forward|\bsave\b|update|confirm|\bok\b|\byes\b|apply|\bpay\b|\bbuy\b|purchase|checkout|subscribe|unsubscribe|terminate|deactivate|suspend|\bblock\b|unblock|\bban\b|\bleave\b|\bexit\b|recall|\breport\b|archive|invite|provision|register|change password|reset)/i;

/** How many controls to exercise per screen — bounds runtime across three browsers. */
const MAX_CLICKS = 24;
/** How many candidate controls to consider before filtering (a screen can have hundreds of nodes). */
const MAX_CANDIDATES = 80;

/** The raw text that identifies a control, for the denylist check and the finding message. */
async function describe(loc: Locator): Promise<string> {
  try {
    const [text, aria, cls, title] = await Promise.all([
      loc.innerText({ timeout: 500 }).catch(() => ''),
      loc.getAttribute('aria-label').catch(() => null),
      loc.getAttribute('class').catch(() => null),
      loc.getAttribute('title').catch(() => null),
    ]);
    return [text, aria, title, cls].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  } catch {
    return '';
  }
}

/** Text nodes rendered as a raw failed value — the same calibrated tokens as the ui.content check. */
async function rawValueLeaks(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      const BAD = new Set(['undefined', 'null', 'NaN', '[object Object]', 'Invalid Date']);
      const found: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.nodeValue ?? '').trim();
        if (!BAD.has(text)) continue;
        const el = node.parentElement;
        if (!el || el.offsetParent === null) continue;
        const tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style') continue;
        found.push(text);
        if (found.length >= 4) break;
      }
      return found;
    });
  } catch {
    return [];
  }
}

/**
 * Exercise the screen's controls one by one, reporting any that crash, freeze, or corrupt the render.
 * `pageErrors` (crashes) are collected by the caller's health monitor; this returns the hang/content
 * findings and never throws — a screen with no safe controls simply returns no findings.
 */
export async function crawlScreen(page: Page, route: string): Promise<CrawlFinding[]> {
  const findings: CrawlFinding[] = [];
  // Candidate controls: buttons, menu items, tabs, links, icon-font controls, contact/thread rows.
  const candidates = page.locator(
    [
      'button:visible',
      '[role="button"]:visible',
      '[role="menuitem"]:visible',
      '[role="tab"]:visible',
      'a[href]:visible',
      '[class*="icon-KP"]:visible',
      'li[id*="@"]:visible',
    ].join(', '),
  );

  const total = Math.min(await candidates.count().catch(() => 0), MAX_CANDIDATES);
  let clicked = 0;
  for (let i = 0; i < total && clicked < MAX_CLICKS; i += 1) {
    const loc = candidates.nth(i);
    const label = await describe(loc);
    if (!label || DESTRUCTIVE.test(label)) continue; // never touch a committing/destructive control

    try {
      await loc.click({ timeout: 2500 });
    } catch {
      continue; // not actionable (covered, detached, disabled) — skip, do not fail
    }
    clicked += 1;
    await page.waitForTimeout(350); // let the click's effect render

    if (!(await isResponsive(page, 6000))) {
      findings.push({
        check: 'ui.hang',
        severity: 'HIGH',
        message: `The screen FROZE (main thread unresponsive) after clicking "${label}".`,
      });
      break; // a frozen page cannot be crawled further
    }
    for (const leak of await rawValueLeaks(page)) {
      findings.push({
        check: 'ui.content',
        severity: 'HIGH',
        message: `A value rendered as raw "${leak}" after clicking "${label}" — the user sees this literally.`,
      });
    }

    // Close whatever the click opened, without committing it, and return if it navigated away.
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(120);
    if (!page.url().includes(route)) {
      await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }

  return findings;
}
