import { AUTH_PROFILES } from '@config/auth-profile';
import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { mailShape } from '@api/definitions/kmail/send.api';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { expect, test } from '@fixtures';
import { signedIn } from '@fixtures/login-gate';

/**
 * KMail read receipt (FR-KM-020): A sends via the API, B opens it in the browser (the API open returns
 * an empty record), and A must then see B's exact open time, never before. Known defect #1359: an
 * open is intermittently not marked read. Self-cleaning: both sides delete their copy.
 */
const K = AUTH_PROFILES.kpost.principals;
const A = K.find((p) => p.key === 'personal')!;
const B = K.find((p) => p.key === 'victim')!;
const SKEW_MS = 5 * 60_000;

interface Txn {
  transactionID: number;
  receiver: string;
  readStatus?: string;
  letterReadTimeAsLong?: number;
}

/** `who`'s copy of mail `kmailID` in the conversation with `other` (polled by callers). */
async function mailRow(
  endpoints: EndpointExecutor,
  who: typeof A,
  other: string,
  kmailID: number,
): Promise<{ kmailSendDateAsLong?: number; kmailTransactionList?: Txn[] } | undefined> {
  const view = await endpoints.sendTo(
    'kmail-selected-contact-mails',
    {
      body: {
        selectedContact: other,
        fetchMailType: 'A',
        groupFlag: false,
        lastKmailID: null,
        firstKmailID: null,
        count: 30,
      },
    },
    { label: `receipt:view:${who.key}`, auth: { principal: who }, allowLiveRead: true },
  );
  const parsed = view.json();
  const rows = ((parsed.ok ? (parsed.value as { data?: unknown }).data : []) ?? []) as Array<{
    kmailID?: number;
    kmailSendDateAsLong?: number;
    kmailTransactionList?: Txn[];
  }>;
  return rows.find((m) => m.kmailID === kmailID);
}

async function copiesReadTime(
  endpoints: EndpointExecutor,
  kmailID: number,
): Promise<string | null | undefined> {
  const ex = await endpoints.sendTo(
    'kmail-copies-info',
    { pathParams: { kmailID } },
    { label: 'receipt:copies-info', auth: { principal: A }, allowLiveRead: true },
  );
  const parsed = ex.json();
  const to = ((parsed.ok
    ? ((parsed.value as { data?: Record<string, unknown> }).data ?? {})['To Address']
    : []) ?? []) as Array<{ kpostID?: string; readTime?: string | null }>;
  return to.find((r) => r.kpostID === B.username)?.readTime;
}

