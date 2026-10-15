import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import { parkPointerAwayFromSideMenu } from './support/katchup';

/**
 * KDirectory — **initiate Katchup / Kall from a directory entry's profile** (FR-KD-006, KDirectory
 * FRD §7: "User selects Message or Call on the profile view; system opens a new Katchup message or
 * places a Kall to that contact").
 *
 * Read from source (`Kdirectory/components/KdirectoryModal/KdirectoryModal.js`,
 * `Katchup/bubble/DigitalCard/DigitalCard.js`, 2026-10-11): the directory asks for Country →
 * Language → vertical (`.dirCategory-box`) → Continue; the second phase has a `SearchBar`
 * (debounced `GetKdirectorySearch`) whose result rows are `ContactBar`s whose avatar `imgClick` opens
 * the person's `DigitalCard`. The card's feature row renders `button.dc-feature-button` with
 * `aria-label` **Write Mail · KMail · Katchup · Kall**; Katchup → `NavToComponentGroup(id,
 * "katchupModal")` → `navigate('/katchup', {state:{myProp:id, unknown:{…}}})`; Kall → `setKall({state:
 * true, contact})` → `KallModal`. Nothing is sent and no call is placed: the Kall modal is opened and
 * dismissed.
 */
const SEARCH_TERM = process.env.KDIRECTORY_SEARCH_TERM ?? 'Qatest';

/** react-select: the placeholder text is covered by the input container, so type into the input. */
async function pickReactSelect(page: Page, placeholder: RegExp, option: string): Promise<void> {
  const control = page.locator('.react-select__control').filter({ hasText: placeholder }).first();
  await expect(control, `the "${placeholder.source}" selector renders`).toBeVisible({
    timeout: 15_000,
  });
  await control.locator('input').first().fill(option);
  const match = page
    .locator('.react-select__option')
    .filter({ hasText: new RegExp(option, 'i') })
    .first();
  await expect(match, `"${option}" is offered`).toBeVisible({ timeout: 15_000 });
  await match.click();
}

async function openFirstProfileCard(page: Page): Promise<Locator> {
  await page.goto('/kdirectory', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);
  await parkPointerAwayFromSideMenu(page);

  await pickReactSelect(page, /Select Country/i, 'India');
  await pickReactSelect(page, /Choose Language/i, 'English');
  await page
    .locator('.dirCategory-box, .selectedCategory-box')
    .filter({ hasText: /^Personal$/ })
    .first()
    .click();
  const cont = page.getByRole('button', { name: /^Continue$/i });
  await expect(cont, 'Continue is enabled once a vertical is chosen').toBeEnabled({
    timeout: 10_000,
  });
  await cont.click();

  const search = page.getByRole('searchbox').first();
  await expect(search, 'the directory search renders').toBeVisible({ timeout: 15_000 });
  // `handleContactSearch` debounces 1 s, then POSTs /contacts/globalSearch/ — wait for that answer so
  // "no rows" can be told apart from "rows not rendered".
  const answer = page.waitForResponse((r) => r.url().includes('/contacts/globalSearch/'), {
    timeout: 30_000,
  });
  await search.fill(SEARCH_TERM);
  const response = await answer.catch(() => undefined);
  const payload = (await response?.json().catch(() => undefined)) as
    { status?: string; data?: unknown[] } | undefined;
  const hits = Array.isArray(payload?.data) ? payload.data.length : -1;
  test.info().annotations.push({
    type: 'observed',
    description: `globalSearch "${SEARCH_TERM}" → HTTP ${response?.status() ?? 'none'}, ${hits} entries`,
  });
  test.skip(
    hits === 0,
    `the directory search returned no entry for "${SEARCH_TERM}" (Personal / India / English) — set KDIRECTORY_SEARCH_TERM to a listed name`,
  );
  const rows = page.locator('.contactDir_scrollHeight .sb-avatar');
  await expect(rows.first(), 'the directory lists the matching entries').toBeVisible({
    timeout: 20_000,
  });
  await rows.first().click();
  const card = page.getByRole('dialog').filter({ has: page.locator('.dc-feature-button') });
  await expect(card, "the entry's profile (Digital Card) opens").toBeVisible({ timeout: 15_000 });
  return card;
}

test.describe(
  'KPost KDirectory · launch Katchup / Kall from a profile (FR-KD-006)',
  { tag: ['@ui', '@contacts', '@regression'] },
  () => {
    test.describe.configure({ timeout: 120_000 });
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test(
      'the profile view offers Write Mail / KMail / Katchup / Kall, and Katchup opens a new message with that contact @ui',
      {
        annotation: [
          { type: 'requirement', description: 'FR-KD-006' },
          { type: 'requirement-partial', description: 'FR-KD-003' },
          { type: 'requirement-partial', description: 'FR-KD-005' },
        ],
      },
      async ({ page }) => {
        const card = await openFirstProfileCard(page);
        for (const label of ['Write Mail', 'KMail', 'Katchup', 'Kall']) {
          await expect(
            card.getByRole('button', { name: label, exact: true }),
            `the profile offers ${label}`,
          ).toBeVisible();
        }
        const katchup = card.getByRole('button', { name: 'Katchup', exact: true });
        await expect(katchup, 'Katchup is enabled for an active entry').toBeEnabled();
        await katchup.click();
        await expect(page, 'Katchup opens for that contact').toHaveURL(/\/katchup/, {
          timeout: 15_000,
        });
        await expect(
          page.locator('#ChatTop .background-color-katchup').first(),
          'a conversation with the selected contact is open',
        ).toBeVisible({ timeout: 20_000 });
      },
    );

    test(
      'Kall from the profile view opens the call sheet for that contact (no call is placed) @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KD-006' }] },
      async ({ page }) => {
        const card = await openFirstProfileCard(page);
        const kall = card.getByRole('button', { name: 'Kall', exact: true });
        await expect(kall, 'Kall is enabled for an active entry').toBeEnabled();
        await kall.click();
        const sheet = page
          .getByRole('dialog')
          .filter({ hasText: /Kall|Call/i })
          .last();
        await expect(sheet, 'the Kall sheet opens for the contact').toBeVisible({
          timeout: 15_000,
        });
        await page.keyboard.press('Escape');
      },
    );
  },
);
