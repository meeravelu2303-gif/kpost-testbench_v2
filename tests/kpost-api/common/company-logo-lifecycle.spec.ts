import type { APIRequestContext } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Company logo (FR-S05) on the QA company: its admin sets, reads back and removes the logo; another
 * company's admin and an ordinary account are refused both changes (CommonControllerV2
 * updateCompanyLogo and AdminController removeCompanyLogo check isCompanyAdmin). The logo is a
 * shared company setting, so the original is restored whatever happens. QA test server only.
 */

const K = AUTH_PROFILES.kpost;
const ADMIN = K.principals.find((p) => p.key === 'business-m');
const OTHER_ADMIN = K.principals.find((p) => p.key === 'business-s');
const ORDINARY = K.principals.find((p) => p.key === 'personal-5');
const COMPANY = testData.businessMCompanyId;

/** A 1x1 PNG, generated rather than committed. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC',
  'base64',
);

interface Logo {
  status: number;
  bytes?: Buffer;
  type?: string;
}

/** The logo's bytes as the admin sees them (the executor keeps only text, so this reads raw). */
async function readLogo(endpoints: EndpointExecutor, request: APIRequestContext): Promise<Logo> {
  const token = await endpoints.tokens.tokenFor(ADMIN!, K);
  const base = env.KPOST_API_BASE_URL ?? env.API_BASE_URL;
  const res = await request.get(`${base}/v2/common/downloadCompanyLogo/${COMPANY}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status() === 200
    ? { status: 200, bytes: await res.body(), type: res.headers()['content-type'] }
    : { status: res.status() };
}

const upload = (
  endpoints: EndpointExecutor,
  who: Principal,
  file: { name: string; mimeType: string; buffer: Buffer },
  label: string,
) =>
  endpoints.sendTo(
    'common-update-company-logo',
    { multipart: { file, text: JSON.stringify({ companyID: COMPANY }) } },
    { label: `company-logo:${label}`, auth: { principal: who }, allowGlobalLifecycle: true },
  );

const remove = (endpoints: EndpointExecutor, who: Principal, label: string) =>
  endpoints.sendTo(
    'common-remove-company-logo',
    { body: { companyId: COMPANY } },
    { label: `company-logo:${label}`, auth: { principal: who }, allowGlobalLifecycle: true },
  );

test.describe(
  'KPost Common · company logo set, refused to others, removed, restored',
  { tag: ['@api', '@platform', '@security', '@regression'] },
  () => {
    test.skip(
      process.env.GLOBAL_LIFECYCLE !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'changes the QA company’s logo (restored afterwards); set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true',
    );
    test.skip(
      !ADMIN || !OTHER_ADMIN || !ORDINARY,
      'needs the BUSINESS_M and BUSINESS_S admins and the 5th QA account',
    );

    test('only the company’s admin can set or remove its logo (FR-S05)', async ({
      endpoints,
      request,
    }) => {
      const original = await readLogo(endpoints, request);
      expect([200, 404], `the current logo reads cleanly (got ${original.status})`).toContain(
        original.status,
      );
      try {
        // Strangers first, while the original is in place: nothing they send may change it.
        for (const [who, principal] of [
          ['another company’s admin', OTHER_ADMIN!],
          ['an ordinary account', ORDINARY!],
        ] as const) {
          const set = await upload(
            endpoints,
            principal,
            { name: 'qa-bench-logo.png', mimeType: 'image/png', buffer: PNG },
            `stranger-set:${who}`,
          );
          expect.soft(set.status, `${who} cannot set this company's logo`).toBe(403);
          const unset = await remove(endpoints, principal, `stranger-remove:${who}`);
          expect.soft(unset.status, `${who} cannot remove this company's logo`).toBe(403);
        }
        const untouched = await readLogo(endpoints, request);
        expect
          .soft(untouched.bytes?.equals(original.bytes ?? Buffer.alloc(0)) ?? untouched.status)
          .toBe(original.bytes ? true : original.status);

        // The admin sets a logo and reads back exactly those bytes.
        const set = await upload(
          endpoints,
          ADMIN!,
          { name: 'qa-bench-logo.png', mimeType: 'image/png', buffer: PNG },
          'admin-set',
        );
        expect.soft(set.status, 'the admin can set the logo').toBe(200);
        const now = await readLogo(endpoints, request);
        expect.soft(now.status, 'the new logo can be downloaded').toBe(200);
        expect.soft(now.bytes?.equals(PNG), 'the downloaded logo is the uploaded file').toBe(true);

        // The admin removes it; the download then answers 404 (no logo), not 500.
        const removed = await remove(endpoints, ADMIN!, 'admin-remove');
        expect.soft(removed.status, 'the admin can remove the logo').toBe(200);
        expect.soft((await readLogo(endpoints, request)).status, 'no logo reads as 404').toBe(404);
        // Removing a logo that is not there is a no-op or a 404, never a crash.
        const again = await remove(endpoints, ADMIN!, 'admin-remove-again');
        expect
          .soft(again.status, 'removing an absent logo answers 200 or 404, not a server error')
          .toBeLessThan(500);
      } finally {
        // Put the company's own logo back (or none, as it was).
        if (original.bytes) {
          const ext = /jpe?g/.test(original.type ?? '') ? 'jpg' : 'png';
          await upload(
            endpoints,
            ADMIN!,
            {
              name: `company-logo.${ext}`,
              mimeType: original.type ?? 'image/png',
              buffer: original.bytes,
            },
            'restore',
          );
        } else if ((await readLogo(endpoints, request)).status === 200) {
          await remove(endpoints, ADMIN!, 'restore-none');
        }
        const restored = await readLogo(endpoints, request);
        expect
          .soft(
            original.bytes ? restored.bytes?.equals(original.bytes) : restored.status === 404,
            'the company’s original logo is back',
          )
          .toBe(true);
      }
    });
  },
);
