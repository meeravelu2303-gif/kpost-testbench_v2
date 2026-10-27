import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { STORAGE_STATE_2 } from '@config/constants';
import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { mailShape } from '@api/definitions/kmail/send.api';
import type { Page } from '@playwright/test';
import { settleFrames } from '../support/settle';
import { signedIn } from '@fixtures/login-gate';

/**
 * KMail finding and counting: Recents search, the calendar date reload, the unread badge and outside
 * contacts. Seed mails are sent by qatest3 through the API, never as the browser account.
 */
const C: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-3')!;

test.describe(
  'KPost KMail · search, date filter and unread badge @ui',
  { tag: ['@ui', '@kmail', '@regression'] },
  () => {
    test.describe.configure({ timeout: 150_000 });
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends real mails; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || !testData.personal3KpostId,
      'needs both QA accounts, qatest1 and qatest3',
    );

    const waitLoaded = (page: Page) =>
      page
        .locator('.loader-overlay')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => undefined);

    async function seed(endpoints: EndpointExecutor, subject: string): Promise<void> {
      const sent = await endpoints.sendTo(
        'kmail-post-mail',
        { body: mailShape({ toAddress: testData.kpostId, kmailSubject: subject }) },
        { label: 'browse:seed', auth: { principal: C }, allowLiveWrite: true },
      );
      expect(sent.status, 'qatest3 sends qatest1 a mail').toBe(200);
    }

    async function openKmail(page: Page): Promise<void> {
      await page.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
    }

    const badge = (page: Page) => page.locator('.icon-KP_03-KMail .Header_msg_count').first();
    async function badgeCount(page: Page): Promise<number> {
      if (
        !(await badge(page)
          .isVisible()
          .catch(() => false))
      )
        return 0;
      const n = parseInt(
        (
          await badge(page)
            .innerText()
            .catch(() => '')
        ).replace(/\D/g, ''),
        10,
      );
      return Number.isNaN(n) ? 0 : n;
    }

    /**
     * Remove an outside-domain contact of the signed-in browser account, using that page's own
     * session token (a fresh API login as the same account would end the browser's session).
     */
    async function removeOutsideContact(page: Page, contactEmailID: string): Promise<number> {
      // The configured base may carry a path; KMail paths hang off its origin + KMAIL_PATH_PREFIX.
      const origin = new URL(env.KMAIL_API_BASE_URL ?? env.API_BASE_URL ?? '').origin;
      const url = `${origin}${env.KMAIL_PATH_PREFIX}/common/deleteOtherDomainContact/`;
      return page.evaluate(
        async ({ u, email }) => {
          const r = await fetch(u, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`,
            },
            body: JSON.stringify({ contactEmailID: email }),
          });
          return r.status;
        },
        { u: url, email: contactEmailID },
      );
    }

    // Set while a test-added outside contact still exists; afterEach removes it if a test fails
    // before its own clean-up, so no run leaves a contact behind.
    let outsideContactToRemove = '';

    test.afterEach(async ({ page }) => {
      if (!outsideContactToRemove) return;
      const email = outsideContactToRemove;
      outsideContactToRemove = '';
      await removeOutsideContact(page, email).catch(() => undefined);
    });

    test(
      'search: typing a subject shows that mail, and text that matches nothing shows no mails @ui',
      { annotation: [{ type: 'requirement', description: 'RTM-KMAIL-F04' }] },
      async ({ page, endpoints }) => {
        const stamp = Date.now();
        const subject = `QA KMail search ${stamp}`;
        await seed(endpoints, subject);
        await openKmail(page);
        const search = page.locator('.Serach_input').first();
        await search.fill(subject);
        await expect(
          page.getByText(subject, { exact: false }).first(),
          'the searched mail is listed',
        ).toBeVisible({ timeout: 30_000 });
        await search.fill(`zzqa-nomatch-${stamp}`);
        await expect(
          page.getByText(subject, { exact: false }),
          'text that matches no mail lists none of them',
        ).toHaveCount(0, { timeout: 15_000 });
      },
    );

    test('date filter: picking an earlier day reloads Recents from that day @ui', async ({
      page,
    }) => {
      await openKmail(page);
      // Only the date-driven reload carries "selectedDate"; ordinary list refreshes can still be in
      // flight after load (Firefox) and must not be mistaken for it.
      const reload = page.waitForRequest(
        (r) =>
          r.url().includes('/common/getKmailDashboardMsg') &&
          (r.postData() ?? '').includes('selectedDate'),
        { timeout: 20_000 },
      );
      await page.locator('.Date_alignment').first().click();
      const cal = page.locator('.react-calendar').first();
      await expect(cal, 'the calendar opens').toBeVisible({ timeout: 10_000 });
      // Two days ago (stays inside the current month view for most days; otherwise go back a month).
      const target = new Date(Date.now() - 2 * 24 * 3600_000);
      if (target.getMonth() !== new Date().getMonth()) {
        await cal.locator('.react-calendar__navigation__prev-button').click();
      }
      const label = target.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      await cal.locator(`abbr[aria-label="${label}"]`).first().click();
      const req = await reload.catch(() => null);
      const body = req?.postData() ?? '';
      const shot = test.info().outputPath('date-filter.png');
      await page.screenshot({ path: shot });
      await test.info().attach('date-filter', { path: shot, contentType: 'image/png' });
      test.info().annotations.push({
        type: 'observed',
        description: `picked ${label}; reload request body: ${body.slice(0, 200)}`,
      });
      expect(req, 'picking a day reloads the mail list').not.toBeNull();
      const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
      expect(body, 'the reload asks for mail from the chosen day (selectedDate)').toContain(
        `"selectedDate":"${iso}`,
      );
      await expect(
        page.getByText('Today', { exact: true }).first(),
        'Recents now starts at the chosen earlier day, not Today',
      ).toBeHidden({ timeout: 15_000 });
    });

    test('unread badge: a new mail raises the KMail badge by one, and reading it brings it back down @ui', async ({
      page,
      browser,
    }) => {
      test.skip(
        process.env.KATCHUP_UI_LIFECYCLE !== 'true',
        'needs the 2nd account (auth2.setup.ts); set KATCHUP_UI_LIFECYCLE=true',
      );
      await openKmail(page);
      const before = await badgeCount(page);
      const subject = `QA KMail badge ${Date.now()}`;
      // Sent by qatest2 from the browser, so the sender screen's live-update signal is part of the test.
      const ctx = await browser.newContext({ storageState: signedIn(STORAGE_STATE_2) });
      const sender = await ctx.newPage();
      try {
        await sender.goto('/writemail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await waitLoaded(sender);
        const to = sender.locator('.subjectTextboxKmailTO, input[name="to"]').first();
        await to.click();
        await to.fill(testData.kpostId);
        await sender
          .locator('.suggestion-dropdown')
          .getByText(testData.kpostId, { exact: false })
          .first()
          .click({ timeout: 4_000 })
          .catch(() => undefined);
        await sender.keyboard.press('Escape').catch(() => undefined);
        await sender.locator('.toInput').first().fill(subject);
        await sender.locator('.ql-editor[contenteditable="true"]').first().click();
        await sender.keyboard.type('QA badge body');
        const send = sender.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
          timeout: 20_000,
        });
        await sender
          .locator('.post_button_size')
          .filter({ has: sender.locator('.icon-KP_3164') })
          .first()
          .click();
        expect((await send).status(), 'qatest2 sends the mail from Write Mail').toBe(200);
      } finally {
        await ctx.close();
      }

      // Live first (no reload) — the app listens for a socket count event; then after a reload.
      const live = await expect
        .poll(() => badgeCount(page), { timeout: 20_000, intervals: [2_000] })
        .toBe(before + 1)
        .then(
          () => true,
          () => false,
        );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitLoaded(page);
      const afterArrive = await badgeCount(page);

      await page.locator('.Serach_input').first().fill(subject);
      await page.getByText(subject, { exact: false }).first().click({ timeout: 30_000 });
      await expect(page.getByText(`Sub : ${subject}`, { exact: false }).first()).toBeVisible({
        timeout: 20_000,
      });
      const liveDown = await expect
        .poll(() => badgeCount(page), { timeout: 20_000, intervals: [2_000] })
        .toBe(afterArrive - 1)
        .then(
          () => true,
          () => false,
        );
      // Proof of the stale state: the mail is open (read) but the badge has not moved.
      const staleShot = test.info().outputPath('badge-after-reading-no-reload.png');
      await page.screenshot({ path: staleShot });
      await test
        .info()
        .attach('badge-after-reading-no-reload', { path: staleShot, contentType: 'image/png' });
      const staleCount = await badgeCount(page);
      console.log(`KMAIL-BROWSE badge right after reading (no reload): ${staleCount}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitLoaded(page);
      const afterRead = await badgeCount(page);
      const observed = `badge before=${before}, after new mail=${afterArrive} (live update: ${live}), after reading=${afterRead} (live update: ${liveDown})`;
      test.info().annotations.push({ type: 'observed', description: observed });
      console.log(`KMAIL-BROWSE ${observed}`);
      expect(afterArrive, `a new mail raises the badge by one (${observed})`).toBe(before + 1);
      expect(afterRead, `reading the mail brings the badge back down (${observed})`).toBe(before);
      expect(live, `the badge rises without a page reload (${observed}; #1358)`).toBe(true);
      expect(liveDown, `the badge drops without a page reload (${observed}; #1358)`).toBe(true);
    });

    test('outside-domain contacts: listed in KMail Contacts, open their conversation, and an unknown outside sender can be added @ui', async ({
      page,
    }) => {
      // An unknown outside sender appears only when mail arrives from outside KPost, so the add step
      // runs only when one is present. The app has no Remove, so cleanup calls
      // /common/deleteOtherDomainContact/ with this browser session's own token (no second login).
      let addedEmail = '';
      const section = (title: string) =>
        page.getByText(title, { exact: true }).first().locator('xpath=..');
      const countOf = async (title: string) =>
        Number(
          (
            await section(title)
              .innerText()
              .catch(() => '')
          )
            .replace(title, '')
            .replace(/\D+/g, ' ')
            .trim()
            .split(' ')[0] || 0,
        );
      await openKmail(page);
      await page.getByText('Contacts', { exact: true }).first().click();
      const known = page.getByText('Other Domain Contact', { exact: true }).first();
      // The Contacts list re-renders while it slides in — wait for it to settle before scrolling.
      await expect(known).toBeAttached({ timeout: 15_000 });
      await settleFrames(page, 30);
      await known.scrollIntoViewIfNeeded();
      const saved = await countOf('Other Domain Contact');
      const unknown = await countOf('Unknown Other Domain Contact');
      test.info().annotations.push({
        type: 'observed',
        description: `Other Domain Contact: ${saved} | Unknown Other Domain Contact: ${unknown}`,
      });

      if (unknown > 0) {
        const name = `QA Outside ${Date.now()}`;
        // Off-screen panels carry copies of the same label, so pick the one under the Unknown heading.
        const heading = await page
          .getByText('Unknown Other Domain Contact', { exact: true })
          .first()
          .boundingBox();
        const adds = page.locator('span.text-danger', { hasText: 'Add Contact' });
        let picked = -1;
        for (let i = 0; i < (await adds.count()); i++) {
          const box = await adds.nth(i).boundingBox();
          if (box && heading && box.x >= 0 && box.y > heading.y) {
            picked = i;
            break;
          }
        }
        expect(picked, 'the unknown outside sender offers "Add Contact"').toBeGreaterThanOrEqual(0);
        await adds.nth(picked).click();
        const form = page.getByRole('dialog').filter({ hasText: 'Add To Contact' });
        await expect(form, 'the Add To Contact form opens').toBeVisible({ timeout: 10_000 });
        await form.getByPlaceholder('Enter the Contact Name').fill(name);
        await expect(
          form.getByPlaceholder('Enter the email id'),
          'the sender’s address is filled in for the user',
        ).not.toHaveValue('');
        const email = await form.getByPlaceholder('Enter the email id').inputValue();
        // Save stays disabled until a Reference is given (by design).
        await form.getByPlaceholder('Add Reference').fill('QA outside reference');
        const added = page.waitForResponse(
          (r) => r.url().includes('/common/addOtherDomainContacts'),
          { timeout: 20_000 },
        );
        await form.getByRole('button', { name: /^Save$/i }).click();
        const res = await added;
        expect(res.status(), 'the outside contact is saved').toBe(200);
        addedEmail = email;
        outsideContactToRemove = email; // safety net: afterEach removes it if a check below fails
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitLoaded(page);
        await page.getByText('Contacts', { exact: true }).first().click();
        await expect(
          page.getByText(name, { exact: false }).first(),
          'the added outside contact is listed under Other Domain Contact, with the name just typed (a re-add after removal fails here — #1361)',
        ).toBeVisible({ timeout: 20_000 });
        expect(await countOf('Other Domain Contact'), 'the saved count goes up by one').toBe(
          saved + 1,
        );
      }

      test.skip(
        saved === 0 && unknown === 0,
        'qatest1 has no outside-domain contacts on this account to open',
      );
      // The first saved outside contact: its picture opens "Edit Reference" (closed without saving);
      // its name opens its KMail conversation.
      const avatar = known.locator('xpath=following::div[contains(@class,"sb-avatar")][1]');
      await avatar.click({ timeout: 10_000 });
      const ref = page.getByRole('dialog').filter({ hasText: 'Edit Reference' });
      await expect(ref, 'the picture opens Edit Reference').toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
      await expect(ref).toBeHidden({ timeout: 5_000 });
      await avatar.locator('xpath=following::*[normalize-space(text())!=""][1]').click();
      await expect(
        page.getByText('Unopened', { exact: false }).filter({ visible: true }).first(),
        'opening an outside contact opens its KMail conversation',
      ).toBeVisible({ timeout: 15_000 });
      const shot = test.info().outputPath('outside-contact.png');
      await page.screenshot({ path: shot });
      await test.info().attach('outside-contact', { path: shot, contentType: 'image/png' });

      if (addedEmail) {
        // Clean up: remove the contact again; the sender must go back to "Unknown".
        outsideContactToRemove = '';
        expect(
          await removeOutsideContact(page, addedEmail),
          'the added outside contact is removed again',
        ).toBe(200);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitLoaded(page);
        await page.getByText('Contacts', { exact: true }).first().click();
        await expect(known).toBeAttached({ timeout: 15_000 });
        await settleFrames(page, 30);
        await expect
          .poll(() => countOf('Unknown Other Domain Contact'), {
            message: 'the removed sender is back under Unknown Other Domain Contact',
            timeout: 20_000,
          })
          .toBe(unknown);
      }
    });
  },
);
