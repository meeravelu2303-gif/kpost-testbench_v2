import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { createQaGroup, deleteQaGroup, GROUP_CREATOR, type QaGroup } from '../support/groups';
import { openGroupConversation } from '../support/katchup';
import { settleNetwork } from '../support/settle';

/**
 * Viewing a GROUP MEMBER's profile must not log the user out.
 *
 * Why: a manual QA report (2026-10-14) — "when I view a group member's profile the application logs
 * out". The 1:1 version of this (clicking a contact's avatar in a chat) is already guarded by the
 * #979 / #1079 regression test; the Group Info member list is a different entry point with no test.
 *
 * Path (bubble/KatchupMessage/KatchupMessage.js): thread header → Group Info panel (`#ChatTop
 * .comm_back`) → a member row's avatar (`ContactBar imgClick` → `setModalId(member)` +
 * `setProfileModal(true)`) → the Digital Card (bubble/DigitalCard/DigitalCard.js) for that member,
 * who is often NOT one of the viewer's contacts.
 *
 * Source suspects (why it could log out): the global fetch interceptor (src/interceptFetch.js) still
 * force-logs-out on ANY 401 from an API host other than for profile-image URLs (the #979 fix only
 * exempted `/downloadProfileImage` + `/downloadGroupProfileImage`), and the Digital Card (a) calls
 * `getDigitalCard` with `userType: "UnknownContacts"` for a non-contact and (b) fetches the cover image
 * with the viewer's token from a HARD-CODED dev host (`https://devapi2.kpostindia.com/v2/profile/
 * downloadCoverImage/…`, DigitalCard.js:214) — a host on the interceptor's own API list, which does
 * not accept the test deployment's token (filed #1345). Either 401 → `beginLogout` → `/login` (#979).
 *
 * The test records every 401, every devapi2 request and any jump to /login so a failure names the
 * exact request. Group fixture from support/groups.ts (created by personal-3 — never as the browser's
 * account, which would kill the browser session).
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
        test.skip(!opened, 'the new group is absent from Katchup right now (four reloads)');

        await page.locator('#ChatTop .background-color-katchup .line_height').first().click();
        const panel = page.locator('#ChatTop .comm_back').first();
        await expect(panel.getByText(/Katchup Group Info/i), 'Group Info opens').toBeVisible({
          timeout: 15_000,
        });

        // Every OTHER member's row (the ones with quick actions — the viewer's own row has none):
        // the creator (personal-3) and the plain member (victim).
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

          // The card's own requests (getDigitalCard, then the cover image it triggers) — either can be
          // the 401 that logs the user out. 0 = it never answered within 15s.
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
            // "View Profile" opens the profile page in a new tab. The request to any host other than the
            // test deployment is BLOCKED here (test-deployment-only rule) — only its URL is recorded.
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
            // The test deployment's own profile page belongs on the test deployment, not the live site.
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
