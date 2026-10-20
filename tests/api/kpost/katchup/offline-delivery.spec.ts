import { randomUUID } from 'node:crypto';
import { sendShape } from '@api/definitions/kpost/katchup/send.api';
import { AUTH_PROFILES, KPOST_DEVICE_IDENTITY } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { isSqlClient } from '@database/database-client';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * RTM-KU-M05 — a message sent while the recipient is OFFLINE is waiting for them, unread, when they
 * next sign in.
 *
 * B goes offline the way a person does: B signs in on a device of its own and signs out of it
 * (the bench's shared session lives on a different device and is untouched — the pattern of
 * `login-flow.spec.ts` "a session can be ended…"). A then sends B a message. B signs in again on that
 * device, opens the conversation with A, and finds the message. The database row is the judge of
 * "unread until opened": `read_time` is empty before B opens it.
 */
const P = AUTH_PROFILES.kpost.principals;
const A = P.find((p) => p.key === 'personal')!;
const B = P.find((p) => p.key === 'victim')!;

async function signIn(endpoints: EndpointExecutor, device: string): Promise<string> {
  const base = AUTH_PROFILES.kpost.loginRequest({
    key: 'offline',
    role: 'USER',
    username: B.username,
    password: testData.password,
    userType: 'PERSONAL',
  });
  const exchange = await endpoints.sendTo(
    'signup-login-user-login',
    {
      body: {
        ...(base.body as Record<string, unknown>),
        sessionID: randomUUID(),
        deviceIdentity_primary: device,
      },
    },
    { label: 'offline:sign-in', auth: { header: undefined } },
  );
  expect(exchange.status, 'B signs in on its own device').toBe(200);
  const token = String(
    (JSON.parse(exchange.bodyText) as { accessToken?: string }).accessToken ?? '',
  );
  expect(token, 'and gets a token').not.toBe('');
  return token;
}

async function signOut(endpoints: EndpointExecutor, device: string, token: string): Promise<void> {
  const exchange = await endpoints.sendTo(
    'signup-login-user-logout',
    {
      body: {
        deviceType: 'Web',
        deviceIdentity_primary: device,
        logouttime: new Date().toISOString().replace('T', ' ').slice(0, 19),
      },
    },
    { label: 'offline:sign-out', auth: { header: `Bearer ${token}` } },
  );
  expect(exchange.status, 'B signs out of that device').toBeLessThan(400);
}

test.describe(
  'KPost Katchup · a message waits for an offline recipient',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true',
      'sends a real message between the QA accounts; set KATCHUP_LIFECYCLE=true',
    );

    test(
      'B is offline when A writes; on B’s next sign-in the message is there, unread',
      { annotation: [{ type: 'requirement', description: 'RTM-KU-M05' }] },
      async ({ endpoints, databases }) => {
        expect(KPOST_DEVICE_IDENTITY, 'the shared session uses another device').toBeTruthy();
        const db = databases.for('kpost-api');
        if (!isSqlClient(db)) {
          test.skip(true, 'needs the KPOST_QA database to see read_time');
          return;
        }
        const device = `qa-bench-offline-${randomUUID()}`;
        const subject = `QA offline delivery ${Date.now()}`;
        let msgID: number | undefined;

        try {
          await test.step('B goes offline (signs out of its own device)', async () => {
            const token = await signIn(endpoints, device);
            await signOut(endpoints, device, token);
          });

          await test.step('A writes to B while B is offline', async () => {
            const sent = await endpoints.sendTo(
              'katchup-send-message',
              { body: sendShape({ receiver: B.username, subject, actualMessage: subject }) },
              { label: 'offline:send', auth: { principal: A }, allowLiveWrite: true },
            );
            expect(sent.status, 'A sends').toBeLessThan(300);
            const row = (JSON.parse(sent.bodyText) as { data?: Array<{ msgID?: number }> })
              .data?.[0];
            msgID = row?.msgID;
            expect(msgID, 'the message is stored').toBeTruthy();
            const [stored] = await db.query<{ receiver: string; read_time: string | null }>(
              'SELECT receiver, read_time FROM TBL_KPOST_KATCHUP_MESSAGES WHERE msg_id = ?',
              [msgID],
            );
            expect(stored?.receiver?.toLowerCase(), 'addressed to B').toBe(
              B.username.toLowerCase(),
            );
            expect(stored?.read_time ?? null, 'unread while B is offline').toBeNull();
          });

          await test.step('B signs in again and the message is waiting', async () => {
            const token = await signIn(endpoints, device);
            try {
              const thread = await endpoints.sendTo(
                'katchup-conversation',
                {
                  body: {
                    groupFlag: false,
                    firstMsgID: null,
                    lastMsgID: null,
                    receiver: A.username,
                  },
                },
                { label: 'offline:thread', auth: { header: `Bearer ${token}` } },
              );
              expect(thread.status, 'B opens the thread with A').toBe(200);
              expect(thread.bodyText, 'the message A sent while B was offline is there').toContain(
                subject,
              );
            } finally {
              await signOut(endpoints, device, token).catch(() => undefined);
            }
          });
        } finally {
          if (msgID)
            await endpoints
              .sendTo(
                'katchup-delete-message',
                { body: { messageIds: [msgID], groupFlag: false } },
                { label: 'offline:cleanup', auth: { principal: A }, allowLiveWrite: true },
              )
              .catch(() => undefined);
        }
      },
    );
  },
);
