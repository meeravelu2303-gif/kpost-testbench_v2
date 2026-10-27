import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import {
  crashDiagnosis,
  healthFailures,
  isResponsive,
  renderCrashOverlay,
  watchUiHealth,
} from '@ui/ui-health';
import type { UiHealthReport } from '@ui/ui-health';

/**
 * Shared screen-breakage sweep ("does this screen crash?"): drives a screen, watches its health,
 * and on a crash attaches a diagnosis, an annotated screenshot and a short video ending on the
 * overlay.
 */

/** Open a labelled section/tab if present; never fails the walk if a label is absent on this build. */
export async function openSection(page: Page, label: string): Promise<void> {
  await page
    .getByText(label, { exact: false })
    .first()
    .click({ timeout: 8_000 })
    .catch(() => undefined);
  await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => undefined);
  await isResponsive(page, 3_000).catch(() => undefined);
}

/** Wait out the app's loading overlay (best-effort). */
export async function settleLoader(page: Page): Promise<void> {
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
}

/** Attaches crash proof (diagnosis, overlay, screenshot); best-effort, never hides an assertion. */
export async function attachCrashEvidence(
  page: Page,
  screen: string,
  route: string,
  report: UiHealthReport,
): Promise<void> {
  const info = test.info();
  const diagPath = info.outputPath('crash-diagnosis.txt');
  writeFileSync(diagPath, crashDiagnosis(screen, route, report));
  await info.attach('crash-diagnosis', { path: diagPath, contentType: 'text/plain' });

  await renderCrashOverlay(page, screen, report);
  const shot = info.outputPath('crash-evidence.png');
  await page.screenshot({ path: shot }).catch(() => undefined);
  await info.attach('crash-evidence', { path: shot, contentType: 'image/png' });

  await page
    .locator('#__kp_crash_overlay')
    .waitFor({ state: 'detached', timeout: 5_000 })
    .catch(() => undefined);
}

/**
 * Loads a screen and checks its health, then walks its sub-sections only if the load was clean.
 * `arrive` navigates (default `page.goto(route)`), `mount` asserts it appeared, `walk` opens
 * sections.
 */
export async function sweepScreen(
  page: Page,
  opts: {
    screen: string;
    route: string;
    mount: () => Promise<void>;
    walk: () => Promise<void>;
    arrive?: () => Promise<void>;
  },
): Promise<void> {
  const { screen, route } = opts;

  // --- Phase 1: did the screen crash just loading? (the common case; keeps the video short) -------
  const stopLoad = watchUiHealth(page);
  if (opts.arrive) await opts.arrive();
  else await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await settleLoader(page);
  await opts.mount();
  await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => undefined);
  await isResponsive(page, 4_000).catch(() => undefined);

  const loadReport = stopLoad();
  const loadFailures = healthFailures(loadReport);
  if (loadFailures.length) {
    await attachCrashEvidence(page, screen, route, loadReport);
    expect(
      loadFailures,
      `The ${screen} screen crashes on load:\n${loadFailures.join('\n')}`,
    ).toEqual([]);
    return;
  }

  // --- Phase 2: load was clean — walk each sub-section to catch a section-specific break ----------
  const stopWalk = watchUiHealth(page);
  await opts.walk();
  const responsive = await isResponsive(page);
  const report = stopWalk();
  const failures = healthFailures(report);

  test.info().annotations.push({
    type: 'observed',
    description:
      `${screen}: ${report.consoleErrors.length} console error(s), ` +
      `${report.failedApiCalls.length} failed API call(s) (context only).`,
  });

  if (failures.length) await attachCrashEvidence(page, screen, route, report);

  expect(
    failures,
    `${screen} sections must not crash or 404 an asset:\n${failures.join('\n')}`,
  ).toEqual([]);
  expect(responsive, `the ${screen} screen must not hang after opening its sections`).toBe(true);
}
