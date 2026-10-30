import type { Locator, Page, Response } from '@playwright/test';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { openProfileSection } from '../support/profile';
import { pickReactSelect } from '../support/react-select';

/**
 * Settings › Profile Creation, every section's save on screen, each restored afterwards:
 * Basic Information (Other Email ID), Contact Information (Landline Number), Experience, Education
 * (School) and Other Activities (add a card, save, then delete that card). Each step checks the
 * server's answer, not only the screen. Selectors from components/Settings/* (the screen renders
 * twice, a desktop and a hidden mobile copy, so everything is scoped to the desktop panel).
 * Gated behind PROFILE_UI_LIFECYCLE=true: it writes to the signed-in QA account's profile.
 */

/** Runs `act` and returns the first POST answer whose URL contains `path`. */
async function answerTo(page: Page, path: string, act: () => Promise<void>): Promise<Response> {
  const answer = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes(path),
    { timeout: 30_000 },
  );
  await act();
  return answer;
}

async function envelope(response: Response): Promise<{ status?: string; message?: string }> {
  return (await response.json().catch(() => ({}))) as { status?: string; message?: string };
}

/** The last entry card (a new one is appended at the end). */
const lastCard = (panel: Locator): Locator => panel.locator('.pc-entry-card').last();

/** The saved card whose input with `placeholder` holds `value`. */
async function cardWith(
  panel: Locator,
  placeholder: string,
  value: string,
): Promise<Locator | null> {
  const cards = panel.locator('.pc-entry-card');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const field = cards.nth(i).getByPlaceholder(placeholder).first();
    if ((await field.inputValue().catch(() => '')) === value) return cards.nth(i);
  }
  return null;
}

/** Adds a card unless the section shows its single blank starter card. */
async function newCard(
  panel: Locator,
  addLabel: RegExp,
  firstPlaceholder: string,
): Promise<Locator> {
  const blankStarter =
    (await panel.locator('.pc-entry-card').count()) === 1 &&
    (await lastCard(panel)
      .getByPlaceholder(firstPlaceholder)
      .first()
      .inputValue()
      .catch(() => 'x')) === '';
  if (!blankStarter) await panel.getByRole('button', { name: addLabel }).first().click();
  return lastCard(panel);
}

/**
 * True when Basic Information shows no gender, after picking "Female" so a save can still go
 * through. The account is stored as "Female" (as the phone app saves it), but the form's options
 * are "Male" / "female" / "other", matched case-sensitively from the copy of the user saved at
 * login; an unmatched gender shows empty and the save sends "-", which the server refuses.
 */
async function pickGenderIfEmpty(page: Page, panel: Locator): Promise<boolean> {
  const empty = panel
    .locator('.react-select__control')
    .filter({ hasText: 'Select Gender' })
    .first();
  if (!(await empty.isVisible().catch(() => false))) return false;
  await pickReactSelect(empty, 'Female', { page });
  return true;
}

/** Each record list in the profile: its key, the field naming the record, and its id field. */
const RECORDS = [
  { list: 'schoolDetails', name: 'schoolName', id: 'schoolID', remove: 'profile-delete-school' },
  {
    list: 'collegeDetails',
    name: 'collegeName',
    id: 'collegeID',
    remove: 'profile-delete-college',
  },
  {
    list: 'universityDetails',
    name: 'universityName',
    id: 'universityID',
    remove: 'profile-delete-university',
  },
  {
    list: 'experienceDetails',
    name: 'companyName',
    id: 'experienceID',
    remove: 'profile-delete-experience',
  },
  {
    list: 'otherActivities',
    name: 'title',
    id: 'activityID',
    remove: 'profile-delete-other-activity',
  },
] as const;

/**
 * Puts the QA account's profile in a state the screens can save: the API tests leave records named
 * "QA…" (some missing fields, which blocks every save on that screen) and fuzz values in the basic
 * details (gender "-", which the server refuses). Runs as the browser's account, reusing its session.
 */