test.describe(
  'KPost KMail · read receipt (sender sees the open time only after the recipient opens) @ui',
  {
    tag: ['@ui', '@kmail', '@regression'],
    annotation: [
      { type: 'requirement', description: 'BR-M01' },
      { type: 'requirement', description: 'FR-KM-020' },
    ],
  },
  () => {
    test.describe.configure({ timeout: 150_000 });
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends a real mail; set KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true',
      'needs auth2.setup.ts to log the 2nd account in; set KATCHUP_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    test('A sees no read time until B opens the mail, then B’s exact open time @ui', async ({
      browser,
      endpoints,
    }) => {
      const subject = `QA read receipt ${Date.now()}`;
      const sent = await endpoints.sendTo(
        'kmail-post-mail',
        { body: mailShape({ toAddress: B.username, kmailSubject: subject }) },
        { label: 'receipt:send', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(sent.status, `A sends the mail: ${sent.bodyText.slice(0, 200)}`).toBe(200);
      const sj = sent.json();
      const kmailID = (
        ((sj.ok ? (sj.value as { data?: unknown }).data : []) ?? []) as Array<{
          kmailID?: number;
        }>
      )[0]?.kmailID;
      expect(kmailID, 'the mail has a kmailID').toBeTruthy();
      if (!kmailID) return;

      const context = await browser.newContext({ storageState: signedIn(STORAGE_STATE_2) });
      try {
        // Before B opens it: no receipt anywhere on A's side.
        const before = await mailRow(endpoints, A, B.username, kmailID);
        const txnBefore = before?.kmailTransactionList?.find((t) => t.receiver === B.username);
        expect(txnBefore, "A's copy lists B as a recipient").toBeTruthy();
        expect(txnBefore?.readStatus, 'before B opens it, A sees it as unread').toBe('N');
        expect(txnBefore?.letterReadTimeAsLong ?? 0, 'and no read time yet').toBe(0);
        expect(await copiesReadTime(endpoints, kmailID), 'getCopiesInfo shows no read time').toBe(
          null,
        );

        // B opens the mail in KMail (the screen's own open request).
        const b = await context.newPage();
        await b.goto('/kmail', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await b
          .locator('.loader-overlay')
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .catch(() => undefined);
        await b.locator('.Serach_input').first().fill(subject);
        const row = b.getByText(subject, { exact: false }).first();
        await expect(row, 'B has the mail in KMail').toBeVisible({ timeout: 30_000 });
        const opened = b.waitForResponse(
          (r) => r.url().includes('/readMail/sentAndInboxMailContent'),
          { timeout: 30_000 },
        );
        const openedAt = Date.now();
        await row.click();
        const openResponse = await opened;
        expect(openResponse.status(), 'B’s open request is answered').toBe(200);
        // An empty record here (kmailID 0, #1348) is when the read status goes to the wrong row (#1359).
        const openedRecord = (
          (await openResponse.json().catch(() => ({}))) as { data?: { kmailID?: number } }
        ).data?.kmailID;
        test.info().annotations.push({
          type: 'observed',
          description:
            `B's open returned kmailID ${String(openedRecord)} for mail ${kmailID}; the screen sent ` +
            `${String(openResponse.request().postData()).slice(0, 300)}`,
        });

        // After: A sees B's read status and an exact open time inside the send → now window.
        let txnAfter: Txn | undefined;
        await expect
          .poll(
            async () => {
              const after = await mailRow(endpoints, A, B.username, kmailID);
              txnAfter = after?.kmailTransactionList?.find((t) => t.receiver === B.username);
              return txnAfter?.readStatus;
            },
            {
              message:
                `after B opens it, A sees it as read — B's open returned kmailID ${String(openedRecord)} ` +
                '(an empty record, 0, is #1348; the read status then lands on the wrong row, #1359)',
              timeout: 30_000,
            },
          )
          .toBe('Y');
        const readAt = txnAfter?.letterReadTimeAsLong ?? 0;
        test.info().annotations.push({
          type: 'observed',
          description: `opened at ${new Date(openedAt).toISOString()}, A sees read time ${new Date(readAt).toISOString()}`,
        });
        expect(readAt, 'A sees a read time').toBeGreaterThan(0);
        expect(readAt, 'the read time is not before the mail was sent').toBeGreaterThanOrEqual(
          (before?.kmailSendDateAsLong ?? openedAt) - SKEW_MS,
        );
        expect(readAt, 'the read time is not in the future').toBeLessThanOrEqual(
          Date.now() + SKEW_MS,
        );
        expect(
          await copiesReadTime(endpoints, kmailID),
          'getCopiesInfo now shows B’s read time',
        ).toBeTruthy();
      } finally {
        await context.close();
        for (const [who, other] of [
          [A, B.username],
          [B, A.username],
        ] as const) {
          const mine = await mailRow(endpoints, who, other, kmailID).catch(() => undefined);
          const ids = (mine?.kmailTransactionList ?? []).map((t) => t.transactionID);
          if (ids.length)
            await endpoints
              .sendTo(
                'kmail-delete',
                { body: { groupFlag: false, transactionIDs: ids } },
                {
                  label: `receipt:cleanup:${who.key}`,
                  auth: { principal: who },
                  allowLiveWrite: true,
                },
              )
              .catch(() => undefined);
        }
      }
    });
  },
);
