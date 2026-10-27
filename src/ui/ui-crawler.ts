import type { Locator, Page } from '@playwright/test';
import { isResponsive } from './ui-health';

/**
 * Generic UI crawler: clicks every discovered control and fills every input, then checks for a
 * crash, freeze or raw `undefined`/`NaN` render (selector-independent signals). On the disposable
 * test environment writes are allowed; only `OPERATIONAL_BLOCK` controls are skipped.
 */

export interface CrawlFinding {
  /** `ui.crash` | `ui.hang` | `ui.content` */
  check: string;
  severity: 'HIGH' | 'MEDIUM';
  /** Application-level description, naming the control that triggered it. */
  message: string;
}

/** Controls the crawler skips because they would end its session or destroy the test account. */
const OPERATIONAL_BLOCK =
  /(log\s?out|sign\s?out|deactivate|terminate|delete\s+(my\s+)?account|close\s+account|remove\s+account)/i;

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
    return [text, aria, title, cls]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  } catch {
    return '';
  }
}

/** Edge-case values fed into every input; filling never submits. */
const EDGE_VALUES = [
  'a'.repeat(4000), // very long — length/overflow handling
  '😀🔥💯 unicode ćafé', // multibyte / emoji
  '<script>alert(1)</script>', // must be escaped, never executed
  "'; DROP TABLE users;--", // injection-shaped text
  '99999999999999999999999999', // huge number
  '   ', // whitespace only
  `!@#$%^&*(){}[]|\\:;"'<>?,./~`, // special characters
];

/** Fill each visible input/editor with edge values and watch for a crash/freeze/render corruption. */
async function fuzzInputs(page: Page, route: string): Promise<CrawlFinding[]> {
  const findings: CrawlFinding[] = [];
  const inputs = page.locator(
    [
      'input:visible:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"])',
      'textarea:visible',
      '[contenteditable="true"]:visible',
    ].join(', '),
  );
  const n = Math.min(await inputs.count().catch(() => 0), 12);
  for (let i = 0; i < n; i += 1) {
    const inp = inputs.nth(i);
    for (const value of EDGE_VALUES.slice(0, 4)) {
      const ok = await inp
        .fill(value, { timeout: 1500 })
        .then(() => true)
        .catch(async () => {
          // A contenteditable editor is not a form input; type into it instead.
          try {
            await inp.click({ timeout: 1000 });
            await page.keyboard.type(value.slice(0, 300));
            return true;
          } catch {
            return false;
          }
        });
      if (!ok) break; // this input is not fillable here — move on
      await page.waitForTimeout(150);
      if (!(await isResponsive(page, 6000))) {
        findings.push({
          check: 'ui.hang',
          severity: 'HIGH',
          message: `The screen FROZE after entering an edge value into input #${i + 1}.`,
        });
        return findings;
      }
      for (const leak of await rawValueLeaks(page)) {
        findings.push({
          check: 'ui.content',
          severity: 'HIGH',
          message: `A value rendered as raw "${leak}" after typing into input #${i + 1}.`,
        });
      }
    }
    await inp.fill('', { timeout: 1000 }).catch(() => undefined); // clear so the next test starts fresh
    if (!page.url().includes(route)) {
      await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    }
  }
  return findings;
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
 * Exercises the screen's controls one by one and returns hang/content findings (crashes come from
 * the health monitor). Never throws.
 */
export async function crawlScreen(page: Page, route: string): Promise<CrawlFinding[]> {
  // First the deep input angle — fill every field with edge values and watch for a break.
  const findings: CrawlFinding[] = await fuzzInputs(page, route);
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
    // Skip only controls that would end the session or destroy the account.
    if (!label || OPERATIONAL_BLOCK.test(label)) continue;

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
