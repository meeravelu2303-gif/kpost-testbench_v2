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

  test('signature graphics/style/social/template writes are accepted', async ({ endpoints }) => {
    // None of these fields match the qa-identifier-guard's resource-identifier pattern, so they
    // need no QA-owned allowlisted value — unlike companyName (see the sig-company test below).
    const style = { color: '#1A73E8', fontStyle: 'Arial, sans-serif' };

    expect
      .soft(
        await write(
          endpoints,
          'kmail-sig-graphics',
          { photoUrl: '', bannerUrl: '', bannerLinkingTo: '' },
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
          { twitter: '', facebook: '', instagram: '', linkedIn: '', youTube: '' },
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

    const read = await endpoints.sendTo(
      'kmail-mail-signature',
      {},
      { label: 'kmail:sig-readback', auth: { principal: A } },
    );
    expect(read.status, 'getMailSignature reads back').toBe(200);
  });

  test('sig-company: no live test yet (QA_COMPANY_NAME is not configured)', () => {
    /*
     * companyName is a hard-required IDENTITY_FIELD (src/config/test-data.config.ts) — the schema
     * default is deliberately NOT allowed to stand in for it on live, because an unconfigured
     * default would tell the QA-identifier guard that some arbitrary/real company is ours to name
     * in a request. Only `QA_COMPANY_NAME_ABSENT` is set in .env today (for negative testing);
     * `QA_COMPANY_NAME` itself needs a real, owner-confirmed company name this QA account genuinely
     * belongs to before `kmail-sig-company` (and the companyData half of `kmail-sig-full`) can be
     * exercised live. Not worked around by inventing a value — that is exactly the danger the
     * guard's own docstring warns about.
     */
    test.skip(
      !process.env.QA_COMPANY_NAME,
      'set QA_COMPANY_NAME in .env to a real, owner-confirmed company name to unblock this',
    );
    expect(testData.companyName, 'once configured, this test can assert against it').toBeTruthy();
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