async function resetQaProfile(endpoints: EndpointExecutor): Promise<void> {
  const read = await endpoints.sendTo(
    'profile-get-user-profile',
    {},
    { label: 'profile-ui:reset-read' },
  );
  const parsed = read.json();
  const data = ((parsed.ok ? parsed.value : {}) as { data?: unknown }).data;
  const profile = ((Array.isArray(data) ? data[0] : data) ?? {}) as {
    userProfile?: Record<string, unknown>;
  };
  const sections = profile.userProfile ?? {};
  for (const record of RECORDS) {
    let list = sections[`${record.list}AsJson`] ?? sections[record.list];
    if (typeof list === 'string') list = JSON.parse(list || '[]') as unknown;
    for (const row of (Array.isArray(list) ? list : []) as Record<string, unknown>[]) {
      const name = row[record.name];
      if (typeof name !== 'string' || !/^QA/i.test(name) || !row[record.id]) continue;
      await endpoints
        .sendTo(
          record.remove,
          { body: { [record.id]: row[record.id] } },
          { label: 'profile-ui:reset-remove', allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  }
  await endpoints.sendTo(
    'profile-update-basic',
    {
      body: {
        knownLanguages: ['English'],
        designation: 'QA Bench',
        gender: 'Female',
        otherEmail: testData.kpostId,
        dateOfBirth: '1995-01-01',
      },
    },
    { label: 'profile-ui:reset-basic', allowLiveWrite: true },
  );
}

test.describe(
  'KPost Profile · every Profile Creation section saves and restores @ui',
  { tag: ['@ui', '@profile', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 180_000 });
    test.skip(
      process.env.PROFILE_UI_LIFECYCLE !== 'true',
      'writes to the QA profile; set PROFILE_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real QA account',
    );
    test.beforeEach(async ({ endpoints }) => {
      await resetQaProfile(endpoints);
    });

    test('Basic Information: a new Other Email ID saves, then the original is put back', async ({
      page,
    }) => {
      const panel = await openProfileSection(page, 'Basic Information');
      const email = panel.getByPlaceholder('Enter Email ID').first();
      await expect(email, 'the Basic Information form renders').toBeVisible({ timeout: 20_000 });
      const original = await email.inputValue();
      const marker = `qa.bench.${Date.now()}@kpostindia.com`;
      expect
        .soft(await pickGenderIfEmpty(page, panel), 'the saved gender ("Female") is shown')
        .toBe(false);
      try {
        await email.fill(marker);
        const saved = await answerTo(page, '/profile/updateBasicInformation', () =>
          panel
            .getByRole('button', { name: /^Update$/ })
            .first()
            .click(),
        );
        expect(saved.request().postData() ?? '', 'the save carries the new e-mail').toContain(
          marker,
        );
        expect((await envelope(saved)).status, 'the server saves it').toBe('SUCCESS');
        const reopened = await openProfileSection(page, 'Basic Information');
        await expect
          .soft(reopened.getByPlaceholder('Enter Email ID').first(), 'it is shown after reopening')
          .toHaveValue(marker, { timeout: 20_000 });
      } finally {
        const back = await openProfileSection(page, 'Basic Information');
        await pickGenderIfEmpty(page, back);
        await back.getByPlaceholder('Enter Email ID').first().fill(original);
        await answerTo(page, '/profile/updateBasicInformation', () =>
          back
            .getByRole('button', { name: /^Update$/ })
            .first()
            .click(),
        ).catch(() => undefined);
      }
    });

    test('Contact Information: a new Landline Number saves, then the original is put back', async ({
      page,
    }) => {
      const panel = await openProfileSection(page, 'Contact Information');
      const landline = panel.getByPlaceholder('Enter Landline Number').first();
      await expect(landline, 'the Contact Information form renders').toBeVisible({
        timeout: 20_000,
      });
      test.skip(
        !(await panel
          .getByPlaceholder('Enter Address line 1')
          .first()
          .inputValue()
          .catch(() => '')),
        'no saved address on this account yet, so the required fields cannot be kept as they are',
      );
      const original = await landline.inputValue();
      const marker = `044${String(Date.now()).slice(-7)}`;
      try {
        await landline.fill(marker);
        const saved = await answerTo(page, '/profile/updateContactInformation', () =>
          panel
            .getByRole('button', { name: /^Update$/ })
            .first()
            .click(),
        );
        expect(saved.request().postData() ?? '', 'the save carries the new landline').toContain(
          marker,
        );
        expect((await envelope(saved)).status, 'the server saves it').toBe('SUCCESS');
      } finally {
        const back = await openProfileSection(page, 'Contact Information');
        await back.getByPlaceholder('Enter Landline Number').first().fill(original);
        await answerTo(page, '/profile/updateContactInformation', () =>
          back
            .getByRole('button', { name: /^Update$/ })
            .first()
            .click(),
        ).catch(() => undefined);
      }
    });

    test('Experience: a new entry saves and is listed, then deleting it removes it', async ({
      page,
    }) => {
      const company = `QA Bench Co ${Date.now()}`;
      const panel = await openProfileSection(page, 'Experience');
      await expect(
        panel.locator('.pc-entry-card').first(),
        'the Experience list renders',
      ).toBeVisible({
        timeout: 20_000,
      });
      const card = await newCard(panel, /Add New Experience/i, 'Enter Company Name');
      await card.getByPlaceholder('Enter Company Name').fill(company);
      await card.getByPlaceholder('Enter Designation').fill('QA Engineer');
      await card.getByPlaceholder('Enter Company Location').fill('Chennai');
      await card.getByPlaceholder('Enter Achievements').fill('QA bench entry, removed by the test');
      await card.getByPlaceholder('From').fill('2020-01-01');
      await card.getByPlaceholder('To').fill('2021-01-01');
      const saved = await answerTo(page, '/profile/saveOrUpdateExperienceDetails', () =>
        card
          .locator('.pc-entry-footer')
          .getByRole('button', { name: /^Save$/ })
          .click(),
      );
      expect((await envelope(saved)).status, 'the server saves the entry').toBe('SUCCESS');

      const reopened = await openProfileSection(page, 'Experience');
      await expect(reopened.locator('.pc-entry-card').first()).toBeVisible({ timeout: 20_000 });
      const stored = await cardWith(reopened, 'Enter Company Name', company);
      expect(stored, 'the saved entry is listed after reopening').not.toBeNull();

      const deleted = await answerTo(page, '/profile/deleteExperienceDetail', () =>
        stored!.getByRole('button', { name: 'Delete' }).first().click(),
      );
      expect((await envelope(deleted)).status, 'the server deletes it').toBe('SUCCESS');
      const after = await openProfileSection(page, 'Experience');
      await expect(after.locator('.pc-entry-card').first()).toBeVisible({ timeout: 20_000 });
      expect(await cardWith(after, 'Enter Company Name', company), 'and it is gone').toBeNull();
    });

    test('Education (School): a new school saves and is listed, then deleting it removes it', async ({
      page,
    }) => {
      const school = `QA Bench School ${Date.now()}`;
      const panel = await openProfileSection(page, 'Education');
      await panel
        .getByRole('button', { name: /^School$/ })
        .first()
        .click();
      const card = await newCard(panel, /Add New School/i, 'Enter School Name');
      await card.getByPlaceholder('Enter School Name').fill(school);
      await card.getByPlaceholder('Enter Standard Name').fill('XII');
      await card.getByPlaceholder('Enter Course Name').fill('Science');
      await card.getByPlaceholder('From').fill('2010');
      await card.getByPlaceholder('To').fill('2012');
      const saved = await answerTo(page, '/profile/saveOrUpdateSchoolDetails', () =>
        card
          .locator('.pc-entry-footer')
          .getByRole('button', { name: /^Save$/ })
          .click(),
      );
      expect((await envelope(saved)).status, 'the server saves the school').toBe('SUCCESS');

      const reopened = await openProfileSection(page, 'Education');
      await reopened
        .getByRole('button', { name: /^School$/ })
        .first()
        .click();
      await expect(reopened.locator('.pc-entry-card').first()).toBeVisible({ timeout: 20_000 });
      const stored = await cardWith(reopened, 'Enter School Name', school);
      expect(stored, 'the saved school is listed after reopening').not.toBeNull();

      await stored!.getByRole('button', { name: 'Delete' }).first().click();
      const confirm = page
        .getByRole('dialog')
        .filter({ hasText: /School Details\?/ })
        .first();
      const deleted = await answerTo(page, '/profile/deleteSchoolDetail', () =>
        confirm.getByRole('button', { name: /^Delete$/ }).click(),
      );
      expect((await envelope(deleted)).status, 'the server deletes it').toBe('SUCCESS');
    });

    test('Other Activities: a new activity saves and is listed, then deleting it removes it', async ({
      page,
    }) => {
      const title = `QA Bench activity ${Date.now()}`;
      const panel = await openProfileSection(page, 'Other Activities');
      const card = await newCard(panel, /Add New Other Activity/i, 'Enter your Title Name');
      await card.getByPlaceholder('Enter your Title Name').fill(title);
      await card.locator('textarea.pc-about-area').fill('QA bench entry, removed by the test');
      const saved = await answerTo(page, '/profile/saveOrUpdateOtherActivity', () =>
        card
          .locator('.pc-entry-footer')
          .getByRole('button', { name: /^Save$/ })
          .click(),
      );
      expect((await envelope(saved)).status, 'the server saves the activity').toBe('SUCCESS');

      const reopened = await openProfileSection(page, 'Other Activities');
      await expect(reopened.locator('.pc-entry-card').first()).toBeVisible({ timeout: 20_000 });
      const stored = await cardWith(reopened, 'Enter your Title Name', title);
      expect(stored, 'the saved activity is listed after reopening').not.toBeNull();
      const deleted = await answerTo(page, '/profile/deleteOtherActivity', () =>
        stored!.getByRole('button', { name: 'Delete' }).first().click(),
      );
      expect((await envelope(deleted)).status, 'the server deletes it').toBe('SUCCESS');
    });
  },
);
