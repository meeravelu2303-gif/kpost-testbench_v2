import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { createQaGroup, deleteQaGroup, GROUP_CREATOR, type QaGroup } from '../support/groups';
import { openGroupConversation } from '../support/katchup';
import { settleNetwork } from '../support/settle';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Group Info > a member's avatar > Digital Card must not log the user out. Any 401 forces a logout
 * (src/interceptFetch.js), so every 401, devapi2 request and jump to /login is recorded.
 * The group is created by personal-3, never as the browser's account (that would end its session).
 */
const K = AUTH_PROFILES.kpost;
const VIEWER: Principal | undefined = K.principals.find((p) => p.key === 'personal'); // the browser
const OTHER: Principal | undefined = K.principals.find((p) => p.key === 'victim');

test.describe(
  'KPost Katchup · Group member profile keeps the session',
  { tag: ['@ui', '@group', '@regression'] },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      process.env.GROUP_UI_LIFECYCLE !== 'true',
      'creates and deletes a real group; set GROUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !VIEWER ||
        !GROUP_CREATOR ||
        !OTHER ||
        !testData.kpostId ||
        testData.kpostId.includes('qa.bench') ||
        !testData.personal3KpostId ||
        testData.personal3KpostId.includes('qa.p3'),
      'needs the primary, 2nd and personal-3 QA accounts',
    );

    test("opening a group member's profile from Group Info does not log the user out @ui", async ({
      page,
      endpoints,
    }) => {
      const unauthorized: string[] = [];
      const devHost: string[] = [];
      let sentToLogin = false;
      page.on('response', (r) => {
        if (r.status() === 401) unauthorized.push(`${r.request().method()} ${r.url()}`);
      });
      page.on('request', (r) => {
        if (r.url().includes('devapi2.kpostindia.com')) devHost.push(`${r.method()} ${r.url()}`);
      });
      page.on('framenavigated', (f) => {
        if (f === page.mainFrame() && /\/login(\b|$|\?)/.test(f.url())) sentToLogin = true;
      });

      let group: QaGroup | undefined;
      try {
        // Creator = personal-3; the viewer is an admin; victim is a plain member.
        group = await createQaGroup(endpoints, 'member-profile', {
          admins: [VIEWER!.username],
          members: [OTHER!.username],
        });
        const opened = await openGroupConversation(page, group.groupKpostID);
        retryOrSkip(!opened, 'the new group is absent from Katchup right now (four reloads)');

        await page.locator('#ChatTop .background-color-katchup .line_height').first().click();
        const panel = page.locator('#ChatTop .comm_back').first();
        await expect(panel.getByText(/Katchup Group Info/i), 'Group Info opens').toBeVisible({
          timeout: 15_000,
        });

        // Rows of the OTHER members (only they have quick actions).
        const memberRows = panel
          .locator('.group_info_height > *')
          .filter({ has: page.locator('.icon-KP_05-Kall') });
        await expect(memberRows.first(), "another member's row is listed").toBeVisible({
          timeout: 10_000,
        });
        const rows = await memberRows.count();

        for (let i = 0; i < rows; i++) {
          // Only count what happens from this member-profile click on.
          unauthorized.length = 0;
          devHost.length = 0;
          const digitalCard = settleNetwork(page, /\/profile\/getDigitalCard/);
          const coverImage = settleNetwork(page, /\/profile\/downloadCoverImage\//);
          await memberRows.nth(i).locator('.font-Family-Nunito').first().click();

          // Either card request can be the 401 that logs out. 0 = no answer within 15 s.
          const cardStatus = await digitalCard;
          const coverStatus = await coverImage;
          const observed =
            `member ${i + 1}/${rows}: getDigitalCard HTTP ${cardStatus}, cover HTTP ${coverStatus} | ` +
            `401s: ${unauthorized.length ? unauthorized.join(' ; ') : 'none'} | ` +
            `devapi2: ${devHost.length ? devHost.join(' ; ') : 'none'} | URL: ${page.url()}`;
          test.info().annotations.push({ type: 'observed', description: observed });
          console.log(`MEMBER-PROFILE ${observed}`);
          const shot = test.info().outputPath(`member-${i + 1}-profile.png`);
          await page.screenshot({ path: shot });
          await test
            .info()
            .attach(`member-${i + 1}-profile`, { path: shot, contentType: 'image/png' });

          expect(
            sentToLogin || /\/login/.test(page.url()),
            `viewing a group member's profile must keep the user signed in (${observed})`,
          ).toBe(false);
          await expect(
            page.getByText('View Profile', { exact: true }).first(),
            "the member's Digital Card opens",
          ).toBeVisible({ timeout: 10_000 });

          if (i === rows - 1) {
            // View Profile opens a new tab; a request to the live host is blocked and only its URL kept.
            let blockedUrl = '';
            await page.context().route(/account.kpostindia.com/, (route) => {
              blockedUrl = route.request().url();
              return route.abort();
            });
            const popup = page
              .context()
              .waitForEvent('page', { timeout: 10_000 })
              .catch(() => null);
            await page.getByText('View Profile', { exact: true }).first().click();
            const opened = await popup;
            const openedUrl = blockedUrl || (opened ? opened.url() : '(no new tab)');
            const where = `View Profile opened: ${openedUrl}`;
            test.info().annotations.push({ type: 'observed', description: where });
            console.log(`MEMBER-PROFILE ${where}`);
            await opened?.close().catch(() => undefined);
            expect(
              sentToLogin || /\/login/.test(page.url()),
              `pressing View Profile must keep this tab signed in (${where})`,
            ).toBe(false);
            expect
              .soft(
                openedUrl,
                'View Profile stays on the deployment the user is signed in to (#1346)',
              )
              .not.toMatch(/account\.kpostindia\.com/);
          } else {
            await page.keyboard.press('Escape');
            await expect(page.getByText('View Profile', { exact: true }).first()).toBeHidden({
              timeout: 10_000,
            });
          }
        }
      } finally {
        await deleteQaGroup(endpoints, group);
      }
    });
  },
);
