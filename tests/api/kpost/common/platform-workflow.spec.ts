/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Common **platform business rules** — service status, the mobile app version gate, usage totals,
 * and the public enquiry-capture write. The 3 reads are not gated (`productionSafe: true`); the
 * enquiry write is a `data`-side-effect public write, safe to exercise directly with `allowLiveWrite`
 * (unlike `updateFlutterAppVersion`, which is `sideEffect: 'global'` and changes what every mobile
 * client is told to install — never exercised here, see the endpoint definition's own warning).
 *
 * `saveUnsubscriberDetails` is NOT exercised here — see `common-gaps.spec.ts`.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe('KPost common · platform business rules @api @kpost-api @common', () => {
  test('msStatus reports the service as reachable', async ({ endpoints }) => {
    const ex = await endpoints.sendTo(
      'common-ms-status',
      {},
      { label: 'common:ms-status', auth: { principal: A } },
    );
    expect(ex.status, 'msStatus succeeds').toBe(200);
    expect(ex.bodyText.toUpperCase(), 'the service reports SUCCESS').toContain('SUCCESS');
  });

  test('getFlutterAppVersion returns a real, well-formed version string', async ({ endpoints }) => {
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
    /*
     * Live-verified 2026-09-24: this exact, contract-matching payload 500s deterministically
     * ("could not execute statement... ConstraintViolationException"), reproduced twice. A real
     * defect — a public-facing enquiry form must never crash the server, even on a constraint it
     * cannot satisfy; that belongs in a 4xx. It's a genuine 5xx from an authorized write, so the
     * engine's own flow-finding pipeline files it automatically; no manual recording needed here.
     */
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
});
