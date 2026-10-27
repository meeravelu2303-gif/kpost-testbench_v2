import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/** Katchup reads that need a real id: the subject suggestions for a real contact (id as a path param). */
const A = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe(
  'KPost Katchup · needs-id reads',
  { tag: ['@api', '@katchup', '@regression'] },
  () => {
    test('katchup-messages-subject returns the subject lines used with a real contact @api', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'katchup-messages-subject',
        { pathParams: { id: testData.victimKpostId } },
        { label: 'needs-id:messages-subject', auth: { principal: A }, allowLiveRead: true },
      );
      expect(ex.status, 'getKatchupMessagesSubject succeeds with a real contact id').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as { data?: unknown };
      expect(Array.isArray(body.data), 'the response carries a list of subject strings').toBe(true);
    });
  },
);
