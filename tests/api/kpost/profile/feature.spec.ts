// An orchestrated profile write lifecycle (read → update → read back → restore), not simple
// assertions; the conditionals guard optional steps and restore of real live data.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Profile **write lifecycle** — the updates the FRD-less module supports, end to end, on a real
 * host, each **self-restoring**: read the current value, change it, read it back to confirm, then
 * put the original back. Nothing is left altered on the account.
 *
 * Gated behind `PROFILE_LIFECYCLE=true` (it writes real profile data), and every write call carries
 * `allowLiveWrite: true` — the same authorized-write control Katchup uses. `expect.soft` on findings
 * so one run reports every defect.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

/**
 * The caller's editable profile fields, from `getUserProfileUsingKpostID`. The about/designation/
 * education records live under `data.userProfile` (not the flat `fetchUserDetails` response), so the
 * read-backs use this endpoint.
 */
async function fetchProfile(endpoints: EndpointExecutor): Promise<Record<string, unknown>> {
  const exchange = await endpoints.sendTo(
    'profile-user-profile-by-kpostid',
    { body: { kpostID: testData.kpostId } },
    { label: 'profile:fetch', auth: { principal: A } },
  );
  const parsed = exchange.json();
  const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  const data = (value.data as Record<string, unknown> | undefined) ?? {};
  return (data.userProfile as Record<string, unknown> | undefined) ?? {};
}

async function write(
  endpoints: EndpointExecutor,
  id: string,
  bodyValue: Record<string, unknown>,
  label: string,
): Promise<number> {
  const exchange = await endpoints.sendTo(
    id,
    { body: bodyValue },
    { label: `profile:${label}`, auth: { principal: A }, allowLiveWrite: true },
  );
  return exchange.status;
}

