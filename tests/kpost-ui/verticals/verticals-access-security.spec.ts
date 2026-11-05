import { createDecipheriv, createHash } from 'node:crypto';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import type { Page, Response } from '@playwright/test';
import { skipIfSignedOut } from '../support/session';

/**
 * Who may see the vertical screens' data (KDiary, KBooking, KDirectory, KNews), read-only:
 *
 * 1. Signed out, each vertical route sends the visitor to /login (MenuRoutes.js:427, one guard for
 *    every signed-in route) AND the screen's data call never fires, so nothing is fetched for a
 *    visitor with no token.
 * 2. KDiary and KBooking carry no record id in the URL (MenuRoutes.js:437,442): the screens read the
 *    caller's own records (getEventSelectedDate, Diary.js:427; redbus/getTicket/, KBook.js:776) and
 *    the backend scopes them by the token's kpostID (KdiaryScheduleServiceImpl.java:335-353,
 *    RedBusIntegrationController.java:754-760). The only id a user can edit is in the request, so
 *    the test rewrites the screen's own request to name another user (body, query and a kpostID
 *    header) and checks the rows it renders from. Owner control: the untouched request must succeed
 *    first; then the tampered one must return only the signed-in user's records.
 *    KBooking's `?order_id=` callback (KBook.js:1067) is never opened: it calls a live payment host.
 * 3. On each vertical screen, the page and localStorage hold no secret beyond the app's own token:
 *    the login password is not stored in plain text, nor in the redux-persist blob, which is
 *    encrypted with a key shipped in the bundle (redux/store.js:8-9, authReducer.js:69 stores the
 *    password) and is therefore readable by any script on the origin.
 */

