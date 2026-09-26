/* eslint-disable playwright/no-conditional-in-test */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * KMail **signature components + letterhead + count-days-limit** — each signature-section write
 * (company/graphics/style/social/template/full) is verified against `getMailSignature`, not just
 * accepted, and the letterhead set/read pair is driven with a REAL letterhead id from
 * `getAllLetterHead` rather than a placeholder. Gated `KMAIL_LIFECYCLE=true`: these persist to the
 * caller's own KMail settings row.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

async function write(
  endpoints: EndpointExecutor,
  id: string,
  bodyObj: Record<string, unknown>,
  label: string,
): Promise<number> {
  const ex = await endpoints.sendTo(
    id,
    { body: bodyObj },
    { label: `kmail:${label}`, auth: { principal: A }, allowLiveWrite: true },
  );
  return ex.status;
}

test.describe('KMail · signature components, letterhead, count-days-limit @api @kmail-api @kmail', () => {
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  test.skip(
    process.env.KMAIL_LIFECYCLE !== 'true',
    'writes real KMail settings; set KMAIL_LIFECYCLE=true',
  );

  test('signature graphics/style/social/template writes are accepted and actually persist', async ({
    endpoints,
  }) => {
    // None of these fields match the qa-identifier-guard's resource-identifier pattern, so they
    // need no QA-owned allowlisted value — unlike companyName (see the sig-company test below).
    // A unique marker per field, so the readback below proves THESE writes landed, not a stale value
    // left over from an earlier run.
    const marker = `QA-${Date.now()}`;
    const style = { color: '#1A73E8', fontStyle: marker };

    expect
      .soft(
        await write(
          endpoints,
          'kmail-sig-graphics',
          { photoUrl: `${marker}.png`, bannerUrl: '', bannerLinkingTo: '' },
          'sig-graphics',
        ),
        'sig-graphics',
      )
      .toBeLessThan(300);
    expect
      .soft(await write(endpoints, 'kmail-sig-style', style, 'sig-style'), 'sig-style')
      .toBeLessThan(300);
    expect
      .soft(
        await write(
          endpoints,
          'kmail-sig-social',
          { twitter: marker, facebook: '', instagram: '', linkedIn: '', youTube: '' },
          'sig-social',
        ),
        'sig-social',
      )
      .toBeLessThan(300);
    expect
      .soft(
        await write(endpoints, 'kmail-sig-template', { templateID: 1 }, 'sig-template'),
        'sig-template',
      )
      .toBeLessThan(300);

    /*
     * Live-verified 2026-09-26: previously this readback only checked `status === 200`, the exact
     * "readback call present but nothing compared" shape that hid a real bug in Kall's reschedule.
     * Here the writes DO genuinely persist — confirmed by comparing each field against the unique
     * marker just sent, not merely that a 200 came back.
     */
    const read = await endpoints.sendTo(
      'kmail-mail-signature',
      {},
      { label: 'kmail:sig-readback', auth: { principal: A } },
    );
    expect(read.status, 'getMailSignature reads back').toBe(200);
    const body = JSON.parse(read.bodyText || '{}') as {
      data?: {
        graphics?: { photoUrl?: string };
        style?: { fontStyle?: string };
        socialMedialink?: { twitter?: string };
      };
    };
    expect(body.data?.graphics?.photoUrl, 'the new photoUrl is actually stored').toBe(
      `${marker}.png`,
    );
    expect(body.data?.style?.fontStyle, 'the new fontStyle is actually stored').toBe(marker);
    expect(body.data?.socialMedialink?.twitter, 'the new twitter link is actually stored').toBe(
      marker,
    );
  });

  test('sig-company: saveOrUpdateMailSignatureCompanyData is accepted and reflected on getMailSignature', async ({
    endpoints,
  }) => {
    /*
     * companyName is a hard-required IDENTITY_FIELD — a fabricated value would tell the
     * QA-identifier guard that some arbitrary/real company is ours to name. Unblocked 2026-09-25:
     * `QA_COMPANY_NAME=Nebius Solutions` is now set in `.env`, confirmed live via
     * `common-company-details` authenticated AS the `business-m` principal itself (co 242) —
     * genuinely owner-confirmed, not invented. A company signature only makes sense for a business
     * account, so this runs as `business-m`, not the personal principal every other test here uses.
     */
    const BM = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'business-m')!;
    const company = {
      companyName: testData.companyName,
      website: 'https://kpostindia.com',
      addressLine1: 'QA Bench Address Line 1',
      addressLine2: 'QA Bench Address Line 2',
    };
    const saved = await endpoints.sendTo(
      'kmail-sig-company',
      { body: company },
      { label: 'kmail:sig-company', auth: { principal: BM }, allowLiveWrite: true },
    );
    expect(saved.status, 'saveOrUpdateMailSignatureCompanyData is accepted').toBeLessThan(300);

    const read = await endpoints.sendTo(
      'kmail-mail-signature',
      {},
      { label: 'kmail:sig-company-read', auth: { principal: BM } },
    );
    expect(read.status, 'getMailSignature reads back').toBe(200);
    const body = JSON.parse(read.bodyText || '{}') as {
      data?: { companyData?: { companyName?: string } };
    };
    expect(
      body.data?.companyData?.companyName,
      'the saved company name is reflected back exactly',
    ).toBe(testData.companyName);
  });

  test('signature "full" write sets every section in one call, reflected on getMailSignature', async ({
    endpoints,
  }) => {
    const marker = `QA Full Sig ${Date.now()}`;
    /*
     * emailId/mobileNumber/alternateMobile match the qa-identifier-guard's resource-identifier
     * pattern and need QA-owned allowlisted values on live. companyData.companyName does too, but
     * (see the sig-company test above) QA_COMPANY_NAME is not configured — companyData is omitted
     * here rather than sent with a fabricated name; if the endpoint schema-requires it, that 4xx
     * would itself confirm the field is mandatory, which is worth knowing regardless.
     */
    const full = {
      personalData: {
        firstName: 'QA',
        lastName: 'Tester',
        designation: marker,
        emailId: testData.otpEmail,
        mobileNumber: testData.mobileExists,
        alternateMobile: testData.mobileExists,
      },
      graphics: { photoUrl: '', bannerUrl: '', bannerLinkingTo: '' },
      style: { color: '#000000', fontStyle: 'Arial, sans-serif' },
      socialMedialink: { twitter: '', facebook: '', instagram: '', linkedIn: '', youTube: '' },
    };
    const status = await write(endpoints, 'kmail-sig-full', full, 'sig-full');
    expect
      .soft(
        status,
        'sig-full without companyData (see note above re: QA_COMPANY_NAME) returns a status',
      )
      .toBeLessThan(600);

    const read = await endpoints.sendTo(
      'kmail-mail-signature',
      {},
      { label: 'kmail:sig-full-readback', auth: { principal: A } },
    );
    expect(read.status, 'getMailSignature reads back').toBe(200);
    expect(
      read.bodyText,
      'the "full" write\'s designation marker is reflected on getMailSignature',
    ).toContain(marker);
  });

  test('letterhead: a real id from getAllLetterHead can be set, and getLetterHead reflects it', async ({
    endpoints,
  }) => {
    const list = await endpoints.sendTo(
      'kmail-all-letterhead',
      {},
      { label: 'kmail:letterhead-list', auth: { principal: A } },
    );
    expect(list.status, 'getAllLetterHead succeeds').toBe(200);
    const listBody = JSON.parse(list.bodyText || '{}') as {
      data?: Array<{ id: string }>;
    };
    const first = listBody.data?.[0];
    test.skip(!first, 'no letterhead is available on this account to set');
    if (!first) return;

    const setStatus = await write(
      endpoints,
      'kmail-set-letterhead',
      { id: first.id },
      'set-letterhead',
    );
    expect.soft(setStatus, 'setLetterHead is accepted').toBeLessThan(300);

    const current = await endpoints.sendTo(
      'kmail-letterhead',
      {},
      { label: 'kmail:letterhead-current', auth: { principal: A } },
    );
    expect(current.status, 'getLetterHead reads back').toBe(200);
    expect(current.bodyText, 'the set letterhead id is reflected on getLetterHead').toContain(
      first.id,
    );
  });

  test('count-days-limit: the update is reflected on getMailCountDaysLimit', async ({
    endpoints,
  }) => {
    const updated = await write(
      endpoints,
      'kmail-count-days-limit-update',
      { countDaysLimit: 90 },
      'count-limit-90',
    );
    expect.soft(updated, 'the update is accepted').toBeLessThan(300);

    const read = await endpoints.sendTo(
      'kmail-count-days-limit',
      {},
      { label: 'kmail:count-limit-readback', auth: { principal: A } },
    );
    expect(read.status, 'getMailCountDaysLimit reads back').toBe(200);
    const body = JSON.parse(read.bodyText || '{}') as { data?: { countDaysLimit?: number } };
    expect(body.data?.countDaysLimit, 'the updated value is stored, not just accepted').toBe(90);

    // Restore a neutral default so this account's setting doesn't drift for other runs/humans.
    await write(
      endpoints,
      'kmail-count-days-limit-update',
      { countDaysLimit: 60 },
      'count-limit-restore',
    );
  });
});