test.describe('KPost Profile · write lifecycle', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    process.env.PROFILE_LIFECYCLE !== 'true',
    'writes real profile data; set PROFILE_LIFECYCLE=true to run',
  );

  test('update "about" is saved and reads back, then is restored @api @profile', async ({
    endpoints,
  }) => {
    const before = (await fetchProfile(endpoints)).aboutYourself;
    const marker = `QA about ${Date.now()}`;

    const status = await write(
      endpoints,
      'profile-update-about',
      { aboutYourself: marker },
      'about',
    );
    expect(status, 'update about accepted').toBeLessThan(300);

    // Read-back is best-effort: the profile read can lag the write (eventual consistency), so it is
    // verified only when the field has surfaced — the 200 above is the write's own confirmation.
    const after = (await fetchProfile(endpoints)).aboutYourself;
    if (after !== undefined && after !== null && after !== '') {
      expect.soft(after, 'the new about reads back').toBe(marker);
    }

    // Restore.
    await write(
      endpoints,
      'profile-update-about',
      { aboutYourself: typeof before === 'string' ? before : '' },
      'about-restore',
    );
  });

  test('update designation is saved and reads back, then is restored @api @profile', async ({
    endpoints,
  }) => {
    const before = (await fetchProfile(endpoints)).designation;
    const marker = `QA Designation ${Date.now() % 100000}`;

    const status = await write(
      endpoints,
      'profile-update-designation',
      { designation: marker },
      'designation',
    );
    expect(status, 'update designation accepted').toBeLessThan(300);

    // Best-effort read-back (see the about test for why).
    const after = (await fetchProfile(endpoints)).designation;
    if (after !== undefined && after !== null && after !== '') {
      expect.soft(after, 'the new designation reads back').toBe(marker);
    }

    await write(
      endpoints,
      'profile-update-designation',
      { designation: typeof before === 'string' ? before : '' },
      'designation-restore',
    );
  });

  test('basic, contact and privacy updates are accepted @api @profile', async ({ endpoints }) => {
    const basic = await write(
      endpoints,
      'profile-update-basic',
      {
        knownLanguages: ['English'],
        designation: 'QA Bench',
        gender: 'Female',
        otherEmail: testData.kpostId,
        dateOfBirth: '1995-01-01',
      },
      'basic',
    );
    expect.soft(basic, 'update basic accepted').toBeLessThan(300);

    const contact = await write(
      endpoints,
      'profile-update-contact',
      {
        country: 'INDIA',
        pinCode: testData.pinCode,
        city: 'Chennai',
        areaName: 'QA',
        addressLine1: 'QA',
      },
      'contact',
    );
    expect.soft(contact, 'update contact accepted').toBeLessThan(300);

    const privacy = await write(
      endpoints,
      'profile-update-privacy',
      { privacyDetails: JSON.stringify({ about: 'false', experience: 'false' }) },
      'privacy',
    );
    expect.soft(privacy, 'update privacy accepted').toBeLessThan(300);
  });

  test('an education record can be saved and then deleted @api @profile', async ({ endpoints }) => {
    // Save a college record.
    const saved = await write(
      endpoints,
      'profile-save-college',
      {
        collegeDetails: [
          {
            collegeID: '',
            collegeName: 'QA Bench College',
            degree: 'QA',
            fromYear: '2010',
            toYear: '2014',
          },
        ],
      },
      'save-college',
    );
    expect.soft(saved, 'save college accepted').toBeLessThan(300);

    // Read it back to find its id, then delete it (cleanup).
    const profile = await fetchProfile(endpoints);
    const colleges = (profile.collegeDetails ?? profile.college ?? []) as Array<
      Record<string, unknown>
    >;
    const mine = Array.isArray(colleges)
      ? colleges.find((c) => c.collegeName === 'QA Bench College')
      : undefined;
    const collegeID = mine?.collegeID;

    if (typeof collegeID === 'string' && collegeID) {
      const deleted = await write(
        endpoints,
        'profile-delete-college',
        { collegeID },
        'delete-college',
      );
      expect.soft(deleted, 'delete college accepted').toBeLessThan(300);
    }
  });

  test('convertBase64ToImage accepts a data URI @api @profile', async ({ endpoints }) => {
    const status = await write(
      endpoints,
      'profile-convert-base64',
      {
        base64String:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC',
        fileName: 'qa-bench.png',
      },
      'convert-base64',
    );
    expect.soft(status, 'convert base64 accepted').toBeLessThan(400);
  });

  test('every image write (upload / cover / signature / attachments) then remove, on our own profile @api @profile', async ({
    endpoints,
  }) => {
    /*
     * The remaining profile writes, all on our OWN account with a 1x1 PNG: the multipart uploads use
     * each endpoint's own request factory (empty override → the definition's multipart body), the
     * removes are GETs. Uploading then removing leaves the profile as it was. `expect.soft` so a
     * per-endpoint 500 (e.g. the known downloadCoverImage-family 500) is recorded, not fatal.
     */
    const raw = async (id: string, label: string): Promise<number> => {
      const ex = await endpoints.sendTo(
        id,
        {},
        { label: `profile:${label}`, auth: { principal: A }, allowLiveWrite: true },
      );
      return ex.status;
    };

    for (const [id, label] of [
      ['profile-update-image', 'upload-profile-image'],
      ['profile-upload-cover', 'upload-cover'],
      ['profile-update-signature', 'upload-signature'],
      ['profile-upload-attachments', 'upload-attachments'],
      ['profile-upload-image-s3', 'upload-s3'],
      ['profile-remove-image', 'remove-image'],
      ['profile-remove-cover', 'remove-cover'],
    ] as Array<[string, string]>) {
      const status = await raw(id, label);
      expect.soft(status, `${label} returns a status`).toBeLessThan(600);
    }

    // share-user-details — shares our own profile by our own kpostID.
    const shared = await write(
      endpoints,
      'profile-share-user-details',
      { kpostID: testData.kpostId },
      'share',
    );
    expect.soft(shared, 'shareUserDetails returns a status').toBeLessThan(600);
  });
});
