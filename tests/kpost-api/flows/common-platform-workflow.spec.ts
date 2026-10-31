import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Common platform rules: service status, the app version gate, usage totals (ungated reads) and the
 * public enquiry write (a `data` write, safe with allowLiveWrite).
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe(
  'KPost common · platform business rules @api @kpost-api @common',
  { tag: ['@api', '@platform', '@regression'] },
  () => {
    test('msStatus reports the service as reachable', async ({ endpoints }) => {
      const ex = await endpoints.sendTo(
        'common-ms-status',
        {},
        { label: 'common:ms-status', auth: { principal: A } },
      );
      expect(ex.status, 'msStatus succeeds').toBe(200);
      expect(ex.bodyText.toUpperCase(), 'the service reports SUCCESS').toContain('SUCCESS');
    });

    test('getFlutterAppVersion returns a real, well-formed version string', async ({
      endpoints,
    }) => {
      const ex = await endpoints.sendTo(
        'common-flutter-app-version',
        {},
        { label: 'common:flutter-app-version', auth: { principal: A } },
      );
      expect(ex.status, 'getFlutterAppVersion succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as { version?: string };
      expect(
        body.version && /^\d+\.\d+\.\d+:\d+$/.test(body.version),
        `the version "${body.version}" matches the documented "major.minor.patch:build" shape`,
      ).toBe(true);
    });

    test('getTotalCountByDate returns real per-module counts for today', async ({ endpoints }) => {
      const ex = await endpoints.sendTo(
        'common-total-count-by-date',
        { body: { date: new Date(new Date().toDateString()).getTime() } },
        { label: 'common:total-count-by-date', auth: { principal: A } },
      );
      expect(ex.status, 'getTotalCountByDate succeeds').toBe(200);
      const body = JSON.parse(ex.bodyText || '{}') as {
        kallCount?: number;
        katchupMsgCount?: number;
        kmailCount?: number;
      };
      for (const [field, value] of Object.entries(body)) {
        if (typeof value === 'number') {
          expect(
            value,
            `${field} is a non-negative count, not an error placeholder`,
          ).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('saveEnquiryDetails accepts its own documented default payload', async ({ endpoints }) => {
      // Known defect: this contract payload 500s (ConstraintViolationException); the flow-finding
      // pipeline files the 5xx, so no manual recording here.
      const ex = await endpoints.sendTo(
        'common-save-enquiry-details',
        {
          body: {
            companyName: testData.companyNameAbsent,
            entity: 'Cake Shop',
            maximumMembersCount: 10,
            firstName: 'QA',
            lastName: 'Bench',
            designation: 'CEO',
            mobileNumber: testData.otpMobile,
            email: testData.otpEmail,
          },
        },
        { label: 'common:save-enquiry-details', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(
        ex.status,
        `saveEnquiryDetails rejected its own documented default payload with ${ex.status} (body: ${ex.bodyText.slice(0, 200)})`,
      ).toBeLessThan(500);
    });
  },
);
