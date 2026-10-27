import { testData } from '@config/test-data.config';
import { text } from '@database/kpost-assertions';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import { requireKpostDb, rowSummary } from '../support/cross-layer';
import { parkPointerAwayFromSideMenu } from '../support/katchup';

/**
 * KDirectory: search (Country → Language → vertical → Continue), result rows vs the API and DB, and
 * Katchup / Kall from an entry's Digital Card. Nothing is sent and no call is placed.
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

/** One directory entry as the globalSearch API returns it (the fields the screen should show). */
interface DirEntry {
  kpostID?: string;
  firstName?: string;
  lastName?: string;
  designation?: string | null;
  role?: string | null;
  city?: string | null;
  companyName?: string | null;
}

/**
 * Country → Language → vertical → Continue → search; returns the result rows and the API's entries.
 * Use the Business vertical for entries with a designation and company.
 */
async function searchDirectory(
  page: Page,
  {
    vertical = 'Personal',
    term = SEARCH_TERM,
  }: { vertical?: 'Personal' | 'Business'; term?: string } = {},
): Promise<{ rows: Locator; entries: DirEntry[]; status?: number }> {
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
    .filter({ hasText: new RegExp(`^${vertical}$`) })
    .first()
    .click();
  const cont = page.getByRole('button', { name: /^Continue$/i });
  await expect(cont, 'Continue is enabled once a vertical is chosen').toBeEnabled({
    timeout: 10_000,
  });
  await cont.click();

  const search = page.getByRole('searchbox').first();
  await expect(search, 'the directory search renders').toBeVisible({ timeout: 15_000 });
  // The box searches as you type (debounced): wait for the answer to THIS term, so "no rows" can be
  // told apart from "rows not rendered".
  const answer = page.waitForResponse(
    (r) =>
      r.url().includes('/contacts/globalSearch/') &&
      (r.request().postData() ?? '').toLowerCase().includes(`"${term.toLowerCase()}"`),
    { timeout: 30_000 },
  );
  await search.fill(term);
  const response = await answer.catch(() => undefined);
  const payload = (await response?.json().catch(() => undefined)) as
    { status?: string; data?: DirEntry[] } | undefined;
  const hits = Array.isArray(payload?.data) ? payload.data.length : -1;
  test.info().annotations.push({
    type: 'observed',
    description: `globalSearch "${term}" (${vertical}) → HTTP ${response?.status() ?? 'none'}, ${hits} entries`,
  });
  test.skip(
    hits === 0,
    `the directory search returned no entry for "${term}" (${vertical} / India / English) right now — set KDIRECTORY_SEARCH_TERM to a listed name`,
  );
  const rows = page.locator('.contactDir_scrollHeight .sb-avatar');
  await expect(rows.first(), 'the directory lists the matching entries').toBeVisible({
    timeout: 20_000,
  });
  return { rows, entries: payload?.data ?? [], status: response?.status() };
}

