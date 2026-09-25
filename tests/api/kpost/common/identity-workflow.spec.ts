/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Common **identity/existence-check business rules**. Not gated: all `productionSafe: true`, safe
 * on every default run.
 *
 * The real business rule these endpoints exist for is the true/false duplicate-detection logic
 * itself — "does this mobile/name already exist" — not just "does the endpoint respond". Each is
 * asked with BOTH a known-absent value (`*Absent` test data) and a known-existing one, so the
 * actual boolean the endpoint returns is verified, not assumed.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

interface Envelope<T = unknown> {
  data?: T;
  message?: string;
}

test.describe('KPost common · identity business rules @api @kpost-api @common', () => {
  test('mobileNoExist reports false for an absent number and true for an existing one', async ({
    endpoints,
  }) => {
    const [absent, exists] = await Promise.all([
      endpoints.sendTo(
        'common-mobile-no-exist',
        {
          body: {
            countryID: testData.countryId,
            mobileNumber: testData.mobileAbsent,
            companyID: 0,
          },
        },
        { label: 'common:mobile-absent', auth: { principal: A } },
      ),
      endpoints.sendTo(
        'common-mobile-no-exist',
        {
          body: {
            countryID: testData.countryId,
            mobileNumber: testData.mobileExists,
            companyID: 0,
          },
        },
        { label: 'common:mobile-exists', auth: { principal: A } },
      ),
    ]);
    expect(absent.status, 'mobileNoExist succeeds for an absent number').toBe(200);
    expect(exists.status, 'mobileNoExist succeeds for an existing number').toBe(200);
    const absentBody = JSON.parse(absent.bodyText || '{}') as Envelope<boolean>;
    const existsBody = JSON.parse(exists.bodyText || '{}') as Envelope<boolean>;
    expect(absentBody.data, 'a known-absent mobile number reports false (available)').toBe(false);
    expect(existsBody.data, 'a known-existing mobile number reports true (taken)').toBe(true);
  });

  test('mobileNoExistInsideCompany reports true for a real member of our own business company', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'common-mobile-no-exist-in-company',
      { body: { mobileNumber: testData.businessMMobile, companyID: testData.businessMCompanyId } },
      { label: 'common:mobile-in-company', auth: { principal: A } },
    );
    expect(ex.status, 'mobileNoExistInsideCompany succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as Envelope<boolean>;
    expect(body.data, 'a real member of the company reports true').toBe(true);
  });

  test('getUserDetailsByMobNo resolves our own mobile number to a real account', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'common-user-details-by-mobile',
      { body: { mobileNumber: Number(testData.mobileExists) } },
      { label: 'common:user-by-mobile', auth: { principal: A } },
    );
    expect(ex.status, 'getUserDetailsByMobNo succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as Envelope<Array<{ kpostID?: string }>>;
    expect(
      body.data?.[0]?.kpostID,
      'a real kpostID is resolved from the mobile number',
    ).toBeTruthy();
  });

  test('getKpostIdUsingModule returns real subscribers for a real module code', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'common-kpost-id-using-module',
      { body: { module: [testData.moduleId] } },
      { label: 'common:kpost-id-using-module', auth: { principal: A } },
    );
    expect(ex.status, 'getKpostIdUsingModule succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as Envelope<Array<{ kpostID?: string }>>;
    expect(
      Array.isArray(body.data) && body.data.length > 0,
      'at least one real kpostID is returned for the module',
    ).toBe(true);
    for (const entry of body.data ?? []) {
      expect(entry.kpostID, 'every returned entry has a real kpostID').toBeTruthy();
    }
  });

  test('uniqueNameExist reports a known-absent company name as available', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'common-unique-name-exist',
      {
        body: {
          companyName: testData.companyNameAbsent,
          uniqueName: testData.uniqueName,
          domain: testData.domain,
        },
      },
      { label: 'common:unique-name-exist', auth: { principal: A } },
    );
    expect(ex.status, 'uniqueNameExist succeeds').toBe(200);
    expect(
      ex.bodyText,
      'a known-absent company name is reported available, not "already exists"',
    ).toContain('Available');
    /*
     * The "taken" branch (a REAL, existing company name) is Unknown/Requires Clarification: only
     * QA_COMPANY_NAME_ABSENT is configured in .env, not a real QA-owned QA_COMPANY_NAME — the same
     * gap already recorded for kmail-sig-company and profile-save-experience this session. Not
     * worked around by inventing a name that might collide with a real customer's.
     */
  });

  test('domain lists at least one real domain suffix for India/BUSINESS', async ({ endpoints }) => {
    const ex = await endpoints.sendTo(
      'common-domain',
      { body: { countryID: testData.countryId, userType: 'BUSINESS' } },
      { label: 'common:domain', auth: { principal: A } },
    );
    expect(ex.status, 'domain succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as Envelope<string[]>;
    expect(Array.isArray(body.data) && body.data.length > 0, 'at least one domain is offered').toBe(
      true,
    );
    for (const domain of body.data ?? []) {
      expect(domain.startsWith('@'), `"${domain}" is a real domain suffix, starting with @`).toBe(
        true,
      );
    }
  });

  test('generateDomainAndUniqueName produces a domain that embeds the suggested unique name', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'common-generate-domain-and-unique-name',
      { body: { kpostID: testData.kpostId, companyName: testData.companyNameAbsent } },
      { label: 'common:generate-domain', auth: { principal: A } },
    );
    expect(ex.status, 'generateDomainAndUniqueName succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as Envelope<{
      uniqueName?: string;
      domain?: string;
    }>;
    expect(body.data?.uniqueName, 'a unique name is generated').toBeTruthy();
    expect(body.data?.domain, 'a domain is generated').toBeTruthy();
    if (body.data?.uniqueName && body.data.domain) {
      expect(
        body.data.domain.startsWith(body.data.uniqueName),
        `the generated domain (${body.data.domain}) embeds the generated unique name (${body.data.uniqueName}), not an unrelated one`,
      ).toBe(true);
    }
  });
});
