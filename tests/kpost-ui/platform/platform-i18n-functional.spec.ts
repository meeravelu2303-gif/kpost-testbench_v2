import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { skipIfSignedOut } from '../support/session';

/**
 * i18n: each language offered by the header select must have a bundle that is not mostly English, and
 * switching language must change the "Katchup" label and survive a reload (English restored after).
 */
async function bundle(page: Page, lang: string): Promise<Record<string, unknown> | null> {
  const res = await page.request.get(`/locales/${lang}/translation.json`);
  if (!res.ok()) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

async function offeredLanguages(page: Page): Promise<string[]> {
  await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const select = page.locator('select.Header_Language').first();
  await expect(select, 'the language selector renders in the header').toBeVisible({
    timeout: 20_000,
  });
  return select
    .locator('option')
    .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
}

test.describe('KPost internationalisation', { tag: ['@ui', '@platform', '@regression'] }, () => {
  test('every language offered in the header has a bundle that covers the English keys @ui', async ({
    page,
  }) => {
    await skipIfSignedOut(page);
    const offered = await offeredLanguages(page);
    test
      .info()
      .annotations.push({ type: 'observed', description: `offered: ${offered.join(', ')}` });
    expect(offered, 'the header offers English').toContain('english');

    const english = await bundle(page, 'english');
    expect(english, 'the English bundle is served').not.toBeNull();
    const englishKeys = Object.keys(english!);
    expect(englishKeys.length, 'the English bundle has content').toBeGreaterThan(50);

    const gaps: string[] = [];
    for (const lang of [...offered.filter((l) => l !== 'english'), 'tamil']) {
      const b = await bundle(page, lang);
      const judged = offered.includes(lang);
      if (!b) {
        if (judged) gaps.push(`${lang}: bundle not served`);
        continue;
      }
      const missing = englishKeys.filter((k) => !(k in b) || b[k] === '' || b[k] === null);
      const pct = Math.round((missing.length / englishKeys.length) * 100);
      test.info().annotations.push({
        type: 'observed',
        description: `${lang}${judged ? '' : ' (served, not offered)'}: ${missing.length}/${englishKeys.length} keys missing (${pct}%) — e.g. ${missing.slice(0, 10).join(', ')}`,
      });
      if (judged && pct > 10) gaps.push(`${lang}: ${pct}% of English keys untranslated`);
    }
    expect(
      gaps,
      'a language offered to users must not fall back to English for more than 10% of its labels',
    ).toEqual([]);
  });

  test('switching language translates the navigation, persists across reload, and switches back @ui', async ({
    page,
  }) => {
    await skipIfSignedOut(page);
    const offered = await offeredLanguages(page);
    const target = offered.find((l) => l !== 'english');
    test.skip(!target, 'the header offers no language other than English right now');
    const b = (await bundle(page, target!)) ?? {};
    const expected = typeof b.Katchup === 'string' ? b.Katchup : '';
    expect(expected, `the ${target} bundle translates "Katchup"`).not.toBe('');

    const select = page.locator('select.Header_Language').first();
    try {
      await select.selectOption(target!);
      // The side menu shows icons only; the Katchup page header (`.Katchup_Name`) carries the label.
      await page.goto('/katchup', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const label = page.locator('.Katchup_Name').first();
      await expect(label, `the Katchup label is shown in ${target}`).toHaveText(
        new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        { timeout: 20_000 },
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(label, 'the language choice survives a reload').toHaveText(
        new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        { timeout: 20_000 },
      );
      // Labels still in English after the switch are the untranslated keys that user sees.
      const tabs = await page
        .getByRole('tab')
        .allInnerTexts()
        .catch(() => []);
      test.info().annotations.push({
        type: 'observed',
        description: `Katchup tab labels under ${target}: ${tabs.map((t) => t.trim()).join(' | ')}`,
      });
    } finally {
      await page
        .goto('/home', { waitUntil: 'domcontentloaded', timeout: 45_000 })
        .catch(() => undefined);
      await page
        .locator('select.Header_Language')
        .first()
        .selectOption('english')
        .catch(() => undefined);
      await page
        .evaluate(() => localStorage.setItem('i18nextLng', 'english'))
        .catch(() => undefined);
    }
  });
});
