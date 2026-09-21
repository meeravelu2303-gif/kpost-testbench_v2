import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { STORAGE_STATE_2 } from '@config/constants';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import type { Browser, Page } from '@playwright/test';
import { slotPrincipals, type CleanupCoordinator } from '../../src/test-data/index';
import {
  openComposerFor,
  openReceivedConversation,
  receivedMessageBySubject,
  sendMessage,
} from './support/katchup';

/**
 * API ↔ UI cross-channel observation (master plan §10, requirements 5 and 6).
 *
 * ## Why both directions, and why neither is a UI smoke test
 *
 * A channel proves nothing about itself. An API test that sends and then reads back through the same
 * API cannot distinguish "the message was delivered" from "the API consistently reports its own
 * writes"; a UI test that clicks send and sees a bubble appear cannot distinguish delivery from
 * optimistic local rendering. Observing through the OTHER channel is what removes that doubt, and it
 * is the same principle Phase 11's independent confirmation will be built on.
 *
 *     API → UI    the API sends as A; the BROWSER, signed in as B, must see that message
 *     UI → API    the browser sends as A; the API, reading as B, must find that message
 *
 * Neither test stops at "the page loaded" or "the composer cleared". Each asserts the resulting
 * RESOURCE, observed by the other party.
 *
 * ## Safety
 *
 * One message per direction between two accounts the bench owns, registered with the resource ledger
 * and deleted by it. Gated behind `KATCHUP_UI_LIFECYCLE`, which `npm run ui` sets. The API half goes
 * through the same `EndpointExecutor` as every other call, so the production guard, the QA-identifier
 * guard and evidence capture all apply unchanged.
 *
 * ## A note on sessions
 *
 * KPOST allows ONE active session per account, and an API login DISPLACES the saved browser session
 * for that account. Measured here twice: a browser driven as an account the API had just
 * authenticated renders its conversation list as an empty skeleton forever, because its own reads are
 * now unauthorised. That is a bench self-inflicted failure and it reads exactly like a product defect.
 *
 * So the rule both tests obey: **the browser is never driven as an account the API authenticates as.**
 * Account A is the API's identity throughout; account B's browser (`.auth/user2.json`) is the UI in
 * both directions, and nothing ever logs in as B through the API.
 */

const [A, B] = slotPrincipals(2) as [Principal, Principal];

/** Account B's saved session, in its own context. The only browser identity these tests use. */
async function openAsB(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: STORAGE_STATE_2 });
  return context.newPage();
}