const VERTICALS = [
  { route: '/kdiary', name: 'KDiary', dataCall: /\/dairySchedule\// },
  { route: '/kbooking', name: 'KBooking', dataCall: /\/redbus\/getTicket\// },
  { route: '/kdirectory', name: 'KDirectory', dataCall: /\/contacts\/globalSearch\// },
  { route: '/knews', name: 'KNews', dataCall: /\/v1\/news/ },
] as const;

/** The key the app encrypts its redux-persist state with (KPOST_REACTJS_2023_V1 src/redux/store.js:9). */
const PERSIST_KEY = 'my-super-secret-key';

type Row = Record<string, unknown>;

/** A record field as text; objects and missing values read as ''. */
const str = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const waitLoaded = (page: Page) =>
  page
    .locator('.loader-overlay')
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined);

/** The signed-in account's kpostID, as the app itself stores it (localStorage `Authuser`). */
async function signedInKpostId(page: Page): Promise<string> {
  const stored = await page
    .evaluate(() => {
      try {
        const raw = localStorage.getItem('Authuser');
        return raw ? (JSON.parse(raw) as { kpostID?: string }).kpostID : undefined;
      } catch {
        return undefined;
      }
    })
    .catch(() => undefined);
  return (stored || testData.kpostId).toLowerCase();
}

async function jsonOf(response: Response | undefined): Promise<Row | undefined> {
  if (!response) return undefined;
  return (await response.json().catch(() => undefined)) as Row | undefined;
}

/** crypto-js `AES.encrypt(text, passphrase)` output (OpenSSL "Salted__" + EVP_BytesToKey/MD5) → text. */
function cryptoJsDecrypt(cipherB64: string, passphrase: string): string | undefined {
  try {
    const raw = Buffer.from(cipherB64, 'base64');
    if (raw.subarray(0, 8).toString('latin1') !== 'Salted__') return undefined;
    const salt = raw.subarray(8, 16);
    const body = raw.subarray(16);
    const pass = Buffer.from(passphrase, 'utf8');
    let derived = Buffer.alloc(0);
    let block = Buffer.alloc(0);
    while (derived.length < 48) {
      block = createHash('md5')
        .update(Buffer.concat([block, pass, salt]))
        .digest();
      derived = Buffer.concat([derived, block]);
    }
    const decipher = createDecipheriv(
      'aes-256-cbc',
      derived.subarray(0, 32),
      derived.subarray(32, 48),
    );
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

test.describe(
  'KPost Verticals · signed-out access is refused and fetches nothing',
  {
    tag: ['@ui', '@verticals', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const v of VERTICALS) {
      test(`${v.route} (${v.name}) sends a signed-out visitor to /login without calling its data API @ui`, async ({
        page,
      }) => {
        const dataCalls: string[] = [];
        page.on('request', (req) => {
          if (v.dataCall.test(req.url())) dataCalls.push(`${req.method()} ${req.url()}`);
        });

        await page.goto(v.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await expect(page, `${v.route} redirects to the login screen`).toHaveURL(/\/login/, {
          timeout: 20_000,
        });
        await expect(
          page.locator('[placeholder*="KPOST ID" i]').first(),
          'the login form is what a signed-out visitor sees',
        ).toBeVisible({ timeout: 20_000 });

        expect
          .soft(dataCalls, `${v.name} must not fetch its data for a visitor with no session`)
          .toEqual([]);
      });
    }
  },
);

test.describe(
  'KPost Verticals · KDiary and KBooking show only the signed-in user’s records (request tampering)',
  {
    tag: ['@ui', '@verticals', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );
    test.skip(
      !testData.victimKpostId || testData.victimKpostId.includes('qa.victim'),
      'needs a second real account to name (QA_VICTIM_KPOST_ID)',
    );

    test.beforeEach(async ({ page }) => {
      await skipIfSignedOut(page);
    });

    test("KDiary: naming another user in the diary request does not show that user's events @ui", async ({
      page,
    }) => {
      const me = await signedInKpostId(page);
      const victim = testData.victimKpostId.toLowerCase();
      test.skip(me === victim, 'the victim account is the signed-in account');

      const isDiaryRead = (r: Response) =>
        r.url().includes('/dairySchedule/getEventSelectedDate') && r.request().method() === 'POST';
      const belongsToMe = (row: Row): boolean =>
        str(row.createdBy).toLowerCase() === me ||
        (Array.isArray(row.participants) &&
          (row.participants as Row[]).some((p) => str(p.participant).toLowerCase() === me));
      const rowsOf = (body: Row | undefined): Row[] =>
        Array.isArray(body?.data) ? (body.data as Row[]) : [];

      // --- Owner control: the screen's own, untouched request ---------------------------------
      const ownAnswer = page
        .waitForResponse(isDiaryRead, { timeout: 30_000 })
        .catch(() => undefined);
      await page.goto('/kdiary', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      const own = await ownAnswer;
      const ownBody = await jsonOf(own);
      const ownRequest = (own?.request().postDataJSON() ?? {}) as Row;
      test.skip(
        !own || own.status() !== 200 || !/success/i.test(str(ownBody?.status)),
        `owner control failed: the diary's own read answered HTTP ${own?.status() ?? 'none'} (${str(ownBody?.status)}), so a tampered read proves nothing`,
      );
      const ownRows = rowsOf(ownBody);

      expect
        .soft(
          Object.keys(ownRequest).filter((k) => /kpost|created|user|owner|participant/i.test(k)),
          'the diary read names no owner field a user could edit (the server takes it from the token)',
        )
        .toEqual([]);
      expect
        .soft(
          ownRows
            .filter((r) => !belongsToMe(r))
            .map((r) => `${String(r.eventID)}:${String(r.createdBy)}`),
          'the untouched diary read returns only events the user created or takes part in',
        )
        .toEqual([]);

      // --- The same screen, with its request rewritten to name another user ------------------
      await page.route('**/dairySchedule/getEventSelectedDate', async (route) => {
        const body = (route.request().postDataJSON() ?? {}) as Row;
        await route.continue({
          headers: { ...route.request().headers(), kpostID: victim },
          postData: JSON.stringify({
            ...body,
            kpostID: victim,
            kpostId: victim,
            createdBy: victim,
            participant: victim,
          }),
        });
      });
      const tamperedAnswer = page
        .waitForResponse(isDiaryRead, { timeout: 30_000 })
        .catch(() => undefined);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      await waitLoaded(page);
      const tampered = await tamperedAnswer;
      await page.unroute('**/dairySchedule/getEventSelectedDate');
      test.skip(!tampered, 'no answer to the tampered diary read (not re-checked)');
      const tamperedRows = rowsOf(await jsonOf(tampered));

      test.info().annotations.push({
        type: 'observed',
        description: `own read: ${ownRows.length} event(s); read naming ${victim}: HTTP ${tampered!.status()}, ${tamperedRows.length} event(s)`,
      });
      test.skip(
        !ownRows.length && !tamperedRows.length,
        'nothing to compare: neither the own nor the tampered diary read returned an event for today',
      );

      expect(
        tamperedRows
          .filter((r) => !belongsToMe(r))
          .map((r) => `${String(r.eventID)} "${String(r.title)}" by ${String(r.createdBy)}`),
        `a diary read rewritten to name ${victim} must not return events the signed-in user neither created nor takes part in`,
      ).toEqual([]);
      expect
        .soft(
          tamperedRows.map((r) => String(r.eventID)).sort(),
          'the tampered read returns the same events as the untouched one',
        )
        .toEqual(ownRows.map((r) => String(r.eventID)).sort());
    });

    test("KBooking: naming another user in the My Trips request does not show that user's tickets @ui", async ({
      page,
    }) => {
      const me = await signedInKpostId(page);
      const victim = testData.victimKpostId.toLowerCase();
      test.skip(me === victim, 'the victim account is the signed-in account');

      const isTicketRead = (r: Response) =>
        new URL(r.url()).pathname.endsWith('/redbus/getTicket/');
      const rowsOf = (body: Row | undefined): Row[] =>
        Array.isArray(body?.value) ? (body.value as Row[]) : [];
      const openMyTrips = async (): Promise<Response | undefined> => {
        await page.goto('/kbooking', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await waitLoaded(page);
        const answer = page
          .waitForResponse(isTicketRead, { timeout: 30_000 })
          .catch(() => undefined);
        await page
          .getByText(/My Trips/i)
          .first()
          .click();
        return answer;
      };

      // --- Owner control ------------------------------------------------------------------------
      const own = await openMyTrips();
      const ownBody = await jsonOf(own);
      test.skip(
        !own || own.status() !== 200 || !/success/i.test(str(ownBody?.status)),
        `owner control failed: My Trips' own read answered HTTP ${own?.status() ?? 'none'} (${str(ownBody?.status)})`,
      );
      expect
        .soft(new URL(own!.url()).search, 'the My Trips read carries no user id in its URL')
        .toBe('');
      const ownRows = rowsOf(ownBody);
      expect
        .soft(
          ownRows
            .filter((r) => str(r.kpostId).toLowerCase() !== me)
            .map((r) => `${String(r.bookingId)}:${String(r.kpostId)}`),
          'the untouched My Trips read returns only the signed-in user’s bookings',
        )
        .toEqual([]);

      // --- Tampered: name the other user in the query and a header ---------------------------
      const matcher = (url: URL) => url.pathname.endsWith('/redbus/getTicket/');
      await page.route(matcher, async (route) => {
        const url = new URL(route.request().url());
        url.searchParams.set('kpostId', victim);
        url.searchParams.set('kpostID', victim);
        await route.continue({
          url: url.toString(),
          headers: { ...route.request().headers(), kpostID: victim },
        });
      });
      const tampered = await openMyTrips();
      await page.unroute(matcher);
      test.skip(!tampered, 'no answer to the tampered My Trips read (not re-checked)');
      const tamperedRows = rowsOf(await jsonOf(tampered));

      test.info().annotations.push({
        type: 'observed',
        description: `own read: ${ownRows.length} booking(s); read naming ${victim}: HTTP ${tampered!.status()}, ${tamperedRows.length} booking(s)`,
      });
      test.skip(
        !ownRows.length && !tamperedRows.length,
        'nothing to compare: neither the own nor the tampered My Trips read returned a booking',
      );

      expect(
        tamperedRows
          .filter((r) => str(r.kpostId).toLowerCase() !== me)
          .map(
            (r) =>
              `booking ${String(r.bookingId)} (PNR ${String(r.pnrNumber)}) of ${String(r.kpostId)}`,
          ),
        `a My Trips read rewritten to name ${victim} must not return another user's bookings`,
      ).toEqual([]);
      expect
        .soft(
          tamperedRows.map((r) => String(r.bookingId)).sort(),
          'the tampered read returns the same bookings as the untouched one',
        )
        .toEqual(ownRows.map((r) => String(r.bookingId)).sort());
    });
  },
);

test.describe(
  'KPost Verticals · no secret beyond the app’s own token in the page or localStorage',
  {
    tag: ['@ui', '@verticals', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    test.beforeEach(async ({ page }) => {
      await skipIfSignedOut(page);
    });

    for (const v of VERTICALS) {
      test(`${v.name}: the login password is not readable from localStorage, and no token or password is in the page @ui`, async ({
        page,
      }) => {
        await page.goto(v.route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await waitLoaded(page);
        await expect(
          page.locator('.icon-KP_01-Home, .header-user-name, .header_font').first(),
          `${v.name} renders inside the signed-in shell`,
        ).toBeVisible({ timeout: 20_000 });

        const storage = await page.evaluate(() => {
          const out: Record<string, string> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) out[key] = localStorage.getItem(key) ?? '';
          }
          return out;
        });
        const html = await page.content();
        const password = testData.password;
        const accessToken = storage.accessToken ?? '';
        const refreshToken = storage.refreshToken ?? '';

        // The token keys are the app's own; anything else holding a secret is a finding.
        const plainHits =
          password.length >= 6
            ? Object.entries(storage)
                .filter(([, value]) => value.includes(password))
                .map(([key]) => key)
            : [];

        // redux-persist: one JSON object, each slice AES-encrypted with the bundled key.
        const persistEntry = Object.entries(storage).find(([key]) => key.startsWith('persist:'));
        const decrypted: Record<string, string> = {};
        if (persistEntry) {
          let slices: Record<string, string>;
          try {
            slices = JSON.parse(persistEntry[1]) as Record<string, string>;
          } catch {
            slices = {};
          }
          for (const [slice, value] of Object.entries(slices)) {
            if (slice === '_persist') continue;
            let cipher = value;
            try {
              cipher = JSON.parse(value) as string;
            } catch {
              // already a bare string
            }
            const clear =
              typeof cipher === 'string' ? cryptoJsDecrypt(cipher, PERSIST_KEY) : undefined;
            if (clear !== undefined) decrypted[slice] = clear;
          }
        }
        const persistPasswordSlices =
          password.length >= 6
            ? Object.entries(decrypted)
                .filter(([, clear]) => clear.includes(password))
                .map(([slice]) => slice)
            : [];

        test.info().annotations.push({
          type: 'observed',
          description: `localStorage keys: ${Object.keys(storage).join(', ')}; persist blob: ${persistEntry ? `${persistEntry[0]}, ${Object.keys(decrypted).length} slice(s) decrypted with the bundled key` : 'absent'}`,
        });

        expect
          .soft(plainHits, 'no localStorage entry holds the login password in plain text')
          .toEqual([]);
        expect
          .soft(
            persistPasswordSlices,
            `the redux-persist blob (${persistEntry?.[0] ?? 'persist:*'}) must not hold the login password: it is encrypted with a key shipped in the JavaScript bundle (src/redux/store.js), so any script on the origin can read it back`,
          )
          .toEqual([]);
        if (password.length >= 6)
          expect.soft(html.includes(password), 'the login password is not in the page').toBe(false);
        if (accessToken.length > 20)
          expect
            .soft(html.includes(accessToken), 'the access token is not written into the page')
            .toBe(false);
        if (refreshToken.length > 20)
          expect
            .soft(html.includes(refreshToken), 'the refresh token is not written into the page')
            .toBe(false);
      });
    }
  },
);
