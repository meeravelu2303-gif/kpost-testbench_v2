import { STORAGE_STATE_2, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import type { Browser, Page } from '@playwright/test';
import {
  C,
  requireAccounts,
  requireFlags,
  restoreSavedSession,
  waitLoaded,
} from './support/journey';

/**
 * Journey 10: A voice- or video-calls B from Kall (Connected Devices), B accepts, A toggles mic or
 * camera, A hangs up. "Connected" = both timers tick past 00:00, which happens only after joining.
 * Needs A and B as mutual contacts; B's name is looked up as C so A's and B's sessions survive.
 * Known defect #1680: B never receives the incoming call. Known defect #1679: leftover repeat-meeting
 * copies can mark B busy ("On Another Call...").
 */

/** How the caller's and the callee's call panel are told apart (GlobalKallSender / GlobalReceiveKall). */
const panel = (page: Page) => page.locator('.kall-panel, .kall-video-wrap').first();
const timer = (page: Page) =>
  panel(page).locator('.kall-status-text, .kall-video-duration-badge').first();
const MM_SS = /^\d{2}:\d{2}$/;

/** The display name the app shows for an account (fetchUserDetails first + last name). */
async function displayName(endpoints: EndpointExecutor, kpostId: string): Promise<string> {
  const details = await endpoints.sendTo(
    'signup-login-fetch-user-details',
    { body: { kpostID: kpostId, countryID: testData.countryId } },
    { label: 'journey:call:name', auth: { principal: C! } },
  );
  const parsed = details.json();
  const who = ((parsed.ok ? (parsed.value as { data?: unknown }).data : {}) ?? {}) as {
    firstName?: string;
    lastName?: string;
  };
  return `${who.firstName ?? ''} ${who.lastName ?? ''}`.trim();
}

test.describe(
  'JOURNEY 10 · a voice call',
  {
    tag: [TAGS.ui, TAGS.journey, TAGS.kall, TAGS.regression],
    annotation: [
      { type: 'requirement', description: 'FR-KL-005' },
      { type: 'requirement', description: 'RTM-KALL-A01' },
    ],
  },
  () => {
    test.describe.configure({ timeout: 180_000 });
    requireAccounts('A', 'B', 'C');
    requireFlags('KALL_UI_LIFECYCLE');

    /** One direct call A → B, voice or video; the in-call toggle step is the kind's own. */
    async function callJourney(
      { page, browser, endpoints }: { page: Page; browser: Browser; endpoints: EndpointExecutor },
      kind: 'audio' | 'video',
    ): Promise<void> {
      const video = kind === 'video';
      const bName = await displayName(endpoints, testData.victimKpostId);
      expect(bName, "B's display name is known (control)").not.toBe('');

      const bContext = await browser.newContext({
        storageState: STORAGE_STATE_2,
        permissions: video ? ['microphone', 'camera'] : ['microphone'],
      });
      const b = await bContext.newPage();
      // The incoming-call card reads the caller's name aloud; keep that out of the run.
      await b.addInitScript(() => {
        window.speechSynthesis.speak = () => undefined;
      });
      // B's socket traffic: the readiness signal, and evidence of whether receiveKallInitiate arrived.
      const bLog: string[] = [];
      let bSocketUp = false;
      b.on('websocket', (ws) => {
        if (!ws.url().includes('socket')) return;
        bLog.push(`open ${ws.url().split('?')[0]}`);
        ws.on('framereceived', (f) => {
          const text = typeof f.payload === 'string' ? f.payload : '';
          bSocketUp = true; // any server frame: the socket upgraded and is live (connect itself travels over polling)
          if (/kall/i.test(text) || bLog.length < 8) bLog.push(`in ${text.slice(0, 160)}`);
        });
        ws.on('framesent', (f) => {
          const text = typeof f.payload === 'string' ? f.payload : '';
          if (/user-join|kall/i.test(text)) bLog.push(`out ${text.slice(0, 120)}`);
        });
        ws.on('close', () => bLog.push('close'));
      });
      // Before the upgrade socket.io talks over HTTP long-polling; `user-join` may travel there.
      b.on('request', (r) => {
        const sent = r.method() === 'POST' && r.url().includes('/socket.io/') ? r.postData() : null;
        if (sent && /user-join|kall/i.test(sent)) bLog.push(`poll-out ${sent.slice(0, 120)}`);
      });
      b.on('response', (r) => {
        if (r.request().method() !== 'GET' || !r.url().includes('/socket.io/')) return;
        void r
          .text()
          .then((t) => {
            if (/kall/i.test(t)) bLog.push(`poll-in ${t.slice(0, 160)}`);
          })
          .catch(() => undefined);
      });
      // A's side of the same socket: whether `kallInitiate` was sent at all.
      const aLog: string[] = [];
      page.on('websocket', (ws) => {
        if (!ws.url().includes('socket')) return;
        ws.on('framesent', (f) => {
          const text = typeof f.payload === 'string' ? f.payload : '';
          if (/kall/i.test(text)) aLog.push(`out ${text.slice(0, 160)}`);
        });
        // The server's answer: the `43<n>` ack to kallInitiate, and any kall event back to A.
        ws.on('framereceived', (f) => {
          const text = typeof f.payload === 'string' ? f.payload : '';
          if (/^43\d|kall/i.test(text)) aLog.push(`in ${text.slice(0, 200)}`);
        });
      });
      let connected = false;

      try {
        await test.step('B is signed in and online on Home', async () => {
          await restoreSavedSession(b, testData.victimKpostId, testData.password, STORAGE_STATE_2);
          await waitLoaded(b);
          await expect(b, 'B is signed in').toHaveURL(/\/home/);
          // The incoming-call listener is bound only once the socket is connected.
          await expect
            .poll(() => bSocketUp, {
              message: 'B is listening for incoming calls (socket connected)',
              timeout: 30_000,
            })
            .toBe(true);
        });

        await test.step('A opens Kall › Contacts and finds B', async () => {
          await page.goto('/kall', { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await waitLoaded(page);
          await page.getByRole('tab', { name: 'Contacts' }).click();
        });

        await test.step(`A places a ${video ? 'video' : 'voice'} call to B (Connected Devices)`, async () => {
          const row = page
            .locator('.contactBar_Dropdown')
            .filter({ has: page.locator('.Bar-Name', { hasText: bName }) })
            .first();
          await expect(row, `B ("${bName}") is in A's Kall contacts`).toBeVisible({
            timeout: 20_000,
          });
          await row.locator('.peRight-3 svg').first().click();

          const info = page.locator('.modal-50w').filter({ hasText: 'Kall Info' });
          await expect(info, 'the Kall Info sheet opens').toBeVisible({ timeout: 15_000 });
          const initiated = page.waitForResponse((r) => r.url().includes('/kall/initiateKall'), {
            timeout: 30_000,
          });
          // Connected Devices is the web-to-web call; SIM/landline dial a phone.
          await info
            .locator('div.justify-content-between', { hasText: 'Connected Devices' })
            .last()
            .locator(video ? '.icon-KP_159-facecall' : '.icon-KP_240-Kall01')
            .click();
          const response = await initiated;
          expect(response.status(), 'initiateKall is accepted').toBeLessThan(300);
          await expect(timer(page), 'A sees the call ringing').toHaveText(/Calling\.\.\./, {
            timeout: 15_000,
          });
        });

        await test.step('B is told who is calling, and accepts', async () => {
          const card = b.getByText('is calling you...').first();
          await expect(card, 'B gets the incoming-call card (#1680)').toBeVisible({
            timeout: 20_000,
          });
          await expect(
            b.getByText(video ? 'Incoming video call' : 'Incoming call', { exact: true }).first(),
            video ? 'as a video call' : 'as a voice call',
          ).toBeVisible();
          await b.getByRole('button', { name: /Accept/ }).click();
        });

        await test.step('both sides are connected: each timer is running', async () => {
          for (const [who, p] of [
            ['A', page],
            ['B', b],
          ] as const) {
            await expect(timer(p), `${who} shows the call timer`).toHaveText(MM_SS, {
              timeout: 30_000,
            });
            await expect(
              timer(p),
              `${who}'s timer ticks — that side has joined the call`,
            ).not.toHaveText('00:00', { timeout: 20_000 });
            await expect(
              panel(p).locator('.kall-btn--mic'),
              `${who} has a microphone control`,
            ).toBeVisible();
          }
          connected = true;
        });

        if (video)
          await test.step('A turns the camera off and on again during the call', async () => {
            // The button gains kall-btn--cam-off while the camera is off.
            const cam = panel(page).locator('.kall-btn--cam');
            await expect(cam, 'A has a camera control on the video call').toBeVisible();
            await cam.click();
            await expect(cam, 'camera off: the button shows it').toHaveClass(/kall-btn--cam-off/);
            await cam.click();
            await expect(cam, 'camera on again').not.toHaveClass(/kall-btn--cam-off/);
          });

        await test.step('A mutes and unmutes the microphone during the call', async () => {
          const mic = panel(page).locator('.kall-btn--mic');
          await mic.click();
          await expect(mic, 'muted: the button shows Mic-Off').toHaveClass(/kall-btn--muted/);
          await expect(mic, 'and the muted icon').toHaveClass(/icon-KP_52-Mic-Off/);
          await mic.click();
          await expect(mic, 'unmuted again').not.toHaveClass(/kall-btn--muted/);
          await expect(mic, 'with the Mic-on icon').toHaveClass(/icon-KP_53-Mic-on/);
        });

        await test.step('A hangs up and the call ends on both sides', async () => {
          const ended = page.waitForResponse((r) => r.url().includes('/kall/endIndividualKall'), {
            timeout: 20_000,
          });
          await panel(page).locator('.kall-btn--end').click();
          expect((await ended).status(), 'endIndividualKall is accepted').toBeLessThan(300);
          await expect(page.locator('.kall-panel'), "A's call panel closes").toHaveCount(0, {
            timeout: 15_000,
          });
          await expect(b.locator('.kall-panel'), "B's call panel closes").toHaveCount(0, {
            timeout: 15_000,
          });
          connected = false;
        });
      } finally {
        // Screenshot both sides before the clean-up hangs up.
        for (const [who, p] of [
          ['A-caller', page],
          ['B-callee', b],
        ] as const)
          await p
            .screenshot()
            .then((body) =>
              test.info().attach(`${who} at the end`, { body, contentType: 'image/png' }),
            )
            .catch(() => undefined);
        test.info().annotations.push({
          type: 'observed',
          description: `socket — A sent: ${JSON.stringify(aLog.slice(-6))}; B: ${JSON.stringify(bLog.slice(-12))}`,
        });
        // Never leave a call open: hang up from whichever side still has it, then drop B's browser.
        if (connected || (await page.locator('.kall-panel').count()) > 0)
          await panel(page)
            .locator('.kall-btn--end')
            .click({ timeout: 5_000 })
            .catch(() => undefined);
        const reject = b.getByRole('button', { name: /Reject/ });
        if (await reject.isVisible().catch(() => false))
          await reject.click({ timeout: 5_000 }).catch(() => undefined);
        await bContext.close();
      }
    }

    test(
      'A calls B from Kall, B accepts, both are connected, A hangs up',
      {
        annotation: [
          // The "first call" leg of the first-use journey (journeys/first-use.spec.ts covers the rest).
          { type: 'requirement', description: 'RTM-E2E01' },
          // The mic half of RTM-KALL-A04; the camera half is the video test below.
          { type: 'requirement-partial', description: 'RTM-KALL-A04' },
        ],
      },
      async ({ page, browser, endpoints }) => callJourney({ page, browser, endpoints }, 'audio'),
    );

    test(
      'A video-calls B from Kall, B accepts, both are connected, A turns the camera off and on, A hangs up',
      { annotation: [{ type: 'requirement', description: 'RTM-KALL-A04' }] },
      async ({ page, browser, endpoints }) => callJourney({ page, browser, endpoints }, 'video'),
    );
  },
);
