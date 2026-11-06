import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { RequestSpec } from '@api/client/request-builder';
import { expect, test } from '@fixtures';
import { deleteMessages, sendText } from '../../../support/katchup-messages';
import { retryOrSkip } from '../../../support/live-condition';

/**
 * The Home dashboard feeds take message ids as paging markers (homeDashboardMsgs: lastMsgID;
 * homeDashboardNewMsgs: firstMsgID + serverTime) and must list only the caller's own messages
 * (DashboardDaoImpl.java:311+, 378, 627-700: sender = me, receiver = me, or a group I am in). A sends B
 * a message; A's own feed lists it (owner control); C, using A's markers, must never get it.
 */
const P = AUTH_PROFILES.kpost.principals;
const A = P.find((p) => p.key === 'personal'); // sender
const B = P.find((p) => p.key === 'victim'); // recipient
const C = P.find((p) => p.key === 'personal-3'); // outsider
const stamp = Date.now();

interface Window {
  LastFetchDate?: string;
  firstMsgID?: number;
  katchup?: Array<{ msgID?: number }>;
}
const windowOf = (ex: ApiResponseWrapper): Window => {
  try {
    return JSON.parse(ex.bodyText || '{}') as Window;
  } catch {
    return {};
  }
};

test.describe(
  'KPost Security · the Home dashboard feeds list only the caller’s own messages @api @kpost-api @security @dashboard',
  {
    tag: ['@api', '@dashboard', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ timeout: 120_000 });
    test.skip(!A || !B || !C, 'needs the personal, victim and personal-3 principals');
    test.skip(
      process.env.KATCHUP_LIFECYCLE !== 'true',
      'sends a real message; set KATCHUP_LIFECYCLE=true',
    );

    test("an outsider's dashboard never lists another pair's message, even with that pair's markers @api @kpost-api @security", async ({
      endpoints,
    }) => {
      const secret = `QA xuser dashboard ${stamp}`;
      const feed = (id: string, who: Principal, spec: RequestSpec, label: string) =>
        endpoints.sendTo(id, spec, {
          label: `xuser-dashboard:${label}`,
          auth: { principal: who },
          allowLiveRead: true,
        });
      // A's markers before the message, exactly as the client keeps them (RecentMessage.js:723-741).
      const marker = windowOf(
        await feed(
          'dashboard-home-msgs',
          A!,
          { body: { serverTime: null, lastMsgID: null } },
          'owner-marker',
        ),
      );
      test.skip(
        marker.firstMsgID === undefined || marker.LastFetchDate === undefined,
        'A has no recent-activity marker right now (empty window)',
      );
      let msgIDs: number[] = [];
      try {
        msgIDs = await sendText(endpoints, A!, B!, 'QA xuser dashboard', secret, 'xuser-dashboard');
        const msgID = msgIDs[0];
        test.skip(!msgID, 'the setup message got no msgID back; nothing to look for');
        const lists = (ex: ApiResponseWrapper): boolean =>
          ex.status < 300 &&
          ((windowOf(ex).katchup ?? []).some((m) => m.msgID === msgID) ||
            ex.bodyText?.includes(secret) === true);

        const probes: Array<[string, string, RequestSpec]> = [
          [
            'homeDashboardMsgs, latest page',
            'dashboard-home-msgs',
            { body: { serverTime: null, lastMsgID: null } },
          ],
          [
            'homeDashboardMsgs from just above the message',
            'dashboard-home-msgs',
            { body: { serverTime: Date.now(), lastMsgID: msgID! + 1 } },
          ],
          [
            "homeDashboardNewMsgs with the sender's own markers",
            'dashboard-home-new-msgs',
            { body: { firstMsgID: marker.firstMsgID, serverTime: marker.LastFetchDate } },
          ],
        ];
        for (const [variant, id, spec] of probes) {
          const own = await feed(id, A!, spec, `owner:${variant.replace(/\W+/g, '-')}`);
          if (!lists(own)) {
            test.info().annotations.push({
              type: 'not-judged',
              description: `${id} (${variant}): A's own identical call (HTTP ${own.status}) does not list the message`,
            });
            continue;
          }
          const attack = await feed(id, C!, spec, `outsider:${variant.replace(/\W+/g, '-')}`);
          retryOrSkip(attack.status === 0, `${id} did not answer the outsider (timeout)`);
          const leaked = lists(attack);
          if (leaked)
            endpoints.recordBusinessRuleViolation({
              endpointId: id,
              ruleId: `IDOR-${id}-foreign-message`,
              rule: "The Home dashboard lists only the caller's own messages (sent, received, or in a group they are in).",
              expected: `no row for message ${msgID} in ${C!.username}'s feed`,
              actual: `HTTP ${attack.status} (${variant}): ${C!.username}'s feed listed ${A!.username}'s message ${msgID} to ${B!.username}`,
              request: spec,
              correlationId: attack.correlationId,
            });
          expect
            .soft(leaked, `an outsider's ${id} must not list another pair's message (${variant})`)
            .toBe(false);
        }
        const judged = test.info().annotations.filter((a) => a.type === 'not-judged').length;
        retryOrSkip(judged === probes.length, "none of A's own feed calls listed the new message");
      } finally {
        await deleteMessages(endpoints, A!, msgIDs, 'xuser-dashboard:cleanup');
      }
    });
  },
);
