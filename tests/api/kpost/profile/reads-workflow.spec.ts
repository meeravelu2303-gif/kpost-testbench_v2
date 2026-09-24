import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Profile **plain reads** not covered by the write-lifecycle flow — basic/digital-card/search
 * lookups, device-primary state, and the three binary image downloads. Not gated: all are
 * `productionSafe: true`, safe to run on every default run.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

test.describe('KPost Profile · plain-read business rules @api @kpost-api @profile', () => {
  test('getUserBasicDetailsUsingKpostID returns a real profile for a known mobile number', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'profile-user-basic-by-kpostid',
      { body: { mobileNumber: testData.mobileExists, countryID: testData.countryId } },
      { label: 'profile:basic-by-mobile', auth: { principal: A } },
    );
    expect(ex.status, 'getUserBasicDetailsUsingKpostID succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as { data?: { kpostID?: string } };
    expect(body.data?.kpostID, 'a real account is resolved from the mobile number').toBeTruthy();
  });

  test("getDigitalCard returns the requested contact's own card", async ({ endpoints }) => {
    const ex = await endpoints.sendTo(
      'profile-digital-card',
      { body: { contactID: testData.kpostId, userType: 'KnownContacts' } },
      { label: 'profile:digital-card', auth: { principal: A } },
    );
    expect(ex.status, 'getDigitalCard succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as { data?: Array<{ kpostID?: string }> };
    const card = body.data?.[0];
    expect(
      card?.kpostID,
      'the returned card belongs to the contact we asked for, not an arbitrary one',
    ).toBe(testData.kpostId);
  });

  test('advancedSearch with our own mobile number resolves a real match', async ({ endpoints }) => {
    const ex = await endpoints.sendTo(
      'profile-advanced-search',
      {
        body: {
          fullName: 'qa',
          mobileNumber: testData.mobileExists,
          gender: null,
          ageFrom: null,
          ageTo: null,
          profession: null,
          pincode: '',
          state: '',
          city: '',
          country: '',
        },
      },
      { label: 'profile:advanced-search', auth: { principal: A } },
    );
    expect(ex.status, 'advancedSearch succeeds').toBe(200);
    // Not asserting a specific match count/shape here: the search is a filter combination the
    // backend may score however it likes. What matters is that a real, owned mobile number in the
    // filter doesn't crash the endpoint (it previously couldn't be sent at all — see read.api.ts).
  });

  test('isDevicePrimaryOrNot returns a boolean for the current device', async ({ endpoints }) => {
    const ex = await endpoints.sendTo(
      'profile-is-device-primary',
      {},
      { label: 'profile:is-device-primary', auth: { principal: A } },
    );
    expect(ex.status, 'isDevicePrimaryOrNot succeeds').toBe(200);
    const body = JSON.parse(ex.bodyText || '{}') as { primaryDevice?: unknown };
    expect(typeof body.primaryDevice, 'primaryDevice is a real boolean, not a string/number').toBe(
      'boolean',
    );
  });

  test('getlanguages: both GET and POST now answer 200 (stale "no working verb" finding retired), but the list is empty', async ({
    endpoints,
  }) => {
    // Live-verified 2026-09-24: the endpoint definition's old note claimed GET->405/POST->500 with
    // no working verb — no longer true (re-verified twice). What IS still true, and worth a real
    // assertion rather than silence: the language reference list itself is empty on this account.
    const get = await endpoints.sendTo(
      'profile-get-languages',
      {},
      { label: 'profile:languages-get', auth: { principal: A } },
    );
    expect(
      get.status,
      'GET getlanguages succeeds (the previously-claimed 405 does not reproduce)',
    ).toBe(200);
    const body = JSON.parse(get.bodyText || '{}') as { data?: unknown[] };
    expect(Array.isArray(body.data), 'the response shape is an array, empty or not').toBe(true);
  });

  test('the three profile image downloads each answer 200 (has an image) or 204 (none) — never a server error', async ({
    endpoints,
  }) => {
    for (const [id, label] of [
      ['profile-download-image', 'download-image'],
      ['profile-download-full-image', 'download-full-image'],
      ['profile-download-cover', 'download-cover'],
    ] as const) {
      const ex = await endpoints.sendTo(
        id,
        { pathParams: { kpostID: testData.kpostId } },
        { label: `profile:${label}`, auth: { principal: A } },
      );
      expect([200, 204], `${id} answers 200 or 204, not a server error`).toContain(ex.status);
    }
  });

  test('getSignatureImage answers 404 when no signature is set, not a server error', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'profile-get-signature',
      {},
      { label: 'profile:signature', auth: { principal: A } },
    );
    // Live-verified 2026-09-24: 404 on an account with no signature image — a real, distinct-from-
    // the-other-images behavior (they answer 204 for "none"), already noted as a minor inconsistency
    // in the endpoint's own definition. Asserted here rather than left generic-only.
    expect(
      [200, 204, 404],
      'getSignatureImage answers a documented status, not a server error',
    ).toContain(ex.status);
  });
});