async function openFirstProfileCard(page: Page): Promise<Locator> {
  const { rows } = await searchDirectory(page);
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
        tag: '@sanity',
        annotation: [{ type: 'requirement', description: 'FR-KD-006' }],
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
      'each result row shows the person’s name and location (FR-KD-003) @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KD-003' }] },
      async ({ page }) => {
        // Rows are compared with the names the search API returned for the same entries.
        const { rows, entries } = await searchDirectory(page);
        const rowBars = page.locator('.contactDir_scrollHeight').first();
        const shown = await rowBars.innerText();
        test.info().annotations.push({
          type: 'observed',
          description: `rows: ${JSON.stringify(shown.split('\n').filter(Boolean).slice(0, 6))}; API: ${JSON.stringify(entries.slice(0, 6).map((e) => `${e.firstName} ${e.lastName}`))}`,
        });
        await expect(rows, 'one row per entry the API returned').toHaveCount(entries.length);
        for (const entry of entries) {
          const name = `${entry.firstName ?? ''} ${entry.lastName ?? ''}`.trim();
          await expect(
            rowBars,
            `the row for ${entry.kpostID} shows the person’s name "${name}" (#1370)`,
          ).toContainText(name);
          if (entry.city) await expect(rowBars, 'and their location').toContainText(entry.city);
          const role = entry.designation ?? entry.role;
          if (role) await expect(rowBars, 'and their role/designation').toContainText(role);
        }
      },
    );

    test(
      'each business result row shows the person’s name, role/designation and team (company) (FR-KD-003) @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KD-003' }] },
      async ({ page }) => {
        // Personal QA accounts have no designation or company, so search the QA company (242) members.
        const { rows, entries } = await searchDirectory(page, {
          vertical: 'Business',
          term: 'Nebius',
        });
        const rowBars = page.locator('.contactDir_scrollHeight').first();
        test.info().annotations.push({
          type: 'observed',
          description: `rows: ${JSON.stringify((await rowBars.innerText()).split('\n').filter(Boolean).slice(0, 8))}`,
        });
        await expect(rows, 'one row per entry the API returned').toHaveCount(entries.length);
        for (const entry of entries) {
          const name = `${entry.firstName ?? ''} ${entry.lastName ?? ''}`.trim();
          await expect(
            rowBars,
            `the row for ${entry.kpostID} shows the name "${name}"`,
          ).toContainText(name);
          const role = entry.designation ?? entry.role;
          if (role)
            await expect(rowBars, `and the role/designation "${role}" (#13220)`).toContainText(
              role,
            );
          if (entry.companyName)
            await expect(rowBars, `and the team/company "${entry.companyName}"`).toContainText(
              entry.companyName,
            );
        }
        expect(
          entries.some((e) => (e.designation ?? e.role) && e.companyName),
          'the search reached entries that carry a role and a company (otherwise nothing was proven)',
        ).toBe(true);
      },
    );

    test(
      'a business directory search shows on screen exactly what the API returned, and the API returns what the database holds @ui',
      {
        annotation: [
          {
            type: 'cross-layer',
            description:
              'KDirectory: Business search on screen → contacts/globalSearch → TBL_KPOST_USER_MASTER + TBL_KPOST_USER_PROFILE',
          },
        ],
      },
      async ({ page, databases }) => {
        // Read-only. Designation on screen is judged in the FR-KD-003 test; here the UI half checks only
        // name and company, so a failure points at one layer.
        const db = requireKpostDb(databases);
        const { rows, entries, status } = await searchDirectory(page, {
          vertical: 'Business',
          term: 'Nebius',
        });
        expect(status, 'API: globalSearch answers 200').toBe(200);
        expect(entries.length, 'API: the search returned entries to compare').toBeGreaterThan(0);

        await test.step('UI: one row per entry, each showing its name and company', async () => {
          await expect(rows, 'one row per entry the API returned').toHaveCount(entries.length);
          const rowBars = page.locator('.contactDir_scrollHeight').first();
          for (const e of entries) {
            const name = `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim();
            await expect(rowBars, `the row for ${e.kpostID} shows "${name}"`).toContainText(name);
            if (e.companyName)
              await expect(rowBars, `and the company "${e.companyName}"`).toContainText(
                e.companyName,
              );
          }
        });

        await test.step('DB: every entry matches its account and profile rows', async () => {
          type AccountRow = {
            kpost_id: unknown;
            first_name: unknown;
            last_name: unknown;
            designation: unknown;
            company_name: unknown;
          };
          const ids = entries.map((e) => e.kpostID ?? '');
          const found = await db.query<AccountRow>(
            `SELECT m.kpost_id, m.first_name, m.last_name, p.designation, p.company_name
               FROM TBL_KPOST_USER_MASTER m
               LEFT JOIN TBL_KPOST_USER_PROFILE p ON p.kpost_id = m.kpost_id
              WHERE m.kpost_id IN (${ids.map(() => '?').join(', ')})`,
            ids,
          );
          const byId = new Map(found.map((r) => [String(text(r.kpost_id)).toLowerCase(), r]));
          test.info().annotations.push({
            type: 'observed',
            description: `rows: ${found
              .slice(0, 3)
              .map((r) =>
                rowSummary(r, [
                  'kpost_id',
                  'first_name',
                  'last_name',
                  'designation',
                  'company_name',
                ]),
              )
              .join(' | ')}`,
          });
          const same = (v: unknown): string => String(text(v) ?? '').trim();
          for (const e of entries) {
            const row = byId.get(String(e.kpostID).toLowerCase());
            expect(row, `${e.kpostID} has an account row`).toBeDefined();
            expect
              .soft(same(row?.first_name), `${e.kpostID}: first name as stored`)
              .toBe(same(e.firstName));
            expect
              .soft(same(row?.last_name), `${e.kpostID}: last name as stored`)
              .toBe(same(e.lastName));
            expect
              .soft(same(row?.designation), `${e.kpostID}: designation as stored`)
              .toBe(same(e.designation));
            expect
              .soft(same(row?.company_name), `${e.kpostID}: company as stored`)
              .toBe(same(e.companyName));
          }
        });
      },
    );

    test(
      'the directory screen shows the total contact count for the search (FR-KD-004) @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KD-004' }] },
      async ({ page }) => {
        // The count must be stated as text ("6 contacts", "Total 6"), not just six rows on screen.
        const { rows, entries } = await searchDirectory(page);
        // The captured reply can be an earlier empty search, so fall back to the rows.
        const n = entries.length || (await rows.count());
        const screen = page.locator('.secondPhase, .contactDir_scrollHeight').first().locator('..');
        const shown = await screen.innerText();
        test.info().annotations.push({
          type: 'observed',
          description: `API entries: ${n}; screen text: ${JSON.stringify(shown.split('\n').filter(Boolean).slice(0, 12))}`,
        });
        const count = new RegExp(
          `\\b${n}\\s*(contacts?|results?|entries|members?|found)\\b|\\b(total|contacts?|results?|count)\\b\\W{0,3}${n}\\b`,
          'i',
        );
        await expect(
          page.locator('body'),
          `the screen states the total count (${n}) of the directory search (#13221)`,
        ).toContainText(count, { timeout: 10_000 });
      },
    );

    test(
      'opening an entry shows that person’s full profile — name, email, location (FR-KD-005) @ui',
      { annotation: [{ type: 'requirement', description: 'FR-KD-005' }] },
      async ({ page }) => {
        const { rows, entries } = await searchDirectory(page);
        const first = entries[0];
        expect(first?.kpostID, 'the search returned an entry').toBeTruthy();
        await rows.first().click();
        const card = page.getByRole('dialog').filter({ has: page.locator('.dc-feature-button') });
        await expect(card, "the entry's profile (Digital Card) opens").toBeVisible({
          timeout: 15_000,
        });
        const name = `${first?.firstName ?? ''} ${first?.lastName ?? ''}`.trim();
        await expect(card, `the profile is that person’s: "${name}"`).toContainText(name);
        await expect(card, 'with their email').toContainText(first?.kpostID ?? '__none__', {
          ignoreCase: true,
        });
        if (first?.city) await expect(card, 'and their location').toContainText(first.city);
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
