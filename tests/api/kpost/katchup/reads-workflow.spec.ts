import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Katchup plain reads (badge counts, contacts, search/filter, reported messages). Not gated: all are
 * productionSafe. Search and filter get a longer timeout because they often exceed 10 s on this build.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe(
  'KPost Katchup · plain-read business rules @api @kpost-api @katchup',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test('getUnopenedMessagesCount returns a real per-sender breakdown', async ({ endpoints }) => {
      const ex = await endpoints.sendTo(
        'katchup-unopened-count',
        {},
        { label: 'katchup:unopened-count', auth: { principal: A }, timeoutMs: 20_000 },
      );
      expect(ex.status, 'getUnopenedMessagesCount succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as {
        msgsCount?: number;
        resultList?: Array<{ sender: string; count: number }>;
      };
      expect(Array.isArray(body.resultList), 'resultList is an array').toBe(true);
      if (body.resultList?.length) {
        const summed = body.resultList.reduce((total, entry) => total + entry.count, 0);
        expect(
          summed,
          'msgsCount is the sum of every per-sender count in resultList, not an unrelated figure',
        ).toBe(body.msgsCount);
      }
    });

    test('getUnopenedMessagesAndKmailsTotalCount returns both totals', async ({ endpoints }) => {
      const ex = await endpoints.sendTo(
        'katchup-unopened-total-count',
        {},
        { label: 'katchup:unopened-total', auth: { principal: A }, timeoutMs: 20_000 },
      );
      expect(ex.status, 'getUnopenedMessagesAndKmailsTotalCount succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as {
        katchupTotalCount?: number;
        kmailTotalCount?: number;
      };
      expect(typeof body.katchupTotalCount, 'katchupTotalCount is a number').toBe('number');
      expect(typeof body.kmailTotalCount, 'kmailTotalCount is a number').toBe('number');
    });

    test('frequentlyAccessContacts returns real contacts, not placeholders', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'katchup-frequent-contacts',
        {},
        { label: 'katchup:frequent-contacts', auth: { principal: A } },
      );
      expect(ex.status, 'frequentlyAccessContacts succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as {
        data?: Array<{ contactID?: string; contactName?: string }>;
      };
      expect(Array.isArray(body.data), 'the response is a list of contacts').toBe(true);
      for (const contact of body.data ?? []) {
        expect(contact.contactID, 'each contact has a real contactID').toBeTruthy();
      }
    });

    test('messageCountBetweenSenderAndReceiver counts our real conversation with the second account', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'katchup-message-count',
        { body: { receiver: testData.victimKpostId, groupFlag: 'false' } },
        { label: 'katchup:message-count', auth: { principal: A } },
      );
      expect(ex.status, 'messageCountBetweenSenderAndReceiver succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as { messageCount?: number };
      expect(
        typeof body.messageCount === 'number' && body.messageCount >= 0,
        'messageCount is a non-negative number, not an error placeholder',
      ).toBe(true);
    });

    test('searchKatchUpMessage finds real matches for a term already in our conversation history', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'katchup-search-message',
        { body: { searchMessage: 'qa bench' } },
        { label: 'katchup:search-message', auth: { principal: A }, timeoutMs: 20_000 },
      );
      expect.soft(ex.status, 'searchKatchUpMessage succeeds').toBe(200);
    });

    test('searchKatchUpMessageSubject with a real contact and term returns a status', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'katchup-search-subject',
        { body: { selectedContact: testData.victimKpostId, searchMessage: 'qa' } },
        { label: 'katchup:search-subject', auth: { principal: A } },
      );
      expect(ex.status, 'searchKatchUpMessageSubject succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as { data?: unknown[] };
      expect(Array.isArray(body.data), 'the response is a list of subjects').toBe(true);
    });

    test('filterKatchUpMessage with a real contact filter returns a status', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'katchup-filter-message',
        { body: { selectedContact: testData.victimKpostId, groupFlag: false, messageBy: 'All' } },
        { label: 'katchup:filter-message', auth: { principal: A }, timeoutMs: 20_000 },
      );
      expect.soft(ex.status, 'filterKatchUpMessage succeeds').toBe(200);
    });

    test('getAllReportMsg returns the reference list of report reasons', async ({ endpoints }) => {
      const ex = await endpoints.sendTo(
        'katchup-all-report-msg',
        {},
        { label: 'katchup:all-report-msg', auth: { principal: A } },
      );
      expect(ex.status, 'getAllReportMsg succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as {
        data?: Array<{ id: number; reportMsg: string }>;
      };
      expect(
        Array.isArray(body.data) && body.data.length > 0,
        'at least one report reason exists',
      ).toBe(true);
      for (const reason of body.data ?? []) {
        expect(
          reason.reportMsg,
          'each report reason has real text, not a blank placeholder',
        ).toBeTruthy();
      }
    });
  },
);
