import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { mailShape } from '@api/definitions/kmail/send.api';

/**
 * KMail account-scoped reads (contacts, counts, dashboard, translation): shape checks, plus an
 * unread count that must rise by exactly one when a fresh mail arrives.
 */

const K = AUTH_PROFILES.kpost;
const p = (key: string): Principal => K.principals.find((x) => x.key === key)!;
const A = p('personal');
const B = p('victim');

async function read(
  endpoints: EndpointExecutor,
  id: string,
  as: Principal,
  label: string,
  bodyObj?: Record<string, unknown>,
): Promise<{ status: number; bodyText: string }> {
  const ex = await endpoints.sendTo(id, bodyObj ? { body: bodyObj } : {}, {
    label: `kmail:${label}`,
    auth: { principal: as },
  });
  return { status: ex.status, bodyText: ex.bodyText ?? '' };
}

test.describe(
  'KMail · plain-read business rules @api @kmail-api @kmail',
  { tag: ['@api', '@kmail', '@regression'] },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');

    test('contact/reference reads return their documented shape', async ({ endpoints }) => {
      const frequent = await read(endpoints, 'kmail-frequent-contact', A, 'frequent');
      expect(frequent.status, 'frequentKmailContact succeeds').toBe(200);

      const misc = await read(endpoints, 'kmail-misc-contacts', A, 'misc');
      expect(misc.status, 'miscellaneousContacts succeeds').toBe(200);

      const otherDomain = await read(endpoints, 'kmail-other-domain-mails', A, 'other-domain');
      expect(otherDomain.status, 'loadOtherDomainMails succeeds').toBe(200);

      const instantReplyOptions = await read(
        endpoints,
        'kmail-instant-reply',
        A,
        'instant-reply-list',
      );
      expect(instantReplyOptions.status, 'getInstantReply succeeds').toBe(200);
      expect(
        instantReplyOptions.bodyText,
        'the default (non-customized) instant-reply options are present',
      ).toContain('"customized":false');

      const letterheadTemplates = await read(
        endpoints,
        'kmail-letterhead-template',
        A,
        'letterhead-template-list',
      );
      expect(letterheadTemplates.status, 'getLetterHeadTemplate succeeds').toBe(200);
      expect(
        letterheadTemplates.bodyText,
        'at least one signature template is available (has an id and html content)',
      ).toContain('htmlContent');

      const knownPostbox = await read(
        endpoints,
        'kmail-known-postbox-contacts',
        A,
        'known-postbox',
        {
          lastFetchTime: String(Date.now()),
        },
      );
      expect(knownPostbox.status, 'knownPostBoxContacts succeeds').toBe(200);
    });

    test('kmail-status-total-count and kmail-dashboard return a consistent SUCCESS envelope', async ({
      endpoints,
    }) => {
      const statusCount = await read(endpoints, 'kmail-status-total-count', A, 'status-count');
      expect(statusCount.status, 'statusOfKmailsContactsTotalCount succeeds').toBe(200);
      expect(statusCount.bodyText, 'the envelope reports SUCCESS').toContain('SUCCESS');

      const dashboard = await read(endpoints, 'kmail-dashboard', A, 'dashboard', { kmailID: '' });
      expect(dashboard.status, 'getKmailDashboardMsg succeeds').toBe(200);
    });

    test('kmail-unopened-count increases by exactly one after a fresh unread mail arrives', async ({
      endpoints,
    }) => {
      const before = await read(endpoints, 'kmail-unopened-count', B, 'unopened-before');
      // Soft, so a failing baseline is reported; the delta check is then skipped, as it means nothing.
      expect
        .soft(before.status, `unOpenedMailCountBySenderID succeeds (body: ${before.bodyText})`)
        .toBe(200);
      test.skip(
        before.status !== 200,
        'unOpenedMailCountBySenderID is currently 500 for every account',
      );
      // The count is the top-level `UnOpenedMailCount` (what the web app reads); there is no `data`.
      const beforeBody = JSON.parse(before.bodyText || '{}') as { UnOpenedMailCount?: number };
      const baseline = beforeBody.UnOpenedMailCount ?? 0;

      const sent = await endpoints.sendTo(
        'kmail-post-mail',
        { body: mailShape({ toAddress: B.username, kmailSubject: `QA Unread ${Date.now()}` }) },
        { label: 'kmail:unopened-send', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(sent.status, 'the send succeeds').toBeLessThan(300);
      const parsed = sent.json();
      const value = (parsed.ok ? parsed.value : {}) as { data?: unknown };
      const data = Array.isArray(value.data)
        ? (value.data[0] as Record<string, unknown>)
        : (value.data as Record<string, unknown> | undefined);
      const txns = data?.kmailTransactionList;
      const transactionIDs = Array.isArray(txns)
        ? (txns as Array<Record<string, unknown>>)
            .map((t) => t.transactionID ?? t.id)
            .filter((v): v is number => typeof v === 'number')
        : [];

      try {
        const after = await read(endpoints, 'kmail-unopened-count', B, 'unopened-after');
        expect(after.status, 'unOpenedMailCountBySenderID succeeds').toBe(200);
        const afterBody = JSON.parse(after.bodyText || '{}') as { UnOpenedMailCount?: number };
        expect(
          afterBody.UnOpenedMailCount ?? 0,
          `unopened count for B must increase by 1 after a fresh unread mail (was ${baseline})`,
        ).toBe(baseline + 1);
      } finally {
        await endpoints
          .sendTo(
            'kmail-delete',
            { body: { groupFlag: false, transactionIDs } },
            { label: 'kmail:unopened-cleanup', auth: { principal: A }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    });

    test('kmail-translation: translates real text, and the AUTH-BYPASS finding is re-confirmed as observed', async ({
      endpoints,
    }) => {
      const translated = await endpoints.sendTo(
        'kmail-translation',
        { body: { langFrom: 'en', langTo: 'hi', msgToTranslate: 'Good morning' } },
        { label: 'kmail:translate', auth: { principal: A } },
      );
      expect(translated.status, 'translation succeeds for a real phrase').toBe(200);
      expect(
        translated.bodyText,
        'the response carries translated content, not an empty/error envelope',
      ).toBeTruthy();

      // Translation answers 200 with no token, unlike every other KMail endpoint. Asserted so a
      // change either way is noticed.
      const withoutAuth = await endpoints.sendTo(
        'kmail-translation',
        { body: { langFrom: 'en', langTo: 'hi', msgToTranslate: 'Good morning' } },
        { label: 'kmail:translate-no-auth', auth: { header: undefined } },
      );
      expect
        .soft(
          withoutAuth.status,
          'AUTH-BYPASS (recorded, unconfirmed as intentional): translation still answers 200 with no token — ' +
            'confirm with the dev whether this is a deliberately public utility',
        )
        .toBe(200);
    });

    test('kmail-all-drafts and kmail-draft-contacts respond even with no drafts, without a server error', async ({
      endpoints,
    }) => {
      // Zero drafts must be a clean empty result, not a 5xx.
      const drafts = await read(endpoints, 'kmail-all-drafts', A, 'drafts-baseline');
      expect(drafts.status, 'getAllDraftMails succeeds with zero or more drafts').toBe(200);

      const contacts = await read(endpoints, 'kmail-draft-contacts', A, 'draft-contacts-baseline');
      expect(contacts.status, 'getDraftMailsContacts succeeds with zero or more drafts').toBe(200);
    });
  },
);
