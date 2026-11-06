import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { expectStored } from '../../../support/db-stored';

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

    test('saveEnquiryDetails accepts its own documented default payload', async ({
      endpoints,
      databases,
    }) => {
      // Known defect: this contract payload 500s (ConstraintViolationException); the flow-finding
      // pipeline files the 5xx, so no manual recording here.
      const enquiry = {
        companyName: testData.companyNameAbsent,
        entity: 'Cake Shop',
        maximumMembersCount: 10,
        firstName: 'QA',
        lastName: 'Bench',
        designation: 'CEO',
        mobileNumber: testData.otpMobile,
        email: testData.otpEmail,
      };
      const ex = await endpoints.sendTo(
        'common-save-enquiry-details',
        { body: enquiry },
        { label: 'common:save-enquiry-details', auth: { principal: A }, allowLiveWrite: true },
      );
      const parsed = ex.json();
      const savedId = parsed.ok
        ? (parsed.value as { data?: { id?: number | string } }).data?.id
        : undefined;
      if (ex.status === 200 && savedId !== undefined) {
        const db = databases.for('kpost-api');
        // CommonServiceImpl.java:921-931 copies every field of the body onto the new row and saves it;
        // the response returns that row with its generated id.
        await expectStored(
          db,
          'common-save-enquiry-details',
          {
            table: 'TBL_KPOST_ENQUIRY_FORM',
            where: { id: savedId },
            columns: {
              company_name: enquiry.companyName,
              entity: enquiry.entity,
              maximum_members_count: enquiry.maximumMembersCount,
              first_name: enquiry.firstName,
              last_name: enquiry.lastName,
              designation: enquiry.designation,
              mobile_number: enquiry.mobileNumber,
              email: enquiry.email,
            },
            rule: 'saveEnquiryDetails stores the enquiry exactly as it was sent',
          },
          endpoints,
        );
      }
      expect(
        ex.status,
        `saveEnquiryDetails rejected its own documented default payload with ${ex.status} (body: ${ex.bodyText.slice(0, 200)})`,
      ).toBeLessThan(500);
    });
  },
);