/** The `data` rows of a response. Module scope: data-shaping, not test flow. */
function dataRows(exchange: {
  json(): { ok: boolean; value?: unknown };
}): Record<string, unknown>[] {
  const parsed = exchange.json();
  if (!parsed.ok) return [];
  const rows = (parsed.value as { data?: unknown }).data;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** The first `data` row, or undefined. */
function firstRow(exchange: {
  json(): { ok: boolean; value?: unknown };
}): Record<string, unknown> | undefined {
  return dataRows(exchange)[0];
}

test.describe('KPost · cross-channel observation', { tag: '@ui' }, () => {
  test.skip(
    !env.KATCHUP_UI_LIFECYCLE,
    'writes real messages between two accounts; set KATCHUP_UI_LIFECYCLE=true',
  );
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
    'needs both QA accounts (QA_KPOST_ID, QA_VICTIM_KPOST_ID)',
  );

  test('API → UI: a message sent through the API is seen by the recipient in the browser @ui', async ({
    browser,
    endpoints,
    resources,
  }: {
    browser: Browser;
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }) => {
    const subject = `QA api2ui ${Date.now()}`;

    const sent = await endpoints.sendTo(
      'katchup-send-message',
      {
        body: sendShape({
          receiver: B.username,
          subject,
          actualMessage: 'QA bench API→UI probe — safe to ignore.',
        }),
      },
      { label: 'cross-channel:api-send', auth: { principal: A }, allowLiveWrite: true },
    );
    const msgID = firstRow(sent)?.msgID;
    expect(typeof msgID, `the API send must issue a msgID (status ${String(sent.status)})`).toBe(
      'number',
    );

    resources.track({
      kind: 'katchup-message',
      id: String(msgID),
      describe: `API→UI probe "${subject}"`,
      cleanup: async () => {
        const deleted = await endpoints.sendTo(
          'katchup-delete-message',
          { body: { messageIds: [msgID], groupFlag: false } },
          {
            label: 'cross-channel:cleanup',
            auth: { principal: A },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        return `deleted (${String(deleted.status)})`;
      },
    });

    // ---- the OTHER channel observes -----------------------------------------------------------
    const recipient = await openAsB(browser);
    /*
     * Open the THREAD, not just the app. `receivedMessageBySubject` matches a message inside an open
     * conversation (it is keyed on the recipient ReplyIcon the thread renders), so landing on
     * /katchup alone would look for it in a list that does not contain it — which is how the first
     * run failed, on the bench and not on the product.
     */
    await openReceivedConversation(recipient, subject);

    /*
     * The assertion is the RESOURCE, in the recipient's own browser. Not "Katchup rendered", not
     * "a list has rows" — the specific message the API created, found by the unique subject this
     * run generated.
     */
    await expect(
      receivedMessageBySubject(recipient, subject),
      'the recipient must see, in their own browser, the message the API sent them',
    ).toBeVisible({ timeout: 30_000 });

    await recipient.context().close();
  });

  test('UI → API: a message sent in the browser is found by the recipient through the API @ui', async ({
    browser,
    endpoints,
    resources,
  }: {
    browser: Browser;
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }) => {
    const subject = `QA ui2api ${Date.now()}`;
    const seedSubject = `QA ui2api seed ${Date.now()}`;

    /*
     * A PRECONDITION, not the thing under test. Two measured facts shape it.
     *
     * 1. The composer is reached through a conversation in the sender's list, and `openComposerFor`
     *    finds that row by `[id=<kpostId>]`. These two QA accounts are not saved contacts of each
     *    other, so before any traffic between them that row does not exist — which is also why
     *    `katchup-two-session.spec.ts` cannot open a composer on a clean account today.
     * 2. The seed is sent as A, and the browser that composes is B's — see the session rule above.
     *    Driving A's browser here failed exactly that way: A's API login had already displaced it.
     */
    const seed = await endpoints.sendTo(
      'katchup-send-message',
      {
        body: sendShape({
          receiver: B.username,
          subject: seedSubject,
          actualMessage: 'QA bench UI→API seed — opens the conversation, not the assertion.',
        }),
      },
      { label: 'cross-channel:seed', auth: { principal: A }, allowLiveWrite: true },
    );
    const seedId = firstRow(seed)?.msgID;
    expect(typeof seedId, 'the seed message must be created').toBe('number');
    resources.track({
      kind: 'katchup-message',
      id: String(seedId),
      describe: `UI→API seed "${seedSubject}"`,
      cleanup: async () => {
        const deleted = await endpoints.sendTo(
          'katchup-delete-message',
          { body: { messageIds: [seedId], groupFlag: false } },
          {
            label: 'cross-channel:cleanup-seed',
            auth: { principal: A },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        return `deleted (${String(deleted.status)})`;
      },
    });

    // The seed put the conversation in B's list, so B can now open it by A's id and compose.
    const sender = await openAsB(browser);
    await openComposerFor(sender, A.username);
    await sendMessage(sender, subject, 'QA bench UI→API probe — safe to ignore.');

    /*
     * The browser having accepted the send is NOT the evidence: a composer clearing proves only that
     * the client thinks it sent something. The evidence is the recipient's own API read.
     */
    const received = await endpoints.sendTo(
      'katchup-conversation',
      { body: { groupFlag: false, firstMsgID: null, lastMsgID: null, receiver: B.username } },
      { label: 'cross-channel:api-observe', auth: { principal: A } },
    );
    const row = dataRows(received).find((entry) => entry.subject === subject);

    expect(
      row,
      `the recipient's API read must contain the message the browser sent (subject "${subject}", ` +
        `read status ${String(received.status)})`,
    ).toBeTruthy();

    // Registered only now, because the msgID is what the OTHER channel just told us.
    resources.track({
      kind: 'katchup-message',
      id: String(row?.msgID),
      describe: `UI→API probe "${subject}"`,
      cleanup: async () => {
        const deleted = await endpoints.sendTo(
          'katchup-delete-message',
          { body: { messageIds: [row?.msgID], groupFlag: false } },
          {
            label: 'cross-channel:cleanup',
            auth: { principal: A },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        return `deleted (${String(deleted.status)})`;
      },
    });

    await sender.context().close();
  });
});
